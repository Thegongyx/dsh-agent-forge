/**
 * Installed-environment checks, against the harness's own dependencies.
 *
 * The keyless suites in `scripts/smoke*.mjs` exercise pure functions and the
 * built artifacts. They cannot see the two failure modes this file exists for:
 * a plugin that does not survive being mounted by real Cordis, and a settings
 * namespace that real schemastery refuses to register. Both are invisible from
 * outside — the harness's logger has no exporter in this deployment, so a failed
 * fiber produces no output at all — which is how a schema bug that killed the
 * whole settings page survived every offline suite.
 *
 * So this mounts the **installed** package against the very same `cordis` and
 * `dsh-settings-file` the harness loads, and asserts what those mounts produce.
 * It needs the package installed into the profile, so it is not part of `check`.
 * Run it with `npm run check:installed`.
 *
 * @module dsh-agent-forge/scripts/installed-smoke
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const dshHome = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
const profile = join(dshHome, 'profiles', process.env.DSH_PROFILE ?? 'web')
const installed = join(profile, 'node_modules', 'dsh-agent-forge')

if (!existsSync(join(installed, 'lib', 'index.js'))) {
  throw new Error(
    `installed-smoke: ${installed} is missing. Install the package into the profile first `
    + '(see README "Install"), then re-run.',
  )
}

const requireFromPlugin = createRequire(join(installed, 'lib', 'index.js'))
const load = specifier => import(pathToFileURL(requireFromPlugin.resolve(specifier)).href)

// Generated presets are written under `DSH_HOME`, so the smoke runs against a
// scratch home. Without this the host half's construction overwrote the
// deployment's own `~/.dsh/.agent-presets/<agent>/` files — a test that silently
// rewrites the thing it is testing is worse than no test.
const scratchHome = mkdtempSync(join(tmpdir(), 'agent-forge-home-'))
process.env.DSH_HOME = scratchHome
writeFileSync(join(scratchHome, 'settings.yaml'), '', 'utf8')

const cordis = await load('@deepseek-ai/cordis')
const settingsFile = await load('@deepseek-ai/dsh-settings-file')
const host = await import(pathToFileURL(join(installed, 'lib', 'index.js')).href)
const mode = await import(pathToFileURL(join(installed, 'lib', 'mode.js')).href)

/** Row configuration a deployment would write in `cordis.yml`. */
const row = { builtinLocale: 'zh', agents: {}, workspaces: {}, fallbackDispatchRule: '' }

/**
 * Builds a context and drains its lifecycle, the way the Loader does.
 * @returns the root context.
 */
async function context() {
  const ctx = new cordis.Context()
  const settle = async fiber => {
    if (fiber && typeof fiber.then === 'function') await fiber
    if (ctx.lifecycle?.then) await ctx.lifecycle
  }
  ctx.settle = settle
  return ctx
}

// ------------------------------------------------------- the host half mounts

{
  const ctx = await context()
  await ctx.settle(ctx.plugin(host.default, row))

  const forge = ctx.get('agentForge')
  assert.notEqual(forge, undefined, 'installed-smoke: the host row did not publish its service')
  assert.equal(forge.constructor.name, 'AgentForge')

  const agents = forge.listAgents()
  assert.deepEqual(agents.map(agent => agent.id), ['spendthrift', 'patchwork', 'sightreader'])
  assert.equal(agents[0].label, '挥金如土', 'installed-smoke: built-in copy is not localised')
  assert.ok(agents.every(agent => agent.persona.length > 0), 'installed-smoke: a built-in agent has no persona')

  // With no settings provider the service must answer from the composition entry.
  assert.deepEqual(forge.settings(), { agents: {}, workspaces: {}, fallbackDispatchRule: '' })
  assert.ok(forge.workspace(undefined).dispatchRule.length > 0, 'installed-smoke: no fallback rules resolved')
  process.stdout.write('installed-smoke: the host half mounts and resolves\n')
}

// ------------------------------------------- the namespace registers for real

