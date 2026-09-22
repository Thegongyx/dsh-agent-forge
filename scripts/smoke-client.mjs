/**
 * Keyless render test for the browser half.
 *
 * The settings page is the plugin's main surface and this process cannot open a
 * browser, so the page is rendered the way the shell renders it — execute the
 * built bundle, call `apply` with a stand-in client context, take the slot entry
 * it registered, and render that component with the shares the framework would
 * compose. React function components are ordinary functions, and
 * `react-dom/server` renders them without a DOM, so this exercises the real
 * bundled code rather than a copy of it.
 *
 * The stand-in context implements only what `apply` touches, and the stand-in
 * settings scope implements the real revision-free read/write contract, so a
 * wrong namespace, a wrong path, or a projection that never re-resolves shows up
 * here instead of in the browser.
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import assert from 'node:assert/strict'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const clientPath = resolve(root, 'lib/client.js')
if (!existsSync(clientPath)) throw new Error(`smoke-client: ${clientPath} is missing. Run "npm run build" first.`)

const React = await import('react')
const jsxRuntime = await import('react/jsx-runtime')
const { renderToStaticMarkup } = await import('react-dom/server')

/**
 * Stands in for `@deepseek-ai/dsh-client-store`.
 *
 * That package's published manifest declares neither `zustand` nor `immer`,
 * although its `lib/index.js` imports both — in a browser they are resolved at
 * bundle time, so the gap only surfaces for a Node consumer. This test needs
 * four methods rather than the whole engine, and the signature the controller
 * actually calls is checked by `tsc` against that package's own declarations, so
 * the behavior here is the part worth stubbing.
 * @param init - initial state.
 * @returns a store satisfying the page's use of the contract.
 */
function createSnapshotStore(init) {
  let state = init
  const listeners = new Set()
  return {
    getSnapshot: () => state,
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: next => {
      state = next
      for (const listener of listeners) listener()
    },
    update: mutator => {
      const draft = structuredClone(state)
      mutator(draft)
      state = draft
      for (const listener of listeners) listener()
    },
  }
}

// ------------------------------------------------------------ bundle execution

let registration
new Function('window', readFileSync(clientPath, 'utf8'))({
  __ModuleLoader__: { load: value => { registration = value } },
})

/** Answers exactly the platform modules the browser half is allowed to require. */
const requireStub = specifier => {
  if (specifier === 'react') return React
  if (specifier === 'react/jsx-runtime') return jsxRuntime
  if (specifier === '@deepseek-ai/dsh-client-store') return { createSnapshotStore }
  throw new Error(`smoke-client: unexpected external request "${specifier}"`)
}

const browserHalf = registration.factory(requireStub)

// ------------------------------------------------------------- stand-in scope

/** Mirrors the settings-section wire shape the controller projects. */
const section = { agents: {}, workspaces: {}, fallbackDispatchRule: '' }
const listeners = new Set()
let writable = true

/** Applies one path op to the section the way the host would. */
function applyOp(op) {
  const path = [...op.path]
  const last = path.pop()
  let cursor = section
  for (const step of path) {
    if (typeof cursor[step] !== 'object' || cursor[step] === null) cursor[step] = {}
    cursor = cursor[step]
  }
  if (op.op === 'unset') delete cursor[last]
  else cursor[last] = op.value
}

/**
 * The section as the host hands it back.
 *
 * The real scope resolves a namespace through its schema, so every field the
 * schema defaults is present even after a clear. The document this stub mutates
 * is raw, so the resolved view is composed here — modelling that contract is the
 * stub's job, not a defensive branch in the plugin.
 * @returns the schema-resolved section.
 */
function resolved() {
  return {
    agents: section.agents ?? {},
    workspaces: section.workspaces ?? {},
    fallbackDispatchRule: section.fallbackDispatchRule ?? '',
  }
}

const scope = {
  getSnapshot: () => ({
    status: 'ready',
    value: resolved(),
    base: undefined,
    user: section,
    revision: 1,
    writable,
    mode: 'host',
  }),
  subscribe: listener => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  mutate: async ops => {
    // A real write is refused when the host document is not writable; the page
    // relies on that, so the stand-in keeps the same rule.
    if (!writable) throw new Error('smoke-client: write attempted while not writable')
    for (const op of ops) applyOp(op)
    for (const listener of listeners) listener()
  },
}

