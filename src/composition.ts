/**
 * Each agent's own composition, written as a real agent preset.
 *
 * An agent elevated to preset level IS a preset directory: `preset.yml` for how
 * it appears in the picker, and `agent.cordis.yml` for the rows it mounts — which
 * is exactly the plugin set the settings page offers as checkboxes. dsh already
 * composes a session from a preset, so nothing here invents a mechanism: a
 * generated preset is indistinguishable from a hand-written one, and the same
 * file the WebUI edits is the file the mode picker reads.
 *
 * Every path is derived from the preset root, never stored, so one agent id
 * always maps to the same directory.
 *
 * A generated composition is this plugin's shipped baseline plus the agent's own
 * rows, never the agent's rows alone: a session joins one standing composition, so
 * "only what I checked" would silently mean "and none of the baseline's tools".
 * The baseline is a file this package owns (`baseline/agent.cordis.yml`), so no
 * deployment preset has to exist for an agent to be composable.
 *
 * The same subject decides two questions the rest of the plugin asks: which of a
 * stored selection are rows this agent adds at all (a row the profile already
 * mounts is not one of them, and writing it here would collide), and which preset
 * a delegation therefore runs on. Both live here so the file writer, the mode,
 * and the dispatch tool cannot answer them differently.
 *
 * @module dsh-agent-forge/composition
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ResolvedAgent } from './types.ts'

/** Marker every generated preset carries in its description. */
export const GENERATED_MARKER = 'dsh-agent-forge generated'

/**
 * The composition every generated agent is built on, shipped with this package.
 *
 * Owned here rather than borrowed from a deployment preset: copying
 * `standard` made every forge agent's capability set depend on a preset somebody
 * else may rename, slim, or not install. This document is the dependency instead,
 * and it is deliberately lighter than the full coding preset — a persistent
 * shell, native file read/write/search, skills, and web search/fetch. A
 * deployment that wants the full coding agent back names one through `presetRef`
 * on the agent that needs it.
 *
 * Resolved relative to this module, so it is the installed package's own file in
 * every face: `lib/index.js` and the test bundle both sit beside `baseline/`.
 */
const BASELINE_PATH = new URL('../baseline/agent.cordis.yml', import.meta.url)

/** Composition document inside one preset directory. */
const COMPOSITION_FILE = 'agent.cordis.yml'

/**
 * Reads the baseline composition this plugin ships.
 *
 * Read per write rather than cached: a deployment that edits the installed file
 * to tune its own agents gets that change on the next sync, and the cost is one
 * small file per settings change or process start.
 * @returns the YAML text of the baseline.
 * @throws when the baseline is missing or unreadable, which means this install is
 * broken and no composition may be generated from it.
 */
export function readBaseline(): string {
  return readFileSync(BASELINE_PATH, 'utf8')
}

/**
 * The preset root this deployment reads and writes.
 *
 * `DSH_HOME` is what dsh itself uses; the fallback matches dsh's own default so
 * a plugin loaded outside a configured home still resolves the same directory.
 * @param env - the process environment.
 * @returns the absolute `.agent-presets` directory.
 */
export function presetRoot(env: NodeJS.ProcessEnv = process.env): string {
  const home = env['DSH_HOME'] !== undefined && env['DSH_HOME'].length > 0
    ? env['DSH_HOME']
    : join(homedir(), '.dsh')
  return join(home, '.agent-presets')
}

/**
 * The preset directory for one agent.
 * @param root - a {@link presetRoot} value.
 * @param agentId - the agent's stable id.
 * @returns the absolute directory.
 */
export function presetDir(root: string, agentId: string): string {
  return join(root, agentId)
}

/**
 * The package part of a module specifier.
 * @param specifier - a module specifier, possibly with a subpath.
 * @returns the package name.
 */
export function packageNameOf(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier)
}

/**
 * Packages this deployment mounts at the profile level.
 *
 * A bundle is installed into the profile and loaded for every session, so its
 * rows are already mounted in the host composition. Offering one as a per-agent
 * choice is offering a guaranteed collision: a second mount registers the same
 * process-level service, and the agent's whole composition then fails to apply.
 * Read from every profile's own manifest rather than authored here, because the
 * membership belongs to the deployment.
 * @returns the package names, empty when no manifest can be read.
 */
