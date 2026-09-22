/**
 * Keyless contract tests for the built artifacts.
 *
 * Installing into a live profile needs a restart, so packaging and resolution
 * faults are worth catching before that cost is paid. Three things are checked,
 * all offline:
 *
 * - the browser artifact, executed the way the page executes it — hand
 *   `window.__ModuleLoader__.load` a capture function, run the bundle, then call
 *   the registered factory with a stub `require`;
 * - the Host artifact's export form, including the failure the repository's
 *   postmortem records: a default export beside named plugin exports;
 * - the pure resolution core, which decides what agents exist and what a
 *   workspace's dispatch rules are.
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import assert from 'node:assert/strict'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

const clientPath = resolve(root, 'lib/client.js')
const hostPath = resolve(root, 'lib/index.js')
const corePath = resolve(root, 'lib/core.js')
for (const path of [clientPath, hostPath, corePath]) {
  if (!existsSync(path)) throw new Error(`smoke: ${path} is missing. Run "npm run build" first.`)
}

// ---------------------------------------------------------------- browser half

/** Records the single `__ModuleLoader__.load(...)` call the bundle is expected to make. */
let registration
const fakeWindow = {
  __ModuleLoader__: {
    load: value => {
      assert.equal(registration, undefined, 'smoke: the bundle registered twice')
      registration = value
    },
  },
}

new Function('window', readFileSync(clientPath, 'utf8'))(fakeWindow)

assert.notEqual(registration, undefined, 'smoke: the bundle never called __ModuleLoader__.load')
assert.equal(registration.id, pkg.name, 'smoke: the module-table id must equal the package name')
assert.equal(typeof registration.factory, 'function', 'smoke: factory is not a function')

/** Answers exactly the platform modules the browser half is allowed to require. */
const requireStub = specifier => {
  if (specifier === 'react') return { useState: () => [undefined, () => {}] }
  if (specifier === 'react/jsx-runtime') {
    return { jsx: () => null, jsxs: () => null, Fragment: Symbol('Fragment') }
  }
  if (specifier === '@deepseek-ai/dsh-client-store') {
    return {
      createSnapshotStore: () => ({
        getSnapshot: () => ({}),
        subscribe: () => () => {},
        set: () => {},
        update: () => {},
      }),
    }
  }
  throw new Error(`smoke: unexpected external request "${specifier}"`)
}

const browserHalf = registration.factory(requireStub)
assert.deepEqual(
  browserHalf.inject,
  ['slots', 'locale', 'settingsScope', 'sessions'],
  'smoke: the browser half must declare the services it reads',
)
assert.equal(typeof browserHalf.apply, 'function', 'smoke: the browser half exports no apply')
// What that apply contributes is verified by rendering it: scripts/smoke-client.mjs.

// ------------------------------------------------------------------- host half

const hostHalf = await import(pathToFileURL(hostPath).href)
assert.equal(typeof hostHalf.default, 'function', 'smoke: the Host half must default-export its service class')
assert.equal(
  typeof hostHalf.default.Config,
  'function',
  'smoke: the Host service class carries no static Config (a schemastery schema is callable)',
)
assert.equal(
  Object.hasOwn(hostHalf, 'apply'),
  false,
  'smoke: named plugin exports beside a default export make the Loader discard the namespace (docs/postmortem/0001)',
)

// Resolving through the row schema proves the defaults a deployment inherits.
const rowDefaults = hostHalf.default.Config({})
assert.equal(rowDefaults.builtinLocale, 'zh', 'smoke: builtinLocale must default to zh')
assert.deepEqual(rowDefaults.agents, {}, 'smoke: the agent map must default to empty')
assert.deepEqual(rowDefaults.workspaces, {}, 'smoke: the workspace map must default to empty')
assert.equal(rowDefaults.fallbackDispatchRule, '', 'smoke: the fallback rules must default to empty')

// --------------------------------------------------------------- resolution core

const core = await import(pathToFileURL(corePath).href)

/** Settings with no user layer at all. */
const empty = { agents: {}, workspaces: {}, fallbackDispatchRule: '' }

// Built-in copy comes from code, in a fixed order, localized on read.
const zh = core.resolveAgents(empty, 'zh')
assert.deepEqual(zh.map(agent => agent.id), ['spendthrift', 'patchwork', 'sightreader'])
assert.equal(zh[0].label, '挥金如土')
assert.equal(zh[2].label, '看图说话')
assert.ok(zh.every(agent => agent.persona.length > 0), 'smoke: a built-in agent has no persona')

