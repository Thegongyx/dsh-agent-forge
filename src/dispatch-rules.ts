/**
 * Injects a workspace's dispatch rules into the model context.
 *
 * The rules must reach the model before it decides how to split work, and dsh
 * offers two ways in. This uses `agent/pre-step` rather than a system-prompt
 * section for two reasons that are properties of the loop, not preferences:
 * `systemPrompt.section()` accepts only a synchronous text provider, and prompt
 * assembly happens *before* the pre-step waterfall — so a rule read
 * asynchronously from workspace configuration could not land in the first
 * request. A pre-step listener can await the read and is still ahead of the
 * request that step builds.
 *
 * The loop appends every message a pre-step decision carries as a durable
 * `user/message`, so the injected text is reconstructable from the log by
 * construction. That also means injecting on every step would append a copy on
 * every step, so the listener keeps one copy per distinct rule text: it asks the
 * session log what it already injected, and only remembers the answer for
 * sessions it has already seen. A resumed session therefore re-reads its own log
 * instead of trusting process memory that a restart would have emptied.
 *
 * @module dsh-agent-forge/dispatch-rules
 */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import type { AgentForge } from './index.ts'

/** Durable provenance of one injected workspace dispatch-rules context. */
export interface DispatchRulesSource {
  /** Discriminant that identifies this plugin's context in the log. */
  readonly kind: 'agent-forge-dispatch-rules'
  /** The injected text is an instruction, not a record of something that happened. */
  readonly form: 'instructions'
  /** Workspace the rules were read for, absent when none resolved. */
  readonly workspaceId: string | undefined
  /** Hash of the injected text, so a later step can tell whether the rules moved. */
  readonly digest: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'agent-forge-dispatch-rules': DispatchRulesSource
  }
}

/** Wraps rules text in a tag the model reads as ambient instruction, not as a user request. */
function render(rule: string): string {
  return ['<workspace-dispatch-rules>', rule, '</workspace-dispatch-rules>'].join('\n')
}

/**
 * Hashes rules text into the digest recorded with its injection.
 * @param rule - the rules text.
 * @returns a short stable hex digest.
 */
function digestOf(rule: string): string {
  return createHash('sha256').update(rule).digest('hex').slice(0, 16)
}

/**
 * The digest this session's log already carries, if any.
 * @param session - the session whose log to read.
 * @returns the digest of the last injected copy, or `undefined` when the log has none.
 */
function lastLoggedDigest(session: Session): string | undefined {
  let found: string | undefined
  for (const message of session.deriveMessages()) {
    if (message.source.kind === 'agent-forge-dispatch-rules') found = message.source.digest
  }
  return found
}

/**
 * Installs the pre-step listener that injects workspace dispatch rules.
 * @param ctx - the plugin's Cordis context; the listener unwinds with it.
 * @param forge - the service resolving a workspace's effective rules.
 */
export function installDispatchRules(ctx: Context, forge: AgentForge): void {
  /** Rule digest each session has been told, for sessions this process has seen. */
  const told = new WeakMap<Session, string | undefined>()
  /** Workspace each session belongs to; a session's working directory never moves. */
  const workspaceOf = new WeakMap<Session, string | undefined>()

  ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
    // Waterfall contract: delegate first, then fold this context onto whatever
    // downstream decided, so a later listener can still reject or rewrite.
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision

    const session = agent.session
    // A subagent is a worker, not a dispatcher. Its behaviour comes from the
    // persona its agent definition supplied, so workspace routing rules would be
    // noise in its context.
    if (session.header.origin === 'subagent') return decision
    const cwd = session.header.cwd
    if (cwd === undefined) return decision

    if (!workspaceOf.has(session)) {
      const registry = ctx.get('workspaceRegistry')
      const workspace = registry === undefined ? undefined : await registry.resolveByPath(cwd)
      signal.throwIfAborted()
      workspaceOf.set(session, workspace?.id)
    }
    const workspaceId = workspaceOf.get(session)

    const { dispatchRule } = forge.workspace(workspaceId)
    const digest = digestOf(dispatchRule)

    if (!told.has(session)) told.set(session, lastLoggedDigest(session))
    if (told.get(session) === digest) return decision
    told.set(session, digest)

    return {
      ...decision,
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text: render(dispatchRule) }],
          source: { kind: 'agent-forge-dispatch-rules', form: 'instructions', workspaceId, digest },
        }),
      ],
    }
  }, { prepend: true })
}