export function profileBundles(): Set<string> {
  const names = new Set<string>()
  let profiles: string[]
  try {
    profiles = readdirSync(join(dirname(presetRoot()), 'profiles'))
  } catch {
    // No profiles directory: nothing is known to be deployment-level, and the
    // picker then behaves as it did before this filter.
    return names
  }
  for (const id of profiles) {
    try {
      const manifest = JSON.parse(
        readFileSync(join(dirname(presetRoot()), 'profiles', id, 'package.json'), 'utf8'),
      ) as { dsh?: { profile?: { bundles?: unknown } } }
      const bundles = manifest.dsh?.profile?.bundles
      if (!Array.isArray(bundles)) continue
      for (const name of bundles) if (typeof name === 'string') names.add(packageNameOf(name))
    } catch {
      // A profile without a readable manifest contributes no bundles.
    }
  }
  return names
}

/**
 * The rows of a stored selection that are this agent's own additions.
 *
 * A selected module the profile already mounts contributes nothing to the
 * generated preset: the row is in the host composition for every session, and
 * naming it again would register its services twice.
 * @param plugins - the agent's stored module specifiers.
 * @returns the specifiers the generated preset should carry.
 */
export function ownPluginRows(plugins: readonly string[] | undefined): string[] {
  const bundles = profileBundles()
  return (plugins ?? []).filter(name => !bundles.has(packageNameOf(name)))
}

/**
 * Which preset one agent's delegations run on.
 *
 * An agent that names a preset uses it, and everything else runs the composition
 * this plugin generated for it — which carries the shipped baseline plus the rows
 * that agent checks. Nothing is left to resolve: no deployment preset is required
 * to exist, and an agent that checks nothing still gets a working composition
 * rather than an empty one.
 * @param agent - the resolved agent.
 * @returns the preset id to compose from.
 */
export function presetIdOf(agent: ResolvedAgent): string {
  return agent.presetRef ?? agent.id
}

/**
 * Module specifiers one composition text names.
 *
 * Read from the text rather than from a parsed value: preset rows carry `!!js`
 * expressions the Loader evaluates against this deployment, which a plain YAML
 * parse would either reject or resolve too early.
 * @param text - a composition document.
 * @returns the specifiers its rows name.
 */
export function compositionNames(text: string): Set<string> {
  const names = new Set<string>()
  for (const match of text.matchAll(/^\s*name:\s*'([^']+)'/gm)) {
    const name = match[1]
    if (name !== undefined) names.add(name)
  }
  return names
}

/**
 * A base composition's rows, without its leading commentary.
 *
 * The base's header explains decisions about the base's own file — which plane
 * each of its rows belongs to and why. Carried into a generated file that is not
 * that file, it reads as a claim about this one. Section comments between rows
 * stay: they still label the rows they sit above.
 * @param text - the base composition.
 * @returns its rows, ready to embed.
 */
function baseRowsOf(text: string): string {
  const lines = text.split('\n')
  let first = 0
  while (first < lines.length && (lines[first]?.trim() === '' || lines[first]?.startsWith('#'))) first += 1
  return lines.slice(first).join('\n').trim()
}

/**
 * The rows an agent adds on top of the base.
 *
 * A module the base already names is dropped rather than repeated. Two rows for
 * one package in one composition register the same tool or the same service
 * twice, and the second registration fails the whole mount.
 * @param own - the agent's own module specifiers.
 * @param base - the base composition text.
 * @returns the specifiers to append.
 */
function ownRowsOf(own: readonly string[], base: string): string[] {
  const inherited = compositionNames(base)
  return own.filter(name => !inherited.has(name))
}

/**
 * Renders the picker entry for one agent.
 * @param label - the agent's display name.
 * @param description - one line shown under the name.
 * @returns the YAML text of `preset.yml`.
 */
export function renderPresetYml(label: string, description: string): string {
  // Quoted on purpose: an agent label is user text and may contain YAML syntax.
  return [
    `name: '${escapeYaml(label)}'`,
    `description: '${escapeYaml(description)} · ${GENERATED_MARKER}'`,
    '',
  ].join('\n')
}

/**
 * Renders one agent's composition: the shipped baseline's rows, then its own.
 *
 * The baseline is embedded rather than referenced because a preset cannot include
 * another one: `mount` binds an agent's scope key to a single standing mount, and
 * `cordis:include` names a configuration file for the Loader's root, not a second
 * composition for one agent. Embedding is also what keeps the baseline's
 * per-service `isolate` realms intact (`isolate: { terminals: true }`) — a row
 * that publishes a service outside such a realm is refused by the roster as
 * process-global, and which realm a row needs is a property of that row, not of
 * this file.
 *
 * The agent's own rows sit in one group so a patch can address them together.
 * That group claims no realm: `isolate` is a map of service name to realm label,
 * so a bare `true` isolates nothing, and this file cannot know which services a
 * package provides before mounting it. A checked module that publishes a service
 * therefore fails its mount with the roster's own message; the way to add such a
 * module is to install it as a profile bundle, where it is composed once for
 * every session.
 * @param own - module specifiers this agent adds.
 * @param base - the baseline composition text; empty means there is nothing to build on.
 * @returns the YAML text of `agent.cordis.yml`.
 */
