/**
 * Pure resolution over the stored settings.
 *
 * Everything here is a function of values only — no Cordis context, no
 * filesystem, no clock — so the rules that decide which agents exist, which one
 * leads a workspace, and which dispatch rules apply are testable directly and
 * cannot drift from what the browser renders.
 *
 * @module dsh-agent-forge/resolve
 */

import { BUILTIN_AGENT_COPY, DEFAULT_DISPATCH_RULE } from './defaults.ts'
import {
  BUILTIN_AGENT_IDS,
  isEmptyToolFilter,
  type AgentDefinition,
  type AgentForgeSettings,
  type AgentModelDraft,
  type AgentModelRoute,
  type AgentToolFilter,
  type BuiltinAgentId,
  type ForgeLocale,
  type ResolvedAgent,
  type ResolvedWorkspace,
} from './types.ts'

/**
 * A route is usable only when both halves are present and non-blank.
 * @param draft - the stored route, if any.
 * @returns the usable route, or `undefined` to inherit the session's.
 */
function resolveModel(draft: AgentModelDraft | undefined): AgentModelRoute | undefined {
  if (draft === undefined) return undefined
  const provider = draft.provider?.trim() ?? ''
  const model = draft.model?.trim() ?? ''
  if (provider === '' || model === '') return undefined
  return { provider, model }
}

/**
 * Drops a tool filter that constrains nothing.
 *
 * The stored value cannot answer this on its own: the settings schema fills an
 * absent `tools` entry with two empty lists, so every agent — including one
 * whose owner never opened the control — arrives with a filter. Acting on that
 * value is not a no-op but a total denial, so resolution settles the question
 * once and hands out either a filter that names something or nothing at all.
 * @param draft - the stored filter, if any.
 * @returns the filter to act on, or `undefined` when it constrains nothing.
 */
function resolveToolFilter(draft: AgentToolFilter | undefined): AgentToolFilter | undefined {
  return isEmptyToolFilter(draft) ? undefined : draft
}

/**
 * Whether an id names one of the shipped agents.
 * @param id - the stored map key.
 * @returns true when the id is shipped with the plugin.
 */
export function isBuiltinAgentId(id: string): id is BuiltinAgentId {
  return (BUILTIN_AGENT_IDS as readonly string[]).includes(id)
}

/** Settings namespace the locale plugin owns. */
export const LOCALE_SETTINGS_NAMESPACE = 'locale'

/** Field inside it carrying the user's explicit language; absent means "follow the browser". */
export const LOCALE_PREFERENCE_FIELD = 'preference'

/**
 * Resolves the language the Host renders built-in agent copy in.
 *
 * Reading the locale plugin's own persisted preference is what makes both halves
 * agree without a second source of truth: the browser already follows that
 * field, and the Host reads the same one. The two namespace strings are spelled
 * here rather than imported because the locale package is a browser package, and
 * a Host half taking two constants from it would make the Host depend on the
 * browser surface for them.
 *
 * The residue is stated plainly: with no stored preference the browser falls
 * back to `navigator.languages`, which the Host cannot see. A deployment that
 * wants the Host to match an unset browser locale sets the row's language.
 * @param preference - the stored `locale.preference`, if any.
 * @param fallback - the row's configured language.
 * @returns the language to render built-in copy in.
 */
export function localeFromPreference(preference: unknown, fallback: ForgeLocale): ForgeLocale {
  if (typeof preference !== 'string') return fallback
  const tag = preference.trim().toLowerCase()
  if (tag === '') return fallback
  return tag === 'zh' || tag.startsWith('zh-') ? 'zh' : 'en'
}

/**
 * Merges a stored entry over one built-in agent.
 * @param id - the built-in id.
 * @param override - the stored override, when present.
 * @param locale - language for any field the override does not restate.
 * @returns the resolved agent.
 */
function resolveBuiltin(
  id: BuiltinAgentId,
  override: AgentDefinition | undefined,
  locale: ForgeLocale,
): ResolvedAgent {
  const copy = BUILTIN_AGENT_COPY[locale][id]
  const tools = resolveToolFilter(override?.tools)
  return {
    id,
    builtin: true,
    label: override?.label ?? copy.label,
    description: override?.description ?? copy.description,
    persona: override?.persona ?? copy.persona,
    model: resolveModel(override?.model),
    ...(override?.reasoningEffort === undefined ? {} : { reasoningEffort: override.reasoningEffort }),
    ...(tools === undefined ? {} : { tools }),
    ...(override?.plugins === undefined ? {} : { plugins: override.plugins }),
    ...(override?.presetRef === undefined ? {} : { presetRef: override.presetRef }),
    ...(override?.maxDepth === undefined ? {} : { maxDepth: override.maxDepth }),
  }
}

/**
 * Merges one user-authored entry.
 * @param id - the stored map key.
 * @param definition - the stored definition.
 * @returns the resolved agent.
 */