// ------------------------------------------------------------------- apply run

const slotRegistrations = []
const slotInjections = []
const disposers = []
const opened = []
const expanded = []
const refreshed = []
const fakeContext = {
  // The real runtime waits for a dependency and hands the callback a scope that
  // has it; this stub has no service store, so it runs the callback with itself.
  inject: (_deps, callback) => { callback(fakeContext) },
  get: () => undefined,
  effect: callback => { disposers.push(callback()) },
  on: () => () => {},
  locale: {
    register: () => () => {},
    bind: () => key => key,
    getSnapshot: () => ({ active: 'zh' }),
  },
  settingsScope: { bind: () => scope },
  sessions: {
    openSubagent: address => { opened.push(address) },
    setSubagentCatalogOpen: (parentSessionId, open) => { expanded.push({ parentSessionId, open }) },
    refreshSubagents: parentSessionId => {
      refreshed.push(parentSessionId)
      return Promise.resolve()
    },
  },
  slots: {
    inject: (key, callback) => { slotInjections.push(key); callback() },
    register: (options, component) => {
      slotRegistrations.push({ options, component })
      return () => {}
    },
  },
}

browserHalf.apply(fakeContext)

assert.deepEqual(
  browserHalf.inject,
  ['slots', 'locale', 'settingsScope', 'sessions'],
  'smoke-client: the browser half must declare the services it reads',
)
assert.deepEqual(
  slotInjections,
  ['settings.section', 'sidebar.panellist', 'main'],
  'smoke-client: unexpected slot injection',
)
assert.equal(slotRegistrations.length, 3, 'smoke-client: expected three slot registrations')

/** The registrations this test drives, found by the slot each targets. */
const bySlot = name => slotRegistrations.find(registration => registration.options.name === name)

const entry = bySlot('settings.section')
assert.notEqual(entry, undefined, 'smoke-client: no settings section was registered')
assert.equal(entry.options.id, 'agent-forge', 'smoke-client: the page must not reuse a shipped section id')
assert.equal(typeof entry.options.label, 'function', 'smoke-client: the nav label must be a live thunk')
assert.equal(typeof entry.options.inject, 'function', 'smoke-client: the entry injects no face')

// The sidebar entry and the main panel address each other by this id alone; a
// mismatch leaves a button that switches to nothing.
const panelEntry = bySlot('sidebar.panellist')
const mainEntry = bySlot('main')
assert.notEqual(panelEntry, undefined, 'smoke-client: no sidebar entry was registered')
assert.notEqual(mainEntry, undefined, 'smoke-client: no main panel was registered')
assert.equal(
  mainEntry.options.key,
  panelEntry.options.id,
  'smoke-client: the sidebar entry and the main panel must share an id',
)

// ------------------------------------------------------------ render and write

const face = entry.options.inject()
assert.equal(typeof face.hooks?.agentForge?.getSnapshot, 'function', 'smoke-client: no page snapshot hook')

