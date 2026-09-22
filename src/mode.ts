/**
 * The mode's half of the plugin.
 *
 * Two rows, two planes, on purpose. The service and the settings namespace live
 * on the Host plane, because a registry and a settings section are process-wide
 * facts. The delegation tool, the per-agent providers, and the dispatch-rules
 * injection live *here*, because all three are per-mode facts: `ctx.tools.register`
 * and `ctx.on` file into the calling context's scope, so a row mounted by a
 * preset's standing composition contributes only to sessions that joined that
 * preset. The providers are per-mode for the same reason — a mode owns the
 * presets its agents are composed from.
 *
 * @module dsh-agent-forge/mode
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { presetIdOf } from './composition.ts'
import { createForgeProvider, registerForgeProviders } from './dispatch.ts'
import { installDispatchRules } from './dispatch-rules.ts'
import { installDispatchTool } from './tool.ts'

/** Cordis plugin name, used by Loader diagnostics. */
export const name = 'agent-forge-mode'

/** Services this half reads: the definitions, the tool registry, and the delegation seam. */
export const inject = ['agentForge', 'tools', 'subagents']

/** What a deployment can change about the mode's contribution. */
export interface Config {
  /** Model-facing name of the delegation tool. */
  dispatchToolName: string
  /**
   * Namespace of the per-agent provider names.
   *
   * One provider is registered per agent as `<namespace>:<agentId>`; the tool
   * addresses an agent by that name. It was a single provider name before agents
   * owned their composition.
   */
  dispatchProvider: string
}

export const Config: z<Config> = z.object({
  dispatchToolName: z.string().default('forge_dispatch'),
  dispatchProvider: z.string().default('forge'),
})

/**
 * Registers the delegation tool, one provider per agent, and the rules injection.
 * @param ctx - the preset-scoped context this row was mounted into.
 * @param config - the row's configuration.
 */
export function apply(ctx: Context, config: Config): void {
  // One provider per agent, each carrying that agent's preset id: the provider
  // is what turns "this agent" into "a session composed from this agent's
  // composition". Registered in an effect so the mode unmounting takes them with
  // it, and re-derived whenever the roster changes.
  ctx.effect(() => {
    let disposeAll: (() => void) | undefined
    const sync = (): void => {
      disposeAll?.()
      disposeAll = registerForgeProviders(ctx, ctx.agentForge.listAgents().map(agent => createForgeProvider({
        name: `${config.dispatchProvider}:${agent.id}`,
        presetId: presetIdOf(agent),
      })))
    }
    sync()
    return () => { disposeAll?.() }
  }, 'agent-forge: per-agent providers')

  installDispatchTool(ctx, ctx.agentForge, {
    toolName: config.dispatchToolName,
    provider: config.dispatchProvider,
  })
  installDispatchRules(ctx, ctx.agentForge)
  // The mode mounts lazily, on the first session that names its preset, so this
  // line is the only startup-visible evidence that it mounted at all.
  ctx.logger.info(
    `agent-forge: mode mounted (tool "${config.dispatchToolName}", providers "${config.dispatchProvider}:<agent>")`,
  )
}
