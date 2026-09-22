/**
 * DOM-level checks for the browser half.
 *
 * `renderToStaticMarkup` proves what the page draws from a given snapshot. It
 * cannot prove the two things that actually depend on being mounted: an effect
 * that runs after mount, and an interaction that changes what is drawn. Both
 * matter here — the canvas asks the host for a delegation catalogue on mount,
 * because the session list carries none until something asks, and the settings
 * page switches tabs and commits edits on blur.
 *
 * So this renders the real built bundle into a jsdom document through
 * `react-dom/client`, then drives it the way a user would: click a tab, type in
 * a field and blur it, click a card, click an action. Effects run for real, so
 * the mount-time catalogue request is observed rather than assumed.
 *
 * jsdom is not a browser; layout, CSS, and the shell's own slots are all absent.
 * What it does establish is that the components mount, respond, and reach the
 * services they were given.
 *
 * @module dsh-agent-forge/scripts/dom-smoke
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import assert from 'node:assert/strict'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const clientPath = resolve(root, 'lib/client.js')
if (!existsSync(clientPath)) throw new Error(`dom-smoke: ${clientPath} is missing. Run "npm run build" first.`)

// ------------------------------------------------------------------ environment

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true,
  url: 'http://127.0.0.1/',
})

for (const name of [
  'window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent',
  'FocusEvent', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
]) {
  const value = dom.window[name]
  if (value !== undefined) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
}
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
// React only flushes effects inside `act` when it is told this is a test environment.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = await import('react')
const jsxRuntime = await import('react/jsx-runtime')
const { createRoot } = await import('react-dom/client')
// React 18.3 exports `act` itself; the `react-dom/test-utils` copy is deprecated.
const { act } = React

/** Stands in for `@deepseek-ai/dsh-client-store`; see scripts/smoke-client.mjs for why. */
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

// --------------------------------------------------------------- the built bundle

let registration
new Function('window', readFileSync(clientPath, 'utf8'))({
  __ModuleLoader__: { load: value => { registration = value } },
})

const browserHalf = registration.factory(specifier => {
  if (specifier === 'react') return React
  if (specifier === 'react/jsx-runtime') return jsxRuntime
  if (specifier === '@deepseek-ai/dsh-client-store') return { createSnapshotStore }
  throw new Error(`dom-smoke: unexpected external request "${specifier}"`)
})

// ------------------------------------------------------------------ the services

const section = { agents: {}, workspaces: {}, fallbackDispatchRule: '' }
const scopeListeners = new Set()
let writable = true

/** The section as the host hands it back: schema-resolved, so defaults are present. */
const resolved = () => ({
  agents: section.agents ?? {},
  workspaces: section.workspaces ?? {},
  fallbackDispatchRule: section.fallbackDispatchRule ?? '',
})

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

const scope = {
  getSnapshot: () => ({
    status: 'ready', value: resolved(), base: undefined, user: section,
    revision: 1, writable, mode: 'host',
  }),
  subscribe: listener => {
    scopeListeners.add(listener)
    return () => { scopeListeners.delete(listener) }
  },
  mutate: async ops => {
    if (!writable) throw new Error('dom-smoke: write attempted while not writable')
    for (const op of ops) applyOp(op)
    for (const listener of scopeListeners) listener()
  },
}

const opened = []
const expanded = []
const refreshed = []
const registrations = []
const disposers = []

const fakeContext = {
  // The real runtime waits for a dependency and hands the callback a scope that
  // has it; this stub has every service already, so it just runs the callback.
  inject: (_deps, callback) => { callback(fakeContext) },
  get: () => undefined,
  effect: callback => {
    const dispose = callback()
    if (typeof dispose === 'function') disposers.push(dispose)
    return () => {}
  },
  on: () => () => {},
  locale: { register: () => () => {}, bind: () => key => key, getSnapshot: () => ({ active: 'zh' }) },
  settingsScope: { bind: () => scope },
  sessions: {
    openSubagent: address => { opened.push(address) },
    setSubagentCatalogOpen: (parentSessionId, open) => { expanded.push({ parentSessionId, open }) },
    refreshSubagents: parentSessionId => { refreshed.push(parentSessionId); return Promise.resolve() },
  },
  slots: {
    inject: (_key, callback) => { callback() },
    register: (options, component) => { registrations.push({ options, component }); return () => {} },
  },
}