const en = core.resolveAgents(empty, 'en')
assert.equal(en[0].label, 'Spendthrift')
assert.notEqual(en[0].persona, zh[0].persona, 'smoke: built-in personas must be per-language')

// An override restates only the fields it changes.
const overridden = core.resolveAgents({ ...empty, agents: { spendthrift: { persona: 'custom' } } }, 'zh')
assert.equal(overridden[0].persona, 'custom')
assert.equal(overridden[0].label, '挥金如土', 'smoke: an override must keep the built-in label it did not restate')

// Both resolution paths must carry every editable field. A field added to one
// and not the other is invisible in the page — the settings write succeeds and
// the projection silently drops it — which is exactly how `plugins` went missing
// for the three built-in agents while working for authored ones.
const carried = core.resolveAgents({
  ...empty,
  agents: {
    spendthrift: { plugins: ['p'], presetRef: 'cordis', tools: { allow: ['t'] }, maxDepth: 1 },
    mine: { label: 'M', persona: 'p', plugins: ['q'], presetRef: 'minimal', tools: { deny: ['t'] }, maxDepth: 2 },
  },
}, 'zh')
for (const id of ['spendthrift', 'mine']) {
  const agent = carried.find(candidate => candidate.id === id)
  assert.deepEqual(agent?.plugins, id === 'spendthrift' ? ['p'] : ['q'], `smoke: ${id} lost its plugin set`)
  assert.equal(
    agent?.presetRef,
    id === 'spendthrift' ? 'cordis' : 'minimal',
    `smoke: ${id} lost its preset reference`,
  )
  assert.equal(agent?.maxDepth, id === 'spendthrift' ? 1 : 2, `smoke: ${id} lost its depth cap`)
}

// A tool filter is an instruction only when it names a tool. The settings schema
// fills an absent `tools` entry with two empty lists, so every agent resolves with
// one; carrying that value through to a delegation denies every tool the child
// would inherit, because an empty allow-list names nothing. A child with no tools
// still ends its turn `completed`, so nothing downstream reports the loss.
const filtered = core.resolveAgents({
  ...empty,
  agents: {
    spendthrift: { tools: { allow: [], deny: [] } },
    patchwork: { tools: { allow: ['pwsh'] } },
    sightreader: { tools: { deny: ['forge_dispatch'] } },
    mine: { label: 'M', persona: 'p' },
  },
}, 'zh')
const filterOf = id => filtered.find(candidate => candidate.id === id)?.tools
assert.equal(filterOf('spendthrift'), undefined, 'smoke: a materialized-empty tool filter was carried through')
assert.equal(filterOf('mine'), undefined, 'smoke: an agent with no filter resolved with one')
assert.deepEqual(filterOf('patchwork'), { allow: ['pwsh'] }, 'smoke: a real allow-list was dropped')
assert.deepEqual(filterOf('sightreader'), { deny: ['forge_dispatch'] }, 'smoke: a real deny-list was dropped')

// ------------------------------------------- generated agent compositions

// A generated composition is the base preset's rows plus the agent's own. A
// session joins exactly one standing composition, so "only the rows I checked"
// would silently mean "and none of the deployment's tools" — which is what left
// delegated children with an empty tool catalogue while their turns still
// reported `completed`.
const BASE = [
  '# A base preset, with commentary of its own that must not travel.',
  '#',
  '# Rows are quoted the way the shipped presets quote them.',
  '',
  '- id: persona',
  "  name: '@deepseek-ai/dsh-persona'",
  '  config:',
  '    prefix: hi',
  '',
  '# ── plan mode ──',
  '',
  '- id: planning',
  '  name: cordis:group',
  '  group: true',
  '  isolate:',
  '    planMode: true',
  '  config:',
  '    - id: plan-mode',
  "      name: '@deepseek-ai/dsh-plan-mode'",
  '',
].join('\n')

const baseOnly = core.renderAgentComposition([], BASE)
assert.ok(
  baseOnly.includes(core.GENERATED_MARKER),
  'smoke: a generated composition must announce that it is generated',
)
assert.ok(
  baseOnly.includes("name: '@deepseek-ai/dsh-persona'") && baseOnly.includes('planMode: true'),
  'smoke: the base preset rows (and their isolate realms) did not survive the copy',
)
assert.ok(
  !baseOnly.includes('commentary of its own'),
  'smoke: the base preset header travelled into a file it does not describe',
)
assert.ok(!baseOnly.includes('forge-plugins'), 'smoke: an agent with no plugins of its own got a group for them')

