/**
 * Builds both faces of this package with the esbuild CLI.
 *
 * The harness repository owns a `clientBundle()` preset, but it resolves its
 * target through the per-package manifests under the checkout and therefore
 * cannot build a package that lives outside it. This script reproduces the two
 * contracts that preset owns: the Host half is plain ESM with every harness
 * specifier left external, and the browser half is a CommonJS factory
 * registered through `window.__ModuleLoader__.load(...)` with exactly the
 * shell's platform modules left external.
 *
 * The CLI is invoked rather than the JavaScript API on purpose. esbuild's API
 * talks to its native binary over piped stdio, which the DSH file sandbox
 * refuses; the CLI launcher spawns with `stdio: 'inherit'`, which the sandbox
 * permits. Only the launcher is used, so this runs without a shell.
 */
import { readFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

/** The package name doubles as the module-table id the browser half registers under. */
const id = pkg.name

const esbuildBin = resolve(root, 'node_modules/esbuild/bin/esbuild')
if (!existsSync(esbuildBin)) {
  throw new Error(`build: ${esbuildBin} is missing. Run "npm install --ignore-scripts" first.`)
}

/**
 * Specifiers the web shell seeds into its frozen module table
 * (`packages/client/web/src/platform.ts`). Everything else is bundled in, so a
 * feature package cannot silently pick up a second copy of a shared library.
 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

const FACTORY_OPEN = `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`
const FACTORY_CLOSE = 'return module.exports; } });'

/**
 * The factory receives `require` but neither `module` nor `exports`, so the
 * banner has to open the wrapper and stand up that pair before any bundled code
 * runs. esbuild's CLI has no `--intro`, and its banner is emitted ahead of the
 * format wrapper, so both jobs live here.
 */
const clientBanner = `${FACTORY_OPEN}\nvar module = { exports: {} }; var exports = module.exports;`

const hostArgs = [
  'src/index.ts',
  '--bundle',
  '--format=esm',
  '--platform=node',
  '--target=node22',
  '--outfile=lib/index.js',
  '--sourcemap',
  '--external:@deepseek-ai/*',
  '--external:node:*',
  '--log-level=info',
]

/**
 * The pure resolution core, bundled separately so the keyless smoke test can
 * exercise the agent and workspace rules without standing up a Cordis context.
 * Not part of the plugin surface: `lib/index.js` is what the Loader mounts.
 */
const coreArgs = [
  'src/core.ts',
  '--bundle',
  '--format=esm',
  '--platform=node',
  '--target=node22',
  '--outfile=lib/core.js',
  '--external:@deepseek-ai/*',
  '--log-level=info',
]

/**
 * The mode's row, loaded by a preset rather than by the profile patch. Kept a
 * separate entry so the Host plane stays free of the tool and the listener.
 */
const modeArgs = [
  'src/mode.ts',
  '--bundle',
  '--format=esm',
  '--platform=node',
  '--target=node22',
  '--outfile=lib/mode.js',
  '--sourcemap',
  '--external:@deepseek-ai/*',
  '--external:node:*',
  '--log-level=info',
]

/** Every face the build produces, in order. */
const FACES = [hostArgs, modeArgs, coreArgs]

const clientArgs = [
  'src/client/index.tsx',
  '--bundle',
  '--format=cjs',
  '--platform=browser',
  '--target=es2022',
  '--jsx=automatic',
  '--outfile=lib/client.js',
  '--sourcemap',
  ...PLATFORM_MODULES.map(specifier => `--external:${specifier}`),
  '--define:process.env.NODE_ENV="production"',
  `--banner:js=${clientBanner}`,
  `--footer:js=${FACTORY_CLOSE}`,
  '--log-level=info',
]

/**
 * Asserts the browser artifact still opens and closes the factory wrapper the
 * module table requires. Losing either half surfaces as a bundle that never
 * registers, not as an error, so it is checked here.
 */
function verify() {
  const clientPath = resolve(root, 'lib/client.js')
  const hostPath = resolve(root, 'lib/index.js')
  const modePath = resolve(root, 'lib/mode.js')
  const corePath = resolve(root, 'lib/core.js')
  if (!existsSync(hostPath)) throw new Error('verify: lib/index.js is missing')
  if (!existsSync(modePath)) throw new Error('verify: lib/mode.js is missing')
  if (!existsSync(corePath)) throw new Error('verify: lib/core.js is missing')

  const source = readFileSync(clientPath, 'utf8')
  // A linked source map appends its comment after the footer.
  const withoutMapComment = source.replace(/\n?\/\/# sourceMappingURL=[^\n]*\s*$/, '').trimEnd()

  if (!source.startsWith(FACTORY_OPEN)) {
    throw new Error(`verify: lib/client.js does not open with the module-table banner for "${id}"`)
  }
  if (!withoutMapComment.endsWith(FACTORY_CLOSE)) {
    throw new Error('verify: lib/client.js does not close the module-table factory')
  }
  process.stdout.write(`verify: ${id} module-table wrapper ok\n`)
}

mkdirSync(resolve(root, 'lib'), { recursive: true })

const watch = process.argv.includes('--watch')

if (watch) {
  // Every face watches concurrently; the live child processes keep this one
  // alive until the user interrupts it.
  for (const args of [...FACES, clientArgs]) {
    const child = spawn(process.execPath, [esbuildBin, ...args, '--watch'], { stdio: 'inherit', cwd: root })
    child.on('exit', code => { if (code !== 0) process.exitCode = code })
  }
} else {
  for (const args of [...FACES, clientArgs]) {
    execFileSync(process.execPath, [esbuildBin, ...args], { stdio: 'inherit', cwd: root })
  }
  verify()
}