function resolveAuthored(id: string, definition: AgentDefinition): ResolvedAgent {
  const tools = resolveToolFilter(definition.tools)
  return {
    id,
    builtin: false,
    label: definition.label ?? id,
    description: definition.description ?? '',
    persona: definition.persona ?? '',
    model: resolveModel(definition.model),
    ...(definition.reasoningEffort === undefined ? {} : { reasoningEffort: definition.reasoningEffort }),
    ...(tools === undefined ? {} : { tools }),
    ...(definition.plugins === undefined ? {} : { plugins: definition.plugins }),
    ...(definition.presetRef === undefined ? {} : { presetRef: definition.presetRef }),
    ...(definition.maxDepth === undefined ? {} : { maxDepth: definition.maxDepth }),
  }
}

/**
 * The complete agent list: the three shipped agents in their fixed order,
 * followed by user-authored agents in name order.
 * @param settings - the resolved settings section.
 * @param locale - language for built-in copy.
 * @returns every available agent.
 */
export function resolveAgents(settings: AgentForgeSettings, locale: ForgeLocale): ResolvedAgent[] {
  const builtins = BUILTIN_AGENT_IDS.map(id => resolveBuiltin(id, settings.agents[id], locale))
  const authored = Object.entries(settings.agents)
    .filter(([id]) => !isBuiltinAgentId(id))
    .map(([id, definition]) => resolveAuthored(id, definition))
    .sort((left, right) => left.label.localeCompare(right.label))
  return [...builtins, ...authored]
}

/**
 * Folds the stored settings and deployment defaults into one workspace's
 * effective configuration.
 * @param settings - the resolved settings section.
 * @param workspaceId - the workspace to resolve, or `undefined` when none resolved.
 * @param locale - language for built-in copy and the fallback rules.
 * @returns the workspace's effective agents, lead, and dispatch rules.
 */
export function resolveWorkspace(
  settings: AgentForgeSettings,
  workspaceId: string | undefined,
  locale: ForgeLocale,
): ResolvedWorkspace {
  const stored = workspaceId === undefined ? undefined : settings.workspaces[workspaceId]
  const agents = resolveAgents(settings, locale)

  const selected = stored?.enabled
  const enabled = selected === undefined || selected.length === 0
    ? agents
    : selected
        .map(id => agents.find(agent => agent.id === id))
        .filter((agent): agent is ResolvedAgent => agent !== undefined)

  const designated = stored?.lead
  const lead = enabled.find(agent => agent.id === designated) ?? enabled[0]

  const dispatchRule = stored?.dispatchRule?.trim()
    || settings.fallbackDispatchRule.trim()
    || DEFAULT_DISPATCH_RULE[locale]

  return { workspaceId, enabled, lead, dispatchRule }
}

/**
 * Rejects stored settings the schema cannot judge.
 *
 * Two rules need the whole section: a user-authored agent must carry the two
 * fields a built-in would have supplied, and a workspace may not designate a
 * lead it does not enable. Both are cross-field, which is why they live here and
 * are handed to the settings provider as its `validate` hook — a write that
 * breaks either one is refused instead of stored.
 * @param settings - the resolved settings section.
 * @throws {Error} when the section could not be acted on.
 */
export function validateSettings(settings: AgentForgeSettings): void {
  for (const [id, definition] of Object.entries(settings.agents)) {
    if (isBuiltinAgentId(id)) continue
    if (definition.label === undefined || definition.label.trim() === '') {
      throw new Error(`agent "${id}" needs a label (only built-in agent ids may omit it)`)
    }
    if (definition.persona === undefined || definition.persona.trim() === '') {
      throw new Error(`agent "${id}" needs a persona (only built-in agent ids may omit it)`)
    }
  }

  for (const [id, definition] of Object.entries(settings.agents)) {
    const route = definition.model
    if (route === undefined) continue
    const provider = route.provider?.trim() ?? ''
    const model = route.model?.trim() ?? ''
    // Storage tolerates a half-written route so an entry may omit it entirely;
    // acting on half a route is what this refuses.
    if ((provider === '') !== (model === '')) {
      throw new Error(`agent "${id}" has half a model route; give both a provider and a model, or neither`)
    }
  }

  for (const [workspaceId, stored] of Object.entries(settings.workspaces)) {
    const designated = stored.lead
    if (designated === undefined || designated.trim() === '') continue
    const enabled = stored.enabled
    const offers = enabled === undefined || enabled.length === 0
      ? undefined
      : enabled
    if (offers !== undefined && !offers.includes(designated)) {
      throw new Error(
        `workspace "${workspaceId}" designates lead "${designated}" but does not enable it`,
      )
    }
    if (offers === undefined && !isBuiltinAgentId(designated) && settings.agents[designated] === undefined) {
      throw new Error(
        `workspace "${workspaceId}" designates unknown lead "${designated}"`,
      )
    }
  }
}