const withOwn = core.renderAgentComposition(['dsh-free-search', 'dshmarket'], BASE)
for (const name of ['@deepseek-ai/dsh-persona', '@deepseek-ai/dsh-plan-mode']) {
  assert.ok(withOwn.includes(name), `smoke: the base row ${name} was dropped when the agent added rows`)
}
for (const name of ['dsh-free-search', 'dshmarket']) {
  assert.ok(withOwn.includes(`name: '${name}'`), `smoke: the agent's own row ${name} was dropped`)
}
assert.ok(
  withOwn.indexOf('@deepseek-ai/dsh-persona') < withOwn.indexOf('dsh-free-search'),
  'smoke: the base rows must come before the additions',
)

// A module the base already names is dropped rather than repeated: two rows for
// one package in one composition register the same tool twice and fail the mount.
const deduped = core.renderAgentComposition(['@deepseek-ai/dsh-persona'], BASE)
assert.equal(
  deduped.split("name: '@deepseek-ai/dsh-persona'").length - 1,
  1,
  'smoke: a row the base already carries was added a second time',
)

// Without a base there is nothing to compose: an empty document is the only
// honest result, and the writer refuses to run at all in that case.
assert.ok(
  core.renderAgentComposition(['x'], '').trimEnd().endsWith('[]'),
  'smoke: an unreadable base preset did not fall back to an empty composition',
)

assert.deepEqual(
  [...core.compositionNames(BASE)].sort(),
  ['@deepseek-ai/dsh-persona', '@deepseek-ai/dsh-plan-mode'],
  'smoke: the module scan did not read the composition rows',
)

// Which preset a delegation runs on: the one the agent names, else the one this
// plugin generated for it. Nothing is resolved against the deployment's roster,
// so no preset has to exist for an agent to be composable.
const named = { id: 'a', label: 'A', description: '', persona: 'p', builtin: false, model: undefined }
assert.equal(core.presetIdOf({ ...named, presetRef: 'cordis' }), 'cordis', 'smoke: presetRef lost priority')
assert.equal(core.presetIdOf(named), 'a', 'smoke: an agent must run the composition generated for its own id')
assert.equal(
  core.presetIdOf({ ...named, plugins: [] }),
  'a',
  'smoke: an empty selection must still run the generated composition',
)

// ---------------------------------------------------------- the shipped baseline

// The baseline is this package's own file, so every generated composition works
// in a deployment that has none of the shipped presets. These are the properties
// that make it usable as a delegated agent's only composition.
//
// Comments are excluded: they explain the baseline's own decisions (including the
// ones it deliberately declines), and a comment is not a row the Loader mounts.
const baseline = core.readBaseline()
const baselineRows = baseline.split('\n').filter(line => !line.trimStart().startsWith('#')).join('\n')
for (const required of [
  // a shell, and the native file tools a delegated agent needs — including
  // `read_image`, which is what a screenshot-reading agent runs on
  "name: '@deepseek-ai/dsh-tool-fs'",
  "name: '@deepseek-ai/dsh-tool-fs-search'",
  "name: '@deepseek-ai/dsh-tool-skill'",
  "name: '@deepseek-ai/dsh-tool-web'",
  'name: cordis:group',
  'terminals: true',
]) {
  assert.ok(baselineRows.includes(required), `smoke: the shipped baseline lost ${required}`)
}
assert.ok(
  /persistent-pwsh|persistent-bash/.test(baselineRows),
  'smoke: the shipped baseline lost its persistent shell',
)
// A complete persona replaces the whole system prompt, and `includeRuntimeContext:
// false` suppresses every context section — including the statement dsh-subagent
// adds for a delegated child. A baseline carrying either would change every
// forge agent's prompt, so neither may appear as a row.
assert.ok(!baselineRows.includes('complete: true'), 'smoke: the baseline persona would replace the whole prompt')
assert.ok(
  !baselineRows.includes('includeRuntimeContext'),
  'smoke: the baseline would suppress the runtime context of everything joined to it',
)
// The heavy coding rows are the ones a delegated agent does not need; keeping
// them out is the point of owning this baseline.
for (const unwanted of ['dsh-tool-workflow', 'dsh-tool-ralph', 'dsh-tool-subagent', 'dsh-plan-mode']) {
  assert.ok(!baselineRows.includes(unwanted), `smoke: the light baseline carries ${unwanted}`)
}

// A composition generated from the real baseline is a working document.
const generated = core.renderAgentComposition(['my-plugin'], baseline)
assert.ok(
  generated.includes("name: '@deepseek-ai/dsh-tool-fs'") && generated.includes("name: 'my-plugin'"),
  'smoke: a composition generated from the shipped baseline is incomplete',
)

