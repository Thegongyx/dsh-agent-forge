/**
 * dsh-agent-forge, node half.
 *
 * The Host half owns the agent definitions and each workspace's decisions, and
 * exposes them as the `agentForge` service so the delegation path, the browser
 * half, and any other plugin read one resolution instead of re-deriving their
 * own. The browser half ships through this package's `./client` export.
 *
 * The service holds no cache. Reads resolve against the settings provider's
 * current source on every call, so a committed settings write takes effect on
 * the next read without an invalidation path that could go stale.
 *
 * @module dsh-agent-forge
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { installCatalogRoute } from './catalog.ts'
import { presetRoot, readBaseline, writePreset } from './composition.ts'
import {
  LOCALE_PREFERENCE_FIELD,
  LOCALE_SETTINGS_NAMESPACE,
  localeFromPreference,
  resolveAgents,
  resolveWorkspace,
  validateSettings,
} from './resolve.ts'
import * as schema from './schema.ts'
import type { AgentForgeSettings, ForgeLocale, ResolvedAgent, ResolvedWorkspace } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Agent definitions and per-workspace dispatch decisions for this deployment. */
    agentForge: AgentForge
  }
}

/** Agent definitions and the per-workspace decisions layered over them. */
export class AgentForge extends Service {
  static Config = schema.Config

  /** Language the row configures built-in copy to render in. */
  private readonly rowLocale: ForgeLocale

  /**
   * The authoritative settings value. Starts at the composition entry so the
   * service answers correctly when no settings provider is mounted, and is
   * replaced by the provider's scope once one attaches.
   */
  private source: () => AgentForgeSettings

