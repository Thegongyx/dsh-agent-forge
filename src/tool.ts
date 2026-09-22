/**
 * The model-facing delegation tool.
 *
 * `ctx.subagents` already owns starting, capability validation, the durable
 * descriptor, and lifecycle events. What this tool adds is the *agent
 * definition* as the unit of delegation: the model names an agent, and that
 * definition decides the child's model route, reasoning effort, persona, visible
 * tool set, and recursion cap. The alternative — one loaded tool instance per
 * persona, which is how the shipped delegation tool works — fixes those choices
 * at composition time instead of at call time.
 *
 * Capabilities are pre-checked rather than left to the service. A provider that
 * cannot enforce `persona` rejects the start with `UNSUPPORTED_CAPABILITY`, and
 * that error names a capability flag rather than the agent field that asked for
 * it. Failing here instead names the field and says how to resolve it, which is
 * what a deployment running an out-of-process provider actually needs to read.
 *
 * @module dsh-agent-forge/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
// Declares `ctx.subagents`; the tool value-imports the registry below.
import type {} from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { presetIdOf } from './composition.ts'
import { createForgeProvider } from './dispatch.ts'
import type { AgentForge } from './index.ts'
import { DELEGATION_LABEL_SEPARATOR } from './panorama.ts'
import { isEmptyToolFilter, type AgentToolFilter, type ResolvedAgent } from './types.ts'

/**
 * A tool call the child's adapter did not parse.
 *
 * Matched by shape rather than by one model's exact spelling: every dialect that
 * fails this way writes the call as text, and the markers below are what the
 * failing runs produce. A false positive costs a warning line; a false negative
 * costs a silent no-op reported as success — which is how a run whose model wrote
 * DeepSeek's own DSML dialect reached its parent as a plain completed answer.
 *
 * The third alternative covers both spellings of that dialect's delimiter: the
 * full-width bar the model emits, and the ASCII one a template usually carries.
 */
const UNPARSED_TOOL_CALL = /<tool_call>|<function=[A-Za-z_]|<[｜|]DSML[｜|]/

/** The tool's configurable identity and target provider. */
export interface DispatchToolConfig {
  /** Model-facing tool name. */
  toolName: string
  /** `ctx.subagents` provider name runs are started on. */
  provider: string
}

/**
 * The model route an agent definition asks for.
 * @param agent - the resolved agent.
 * @returns the options to pass, or `undefined` when the definition inherits everything.
 */
function routeOf(agent: ResolvedAgent): AgentOptions | undefined {
  const options: AgentOptions = {
    ...(agent.model === undefined ? {} : { provider: agent.model.provider, model: agent.model.model }),
    ...(agent.reasoningEffort === undefined
      // A config-authored effort id. The provider adapter owns which ids exist,
      // so this is a configuration boundary rather than a union to restate here.
      ? {}
      : { reasoningEffort: agent.reasoningEffort as NonNullable<AgentOptions['reasoningEffort']> }),
  }
  return Object.keys(options).length === 0 ? undefined : options
}

/**
 * The filter to hand the delegation runtime, or `undefined` for none.
 *
 * Resolution already drops a filter that names nothing, so this is a second gate
 * rather than the only one — and it is worth keeping, because the failure it
 * prevents is silent: the runtime applies the filter to what the child inherits,
 * an empty `allow` denies every tool the child would otherwise have, and a child
 * with no tools still ends its turn `completed`. What the parent then reads is a
 * model printing tool-call markup as text and nothing having happened.
 * @param filter - the resolved agent's filter.
 * @returns the filter to act on, or `undefined` when it constrains nothing.
 */
function usableToolFilter(filter: AgentToolFilter | undefined): AgentToolFilter | undefined {
  return isEmptyToolFilter(filter) ? undefined : filter
}

/**
 * Flattens a result's content into its text.
 * @param blocks - the child's output blocks.
 * @returns the concatenated text, empty when the child produced none.
 */
