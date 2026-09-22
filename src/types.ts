/**
 * The studio's data model, shared by the Host half, the browser half, and the
 * tests.
 *
 * Two shapes exist on purpose. `AgentDefinition` is what a user stores, so
 * every editable field is optional: a user may override one built-in agent's
 * persona without restating its label. `ResolvedAgent` is what a reader gets,
 * with the built-in merge already applied and the id attached from the map key.
 *
 * @module dsh-agent-forge/types
 */

/** Built-in agent identifiers, in display order. */
export const BUILTIN_AGENT_IDS = ['spendthrift', 'patchwork', 'sightreader'] as const

/**
 * Path the browser fetches the Host's option catalogue from.
 *
 * Spelled in this dependency-free module rather than in the module that serves
 * it: that one reads the tool registry and the Loader, and a browser bundle
 * importing it for a single string would drag both in with it.
 */
export const CATALOG_PATH = '/dsh-agent-forge/catalog'

/** One deployment-global tool a child agent could be allowed to see. */
export interface CatalogTool {
  /** Tool name as the model sees it, and the name a filter names. */
  name: string
  /** One-line purpose, shown beside the control. */
  description: string
}

/** One plugin row the Loader mounted. */
export interface CatalogPlugin {
  /** Loader row id, unique within the composition. */
  id: string
  /** Module specifier the row mounts. */
  name: string
  /**
   * What this package does, taken from its own manifest.
   *
   * The Loader knows only the specifier, so the picker would otherwise offer a
   * wall of package names with no meaning. Empty when the manifest could not be
   * read, which the tree renders as a bare name rather than inventing copy.
   */
  description: string
  /**
   * Functional group this row belongs to.
   *
   * A stable id, not copy: the browser owns the localized label, so the same
   * document renders in either language.
   */
  category: string
}

/** One preset an agent can compose from instead of its own. */
export interface CatalogPreset {
  /** Preset id, which is also its directory name. */
  id: string
  /** Display name from the preset's own `preset.yml`. */
  name: string
  /** One-line description from the preset's own `preset.yml`. */
  description: string
  /** Whether this preset is one dsh-agent-forge generated. */
  generated: boolean
}

/** One thinking level a model declares. */
export interface CatalogEffort {
  /** Level id, as `reasoningEffort` names it. */
  id: string
  /** Display name. */
  name: string
}

/** One model a provider serves. */
export interface CatalogModel {
  /** Model id within the provider. */
  id: string
  /** Display name. */
  name: string
  /** Levels this model declares; empty when it declares none. */
  efforts: CatalogEffort[]
}

/** One provider route with the models it currently serves. */
export interface CatalogProvider {
  /** Provider id, as a model route names it. */
  id: string
  /** Display name. */
  name: string
  /** Models this provider advertises. */
  models: CatalogModel[]
}

/** The Host's option catalogue. */
export interface CatalogBody {
  /** Deployment-global tools, in registry order. */
  tools: CatalogTool[]
  /** Mounted plugin rows, in loader order. */
  plugins: CatalogPlugin[]
  /** Provider routes and the models each serves. */
  providers: CatalogProvider[]
  /**
   * Why no provider route is offered, verbatim from the Host.
   *
   * Empty when routes were read or when nothing reported a reason. A provider
   * whose models cannot be listed is reported here instead of vanishing, which
   * is what makes an empty picker distinguishable from an unreadable one.
   */
  providersError: string
  /** Presets an agent can name instead of running its own composition. */
  presets: CatalogPreset[]
  /**
   * Modules the deployment's smallest preset already composes.
   *
   * Every session has these whatever the agent is, so the picker treats them as
   * already-on and hides them behind a toggle instead of padding each group.
   */
  baseline: string[]
}

/**
 * The settings namespace this plugin owns.
 *
 * Spelled in a schemastery-free module because both halves read it: importing
 * it from the schema module would pull schemastery into the browser bundle,
 * where it is not a platform module and would be inlined as a second copy.
 */
export const SETTINGS_NAMESPACE = 'agent-forge'

/** One of the three agents a fresh install provides. */
export type BuiltinAgentId = (typeof BUILTIN_AGENT_IDS)[number]

/** Languages this plugin ships text for. */
export type ForgeLocale = 'zh' | 'en'

/** Model route one agent runs on. Both halves are present or the route is absent. */
export interface AgentModelRoute {
  /** Provider name as it appears in the model route table. */
  provider: string
  /** Model id within that provider. */
  model: string
}

/**
 * A stored model route, either half possibly missing.
 *
 * Storage allows a half-written route because `required(false)` on an object
 * makes the object optional, not its members: declaring the members required
 * would reject any agent entry that omits the route entirely — which is the
 * default and the common case. Whether a route is *usable* is a cross-field
 * rule, so it is judged in `validateSettings`, and resolution only emits a
 * route whose both halves survived.
 */
