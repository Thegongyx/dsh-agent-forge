/**
 * The settings page's controller: the only object that touches the settings
 * scope, projecting it into plain data a component can render.
 *
 * Components never see the scope, the context, or an observable. They read one
 * snapshot through the `useAgentForge` seat the renderer synthesizes from the
 * `hooks` compartment this controller injects, and they write through plain
 * callbacks. That split is what keeps the agent-merge rules in one place: the
 * page calls the same `resolveAgents` the Host half calls, so the list a user
 * sees cannot drift from the list a dispatch resolves.
 *
 * @module dsh-agent-forge/client/controller
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { DEFAULT_DISPATCH_RULE } from '../defaults.ts'
import { resolveAgents } from '../resolve.ts'
import { LOADING_OPTIONS, type PageOptions } from './options.ts'
import type { AgentForgeSettings, ForgeLocale } from '../types.ts'

/** One agent as the page renders it. */
export interface AgentListItem {
  /** Stable id — the key in the stored map. */
  id: string
  /** Whether this is one of the three shipped agents. */
  builtin: boolean
  /** Whether the stored user layer carries an entry for this id. */
  overridden: boolean
  /** Display name after the built-in merge. */
  label: string
  /** One-line purpose. */
  description: string
  /** Role instructions. */
  persona: string
  /** Model route, or `undefined` to inherit the session model. */
  model: { provider: string; model: string } | undefined
  /** Reasoning effort, or `undefined` to inherit. */
  reasoningEffort: string | undefined
  /** Visible-tool filter, or `undefined` for the deployment default. */
  tools: { allow?: string[]; deny?: string[] } | undefined
  /** Recursion cap, or `undefined` for the row default. */
  maxDepth: number | undefined
  /** Plugin modules this agent mounts, or `undefined` for a composition of its own. */
  plugins: string[] | undefined
  /** An existing preset this agent composes from instead of its own. */
  presetRef: string | undefined
}

/** One workspace's decisions, as the page renders them. */
export interface WorkspaceEntry {
  /** Agents this workspace enables; empty means every available agent. */
  enabled: readonly string[]
  /** Agent that leads this workspace, or `undefined` to lead with the first enabled one. */
  lead: string | undefined
  /** Effective rules, with the deployment fallback already applied. */
  dispatchRule: string
  /** Whether the workspace carries its own rules rather than inheriting the fallback. */
  ruleCustomized: boolean
}

/** Everything the page renders. */
export interface AgentForgeState {
  /** Settings sync state. */
  status: 'loading' | 'ready' | 'unavailable'
  /** Whether the host document accepts writes. */
  writable: boolean
  /** `host` persists; `memory` is a non-loopback page keeping changes in-process. */
  mode: 'host' | 'memory'
  /** Every available agent, in display order. */
  agents: readonly AgentListItem[]
  /** Rules a workspace without its own uses. */
  fallbackDispatchRule: string
  /** Whether the stored user layer overrides the fallback rules. */
  fallbackDispatchRuleCustomized: boolean
  /** Per-workspace decisions, keyed by workspace id. Absent means "all defaults". */
  workspaces: Readonly<Record<string, WorkspaceEntry>>
  /** Option lists the pickers offer, however much of them could be read. */
  options: PageOptions
}

/** A value this page may store in one agent field. `undefined` clears the field. */
export type AgentFieldValue =
  | string
  | number
  | string[]
  | { provider: string; model: string }
  | { allow?: string[]; deny?: string[] }

/** Writes the page performs. Every one settles after the host answers. */
export interface AgentForgeActions {
  /**
   * Store one or more fields on an agent, creating the entry when absent.
   * @param agentId - the agent to write.
   * @param patch - fields to store; `undefined` clears a field back to its inherited value.
   * @returns settlement after the write and any recovery read.
   */
  patchAgent(agentId: string, patch: Record<string, AgentFieldValue | undefined>): Promise<void>
  /**
   * Drop an agent's whole stored entry, so a built-in reverts to its shipped
   * definition and a custom agent disappears.
   * @param agentId - the agent to remove.
   * @returns settlement after the write and any recovery read.
   */
  removeAgent(agentId: string): Promise<void>
  /**
   * Store the rules used by workspaces that define none.
   * @param text - the rules text; empty clears the override.
   * @returns settlement after the write and any recovery read.
   */
  setFallbackDispatchRule(text: string): Promise<void>
  /**
   * Store one workspace's decisions. A field set to `undefined` clears it, so the
   * workspace falls back to the deployment defaults.
   * @param workspaceId - the workspace to write.
   * @param patch - fields to store.
   * @returns settlement after the write and any recovery read.
   */
  patchWorkspace(workspaceId: string, patch: Record<string, string | string[] | undefined>): Promise<void>
}

/** The registration-side face the page's slot entry injects. */
export interface AgentForgeFace extends AgentForgeActions {
  hooks: {
    /** Page snapshot, bound by the renderer as `useAgentForge`. */
    agentForge: SnapshotStore<AgentForgeState>
  }
}

/** Where the controller reads the active language from. */
export interface LocaleSource {
  /** @returns the language built-in copy renders in. */
  current(): ForgeLocale
  /**
   * Observe language changes.
   * @param listener - invoked after the active language changes.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void
}

/** Reads the ids the stored user layer carries an entry for. */
function storedAgentIds(user: unknown): ReadonlySet<string> {
  if (typeof user !== 'object' || user === null) return new Set()
  const agents = (user as { agents?: unknown }).agents
  if (typeof agents !== 'object' || agents === null) return new Set()
  return new Set(Object.keys(agents))
}

/** Whether the stored user layer overrides one top-level string field. */
function isCustomized(user: unknown, field: string): boolean {
  if (typeof user !== 'object' || user === null) return false
  return (user as Record<string, unknown>)[field] !== undefined
}

/** Bridges the plugin's settings scope onto the page's snapshot and actions. */
export class AgentForgeController implements AgentForgeActions {
  private readonly store: SnapshotStore<AgentForgeState>
  private readonly disposers: (() => void)[]
  private activeLocale: ForgeLocale

