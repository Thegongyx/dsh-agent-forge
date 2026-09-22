/**
 * The option catalogue the browser needs in order to offer choices.
 *
 * Every picker reads from this one document. The tool catalogue lives in the
 * Host's tool registry, the plugin roster in the Loader, and the model routes in
 * the LLM registry; none of the three is published to a client plugin, and the
 * model one is reachable only through a Remote that arrives with the gateway's
 * client half. One route over the Host's own web server replaces all of that
 * with a single channel the page can read at any time.
 *
 * @module dsh-agent-forge/catalog
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { createRequire } from 'node:module'
import {
  CATALOG_PATH,
  type CatalogBody,
  type CatalogPlugin,
  type CatalogPreset,
  type CatalogProvider,
  type CatalogTool,
} from './types.ts'
import { compositionNames, GENERATED_MARKER, packageNameOf, profileBundles, readBaseline } from './composition.ts'

/** Resolves a bare specifier from this plugin's own installed location. */
const requireFromPlugin = createRequire(import.meta.url)

/** One-line descriptions by specifier; the roster is re-read on every page open. */
const descriptionCache = new Map<string, string>()

/** The part of the preset roster this route reads. */
interface PresetRoster {
  /** Every preset the configured roots currently supply. */
  list(): Promise<readonly { id: string; name: string; description: string }[]>
  /** The composition text of one preset. */
  read(id: string): Promise<string>
}

export { CATALOG_PATH }
export type { CatalogBody, CatalogPlugin, CatalogProvider, CatalogTool }

/**
 * The part of the Host's LLM registry this route reads.
 *
 * Spelled structurally rather than imported: the projection below mirrors
 * `buildModelCatalog` in `@deepseek-ai/dsh-api-session-controller`, and naming
 * the three methods it calls keeps this package off the LLM package's public
 * surface for a read-only projection.
 */
interface LlmRegistry {
  listProviders(): { id: string; name: string }[]
  listModels(providerId: string): Promise<{ id: string; name: string }[]>
  resolveModelInfo(providerId: string, modelId: string): Promise<{
    reasoning?: { efforts?: readonly { id: string; name: string }[] } | undefined
  }>
}

/**
 * Reads the deployment's tool catalogue.
 * @param ctx - a context that may carry a tool registry.
 * @returns the visible tools, empty when no registry is mounted.
 */
function readTools(ctx: Context): CatalogTool[] {
  const tools = ctx.get('tools')
  if (tools === undefined) return []
  // No scope: the deployment-global catalogue is what an agent's filter names.
  return tools.schemas().map(schema => ({
    name: schema.name,
    description: schema.description ?? '',
  }))
}

/**
 * Reads the mounted plugin roster.
 * @param ctx - a context that may carry a Loader.
 * @returns the rows, empty when no Loader is mounted.
 */
function readPlugins(ctx: Context): CatalogPlugin[] {
  const loader = ctx.get('loader')
  if (loader === undefined) return []
  const bundles = profileBundles()
  const rows: CatalogPlugin[] = []
  for (const entry of loader.entries()) {
    const name = entry.options.name
    if (typeof name !== 'string') continue
    // `cordis:include` and its kin are loader directives, not packages. Writing
    // one into a generated composition fails the whole mount with
    // `Cannot read properties of undefined (reading 'enableLogs')`, so they are
    // never offered as a plugin to check.
    if (name.includes(':')) continue
    // A profile bundle is already mounted for every session; checking it can only
    // collide.
    if (bundles.has(packageNameOf(name))) continue
    // A row without an explicit id is addressed by its module specifier.
    const id = typeof entry.options.id === 'string' ? entry.options.id : name
    rows.push({ id, name, category: categoryOf(name), description: describePackage(name) })
  }
  return rows
}

/**
 * Groups one module by what it does.
 *
 * The rules are ordered from most specific to least, because several categories
 * overlap by prefix (`dsh-client-ui-*` is also `dsh-client-*`). A row this
 * plugin cannot place lands in `core`, which is honest: the tree then shows it
 * under "other" instead of guessing.
 * @param specifier - the module specifier a row mounts.
 * @returns a stable category id the browser localizes.
 */