{
  const dir = mkdtempSync(join(tmpdir(), 'agent-forge-smoke-'))
  const document = join(dir, 'settings.yaml')
  writeFileSync(document, [
    'agent-forge:',
    '  fallbackDispatchRule: RULE_FROM_THE_USER_DOCUMENT',
    '  agents:',
    // Deliberately sparse: no model route, no tool filter. Schemastery resolving
    // an object schema validates its nested members whether or not the caller
    // supplied the object, so a nested required field rejects this entry and
    // takes the whole namespace registration down with it.
    '    auditor:',
    '      label: Auditor',
    '      persona: review things',
    '  workspaces:',
    '    ws-1:',
    '      enabled: [spendthrift, auditor]',
    '      lead: auditor',
    '',
  ].join('\n'), 'utf8')

  const ctx = await context()
  await ctx.settle(ctx.plugin(settingsFile.default, { path: document, watch: false }))
  const provider = ctx.get('settings')
  await ctx.settle(ctx.plugin(host.default, row))
  await new Promise(resolve => setTimeout(resolve, 200))

  assert.ok(
    provider.describe().some(descriptor => descriptor.ns === 'agent-forge'),
    'installed-smoke: the settings namespace never registered',
  )

  const forge = ctx.get('agentForge')
  const agents = forge.listAgents()
  assert.ok(
    agents.some(agent => agent.id === 'auditor' && agent.builtin === false),
    'installed-smoke: a user-authored agent is invisible',
  )
  // The document above names no tool filter, and the schema materializes an empty
  // one anyway. Resolution must not carry it: the runtime applies a filter to what
  // the child inherits, so an empty allow-list leaves the child with no tools while
  // its turn still settles `completed`.
  assert.equal(
    agents.find(agent => agent.id === 'auditor')?.tools,
    undefined,
    'installed-smoke: a materialized-empty tool filter survived resolution',
  )
  // The dispatch rules name agents in the deployment's language; ids are English.
  // Both have to resolve, or the model cannot address what the rules taught it.
  const spendthrift = agents.find(agent => agent.id === 'spendthrift')
  assert.equal(forge.getAgent('auditor')?.id, 'auditor', 'installed-smoke: an id stopped resolving')
  assert.equal(
    forge.getAgent(spendthrift.label)?.id,
    'spendthrift',
    'installed-smoke: an agent was unreachable by its display name',
  )
  assert.equal(
    forge.getAgent(`  ${spendthrift.id.toUpperCase()}  `)?.id,
    'spendthrift',
    'installed-smoke: an id did not survive transcription',
  )
  assert.equal(forge.getAgent('ghost'), undefined, 'installed-smoke: an unknown name resolved to an agent')
  assert.equal(
    forge.workspace(undefined).dispatchRule,
    'RULE_FROM_THE_USER_DOCUMENT',
    'installed-smoke: the user document layer did not win',
  )
  assert.equal(forge.workspace('ws-1').lead?.id, 'auditor', 'installed-smoke: the workspace lead was not honoured')
  process.stdout.write('installed-smoke: the settings namespace registers and the user layer wins\n')
}

// ------------------------------------------------------- the mode half mounts

{
  const ctx = await context()
  const registered = []
  const started = []

  // Only the two services the mode consumes are stood in for; everything else,
  // including `defineTool` and the host service, is real.
  ctx.provide('tools', { register: definition => { registered.push(definition); return () => {} } })
  ctx.provide('subagents', {
    // The mode registers one provider per agent, so this stand-in registry has to
    // accept registrations and resolve them back by name.
    registered: [],
    registerProvider(provider) {
      this.registered.push(provider)
      return () => { this.registered = this.registered.filter(candidate => candidate !== provider) }
    },
    getProvider(name) {
      return this.registered.find(provider => provider.name === name) ?? {
        name: 'spawn',
        capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      }
    },
    start: async (name, request) => {
      started.push({ name, request })
      return {
        id: 'child-1',
        result: Promise.resolve({ output: [{ type: 'text', text: 'done' }], stopReason: 'completed' }),
      }
    },
  })

  await ctx.settle(ctx.plugin(host.default, row))
  await ctx.settle(ctx.plugin(mode, { dispatchToolName: 'forge_dispatch', dispatchProvider: 'spawn' }))
  await new Promise(resolve => setTimeout(resolve, 200))

  assert.equal(registered.length, 1, 'installed-smoke: the mode registered no tool')
  assert.equal(registered[0].name, 'forge_dispatch', 'installed-smoke: the tool ignored the configured name')

  const value = await registered[0].execute(
    { agent: 'patchwork', prompt: 'rename the files' },
    { agent: { id: 'parent' }, signal: new AbortController().signal },
  )
  assert.equal(value.agent, 'patchwork')
  assert.equal(value.subagentId, 'child-1')
  assert.equal(value.output, 'done')
  // The mode registers one provider per agent under `<namespace>:<agentId>`, so
  // the started name carries the agent — that resolution is the whole point.
  assert.equal(started[0].name, 'spawn:patchwork')
  // The canvas groups runs by the agent name this label leads with.
  assert.equal(started[0].request.label, '缝缝补补 · rename the files')
  assert.ok(
    started[0].request.persona.includes('机械改写'),
    'installed-smoke: the child did not receive the patchwork persona',
  )

  // End to end through the real service and a real settings document: the document
  // names no tool filter, schemastery materializes an empty one anyway, and the
  // runtime applies whatever the tool forwards to everything the child inherits.
  // An empty allow-list therefore emptied the child's tool catalogue, which is how
  // a delegation "completed" having run no tool at all.
  const document = join(mkdtempSync(join(tmpdir(), 'agent-forge-mode-')), 'settings.yaml')
  writeFileSync(document, [
    'agent-forge:',
    '  agents:',
    '    auditor:',
    '      label: Auditor',
    '      persona: review things',
    '',
  ].join('\n'), 'utf8')
  const withSettings = await context()
  const settingsTools = []
  withSettings.provide('tools', {
    register: definition => { settingsTools.push(definition); return () => {} },
  })
  withSettings.provide('subagents', {
    registered: [],
    registerProvider(provider) {
      this.registered.push(provider)
      return () => { this.registered = this.registered.filter(candidate => candidate !== provider) }
    },
    getProvider(name) {
      return this.registered.find(provider => provider.name === name)
    },
    start: async (name, request) => {
      started.push({ name, request })
      return { id: 'child-2', result: Promise.resolve({ output: [{ type: 'text', text: 'done' }], stopReason: 'completed' }) }
    },
  })
  await withSettings.settle(withSettings.plugin(settingsFile.default, { path: document, watch: false }))
  await withSettings.settle(withSettings.plugin(host.default, row))
  await withSettings.settle(withSettings.plugin(mode, { dispatchToolName: 'forge_dispatch', dispatchProvider: 'spawn' }))
  await new Promise(resolve => setTimeout(resolve, 200))
  const dispatch = settingsTools.find(definition => definition.name === 'forge_dispatch')
  assert.notEqual(dispatch, undefined, 'installed-smoke: the settings-backed mode registered no tool')
  await dispatch.execute(
    { agent: 'auditor', prompt: 'review the change' },
    { agent: { id: 'parent' }, signal: new AbortController().signal },
  )
  const audited = started.at(-1)
  assert.equal(audited.name, 'spawn:auditor', 'installed-smoke: the settings-backed agent did not dispatch')
  assert.equal(
    audited.request.toolFilter,
    undefined,
    'installed-smoke: a materialized-empty tool filter reached the delegation runtime',
  )
  assert.ok(audited.request.persona.includes('review things'), 'installed-smoke: the persona was lost on that path')
  process.stdout.write('installed-smoke: the mode registers its tool and runs a delegation\n')
}

