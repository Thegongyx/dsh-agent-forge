/**
 * Schemastery schemas for the plugin row and its settings namespace.
 *
 * The row config and the namespace share one shape, because the row is exactly
 * the namespace's composition layer: `installSection` layers the row's entry
 * under the user document, so whatever a deployment writes in `cordis.yml`
 * becomes the value a namespace without user edits resolves to.
 *
 * @module dsh-agent-forge/schema
 */

import z from '@deepseek-ai/schemastery'
import { SETTINGS_NAMESPACE, type AgentForgeSettings, type ForgeLocale } from './types.ts'

export { SETTINGS_NAMESPACE }

/**
 * A model route as stored.
 *
 * The members are optional even though a *usable* route needs both: declaring
 * them required inside an optional object rejects every agent entry that omits
 * the route altogether, because resolving an object schema validates the nested
 * members whether or not the caller supplied the object. Completeness is judged
 * by {@link validateSettings} instead.
 */
const modelRouteSchema = z.object({
  provider: z.string().required(false),
  model: z.string().required(false),
})

const toolFilterSchema = z.object({
  allow: z.array(z.string()).required(false),
  deny: z.array(z.string()).required(false),
})

/**
 * One stored agent. Every field is optional because an entry whose key matches a
 * built-in agent id is an *override*: it may restate only the persona. Which
 * fields a user-authored agent must carry is a cross-field rule, so it lives in
 * {@link validateSettings} rather than in this schema.
 */
const agentDefinitionSchema = z.object({
  label: z.string().required(false),
  description: z.string().required(false),
  persona: z.string().required(false),
  model: modelRouteSchema.required(false),
  reasoningEffort: z.string().required(false),
  tools: toolFilterSchema.required(false),
  maxDepth: z.natural().required(false),
  // The agent's plugin set and an optional preset it composes from instead. Both
  // are stored here so the settings document stays the single source of truth for
  // what an agent is; the generated preset files are derived from them.
  plugins: z.array(z.string()).required(false),
  presetRef: z.string().required(false),
})

/** One workspace's decisions. Absent fields fall back to the deployment defaults. */
const workspaceSettingsSchema = z.object({
  enabled: z.array(z.string()).required(false),
  lead: z.string().required(false),
  dispatchRule: z.string().required(false),
})

/** Schema resolving this plugin's settings namespace. */
export const AgentForgeSettingsSchema: z<AgentForgeSettings> = z.object({
  agents: z.dict(agentDefinitionSchema).default({}),
  workspaces: z.dict(workspaceSettingsSchema).default({}),
  fallbackDispatchRule: z.string().default(''),
})

/** Configuration of the plugin's row in `cordis.yml`. */
export interface Config extends AgentForgeSettings {
  /** Language the built-in agent copy renders in. */
  builtinLocale: ForgeLocale
}

/** Schema for the plugin row. */
export const Config: z<Config> = z.object({
  builtinLocale: z.union(['zh', 'en'] as const).default('zh'),
  agents: z.dict(agentDefinitionSchema).default({}),
  workspaces: z.dict(workspaceSettingsSchema).default({}),
  fallbackDispatchRule: z.string().default(''),
})

/**
 * Projects a row config onto the settings namespace shape.
 *
 * The namespace deliberately excludes `builtinLocale`: that is a deployment
 * choice, not a user setting, so it never appears in the settings document or in
 * a configuration form.
 * @param config - the resolved row configuration.
 * @returns the value used as the namespace's composition layer.
 */
export function namespaceEntryOf(config: Config): AgentForgeSettings {
  return {
    agents: config.agents,
    workspaces: config.workspaces,
    fallbackDispatchRule: config.fallbackDispatchRule,
  }
}