function categoryOf(specifier: string): string {
  const rules: readonly [string, RegExp][] = [
    ['tools', /dsh-tool-|tool-result-pruner|timeout-policy|repeat-tool-reminder/],
    ['agents', /dsh-(agent|goal|skill|command|plan|system-prompt|web|compaction|token-meter|jobs|workspace|message-feedback|code-runtime|user-questions|attachment|plugin-package-inventory|deepseek-llm-api-extensions|subprocess|fs-observation-policy)/],
    ['llm', /^@deepseek-ai\/dsh-llm/],
    ['sessions', /dsh-(session|spill|file-reference)/],
    ['delegation', /subagent|workflow-worker/],
    ['security', /sandbox|approval|permission|credentials|shell-env/],
    ['storage', /storage|projection|telemetry|persistence|query/],
    ['host', /dsh-(host|web-app|app-|boot|typert|api-|sdk-)/],
    ['ui', /dsh-client-ui-/],
    ['client', /dsh-client-/],
    ['framework', /@deepseek-ai\/(cordis|dsh-(base|settings|tools|scope|brand|util|loader|invariants|context|identity|interaction))/],
    ['thirdParty', /^(?!@deepseek-ai\/)/],
  ]
  for (const [category, pattern] of rules) {
    if (pattern.test(specifier)) return category
  }
  return 'core'
}

/**
 * Reads one package's own one-line description.
 *
 * Read from the installed manifest rather than authored here: this deployment's
 * roster is whatever the user installed, and a hand-written list would go stale
 * the moment a row is added. A specifier that does not resolve, or a manifest
 * without a description, yields empty text.
 * @param specifier - the module specifier a row mounts.
 * @returns the description, or an empty string.
 */
function describePackage(specifier: string): string {
  const cached = descriptionCache.get(specifier)
  if (cached !== undefined) return cached
  let text = ''
  try {
    // The row may mount a subpath (`pkg/sub`), so only the package part is resolved.
    const parts = specifier.split('/')
    const packageName = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] ?? specifier
    const manifest = requireFromPlugin(`${packageName}/package.json`) as { description?: unknown }
    if (typeof manifest.description === 'string') text = manifest.description
  } catch {
    // Not installed as a package, or not resolvable from here. The tree falls
    // back to the module name, which is still enough to identify the row.
    text = ''
  }
  descriptionCache.set(specifier, text)
  return text
}

/**
 * Projects the LLM registry into the provider list the pickers offer.
 *
 * A provider whose models cannot be listed is reported through `error` rather
 * than dropped: a credential-less route is the common case, and silently
 * omitting it reads on screen exactly like a deployment with no providers.
 * @param ctx - a context that may carry an LLM registry.
 * @returns the provider routes, and the reason when none survived.
 */
