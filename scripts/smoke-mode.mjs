/**
 * Keyless tests for the mode's half: the delegation tool and the dispatch-rules
 * injection.
 *
 * Both are environment-shaped behaviour — what request a tool call assembles,
 * what the loop is handed back, when a second copy is suppressed — so the test
 * drives the real built module with stand-in services instead of asserting on
 * the shape of the source. The stand-ins record what they were asked for, which
 * is the only thing the two contributions are responsible for.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import assert from 'node:assert/strict'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const modePath = resolve(root, 'lib/mode.js')
if (!existsSync(modePath)) throw new Error(`smoke-mode: ${modePath} is missing. Run "npm run build" first.`)

const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
const mode = await import(pathToFileURL(modePath).href)

// ------------------------------------------------------------- export contract

assert.equal(mode.name, 'agent-forge-mode', 'smoke-mode: wrong plugin name')
assert.deepEqual(
  mode.inject,
  ['agentForge', 'tools', 'subagents'],
  'smoke-mode: the mode must declare the services it reads',
)
assert.equal(typeof mode.apply, 'function', 'smoke-mode: the mode exports no apply')
assert.equal(
  Object.hasOwn(mode, 'default'),
  false,
  'smoke-mode: a default export beside named plugin exports makes the Loader discard the namespace',
)
assert.equal(typeof mode.Config, 'function', 'smoke-mode: the mode carries no configuration schema')
const defaults = mode.Config({})
assert.equal(defaults.dispatchToolName, 'forge_dispatch', 'smoke-mode: wrong default tool name')
// The default is the namespace of the per-agent provider names, not one
// provider: every agent runs on `<namespace>:<agentId>`.
assert.equal(defaults.dispatchProvider, 'forge', 'smoke-mode: wrong default provider namespace')

// --------------------------------------------------------------- stand-in world

const definitions = []
const listeners = []
const starts = []
const logs = []

/** Provider capability flags, flipped by the capability-precheck case below. */
let capabilities = {
  agentOptions: true,
  outputSchema: true,
  depthLimit: true,
  toolFilter: true,
  persona: true,
}

const agents = {
  spendthrift: {
    id: 'spendthrift',
    builtin: true,
    label: '挥金如土',
    description: '',
    persona: 'PERSONA',
    model: { provider: 'route-provider', model: 'route-model' },
    reasoningEffort: 'high',
    tools: { deny: ['forge_dispatch'] },
    maxDepth: 2,
  },
}

const forge = {
  getAgent: id => agents[id],
  listAgents: () => Object.values(agents),
  workspace: () => ({ workspaceId: undefined, enabled: [], lead: undefined, dispatchRule: 'RULES' }),
}