// Authored agents follow the built-ins, in name order.
const authored = core.resolveAgents({
  ...empty,
  agents: { zeta: { label: 'Zeta', persona: 'z' }, alpha: { label: 'Alpha', persona: 'a' } },
}, 'en')
assert.deepEqual(authored.map(agent => agent.id), ['spendthrift', 'patchwork', 'sightreader', 'alpha', 'zeta'])

// A workspace may narrow the list and designate a lead.
const narrowed = core.resolveWorkspace({
  ...empty,
  workspaces: { w1: { enabled: ['patchwork', 'spendthrift'], lead: 'patchwork' } },
}, 'w1', 'zh')
assert.deepEqual(narrowed.enabled.map(agent => agent.id), ['patchwork', 'spendthrift'])
assert.equal(narrowed.lead.id, 'patchwork')
assert.ok(narrowed.dispatchRule.includes('任务分派规则'), 'smoke: the shipped rules must be the last fallback')

// Without a designated lead the first enabled agent leads.
const derived = core.resolveWorkspace({ ...empty, workspaces: { w1: { enabled: ['sightreader'] } } }, 'w1', 'zh')
assert.equal(derived.lead.id, 'sightreader')

// An empty or absent `enabled` means the workspace offers every agent.
assert.equal(core.resolveWorkspace({ ...empty, workspaces: { w1: {} } }, 'w1', 'zh').enabled.length, 3)

// An unknown workspace still gets rules, from the deployment fallback.
const fallback = core.resolveWorkspace({ ...empty, fallbackDispatchRule: 'RULE' }, undefined, 'zh')
assert.equal(fallback.workspaceId, undefined)
assert.equal(fallback.dispatchRule, 'RULE')

// Cross-field rules the schema cannot express.
assert.throws(() => core.validateSettings({ ...empty, agents: { mine: { persona: 'p' } } }), /needs a label/)
assert.throws(() => core.validateSettings({ ...empty, agents: { mine: { label: 'M' } } }), /needs a persona/)
assert.throws(
  () => core.validateSettings({ ...empty, workspaces: { w: { enabled: ['patchwork'], lead: 'sightreader' } } }),
  /does not enable/,
)
assert.throws(() => core.validateSettings({ ...empty, workspaces: { w: { lead: 'ghost' } } }), /unknown lead/)
core.validateSettings({ ...empty, agents: { mine: { label: 'M', persona: 'p' } } })
core.validateSettings({ ...empty, agents: { spendthrift: { persona: 'p' } } })
core.validateSettings({ ...empty, workspaces: { w: { lead: 'sightreader' } } })

// --------------------------------------------------------------- the schema

// The stored schema must accept an entry that omits every optional field — the
// "leave it blank to inherit" contract. `required(false)` on an object makes the
// OBJECT optional, not its members: declaring a nested member required rejects
// every entry that omits the object entirely, because resolving an object schema
// validates the nested members whether or not the caller supplied the object.
const sparse = core.AgentForgeSettingsSchema({
  agents: { auditor: { label: 'Auditor', persona: 'review things' } },
  workspaces: { 'ws-1': { enabled: ['spendthrift'], lead: 'spendthrift' } },
  fallbackDispatchRule: 'x',
})
assert.equal(sparse.agents.auditor.label, 'Auditor')
assert.deepEqual(sparse.workspaces['ws-1'].enabled, ['spendthrift'])
// An omitted optional object survives as `{}` rather than as a dropped key. What
// matters is that the entry is not rejected, and that resolution treats a route
// without both halves as no route at all.
assert.equal(
  core.resolveAgents(sparse, 'en').find(agent => agent.id === 'auditor')?.model,
  undefined,
  'smoke: a route materialised without both halves must resolve to no route',
)

// A complete route round-trips.
const routed = core.AgentForgeSettingsSchema({
  agents: { a: { label: 'A', persona: 'p', model: { provider: 'prov', model: 'mod' } } },
  workspaces: {},
  fallbackDispatchRule: '',
})
assert.deepEqual(routed.agents.a.model, { provider: 'prov', model: 'mod' })

// Half a route is refused where it is authored, and ignored where it is read.
assert.throws(
  () => core.validateSettings({
    ...empty,
    agents: { a: { label: 'A', persona: 'p', model: { provider: 'prov' } } },
  }),
  /half a model route/,
  'smoke: a half-written model route must be refused',
)
const dropped = core.resolveAgents({
  ...empty,
  agents: { a: { label: 'A', persona: 'p', model: { provider: 'prov' } } },
}, 'en').find(agent => agent.id === 'a')
assert.equal(dropped?.model, undefined, 'smoke: a half-written route must resolve to no route')

