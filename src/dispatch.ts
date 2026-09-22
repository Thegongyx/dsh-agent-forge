/**
 * The forge's own subagent provider: one delegation, one session, composed from
 * the agent's preset.
 *
 * This is a provider rather than a bypass so that delegation keeps every
 * property the subagent seam already provides — lifecycle events, the run
 * catalog the panorama reads, cancellation, disposal — and only the child's
 * *composition* comes from here. The child runs in this process, so nothing
 * starts a second dsh.
 *
 * The load-bearing fact: a session created through `ctx.agents.create` inherits
 * no preset (`composedPreset` is null), so selecting one before the first turn is
 * what gives the child its agent's plugin set. The order is forced by dsh — a
 * session that has started has a fixed preset — so `select` lands between
 * creation and the first prompt, and the result boundary is taken after it.
 *
 * @module dsh-agent-forge/dispatch
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { foldConsumedWork, type Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionLogOffset, type SessionId } from '@deepseek-ai/dsh-session'
import {
  applyChildComposition,
  assertSubagentMaxDepth,
  childSessionMeta,
  finalAssistantOutput,
  resolveChildDepth,
  type ResolvedSubagentStartRequest,
  type SubagentProvider,
  type SubagentRun,
  type SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'

/**
 * The part of the preset roster this provider uses.
 *
 * Spelled structurally, like the catalogue route's view of the LLM registry:
 * naming the one method called keeps this package off the preset package's
 * public surface for a single call.
 */
interface PresetRoster {
  /** Compose a blank session's agent from a preset and record it. */
  select(agent: Agent, agentPreset: string): Promise<string>
}

/** How to build one agent's provider. */
export interface ForgeProviderOptions {
  /** Registry name on `ctx.subagents`; unique per agent. */
  name: string
  /** The preset the child session is composed from — the agent's plugin set. */
  presetId: string
}

/**
 * Reads the child's stop reason from its settled events.
 * @param own - the child's events after the dispatch boundary.
 * @returns the recorded reason, or `unknown` when the log carried none.
 */
function stopReasonOf(own: readonly unknown[]): SubagentStopReason {
  const end = foldConsumedWork(own as never).end
  const reason = (end?.data as { reason?: { kind?: unknown } } | undefined)?.reason
  // The session records a TurnEndReason OBJECT discriminated by `kind`. Reading
  // it as a string made every run — including a clean one — report `error`, so
  // the field could not be used to judge whether a dispatch succeeded.
  switch (reason?.kind) {
    case 'completed':
      return 'completed'
    case 'max-tokens':
      return 'max-tokens'
    case 'aborted':
      return 'aborted'
    // A pre-step rejection discarded the claimed prompt: the task was declined,
    // and the caller must not read the run as done.
    case 'blocked':
      return 'refusal'
    default:
      // `error`, `interrupted`, an absent end, or a kind this build does not
      // know. Anything unrecognized must never overstate success.
      return 'error'
  }
}

/**
 * Flattens an error and everything it wraps into one readable chain.
 *
 * The Loader reports a failed composition as a bare
 * `failed to apply loader entry X: loader entries failed to apply`, with the
 * reason that actually matters nested inside an `AggregateError`. Reporting only
 * the outer message makes every composition failure look identical and
 * undiagnosable, which is exactly how several rounds here were spent guessing.
 * @param error - the thrown value.
 * @returns one line naming each distinct cause, outermost first.
 */
function explain(error: unknown): string {
  const parts: string[] = []
  const visit = (value: unknown, depth: number): void => {
    if (value === undefined || depth > 5) return
    if (value instanceof AggregateError) {
      if (value.message.length > 0) parts.push(value.message)
      for (const inner of value.errors) visit(inner, depth + 1)
      return
    }
    if (value instanceof Error) {
      if (value.message.length > 0) parts.push(value.message)
      visit(value.cause, depth + 1)
      return
    }
    parts.push(String(value))
  }
  visit(error, 0)
  return [...new Set(parts)].join(' ← ')
}