  /**
   * @param ctx - the plugin's Cordis context.
   * @param config - the resolved row configuration, used as the namespace's composition layer.
   */
  constructor(ctx: Context, config: schema.Config) {
    super(ctx, 'agentForge')
    this.rowLocale = config.builtinLocale
    const entry = schema.namespaceEntryOf(config)
    this.source = () => entry

    // Mount facts are logged because this plugin's whole job is registering
    // things: whether the settings namespace attached is otherwise only visible
    // through a page that may not have been opened yet.
    ctx.logger.info(
      `agent-forge: service up (row language "${config.builtinLocale}")`,
    )

    // Optional on purpose: a deployment without a settings provider keeps the
    // composition entry as the only layer, which `installSection` handles by
    // falling back to it.
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(
        ctx,
        schema.SETTINGS_NAMESPACE,
        schema.AgentForgeSettingsSchema,
        entry,
        {
          setSource: (current) => { this.source = current },
          // A committed change is the only thing that can alter an agent's
          // composition, so this is where the generated presets are brought back
          // in line. Reads still re-resolve on their own; the files do not.
          onChange: () => { this.syncPresets(ctx) },
          validate: validateSettings,
        },
      )
      ctx.logger.info(`agent-forge: settings namespace "${schema.SETTINGS_NAMESPACE}" registered`)
      // A fresh install has agents but no generated preset files yet.
      this.syncPresets(ctx)
    })

    // The browser cannot read the tool registry or the Loader, so the pickers in
    // the settings page are filled from this one small document instead.
    installCatalogRoute(ctx)
  }

  /**
   * Mirrors the stored agents into the preset directories dsh composes from.
   *
   * Only agents that own a generated composition are written. An agent that
   * names an existing preset runs somebody else's file, and overwriting that
   * would silently discard a composition this plugin never authored.
   *
   * Every generated file embeds this plugin's shipped baseline. That is why
   * nothing here waits on a deployment preset: a composition holding only the
   * agent's rows mounts no tools, and a child running on one reports its turn as
   * completed having done nothing.
   *
   * A failure here is logged rather than thrown: the settings page must keep
   * working on a read-only home, and one agent's write failure must not stop the
   * others. The agent then keeps whatever composition it already had, so a
   * dispatch that resolves to a file that is not there fails with the roster's own
   * `not found` instead of quietly running the wrong thing.
   * @param ctx - the plugin's context, for logging.
   */
  private syncPresets(ctx: Context): void {
    const root = presetRoot()
    let base: string
    try {
      base = readBaseline()
    } catch (error) {
      // The package is installed without its baseline, so no composition this
      // plugin writes could work. Say so once, loudly, per sync.
      ctx.logger.warn(
        `agent-forge: could not read the shipped baseline composition, so no agent composition was written: ${String(error)}`,
      )
      return
    }
    for (const agent of this.listAgents()) {
      if (agent.presetRef !== undefined) continue
      try {
        // The baseline's rows, then whatever this agent's selection adds on top.
        // `writePreset` drops the modules the profile already mounts: a stored
        // selection can name one — a value written before that filter existed,
        // which the page cannot even uncheck because it renders nothing for it —
        // and mounting it a second time inside a preset collides with the host's
        // own instance and fails the whole composition.
        writePreset(root, agent.id, agent.label, agent.description, agent.plugins ?? [], base)
      } catch (error) {
        ctx.logger.warn(
          `agent-forge: could not write the composition for agent "${agent.id}": ${String(error)}`,
        )
      }
    }
  }

  /**
   * The current resolved settings section.
   * @returns the authoritative value, composition layer included.
   */
  settings(): AgentForgeSettings {
    return this.source()
  }

  /**
   * The language built-in copy renders in right now.
   *
   * Read per call rather than cached, so a language chosen in the browser takes
   * effect on the next read — the same reason nothing else here caches.
   * @returns the user's chosen language, or the row's when none is stored.
   */
  private resolveLocale(): ForgeLocale {
    const provider = this.ctx.get('settings')
    if (provider === undefined) return this.rowLocale
    const section = provider.get(LOCALE_SETTINGS_NAMESPACE)
    const preference = typeof section === 'object' && section !== null
      ? (section as Record<string, unknown>)[LOCALE_PREFERENCE_FIELD]
      : undefined
    return localeFromPreference(preference, this.rowLocale)
  }

  /**
   * Every available agent: the shipped three in their fixed order, then
   * user-authored agents in name order.
   * @returns the resolved agent list.
   */
  listAgents(): ResolvedAgent[] {
    return resolveAgents(this.source(), this.resolveLocale())
  }

  /**
   * One agent by id, or by the display name a person reads.
   *
   * The ids are English, while the dispatch rules this plugin injects name the
   * agents in the deployment's own language — those rules, not the roster page,
   * are what the model reads before it chooses. Answering only to the id made
   * every agent unreachable under the name the rules taught, and the failure
   * arrived as `unknown agent "缝缝补补"` on the first dispatch anyone tried.
   *
   * Ids keep priority, so an agent whose label happens to equal another agent's
   * id cannot shadow it. Both comparisons ignore surrounding whitespace, and the
   * id is also tried case-insensitively: a name that reaches this method has
   * already survived a model's transcription of it.
   * @param name - the agent id or display name to resolve.
   * @returns the resolved agent, or `undefined` when no agent answers to it.
   */
  getAgent(name: string): ResolvedAgent | undefined {
    const wanted = name.trim()
    const agents = this.listAgents()
    const exact = agents.find(agent => agent.id === wanted)
    if (exact !== undefined) return exact
    const folded = wanted.toLowerCase()
    return agents.find(agent => agent.id.toLowerCase() === folded)
      ?? agents.find(agent => agent.label.trim().toLowerCase() === folded)
  }

  /**
   * One workspace's effective configuration.
   * @param workspaceId - the workspace to resolve, or `undefined` when none resolved.
   * @returns the workspace's agents, lead, and dispatch rules.
   */
  workspace(workspaceId: string | undefined): ResolvedWorkspace {
    return resolveWorkspace(this.source(), workspaceId, this.resolveLocale())
  }
}

export default AgentForge
