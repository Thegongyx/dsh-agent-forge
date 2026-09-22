/**
 * Installs the mode's preset and checks that its row will resolve.
 *
 * A preset row's `name` is a module specifier, and dsh resolves a **package**
 * name against the profile: `rowResolves` hands it to `packageInstalled`, which
 * walks `node_modules` upward from the profile's directory. That is not the same
 * question as Node's own resolution from the preset's directory — measured, Node
 * answers `MODULE_NOT_FOUND` there — so a check written against Node reports a
 * healthy preset as broken and sends the reader chasing a problem that does not
 * exist. This script mirrors dsh's own test instead, and dsh reports the same
 * answer in the roster row's `broken` field.
 *
 * The row therefore keeps the portable package name. Only `file:` and relative
 * specifiers are resolved against the preset's own directory, and this preset
 * names a package.
 *
 * @module dsh-agent-forge/scripts/install-preset
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageName = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name

/** Preset id, which is also its directory name. */
const PRESET_ID = 'agent-forge'

/** Row name as the preset spells it. */
const ROW_NAME = `${packageName}/mode`

const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', process.env.DSH_PROFILE ?? 'web')
const presetDir = join(dshHome, '.agent-presets', PRESET_ID)
const sourceDir = join(root, 'presets', PRESET_ID)

if (!existsSync(join(profileDir, 'package.json'))) {
  throw new Error(`install-preset: ${profileDir} is not a profile; install the plugin into it first`)
}

/**
 * Whether a package directory sits above one directory.
 *
 * Mirrors dsh's `packageInstalled`: a bare specifier is satisfied by an upward
 * `node_modules` walk from the harness base, and the specifier's subpath is
 * irrelevant to that test.
 * @param specifier - the row name, possibly carrying a subpath.
 * @param from - the directory to walk up from, as dsh walks from the profile.
 * @returns true when the package is installed above `from`.
 */
function packageInstalled(specifier, from) {
  const pkg = specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/')
  for (let dir = from; ;) {
    if (existsSync(join(dir, 'node_modules', pkg, 'package.json'))) return true
    const parent = dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}

mkdirSync(presetDir, { recursive: true })
for (const file of ['agent.cordis.yml', 'preset.yml']) {
  copyFileSync(join(sourceDir, file), join(presetDir, file))
}
process.stdout.write(`install-preset: copied preset to ${presetDir}\n`)

if (!packageInstalled(ROW_NAME, profileDir)) {
  // dsh would report the preset as broken rather than fail at session creation,
  // so saying so here is the same diagnosis one step earlier.
  throw new Error(
    `install-preset: "${ROW_NAME}" is not installed above ${profileDir}. `
    + 'Run `dsh plugin --profile web add <tarball>` first, otherwise dsh will list '
    + `preset "${PRESET_ID}" as broken.`,
  )
}
process.stdout.write(
  `install-preset: "${ROW_NAME}" resolves the way dsh resolves it (upward from ${profileDir})\n`,
)