/** Workspace and session facts the standard props would supply. */
const world = {
  currentSession: 'session-1',
  workspaces: [
    {
      workspaceId: 'workspace-1',
      path: 'C:/work/one',
      title: '工作区一',
      sessionIds: ['session-1'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
}

/** Composes the props shares the framework would hand the component. */
function props(face) {
  const store = face.hooks.agentForge
  return {
    useAgentForge: selector => selector(store.getSnapshot()),
    useWorkspaces: selector => selector({ items: world.workspaces, archivedSessionIds: [], state: 'idle', phase: 'ready', error: null }),
    useSessions: selector => selector({ current: world.currentSession, ids: [], byId: {}, subagentsByParent: {}, jobsBySession: {}, phase: 'ready' }),
    patchAgent: face.patchAgent,
    removeAgent: face.removeAgent,
    setFallbackDispatchRule: face.setFallbackDispatchRule,
    patchWorkspace: face.patchWorkspace,
    t: key => key,
  }
}

function render() {
  return renderToStaticMarkup(React.createElement(entry.component, props(face)))
}

const initial = render()
for (const label of ['挥金如土', '缝缝补补', '看图说话']) {
  assert.ok(initial.includes(label), `smoke-client: the shipped roster is missing ${label}`)
}
assert.ok(!initial.includes('agent-forge'), 'smoke-client: the page rendered its internal id as copy')
assert.ok(initial.includes('tab.workspaces'), 'smoke-client: the workspace tab is missing from the tab bar')

// A stored override restates one field and must keep the built-in label.
await face.patchAgent('spendthrift', { persona: 'custom persona' })
const afterOverride = render()
assert.ok(afterOverride.includes('custom persona'), 'smoke-client: a persona write did not reach the page')
assert.ok(afterOverride.includes('挥金如土'), 'smoke-client: an override dropped the built-in label')

// A user-authored agent appends to the roster.
await face.patchAgent('auditor', { label: '审计员', persona: 'review' })
assert.ok(render().includes('审计员'), 'smoke-client: an authored agent did not reach the page')

// Removing a built-in drops only the override; removing an authored agent deletes it.
await face.removeAgent('spendthrift')
assert.ok(render().includes('挥金如土'), 'smoke-client: resetting a built-in removed it from the roster')
await face.removeAgent('auditor')
assert.ok(!render().includes('审计员'), 'smoke-client: removing an authored agent left it on the page')

// The rules field writes the deployment fallback, and an empty value clears it.
// Checked through the transport and the projection rather than the markup: the
// rules live on the second tab, and a server render cannot click a tab.
await face.setFallbackDispatchRule('RULES')
assert.equal(section.fallbackDispatchRule, 'RULES', 'smoke-client: the rules write did not reach the transport')
assert.equal(
  face.hooks.agentForge.getSnapshot().fallbackDispatchRule,
  'RULES',
  'smoke-client: the projection did not re-resolve after the rules write',
)
await face.setFallbackDispatchRule('')
assert.equal(section.fallbackDispatchRule, undefined, 'smoke-client: clearing the rules must unset the field')
// With nothing stored, the page must show the rule a session actually runs on —
// the shipped default — not an empty box beside a label that says "default".
assert.ok(
  face.hooks.agentForge.getSnapshot().fallbackDispatchRule.includes('任务分派规则'),
  'smoke-client: an unwritten default rule projected as empty',
)

// Per-workspace decisions write under the workspace id.
await face.patchWorkspace('workspace-1', { enabled: ['spendthrift'], lead: 'spendthrift' })
assert.deepEqual(section.workspaces['workspace-1'].enabled, ['spendthrift'])
assert.equal(section.workspaces['workspace-1'].lead, 'spendthrift')

const narrowed = face.hooks.agentForge.getSnapshot().workspaces['workspace-1']
assert.deepEqual(narrowed.enabled, ['spendthrift'], 'smoke-client: the workspace write did not reach the projection')
assert.equal(narrowed.lead, 'spendthrift')
assert.equal(narrowed.ruleCustomized, false, 'smoke-client: an unset workspace rule read as customized')
// A workspace with no rule of its own shows an empty box, not the deployment
// default: the default lives on the rules tab, and copying it here would make an
// inheriting workspace look like an overriding one.
assert.equal(
  narrowed.dispatchRule,
  '',
  'smoke-client: an inheriting workspace must not present the default rule as its own',
)

await face.patchWorkspace('workspace-1', { dispatchRule: 'WORKSPACE RULES' })
const customized = face.hooks.agentForge.getSnapshot().workspaces['workspace-1']
assert.equal(customized.dispatchRule, 'WORKSPACE RULES')
assert.equal(customized.ruleCustomized, true)

// Clearing the field returns the workspace to the deployment default.
await face.patchWorkspace('workspace-1', { dispatchRule: undefined })
const reverted = face.hooks.agentForge.getSnapshot().workspaces['workspace-1']
assert.equal(reverted.ruleCustomized, false, 'smoke-client: clearing a workspace rule left it customized')
assert.equal(section.workspaces['workspace-1'].dispatchRule, undefined)

// A read-only document disables every control and is refused on write.
writable = false
for (const listener of listeners) listener()
const readOnly = render()
assert.ok(readOnly.includes('disabled'), 'smoke-client: a read-only page left its controls enabled')
await assert.rejects(
  () => face.patchAgent('auditor', { label: 'x' }),
  /not writable/,
  'smoke-client: a read-only page reached the transport',
)
writable = true

// ------------------------------------------------------------------ the canvas

/** One delegation, as the session list would carry it. */
function delegationRow(id, parentId, label, running, tokens) {
  return {
    id,
    title: label,
    parentId,
    running,
    blank: false,
    updatedAt: 1,
    projectionValues: {
      // Elapsed time comes from recorded turn bounds, so this is data, not a clock.
      subagentTiming: running
        ? { settledMs: 2000, active: { since: 1000, through: 4000 } }
        : { settledMs: 5000 },
      tokenUsage: {
        uncachedInputTokens: tokens,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    },
  }
}

const sessionsSnapshot = {
  current: 'root',
  byId: {
    root: { id: 'root', running: true, blank: false, updatedAt: 0 },
    'child-a': delegationRow('child-a', 'root', '挥金如土 · 重构鉴权模块', true, 1200),
    'child-b': delegationRow('child-b', 'root', '缝缝补补 · 批量改 200 个文件', false, 9000),
    'child-c': delegationRow('child-c', 'child-b', '看图说话 · 核对改后截图', false, 300),
  },
  subagentsByParent: {
    root: {
      state: 'ready',
      entries: [
        { kind: 'child', id: 'child-a', activity: 'running', hasChildren: false, mode: 'one-shot', label: '挥金如土 · 重构鉴权模块' },
        { kind: 'child', id: 'child-b', activity: 'inactive', hasChildren: true, mode: 'continuable', label: '缝缝补补 · 批量改 200 个文件' },
        { kind: 'diagnostic', id: 'child-x', reason: 'corrupt' },
      ],
    },
    'child-b': {
      state: 'ready',
      entries: [
        { kind: 'child', id: 'child-c', activity: 'inactive', hasChildren: false, mode: 'one-shot', label: '看图说话 · 核对改后截图' },
      ],
    },
  },
}

const canvasProps = {
  useSessions: selector => selector(sessionsSnapshot),
  ...mainEntry.options.inject(),
  t: key => key,
}

const canvas = renderToStaticMarkup(React.createElement(mainEntry.component, canvasProps))

assert.ok(canvas.includes('挥金如土'), 'smoke-client: the canvas omitted an agent lane')
assert.ok(canvas.includes('重构鉴权模块'), 'smoke-client: the canvas omitted a task')
assert.ok(canvas.includes('缝缝补补'), 'smoke-client: the canvas omitted the second agent lane')
assert.ok(canvas.includes('看图说话'), 'smoke-client: the canvas omitted a nested delegation')
assert.ok(!canvas.includes('child-x'), 'smoke-client: a diagnostic catalog row was drawn as a delegation')
assert.ok(canvas.includes('map.summary'), 'smoke-client: the canvas omitted its summary line')

// The panel's three actions are the only path from the canvas back to the shell.
canvasProps.openDelegation({ parentSessionId: 'root', childSessionId: 'child-a', mode: 'one-shot' })
assert.equal(opened.length, 1, 'smoke-client: opening a delegation did not reach the sessions service')
assert.equal(opened[0].childSessionId, 'child-a')

// The session list carries no catalog until something asks for one, so the panel
// owns that request. Server rendering does not run effects, so the action the
// effect calls is driven directly here.
canvasProps.expandDelegation('root')
assert.deepEqual(
  expanded,
  [{ parentSessionId: 'root', open: true }],
  'smoke-client: asking for a session catalogue did not reach the sessions service',
)
canvasProps.refreshDelegation('root')
assert.deepEqual(refreshed, ['root'], 'smoke-client: refreshing a catalogue did not reach the sessions service')

// The entry's disposers release every subscription it opened.
for (const dispose of disposers) dispose()
assert.equal(listeners.size, 0, 'smoke-client: disposing the plugin left a subscription behind')

process.stdout.write('smoke-client: the settings page renders and writes through the scope\n')