function textOf(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

/**
 * Builds the label a delegation is recorded under.
 *
 * This label is the only channel that tells the browser which configured agent
 * ran a run: a plugin outside the harness cannot add a session event type, and
 * the durable subagent descriptor records the composed request rather than the
 * definition it came from. Leading with the agent's name is what lets the run
 * canvas group delegations by agent without a second channel — `../panorama.ts`
 * splits it back apart.
 * @param agentLabel - the agent's display name.
 * @param requested - the label the model supplied, when it supplied one.
 * @param prompt - the task text, used when the model supplied none.
 * @returns the composed label.
 */
function delegationLabel(agentLabel: string, requested: string | undefined, prompt: string): string {
  const supplied = requested?.trim() ?? ''
  const derived = prompt.trim().split('\n')[0]?.slice(0, 60).trim() ?? ''
  const task = supplied === '' ? derived : supplied
  return task === '' ? agentLabel : `${agentLabel}${DELEGATION_LABEL_SEPARATOR}${task}`
}

/**
 * Registers the delegation tool.
 * @param ctx - the plugin's Cordis context, which must provide `tools` and `subagents`.
 * @param forge - the service resolving agent definitions.
 * @param config - the tool's configured identity and provider.
 */
export function installDispatchTool(ctx: Context, forge: AgentForge, config: DispatchToolConfig): void {
  ctx.tools.register(defineTool({
    name: config.toolName,
    description: [
      'Delegate one self-contained sub-task to a configured agent and wait for its result.',
      'Call this when the dispatch rules in context assign the work to another agent.',
      'The agent you name decides the model, the reasoning effort, and which tools the child can',
      'see, so choose the one whose remit matches the work.',
      'The child starts with no memory of this conversation: put everything it needs into `prompt`.',
      'It reports what it intended to do, not proof of what happened — verify what you pass on.',
    ].join(' '),
    parameters: {
      agent: {
        type: 'string',
        required: true,
        description: 'Agent id to run. The dispatch rules and the agent roster name these.',
      },
      prompt: {
        type: 'string',
        required: true,
        description: 'The complete sub-task, written so it stands on its own without this conversation.',
      },
      label: {
        type: 'string',
        description: 'Short label for the delegation list. Defaults to the agent name.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          agent: { type: 'string', required: true },
          subagentId: { type: 'string', required: true },
          stopReason: { type: 'string', required: true },
          output: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.output === ''
          ? `Agent ${value.agent} finished (${value.stopReason}) with no text output.`
          : `Agent ${value.agent} finished (${value.stopReason}):\n\n${value.output}`,
      }],
    },
    async execute(args, exec) {
      const parent = exec.agent
      if (parent === undefined) {
        throw new Error(`"${config.toolName}" requires a calling agent`)
      }

      const agent = forge.getAgent(args.agent)
      if (agent === undefined) {
        // Both names, because the caller's mistake is usually a near-miss on the
        // display name the rules taught it rather than on the id.
        const known = forge.listAgents()
          .map(candidate => `${candidate.id} (${candidate.label})`)
          .join(', ')
        throw new Error(`unknown agent "${args.agent}"; this deployment defines: ${known}`)
      }

      // Each agent runs on its own provider, so the child's session is composed
      // from that agent's preset rather than from the parent's.
      const providerName = `${config.provider}:${agent.id}`
      if (ctx.subagents.getProvider(providerName) === undefined) {
        // An agent authored after the mode mounted has no provider yet. It is
        // registered here instead of being refused, so the roster can change
        // mid-session: the alternative is telling the user to start a new session
        // for a change they just made in the settings page.
        ctx.effect(
          () => ctx.subagents.registerProvider(createForgeProvider({
            name: providerName,
            // The same rule the mode applies at mount. An agent whose selection
            // holds nothing of its own runs the deployment's full coding agent —
            // never the empty preset generated from that selection.
            presetId: presetIdOf(agent),
          })),
          `agent-forge: provider ${providerName}`,
        )
      }

      const persona = agent.persona === '' ? undefined : agent.persona
      const toolFilter = usableToolFilter(agent.tools)
      const maxDepth = agent.maxDepth
      const agentOptions = routeOf(agent)

      const run = await ctx.subagents.start(providerName, {
        label: delegationLabel(agent.label, args.label, args.prompt),
        prompt: [{ type: 'text', text: args.prompt }],
        parent,
        signal: exec.signal,
        ...(persona === undefined ? {} : { persona }),
        ...(toolFilter === undefined ? {} : { toolFilter }),
        ...(maxDepth === undefined ? {} : { maxDepth }),
        ...(agentOptions === undefined ? {} : { agentOptions }),
      })

      const result = await run.result
      const output = textOf(result.output)
      // A turn that ends normally can still have done nothing. The child's model
      // sometimes emits a tool call in a dialect its adapter does not parse; the
      // call is never executed, no result comes back, and the turn still settles
      // as `completed` because nothing errored. Reporting only the turn outcome
      // therefore reads a no-op as success, which is worse than reporting nothing.
      const unparsed = UNPARSED_TOOL_CALL.test(output)
      return {
        agent: agent.id,
        subagentId: String(run.id),
        stopReason: result.stopReason,
        output: unparsed
          ? `${output}\n\n[agent-forge] This run ended ${result.stopReason}, but its answer contains an `
            + 'unparsed tool call: the model asked for a tool in a syntax the deployment\'s adapter '
            + 'did not recognize, so nothing ran and no result was produced. Check the agent\'s model '
            + 'route — the provider or model may not speak the tool-call dialect this adapter expects.'
          : output,
      }
    },
  }))
}