/**
 * Builds the provider that runs an agent's delegations as their own session.
 * @param options - the registry name and the preset to compose from.
 * @returns a subagent provider the service can register.
 */
export function createForgeProvider(options: ForgeProviderOptions): SubagentProvider {
  return {
    name: options.name,
    // Persona, the tool filter, the model route and the depth cap are all
    // enforced here, so the service never has to reject a request this provider
    // cannot honour.
    capabilities: { agentOptions: true, outputSchema: false, depthLimit: true, toolFilter: true, persona: true },
    // Each child is a fresh session with its own context; it never sees the
    // parent's turns except through the prompt it is handed.
    inheritsParentContext: false,
    async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
      // Resolved before anything is created: a request past the cap must fail
      // without leaving a session behind, which is the same order the in-process
      // driver uses.
      assertSubagentMaxDepth(request.maxDepth)
      const childDepth = resolveChildDepth(request.parent, request.maxDepth)
      const sessionId = brandString<SessionId>(randomUUID())
      let created: Agent | undefined
      const handle = await request.parent.ctx.agents.create({
        sessionId,
        meta: childSessionMeta(request.parent, childDepth, false),
        ...request.agentOptions === undefined ? {} : { agentOptions: request.agentOptions },
        signal: request.signal,
        setup: (childCtx: Context, child: Agent) => {
          created = child
          applyChildComposition(childCtx, request.parent, {
            persona: request.persona,
            toolFilter: request.toolFilter,
          })
          // Recorded in the child's own log so the delegation is durable and the
          // panorama can name it, exactly as the in-process driver does.
          child.session.append('subagent/descriptor', request.descriptor)
        },
      })
      const child = created ?? handle.agent
      try {
        const roster = request.parent.ctx.get('agentPresets') as unknown as PresetRoster | undefined
        if (roster === undefined) {
          throw new Error('no agent preset roster is mounted, so this agent has no composition to run on')
        }
        // Before the first turn: a started session's preset is fixed.
        await roster.select(child, options.presetId)
        // Taken after `select`, because selecting records its own event and the
        // boundary must exclude everything that preceded the task.
        const boundary = SessionLogOffset(child.session.snapshotEvents(SessionLogOffset(0)).length)
        child.followup(createUserMessage({ content: request.prompt, source: { kind: 'user' } }))
        const result = (async () => {
          await child.whenIdle()
          const own = child.session.snapshotEvents(boundary)
          return {
            output: finalAssistantOutput(own) ?? [],
            stopReason: stopReasonOf(own),
          }
        })()
        return {
          id: sessionId,
          localAgent: child,
          result,
          async dispose(): Promise<void> {
            await handle.dispose()
          },
        }
      } catch (error) {
        // Publication never happened, so this provider still owns the partial
        // resources and must release them before rejecting. The message carries
        // the whole chain: the Loader's outer line alone does not say which row
        // failed or why.
        await handle.dispose()
        throw new Error(`agent-forge: agent "${options.presetId}" could not be composed — ${explain(error)}`)
      }
    },
  }
}

/**
 * Registers one provider per agent and returns its disposer.
 * @param ctx - a context carrying the subagent registry.
 * @param providers - the providers to register.
 * @returns a function that unregisters all of them.
 */
export function registerForgeProviders(ctx: Context, providers: readonly SubagentProvider[]): () => void {
  const disposers = providers.map(provider => ctx.subagents.registerProvider(provider))
  return () => { for (const dispose of disposers) dispose() }
}

/**
 * Flattens assistant output into the text the delegating agent reads.
 * @param output - the child's final output blocks.
 * @returns the concatenated text of every text block.
 */
export function textOf(output: readonly ContentBlock[]): string {
  return output
    .flatMap(block => (block.type === 'text' ? [block.text] : []))
    .join('\n')
    .trim()
}