  /**
   * Option lists, held here rather than read during render.
   *
   * They arrive from two asynchronous sources, and a component that awaited
   * either would be doing subscription work the renderer owns. Loading them is a
   * command the plugin issues; the result enters the same store as everything
   * else, so the page re-renders through the seat it already has.
   */
  private options: PageOptions = LOADING_OPTIONS

  /**
   * @param scope - the bound settings scope for this plugin's namespace.
   * @param locale - the active-language source.
   */
  constructor(
    private readonly scope: SettingsScope<AgentForgeSettings>,
    locale: LocaleSource,
  ) {
    this.activeLocale = locale.current()
    this.store = createSnapshotStore(this.project())
    this.disposers = [
      scope.subscribe(() => { this.refresh() }),
      locale.subscribe(() => {
        this.activeLocale = locale.current()
        this.refresh()
      }),
    ]
  }

  /** Release both subscriptions. */
  dispose(): void {
    for (const dispose of this.disposers) dispose()
  }

  /**
   * Publish a freshly loaded set of option lists.
   * @param options - the lists, or the loading placeholder to clear them.
   */
  setOptions(options: PageOptions): void {
    this.options = options
    this.refresh()
  }

  /**
   * Build the face the page's slot registration injects.
   * @returns the page snapshot and its actions.
   */
  inject(): AgentForgeFace {
    return {
      hooks: { agentForge: this.store },
      patchAgent: (agentId, patch) => this.patchAgent(agentId, patch),
      removeAgent: agentId => this.removeAgent(agentId),
      setFallbackDispatchRule: text => this.setFallbackDispatchRule(text),
      patchWorkspace: (workspaceId, patch) => this.patchWorkspace(workspaceId, patch),
    }
  }

  /** @inheritdoc */
  patchAgent(agentId: string, patch: Record<string, AgentFieldValue | undefined>): Promise<void> {
    const ops = Object.entries(patch).map(([field, value]) => value === undefined
      ? { op: 'unset' as const, path: ['agents', agentId, field] }
      : { op: 'set' as const, path: ['agents', agentId, field], value })
    if (ops.length === 0) return Promise.resolve()
    return this.scope.mutate(ops)
  }

  /** @inheritdoc */
  removeAgent(agentId: string): Promise<void> {
    return this.scope.mutate([{ op: 'unset', path: ['agents', agentId] }])
  }

  /** @inheritdoc */
  setFallbackDispatchRule(text: string): Promise<void> {
    return text.trim() === ''
      ? this.scope.mutate([{ op: 'unset', path: ['fallbackDispatchRule'] }])
      : this.scope.mutate([{ op: 'set', path: ['fallbackDispatchRule'], value: text }])
  }

  /** @inheritdoc */
  patchWorkspace(workspaceId: string, patch: Record<string, string | string[] | undefined>): Promise<void> {
    const ops = Object.entries(patch).map(([field, value]) => value === undefined
      ? { op: 'unset' as const, path: ['workspaces', workspaceId, field] }
      : { op: 'set' as const, path: ['workspaces', workspaceId, field], value })
    if (ops.length === 0) return Promise.resolve()
    return this.scope.mutate(ops)
  }

  /** Republish the projection after a scope or language change. */
  private refresh(): void {
    this.store.set(this.project())
  }

  /** Project the current scope snapshot into render-ready data. */
  private project(): AgentForgeState {
    const snapshot = this.scope.getSnapshot()
    const settings = snapshot.value
    const shell = {
      status: snapshot.status,
      writable: snapshot.writable,
      mode: snapshot.mode,
      fallbackDispatchRuleCustomized: isCustomized(snapshot.user, 'fallbackDispatchRule'),
    }
    if (settings === undefined) {
      return { ...shell, agents: [], fallbackDispatchRule: '', workspaces: {}, options: this.options }
    }
    const overridden = storedAgentIds(snapshot.user)
    const workspaces: Record<string, WorkspaceEntry> = {}
    for (const [workspaceId, stored] of Object.entries(settings.workspaces)) {
      workspaces[workspaceId] = {
        enabled: stored.enabled ?? [],
        lead: stored.lead,
        // Only this workspace's OWN rules. The effective rule already lives on
        // the rules tab as the deployment default; showing it here too would
        // make a workspace that inherits look like one that overrides, and the
        // label already says which of the two it is.
        dispatchRule: stored.dispatchRule ?? '',
        ruleCustomized: stored.dispatchRule !== undefined,
      }
    }
    return {
      ...shell,
      // The box shows what a session actually runs on when the deployment has
      // written no rules of its own: the shipped default for the reader's
      // language. An empty box beside a label that says "default" reads as "no
      // rules at all", which is the opposite of the truth.
      fallbackDispatchRule: settings.fallbackDispatchRule.trim() === ''
        ? DEFAULT_DISPATCH_RULE[this.activeLocale]
        : settings.fallbackDispatchRule,
      workspaces,
      options: this.options,
      agents: resolveAgents(settings, this.activeLocale).map(agent => ({
        id: agent.id,
        builtin: agent.builtin,
        overridden: overridden.has(agent.id),
        label: agent.label,
        description: agent.description,
        persona: agent.persona,
        model: agent.model,
        reasoningEffort: agent.reasoningEffort,
        tools: agent.tools,
        maxDepth: agent.maxDepth,
        plugins: agent.plugins,
        presetRef: agent.presetRef,
      })),
    }
  }
}