browserHalf.apply(fakeContext)

const bySlot = name => registrations.find(entry => entry.options.name === name)
const sectionEntry = bySlot('settings.section')
const mainEntry = bySlot('main')
const panelEntry = bySlot('sidebar.panellist')
assert.notEqual(sectionEntry, undefined, 'dom-smoke: no settings section was registered')
assert.notEqual(mainEntry, undefined, 'dom-smoke: no main panel was registered')
assert.notEqual(panelEntry, undefined, 'dom-smoke: no sidebar entry was registered')

const world = {
  currentSession: 'session-1',
  workspaces: [{
    workspaceId: 'workspace-1', path: 'C:/work/one', title: '工作区一',
    sessionIds: ['session-1'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }],
}

const sessionsSnapshot = {
  current: 'root',
  byId: {
    root: { id: 'root', running: true, blank: false, updatedAt: 0 },
    'child-a': {
      id: 'child-a', title: '挥金如土 · 重构鉴权模块', parentId: 'root', running: true, blank: false, updatedAt: 1,
      projectionValues: {
        subagentTiming: { settledMs: 2000, active: { since: 1000, through: 4000 } },
        tokenUsage: { uncachedInputTokens: 1200, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    },
  },
  subagentsByParent: {
    root: {
      state: 'ready',
      entries: [{ kind: 'child', id: 'child-a', activity: 'running', hasChildren: false, mode: 'one-shot', label: '挥金如土 · 重构鉴权模块' }],
    },
  },
}

/** Renders one component into a fresh container and returns the container. */
async function mount(component, props) {
  const container = document.createElement('div')
  document.body.append(container)
  const reactRoot = createRoot(container)
  await act(async () => { reactRoot.render(React.createElement(component, props)) })
  return container
}

/**
 * A selector seat backed by the real subscription hook.
 *
 * It has to be a genuine hook. A plain function reading `getSnapshot()` makes
 * every seat look like an ordinary call, which hides exactly the bug this suite
 * exists to catch: a seat called from inside a conditional branch changes the
 * hook count between renders, and React answers by blanking the surface. With a
 * real hook underneath, that becomes a thrown error here instead of a blank page
 * in the browser.
 * @param store - the bare observable source.
 * @returns the seat.
 */
function seat(store) {
  return selector => selector(React.useSyncExternalStore(store.subscribe, store.getSnapshot))
}

/** React reports a hook-order violation through the console before it throws. */
const reactProblems = []
const realConsoleError = console.error
console.error = (...args) => {
  const text = args.map(String).join(' ')
  if (text.includes('Rendered more hooks') || text.includes('React error #')) reactProblems.push(text)
  realConsoleError(...args)
}

/** Finds the first element whose trimmed text equals one of the given strings. */
function byText(container, ...texts) {
  const wanted = new Set(texts)
  return [...container.querySelectorAll('*')]
    .find(node => wanted.has(node.textContent?.trim() ?? ''))
}

const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

// ---------------------------------------------------------------- the settings page

{
  // The renderer turns the face's `hooks` compartment into the `use<Name>` prop
  // and spreads the rest; stand that split up the same way.
  const { hooks, ...actions } = sectionEntry.options.inject()
  const sectionProps = {
    useAgentForge: seat(hooks.agentForge),
    useWorkspaces: selector => selector({ items: world.workspaces, archivedSessionIds: [], state: 'idle', phase: 'ready', error: null }),
    useSessions: selector => selector({ current: world.currentSession, ids: [], byId: {}, subagentsByParent: {}, jobsBySession: {}, phase: 'ready' }),
    ...actions,
    t: key => key,
  }

  const container = await mount(sectionEntry.component, sectionProps)
  assert.ok(container.textContent.includes('挥金如土'), 'dom-smoke: the roster did not render')

  // Provider, model and tools are pickers, never free text: a deployment that
  // offers no options still must not invite a typo.
  assert.ok(container.querySelector('select#dsh-af-provider'), 'dom-smoke: the provider field is not a picker')
  assert.ok(container.querySelector('select#dsh-af-model'), 'dom-smoke: the model field is not a picker')
  assert.ok(container.querySelector('select#dsh-af-toolmode'), 'dom-smoke: the tool field is not a picker')
  assert.ok(container.querySelector('select#dsh-af-effort'), 'dom-smoke: the thinking-level field is not a picker')
  assert.equal(container.querySelector('input#dsh-af-effort'), null, 'dom-smoke: the thinking-level field is still a text box')
  assert.equal(container.querySelector('input#dsh-af-provider'), null, 'dom-smoke: the provider field is still a text box')
  assert.equal(container.querySelector('input#dsh-af-model'), null, 'dom-smoke: the model field is still a text box')

  // Switching tabs is the one interaction the static render cannot express.
  const workspacesTab = byText(container, 'tab.workspaces')
  assert.notEqual(workspacesTab, undefined, 'dom-smoke: the workspaces tab is missing')
  await act(async () => { workspacesTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.ok(container.textContent.includes('工作区一'), 'dom-smoke: the workspaces tab did not render its panel')
  assert.ok(container.textContent.includes('workspaces.lead'), 'dom-smoke: the lead selector is missing')

  // Round-tripping the tabs is what exposes a seat called from inside a branch:
  // the hook count has to survive the change in both directions.
  const agentsTab = byText(container, 'tab.agents')
  await act(async () => { agentsTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await act(async () => { workspacesTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.ok(container.textContent.includes('工作区一'), 'dom-smoke: the workspaces tab broke on the second visit')
  assert.deepEqual(reactProblems, [], 'dom-smoke: React reported a hook-order problem')

  // A field edit commits on blur, which is where the write path lives.
  const persona = container.querySelector('textarea.dsh-af__area--tall')
  assert.notEqual(persona, null, 'dom-smoke: no dispatch-rule textarea was rendered')
  persona.value = 'DOM WRITTEN RULES'
  await act(async () => {
    persona.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }))
  })
  assert.equal(
    section.workspaces['workspace-1']?.dispatchRule,
    'DOM WRITTEN RULES',
    'dom-smoke: blurring the workspace rules field did not write',
  )

  process.stdout.write('dom-smoke: the settings page switches tabs and commits on blur\n')
}

// ----------------------------------------------------------------- the canvas

{
  const { ...actions } = mainEntry.options.inject()
  const canvasProps = {
    useSessions: selector => selector(sessionsSnapshot),
    ...actions,
    t: key => key,
  }
  const container = await mount(mainEntry.component, canvasProps)
  await flush()

  assert.ok(container.textContent.includes('挥金如土'), 'dom-smoke: the canvas drew no lane')
  assert.ok(container.textContent.includes('重构鉴权模块'), 'dom-smoke: the canvas drew no card')

  // The effect that asks for the catalogue is the whole reason this file exists:
  // a server render never runs it, and without it the panel sits empty forever.
  assert.deepEqual(
    expanded,
    [{ parentSessionId: 'root', open: true }],
    'dom-smoke: mounting the canvas did not ask the host for the session catalogue',
  )
  assert.deepEqual(refreshed, ['root'], 'dom-smoke: mounting the canvas did not refresh the catalogue')

  const card = container.querySelector('button.dsh-af-map__card')
  assert.notEqual(card, null, 'dom-smoke: no card was rendered')
  await act(async () => { card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.ok(container.textContent.includes('map.agent'), 'dom-smoke: clicking a card opened no detail')

  const open = byText(container, 'map.open')
  assert.notEqual(open, undefined, 'dom-smoke: the open action is missing')
  await act(async () => { open.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.equal(opened.length, 1, 'dom-smoke: opening a conversation never reached the sessions service')
  assert.equal(opened[0].childSessionId, 'child-a')
  process.stdout.write('dom-smoke: the canvas requests its catalogue, opens details, and opens a conversation\n')
}

// The plugin's own disposers must release what the mounts opened.
for (const dispose of disposers) dispose()
assert.equal(scopeListeners.size, 0, 'dom-smoke: disposing left a settings subscription behind')

process.stdout.write('dom-smoke: the browser half mounts, responds, and reaches its services\n')