async function readProviders(ctx: Context): Promise<{ providers: CatalogProvider[]; error: string }> {
  const llm = ctx.get('llm') as unknown as LlmRegistry | undefined
  if (llm === undefined) return { providers: [], error: 'no LLM registry is mounted' }
  const failures: string[] = []
  const providers = await Promise.all(llm.listProviders().map(async (provider): Promise<CatalogProvider | undefined> => {
    try {
      const models = await llm.listModels(provider.id)
      const entries = await Promise.all(models.map(async model => {
        const resolved = await llm.resolveModelInfo(provider.id, model.id)
        return {
          id: model.id,
          name: model.name,
          efforts: (resolved.reasoning?.efforts ?? []).map(effort => ({ id: effort.id, name: effort.name })),
        }
      }))
      return { id: provider.id, name: provider.name, models: entries }
    } catch (error) {
      failures.push(`${provider.id}: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }))
  const kept = providers.filter((provider): provider is CatalogProvider => provider !== undefined)
  return { providers: kept, error: kept.length === 0 ? failures.join('; ') : '' }
}

/**
 * Builds the catalogue document.
 * @param ctx - the plugin's Cordis context.
 * @returns the body served to the browser.
 */
async function buildBody(ctx: Context): Promise<CatalogBody> {
  const routes = await readProviders(ctx)
  const plugins = readPlugins(ctx)
  return {
    tools: readTools(ctx),
    plugins,
    providers: routes.providers,
    providersError: routes.error,
    presets: await readPresets(ctx),
    baseline: baselineOf(plugins, readBaselineNames()),
  }
}

/**
 * Reads the module set an agent should not have to choose.
 *
 * Two sources, because one is not enough. The modules this plugin's own baseline
 * composes are already in every composition it generates, so no agent needs to
 * ask for them. On top of that sit the categories that are deployment
 * infrastructure rather than agent capability: the interface, the browser
 * runtime, the host and its APIs, storage, the framework, and session records. A
 * composition can technically name them, but an agent's own composition is not
 * where any of them belongs, and offering them pads every group with rows nobody
 * will check.
 * @param plugins - the mounted rows, already categorized.
 * @param base - module specifiers the baseline composes.
 * @returns the module specifiers the picker treats as already on.
 */
function baselineOf(plugins: readonly CatalogPlugin[], base: readonly string[]): string[] {
  const infrastructure = new Set(['ui', 'client', 'host', 'storage', 'framework', 'sessions'])
  const names = new Set(base)
  for (const plugin of plugins) {
    if (infrastructure.has(plugin.category)) names.add(plugin.name)
  }
  return [...names]
}

/**
 * Reads the module specifiers the generated baseline composes.
 *
 * The baseline is this package's own file, so the answer never depends on what
 * presets the deployment happens to have installed.
 * @returns the specifiers, empty when the baseline cannot be read.
 */
function readBaselineNames(): string[] {
  try {
    return [...compositionNames(readBaseline())]
  } catch {
    // A package installed without its baseline cannot generate a composition at
    // all; the picker then hides only the infrastructure categories, which is what
    // it did before the baseline existed.
    return []
  }
}

/**
 * Reads the preset roster an agent can name instead of running its own composition.
 * @param ctx - a context that may carry a preset roster.
 * @returns the presets, empty when no roster is mounted.
 */
async function readPresets(ctx: Context): Promise<CatalogPreset[]> {
  const roster = ctx.get('agentPresets') as unknown as PresetRoster | undefined
  if (roster === undefined) return []
  try {
    const presets = await roster.list()
    return presets.map(preset => ({
      id: preset.id,
      name: preset.name,
      description: preset.description,
      // The marker is how a generated preset is told apart from one the user or
      // the deployment authored, which decides whether deleting it is safe.
      generated: preset.description.includes(GENERATED_MARKER),
    }))
  } catch {
    // A roster whose roots are unreadable reports no presets rather than failing
    // the whole document: the other pickers are still worth serving.
    return []
  }
}

/**
 * Registers the catalogue route on a web server that is known to be present.
 * @param ctx - a context carrying the web server.
 */
function registerRoute(ctx: Context): void {
  const server = ctx.get('webServer')
  if (server === undefined) return
  ctx.effect(() => server.register({
    kind: 'exact',
    path: CATALOG_PATH,
    handler: (_request: IncomingMessage, response: ServerResponse) => {
      void buildBody(ctx).then(body => {
        const payload = JSON.stringify(body)
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': String(Buffer.byteLength(payload)),
        })
        response.end(payload)
      }).catch((error: unknown) => {
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        response.end(error instanceof Error ? error.message : String(error))
      })
    },
  }), 'agent-forge: option catalogue route')
}

/**
 * Serves the catalogue over the Host's web server.
 *
 * The web server binds asynchronously and can mount after this row, so the route
 * waits for the service instead of reading it once: reading it at apply time
 * found nothing and the catalogue silently never existed. A deployment with no
 * web server simply never resolves the dependency, which is the same outcome as
 * an early return — the catalogue exists to fill pickers in a browser, and a
 * deployment without one has none.
 * @param ctx - the plugin's Cordis context.
 */
export function installCatalogRoute(ctx: Context): void {
  ctx.inject(['webServer'], registerRoute)
}