const context = {
  agentForge: forge,
  logger: {
    info: message => { logs.push(message) },
  },
  tools: {
    register: definition => {
      definitions.push(definition)
      return () => {}
    },
  },
  on: (event, listener, options) => {
    listeners.push({ event, listener, options })
    return () => {}
  },
  get: () => undefined,
  // The mode registers one provider per agent, so the stand-in registry has to
  // accept registrations and hand back a disposer.
  effect: callback => {
    const dispose = callback()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  subagents: {
    registered: [],
    registerProvider(provider) {
      this.registered.push(provider)
      return () => {
        this.registered = this.registered.filter(candidate => candidate !== provider)
      }
    },
    // No fallback on purpose: the tool registers a provider on demand for an
    // agent the mode never saw, and a stub that always answers would hide whether
    // that path actually ran.
    getProvider(name) {
      return this.registered.find(provider => provider.name === name)
    },
    start: async (name, request) => {
      starts.push({ name, request })
      // A tool call the adapter cannot parse arrives as ordinary text, which is the
      // one way a run ends `completed` having done nothing. Both spellings seen in
      // practice are exercised below.
      const asked = request.prompt[0].text
      const text = asked === 'dsml-probe'
        ? '<｜DSML｜｜ invoke name="bash">'
        : asked === 'xml-probe' ? '<tool_call><function=web_search>' : 'done'
      return {
        id: 'child-1',
        result: Promise.resolve({ output: [{ type: 'text', text }], stopReason: 'completed' }),
      }
    },
  },
}

mode.apply(context, defaults)

// The mode mounts lazily, so this line is the only startup-visible evidence it
// mounted at all; a silent mount would leave that unverifiable.
assert.equal(logs.length, 1, 'smoke-mode: mounting the mode must announce itself exactly once')
assert.ok(logs[0].includes('forge_dispatch'), 'smoke-mode: the mount line must name the configured tool')
// The line names the namespace the per-agent providers are registered under, so
// it has to carry whatever the deployment configured.
assert.ok(logs[0].includes('forge'), 'smoke-mode: the mount line must name the configured provider namespace')

// ------------------------------------------------------------------ the tool

assert.equal(definitions.length, 1, 'smoke-mode: expected exactly one tool registration')
const tool = definitions[0]
assert.equal(tool.name, 'forge_dispatch', 'smoke-mode: the tool ignored the configured name')

const signal = new AbortController().signal
const parent = { id: 'parent-agent' }
const args = { agent: 'spendthrift', prompt: 'do the thing' }

const value = await tool.execute(args, { agent: parent, signal })
assert.equal(value.agent, 'spendthrift')
assert.equal(value.subagentId, 'child-1')
assert.equal(value.stopReason, 'completed')
assert.equal(value.output, 'done', 'smoke-mode: text blocks were not flattened')

assert.equal(starts.length, 1, 'smoke-mode: the tool started a run more than once')
assert.equal(starts[0].name, 'forge:spendthrift', 'smoke-mode: the run started on the wrong provider')
const request = starts[0].request
assert.equal(request.parent, parent, 'smoke-mode: the calling agent was not the parent')
assert.equal(request.signal, signal, 'smoke-mode: the call signal was not forwarded')
// The label leads with the agent name so the run canvas can group delegations by
// agent without a second channel; the task text follows it.
assert.equal(
  request.label,
  '挥金如土 · do the thing',
  'smoke-mode: the delegation label is not agent-prefixed',
)
assert.equal(request.prompt[0].text, 'do the thing')
assert.equal(request.persona, 'PERSONA')
assert.deepEqual(request.toolFilter, { deny: ['forge_dispatch'] })
// The cap travels with the request now: the provider declares `depthLimit: true`
// and enforces it by resolving the child depth before creating anything.
assert.equal(request.maxDepth, 2)
assert.deepEqual(
  request.agentOptions,
  { provider: 'route-provider', model: 'route-model', reasoningEffort: 'high' },
  'smoke-mode: the agent model route was not assembled',
)

// The model-facing render is the tool's only other output surface.
const rendered = tool.output.render(args, value)
assert.equal(rendered.length, 1)
assert.ok(rendered[0].text.includes('spendthrift'), 'smoke-mode: the result render omits the agent')
assert.ok(rendered[0].text.includes('done'), 'smoke-mode: the result render omits the output')

// A label the model supplies keeps the agent prefix and replaces the task text.
await tool.execute(
  { agent: 'spendthrift', prompt: 'ignored here', label: 'explicit label' },
  { agent: parent, signal },
)
assert.equal(starts[1].request.label, '挥金如土 · explicit label')

// Without a label the first line of the prompt stands in, truncated.
await tool.execute(
  { agent: 'spendthrift', prompt: 'first line\nsecond line that is ignored' },
  { agent: parent, signal },
)
assert.equal(starts[2].request.label, '挥金如土 · first line')

// An unknown id must name what does exist rather than fail opaquely.
await assert.rejects(
  () => tool.execute({ agent: 'ghost', prompt: 'x' }, { agent: parent, signal }),
  /unknown agent "ghost"; this deployment defines: spendthrift/,
  'smoke-mode: an unknown agent did not report the known ones',
)

// Capability negotiation is gone on purpose: the forge provider applies persona
// and the tool filter itself through `applyChildComposition`, so there is no
// unsupported field left to reject. The remaining failure — an agent whose
// per-agent provider was never registered — is a plain guard in the tool; it is
// covered end-to-end by `installed-smoke` once the mode registers providers
// against a real registry.
assert.equal(starts.length, 3, 'smoke-mode: a rejected capability still started a run')

// A caller with no agent has nowhere to hang the child.
await assert.rejects(
  () => tool.execute(args, { signal }),
  /requires a calling agent/,
  'smoke-mode: the tool ran without a calling agent',
)

// ------------------------------------------------------ dispatch-rules injection

assert.equal(listeners.length, 1, 'smoke-mode: expected exactly one event listener')
assert.equal(listeners[0].event, 'agent/pre-step', 'smoke-mode: wrong injected event')
assert.deepEqual(listeners[0].options, { prepend: true }, 'smoke-mode: the listener must observe downstream first')

const human = createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })
const next = async () => ({ kind: 'enter', messages: [human] })
const emit = session => listeners[0].listener({ agent: { session }, signal }, next)