export function renderAgentComposition(own: readonly string[], base: string): string {
  const header = [
    `# ${GENERATED_MARKER}. Edits are overwritten on the next save.`,
    '#',
    "# The rows below are this plugin's baseline composition, embedded as they stand,",
    "# followed by this agent's own additions. A session joins exactly one standing",
    '# composition, so an agent that named only its own rows would lose every tool the',
    '# baseline supplies.',
    '',
  ].join('\n')
  // No base, nothing to compose. Writing the agent's own rows alone is the one
  // document this module exists to prevent: it mounts no tools and still looks
  // like a working composition.
  if (base.trim() === '') return `${header}[]\n`
  const inherited = baseRowsOf(base)
  const additions = ownRowsOf(own, base)
  const block = additions.length === 0
    ? ''
    : [
        '- id: forge-plugins',
        '  name: cordis:group',
        '  group: true',
        '  config:',
        additions
          .map((name, index) => `    - id: forge-plugin-${String(index)}\n      name: '${escapeYaml(name)}'`)
          .join('\n'),
      ].join('\n')
  const body = [inherited, block].filter(part => part !== '').join('\n')
  return body === '' ? `${header}[]\n` : `${header}${body}\n`
}

/**
 * Writes one agent's preset directory.
 *
 * The selection is filtered here rather than by the caller. A module the profile
 * already mounts must not reach this file — mounting it a second time inside a
 * preset collides with the host's own instance (`a web provider with id "ddg" is
 * already registered`) and fails the whole composition — and an invariant that
 * only holds because one caller remembers it is a broken agent waiting for the
 * next caller.
 *
 * A directory this plugin did not write is refused rather than overwritten. Since
 * every agent now runs the composition named after its own id, an agent whose id
 * matches a hand-written preset would otherwise replace that preset's files — and
 * a preset nobody asked this plugin to author is not one it may destroy.
 * @param root - a {@link presetRoot} value.
 * @param agentId - the agent's stable id.
 * @param label - the agent's display name.
 * @param description - one line shown under the name.
 * @param selection - the agent's stored module specifiers.
 * @param base - the baseline composition text.
 * @returns the absolute directory written.
 * @throws when the target directory holds a preset this plugin did not generate.
 */
export function writePreset(
  root: string,
  agentId: string,
  label: string,
  description: string,
  selection: readonly string[],
  base: string,
): string {
  const dir = presetDir(root, agentId)
  const existing = foreignMetadata(dir)
  if (existing) {
    throw new Error(
      `agent "${agentId}" would overwrite the preset in ${dir}, which this plugin did not generate `
      + '(rename the agent, or point it at that preset through `presetRef`)',
    )
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'preset.yml'), renderPresetYml(label, description), 'utf8')
  writeFileSync(join(dir, COMPOSITION_FILE), renderAgentComposition(ownPluginRows(selection), base), 'utf8')
  return dir
}

/**
 * Whether a directory holds a preset metadata file this plugin did not write.
 * @param dir - the candidate preset directory.
 * @returns true when the directory exists with a foreign `preset.yml`.
 */
function foreignMetadata(dir: string): boolean {
  try {
    const text = readFileSync(join(dir, 'preset.yml'), 'utf8')
    return !text.includes(GENERATED_MARKER)
  } catch {
    // Absent or unreadable: there is no metadata to respect, and a directory
    // without one is not a preset the roster would have offered either.
    return false
  }
}

/**
 * Removes one agent's generated preset.
 *
 * Refuses to touch a directory this plugin did not write: a user-authored preset
 * that happens to share the id is theirs, and deleting it would destroy work no
 * setting of ours can restore.
 * @param root - a {@link presetRoot} value.
 * @param agentId - the agent's stable id.
 * @returns true when a generated directory was removed.
 */
export function removeGeneratedPreset(root: string, agentId: string): boolean {
  const dir = presetDir(root, agentId)
  try {
    const files = readdirSync(dir)
    if (!files.includes('preset.yml')) return false
    if (foreignMetadata(dir)) return false
    rmSync(dir, { recursive: true, force: true })
    return true
  } catch {
    // Absent, unreadable, or already gone — nothing to remove either way.
    return false
  }
}

/**
 * Escapes a value for a single-quoted YAML scalar.
 * @param value - raw text.
 * @returns the value with quotes doubled.
 */
function escapeYaml(value: string): string {
  return value.replace(/'/g, "''")
}