// ------------------- a generated composition is the baseline plus the agent's

{
  const document = join(mkdtempSync(join(tmpdir(), 'agent-forge-baseline-')), 'settings.yaml')
  writeFileSync(document, [
    'agent-forge:',
    '  agents:',
    '    worker:',
    '      label: Worker',
    '      persona: work',
    '      plugins:',
    '        - my-extra-plugin',
    '    helper:',
    '      label: Helper',
    '      persona: help',
    '    taken:',
    '      label: Taken',
    '      persona: taken',
    '',
  ].join('\n'), 'utf8')

  // A directory this plugin did not generate, under the id of one of those agents.
  // Every agent now runs the composition named after its own id, so writing this
  // one would replace somebody else's preset.
  const foreign = join(scratchHome, '.agent-presets', 'taken')
  mkdirSync(foreign, { recursive: true })
  writeFileSync(join(foreign, 'preset.yml'), "name: 'not ours'\n", 'utf8')
  writeFileSync(join(foreign, 'agent.cordis.yml'), '# somebody else wrote this\n', 'utf8')

  const ctx = await context()
  await ctx.settle(ctx.plugin(settingsFile.default, { path: document, watch: false }))
  // No preset roster is mounted anywhere in this suite, and none is needed: the
  // baseline is this package's own file.
  await ctx.settle(ctx.plugin(host.default, row))
  await new Promise(resolve => setTimeout(resolve, 200))

  const workerFile = join(scratchHome, '.agent-presets', 'worker', 'agent.cordis.yml')
  const helperFile = join(scratchHome, '.agent-presets', 'helper', 'agent.cordis.yml')
  assert.ok(existsSync(workerFile), 'installed-smoke: an agent that adds its own rows got no composition')
  const worker = readFileSync(workerFile, 'utf8')
  for (const inherited of [
    "name: '@deepseek-ai/dsh-tool-fs'",
    "name: '@deepseek-ai/dsh-tool-fs-search'",
    "name: '@deepseek-ai/dsh-tool-skill'",
    "name: '@deepseek-ai/dsh-tool-web'",
    'terminals: true',
  ]) {
    assert.ok(worker.includes(inherited), `installed-smoke: the generated composition lost ${inherited}`)
  }
  assert.ok(
    worker.includes("name: 'my-extra-plugin'"),
    'installed-smoke: the checked plugin is missing from the generated composition',
  )
  assert.ok(
    worker.indexOf('@deepseek-ai/dsh-tool-fs') < worker.indexOf('my-extra-plugin'),
    'installed-smoke: the baseline rows must precede the agent\'s own',
  )
  // An agent that adds nothing of its own still gets a file — the baseline — because
  // a human can pick that preset for a session too.
  assert.ok(existsSync(helperFile), 'installed-smoke: an agent with no additions got no composition')
  assert.ok(
    readFileSync(helperFile, 'utf8').includes("name: '@deepseek-ai/dsh-tool-fs'")
    && !readFileSync(helperFile, 'utf8').includes('forge-plugins'),
    'installed-smoke: a composition with no additions is not the baseline',
  )
  // The foreign directory survives, and one refused write does not stop the rest.
  assert.equal(
    readFileSync(join(foreign, 'agent.cordis.yml'), 'utf8'),
    '# somebody else wrote this\n',
    'installed-smoke: a preset this plugin did not generate was overwritten',
  )
  assert.ok(!readFileSync(join(foreign, 'preset.yml'), 'utf8').includes('dsh-agent-forge generated'))
  process.stdout.write('installed-smoke: the generated composition carries the shipped baseline\n')
}

process.stdout.write('installed-smoke: the installed package works against the harness dependency tree\n')
