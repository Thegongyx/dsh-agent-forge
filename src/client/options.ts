/**
 * The option lists the settings page offers.
 *
 * One channel: the Host's catalogue route carries tools, plugins, provider
 * routes, each model's thinking levels, and the preset roster, so the page needs
 * no second source and no service that arrives later than the page itself.
 *
 * Loading is a command, not a subscription. The settings page runs it when it
 * opens, which is also when the reader is looking at the result.
 *
 * @module dsh-agent-forge/client/options
 */

import {
  CATALOG_PATH,
  type CatalogEffort,
  type CatalogModel,
  type CatalogPlugin,
  type CatalogPreset,
  type CatalogProvider,
  type CatalogTool,
} from '../types.ts'

/** One thinking level a model declares. */
export type EffortChoice = CatalogEffort

/** One model a provider serves. */
export type ModelChoice = CatalogModel

/** One provider route with the models it currently serves. */
export type ProviderChoice = CatalogProvider

/** One mounted plugin row, with what it does and where it belongs. */
export type PluginChoice = CatalogPlugin

/** One preset an agent can compose from. */
export type PresetChoice = CatalogPreset

/** Everything the pickers need. */
export interface PageOptions {
  /** `unavailable` when the Host route could not be read. */
  status: 'loading' | 'ready' | 'unavailable'
  /** Tools a child agent could be allowed to see. */
  tools: readonly CatalogTool[]
  /** Plugin rows the deployment mounted. */
  plugins: readonly CatalogPlugin[]
  /** Provider routes, empty when the model catalogue was not readable. */
  providers: readonly ProviderChoice[]
  /**
   * Why no provider route is offered, verbatim from the Host.
   *
   * Host data, not copy: it names the provider that refused and the error it
   * raised, which no dictionary can predict.
   */
  providersError: string
  /** Presets an agent can name instead of running its own composition. */
  presets: readonly PresetChoice[]
  /** Modules every session already composes, whatever the agent is. */
  baseline: readonly string[]
}

/** The value before the first load settles. */
export const LOADING_OPTIONS: PageOptions = {
  status: 'loading',
  tools: [],
  plugins: [],
  providers: [],
  providersError: '',
  presets: [],
  baseline: [],
}

/**
 * Reads every option list from the Host's catalogue route.
 * @returns the lists, or the unavailable placeholder when the route did not answer.
 */
export async function loadOptions(): Promise<PageOptions> {
  try {
    const response = await fetch(CATALOG_PATH, { headers: { accept: 'application/json' } })
    if (!response.ok) return { ...LOADING_OPTIONS, status: 'unavailable' }
    const body = await response.json() as Partial<{
      tools: CatalogTool[]
      plugins: CatalogPlugin[]
      providers: CatalogProvider[]
      providersError: string
      presets: CatalogPreset[]
      baseline: string[]
    }>
    const tools = body.tools ?? []
    const plugins = body.plugins ?? []
    return {
      status: tools.length === 0 && plugins.length === 0 ? 'unavailable' : 'ready',
      tools,
      plugins,
      providers: body.providers ?? [],
      providersError: body.providersError ?? '',
      presets: body.presets ?? [],
      baseline: body.baseline ?? [],
    }
  } catch {
    // The browser refused the request, or the Host predates this route. The
    // pickers then fall back to what each agent already stores, which is editable.
    return { ...LOADING_OPTIONS, status: 'unavailable' }
  }
}