// ---------------------------------------------------------------- the panorama

const split = core.splitDelegationLabel('挥金如土 · 重构鉴权模块')
assert.equal(split.agent, '挥金如土', 'smoke: the label separator was not honoured')
assert.equal(split.task, '重构鉴权模块')
assert.deepEqual(core.splitDelegationLabel(undefined), { agent: undefined, task: '' })
assert.deepEqual(
  core.splitDelegationLabel('no separator here'),
  { agent: undefined, task: 'no separator here' },
  'smoke: an unlabelled run must read as unlabelled, not as a broken agent name',
)

/** Two direct delegations, one of which delegated further. */
const subjects = {
  a: { sessionId: 'a', running: true, activeMs: 4000, tokens: 1200 },
  b: { sessionId: 'b', running: false, activeMs: 5000, tokens: 9000 },
  c: { sessionId: 'c', running: false, activeMs: 500, tokens: 300 },
}
const children = {
  root: [
    { id: 'a', mode: 'one-shot', label: '挥金如土 · 重构', hasChildren: false },
    { id: 'b', mode: 'continuable', label: '缝缝补补 · 批量', hasChildren: true },
  ],
  b: [{ id: 'c', mode: 'one-shot', label: '看图说话 · 核对', hasChildren: false }],
}

const tree = core.buildDelegationTree('root', subjects, children)
assert.deepEqual(tree.map(node => node.sessionId), ['a', 'b'])
assert.deepEqual(tree.map(node => node.depth), [1, 1], 'smoke: both direct children must be at depth 1')
assert.equal(tree[1].children.length, 1, 'smoke: a nested delegation was dropped')
assert.equal(tree[1].children[0].sessionId, 'c')
assert.equal(tree[1].children[0].depth, 2)
assert.equal(tree[1].children[0].parentSessionId, 'b')
assert.equal(core.countDelegations(tree), 3)
assert.equal(core.countRunning(tree), 1)
assert.deepEqual(core.buildDelegationTree(undefined, subjects, children), [], 'smoke: no root must mean no tree')

// The catalog's own label wins over the session title, which is only a fallback.
const titled = core.buildDelegationTree(
  'root',
  { a: { sessionId: 'a', title: 'SESSION TITLE', running: false } },
  { root: [{ id: 'a', label: 'AGENT · TASK', hasChildren: false }] },
)
assert.equal(titled[0].title, 'AGENT · TASK')
assert.equal(titled[0].agent, 'AGENT')

// A catalog that disagrees with itself must not recurse until the stack ends.
const cyclic = {
  root: [{ id: 'x', hasChildren: true }],
  x: [{ id: 'root', hasChildren: true }, { id: 'x', hasChildren: true }],
}
assert.equal(core.countDelegations(core.buildDelegationTree('root', {}, cyclic)), 1)

assert.deepEqual(
  core.groupByAgent(tree).map(group => group.agent),
  ['挥金如土', '缝缝补补', '看图说话'],
  'smoke: lanes must follow tree order',
)

assert.equal(core.durationText(4000), '4s')
assert.equal(core.durationText(90_000), '1m 30s')
assert.equal(core.durationText(undefined), undefined, 'smoke: an unrecorded duration must render as absent')
assert.equal(core.tokensText(1200), '1.2k')
assert.equal(core.tokensText(2_400_000), '2.40M')

// ----------------------------------------------------------------- the locale

// The Host follows the language the browser persists, and the row otherwise.
assert.equal(core.localeFromPreference('zh', 'en'), 'zh')
assert.equal(core.localeFromPreference('zh-CN', 'en'), 'zh')
assert.equal(core.localeFromPreference('  ZH  ', 'en'), 'zh', 'smoke: the preference must be normalized')
assert.equal(core.localeFromPreference('en', 'zh'), 'en')
assert.equal(core.localeFromPreference('en-GB', 'zh'), 'en')
assert.equal(core.localeFromPreference(undefined, 'zh'), 'zh', 'smoke: an unset preference falls back to the row')
assert.equal(core.localeFromPreference('', 'zh'), 'zh')
assert.equal(core.localeFromPreference(42, 'zh'), 'zh', 'smoke: a malformed preference must not throw')

// These two strings are spelled in this package rather than imported from the
// browser locale package, so pinning them is what catches dsh renaming either.
assert.equal(core.LOCALE_SETTINGS_NAMESPACE, 'locale')
assert.equal(core.LOCALE_PREFERENCE_FIELD, 'preference')

process.stdout.write('smoke: packaging contract, resolution rules, and the panorama hold\n')