const session = { header: { cwd: 'C:/work' }, deriveMessages: () => [] }
const decision = await emit(session)
assert.equal(decision.kind, 'enter')
assert.equal(decision.messages.length, 2, 'smoke-mode: the rules were not injected')
const injected = decision.messages[1]
assert.equal(injected.source.kind, 'agent-forge-dispatch-rules', 'smoke-mode: the injection carries no provenance')
assert.equal(injected.source.form, 'instructions')
assert.equal(injected.source.workspaceId, undefined)
assert.equal(typeof injected.source.digest, 'string')
assert.ok(injected.content[0].text.includes('RULES'), 'smoke-mode: the injected text is not the rules')
assert.ok(
  injected.content[0].text.includes('<workspace-dispatch-rules>'),
  'smoke-mode: the injected text is not tagged as ambient instruction',
)

// The loop logs every decision message, so a second injection would be a second
// durable copy. One copy per distinct rule text is the contract.
const repeated = await emit(session)
assert.equal(repeated.messages.length, 1, 'smoke-mode: the rules were injected twice in one session')

// A worker is not a dispatcher.
const childSession = { header: { cwd: 'C:/work', origin: 'subagent' }, deriveMessages: () => [] }
assert.equal((await emit(childSession)).messages.length, 1, 'smoke-mode: a subagent was given routing rules')

// A session this process has never seen is answered from its own log, so a
// restart does not produce a second copy in a resumed conversation.
const resumed = { header: { cwd: 'C:/work' }, deriveMessages: () => [injected] }
assert.equal((await emit(resumed)).messages.length, 1, 'smoke-mode: a resumed session was told twice')

// A rejection downstream stays a rejection.
const rejected = await listeners[0].listener(
  { agent: { session: { header: { cwd: 'C:/work' }, deriveMessages: () => [] } }, signal },
  async () => ({ kind: 'reject' }),
)
assert.deepEqual(rejected, { kind: 'reject' }, 'smoke-mode: the listener overrode a downstream rejection')

// ------------------------------------------------- an agent added after mount

// The roster the mode read at apply time did not contain it, so its provider can
// only come from the tool's on-demand registration — without which every roster
// change would need a new session, which is the defect this guards.
agents.late = {
  id: 'late',
  builtin: false,
  label: '迟到者',
  description: '',
  persona: 'LATE',
  model: undefined,
  reasoningEffort: undefined,
  tools: undefined,
  maxDepth: undefined,
}
assert.equal(context.subagents.getProvider('forge:late'), undefined, 'smoke-mode: the late agent was registered at mount')
await tool.execute({ agent: 'late', prompt: 'late task' }, { agent: parent, signal })
assert.ok(
  context.subagents.getProvider('forge:late') !== undefined,
  'smoke-mode: an agent added after mount got no provider',
)
assert.equal(starts.at(-1).name, 'forge:late', 'smoke-mode: the late agent did not dispatch on its own provider')
delete agents.late

// --------------------------------------- a completed run that did nothing

// The child's turn settles `completed` even when its model wrote a tool call the
// adapter could not parse: nothing errors, so the outcome alone reads as success
// and the parent repeats raw markup as an answer. Every observed dialect must be
// reported instead.
const ranText = async prompt =>
  (await tool.execute({ agent: 'spendthrift', prompt }, { agent: parent, signal })).output
assert.ok(
  (await ranText('dsml-probe')).includes('[agent-forge] This run ended'),
  'smoke-mode: a DSML tool call was reported as a result',
)
assert.ok(
  (await ranText('xml-probe')).includes('[agent-forge] This run ended'),
  'smoke-mode: an XML tool call was reported as a result',
)
assert.equal(await ranText('an ordinary answer'), 'done', 'smoke-mode: a plain answer was rewritten')

// A filter the settings schema materialized must not reach the runtime. It names
// nothing, and the runtime applies it to everything the child inherits — so the
// child, not the filter, is what ends up empty.
agents.emptyFilter = { ...agents.spendthrift, id: 'emptyFilter', tools: { allow: [], deny: [] } }
await tool.execute({ agent: 'emptyFilter', prompt: 'x' }, { agent: parent, signal })
assert.equal(
  starts.at(-1).request.toolFilter,
  undefined,
  'smoke-mode: a materialized-empty tool filter was forwarded to the runtime',
)
delete agents.emptyFilter

process.stdout.write('smoke-mode: the delegation tool and the rules injection behave\n')