export interface AgentModelDraft {
  provider?: string
  model?: string
}

/**
 * Which deployment-global tools a child agent may see.
 *
 * `allow` is applied before `deny`, and the result is intersected with every
 * other restriction in force, so an allow-list deliberately hides every global
 * tool it does not name.
 */
export interface AgentToolFilter {
  allow?: string[]
  deny?: string[]
}

/**
 * Whether a stored filter constrains nothing.
 *
 * Schemastery materializes `{ allow: [], deny: [] }` for every agent entry,
 * because both members are optional arrays whose default is the empty list. So
 * "the user configured no filter" and "the user configured a filter that names
 * nothing" arrive here as the same value — and they are not the same
 * instruction: to the tool registry an empty `allow` denies every tool it does
 * not name, which is all of them. A child handed one ran with an empty tool
 * catalogue while still reporting its turn as completed.
 *
 * The rule therefore lives with the data model rather than at one call site:
 * the Host resolver, the dispatch tool, and the browser's mode control all read
 * a filter, and the last of the three already treated an empty list as "not
 * restricted". Only the Host half disagreed, which is what made the defect
 * invisible on screen.
 * @param filter - the stored filter, if any.
 * @returns true when neither side names a tool.
 */
export function isEmptyToolFilter(filter: AgentToolFilter | undefined): boolean {
  if (filter === undefined) return true
  const namesNothing = (names: readonly string[] | undefined): boolean =>
    names === undefined || names.every(name => name.trim() === '')
  return namesNothing(filter.allow) && namesNothing(filter.deny)
}

/** One agent as stored: every field optional, merged over a built-in when the id matches one. */
export interface AgentDefinition {
  /** Display name. Required for a user-authored agent, optional when overriding a built-in. */
  label?: string
  /** One-line purpose, shown in the browser and to the model in the dispatch catalog. */
  description?: string
  /** Role instructions for the child agent. Required for a user-authored agent. */
  persona?: string
  /** Model route; absent inherits the parent session's model. */
  model?: AgentModelDraft
  /** Reasoning effort passed to the model as `agentOptions`. */
  reasoningEffort?: string
  /** Visible deployment-global tools for this agent's children. */
  tools?: AgentToolFilter
  /** Absolute recursion cap for a run this agent starts. Absent leaves it to the row default. */
  maxDepth?: number
  /**
   * Plugin module specifiers this agent mounts.
   *
   * Written into the agent's generated preset as its composition rows, which is
   * what makes one agent's plugin set differ from another's. Order is preserved:
   * a later row may override an earlier one.
   */
  plugins?: string[]
  /**
   * An existing preset this agent composes from instead of its own.
   *
   * Names a preset the deployment already supplies — shipped or hand-written —
   * so an agent can reuse a composition nobody authored here. Absent means the
   * agent runs the preset this plugin generates for it.
   */
  presetRef?: string
}

/**
 * One agent after the built-in merge.
 *
 * The three fields a built-in always supplies are re-declared as required, so a
 * reader never re-checks absence that resolution already settled.
 */
export interface ResolvedAgent extends Omit<AgentDefinition, 'label' | 'description' | 'persona' | 'model'> {
  /** Stable id — the key in the stored map. */
  id: string
  /** Whether this id is one of the three shipped agents. */
  builtin: boolean
  /** Display name, never absent after resolution. */
  label: string
  /** One-line purpose; empty when neither layer supplied one. */
  description: string
  /** Role instructions, never absent after resolution. */
  persona: string
  /** Usable model route, or `undefined` to inherit the session's. */
  model: AgentModelRoute | undefined
}

/** What one workspace decides for itself. */
export interface WorkspaceAgentSettings {
  /** Agent ids this workspace offers. Empty means every available agent. */
  enabled?: string[]
  /** Agent id that leads this workspace's sessions. */
  lead?: string
  /** This workspace's task-dispatch rules. */
  dispatchRule?: string
}

/** The whole settings section. */
export interface AgentForgeSettings {
  /** User-authored agents and built-in overrides, keyed by agent id. */
  agents: Record<string, AgentDefinition>
  /** Per-workspace decisions, keyed by workspace id. */
  workspaces: Record<string, WorkspaceAgentSettings>
  /** Rules used when a workspace has none of its own. */
  fallbackDispatchRule: string
}

/** One workspace after resolution. */
export interface ResolvedWorkspace {
  /** Workspace id the settings were read for, or `undefined` when none resolved. */
  workspaceId: string | undefined
  /** Agents this workspace offers, in display order. */
  enabled: readonly ResolvedAgent[]
  /** The leading agent, or the first enabled one when none is designated. */
  lead: ResolvedAgent | undefined
  /** Effective dispatch rules, with the fallback already applied. */
  dispatchRule: string
}
