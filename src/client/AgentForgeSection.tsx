/**
 * The multi-agent forge settings page.
 *
 * Presentation only: every datum arrives through the props shares (the
 * `useAgentForge` seat, the action callbacks, and the `t` seat), and every write
 * goes back through a callback. The component reads no context, opens no
 * subscription, and holds no state that outlives it — its two `useState` calls
 * are page-local view state (which tab, which agent is selected) that nothing
 * outside needs to see.
 *
 * Text fields are uncontrolled and commit on blur. Remounting on the committed
 * value (`key={value}`) discards a draft whenever the underlying setting moves
 * for another reason, which is what keeps a slow host round-trip from silently
 * overwriting what the user typed next.
 *
 * @module dsh-agent-forge/client/AgentForgeSection
 */

import { useEffect, useState, type ReactNode } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { GlobalStandardProps, Translate } from '@deepseek-ai/dsh-client-ui-slots'
// Each import below declares one of the standard props this entry reads. The
// props interface derives their types from that declaration instead of
// restating the shapes here.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { EffortPicker, ModelPicker, PluginList, PresetPicker, ProviderPicker, ToolPicker, type ToolMode } from './Choices.tsx'
import type { AgentForgeActions, AgentForgeState, AgentListItem, WorkspaceEntry } from './controller.ts'
import type { AgentForgeKey } from './locales.ts'
import { loadOptions, type PageOptions } from './options.ts'

/** Props the four shares compose for this entry. */
export interface AgentForgeSectionProps {
  /** Reactive read of the page snapshot. */
  useAgentForge: SnapshotSelectorHook<AgentForgeState>
  /** Reactive read of the workspace list. */
  useWorkspaces: GlobalStandardProps['useWorkspaces']
  /** Reactive read of the session list, used to locate the current workspace. */
  useSessions: GlobalStandardProps['useSessions']
  /** Store fields on an agent. */
  patchAgent: AgentForgeActions['patchAgent']
  /** Drop an agent's stored entry. */
  removeAgent: AgentForgeActions['removeAgent']
  /** Store the default dispatch rules. */
  setFallbackDispatchRule: AgentForgeActions['setFallbackDispatchRule']
  /** Store one workspace's decisions. */
  patchWorkspace: AgentForgeActions['patchWorkspace']
  /** Copy lookup for this plugin's namespace. */
  t: Translate<AgentForgeKey>
}

/**
 * Derives an unused agent id from a display name.
 * @param agents - agents already defined.
 * @param label - the display name the new agent starts with.
 * @returns an id no existing agent uses.
 */
function unusedAgentId(agents: readonly AgentListItem[], label: string): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent'
  const taken = new Set(agents.map(agent => agent.id))
  let candidate = base
  let suffix = 2
  while (taken.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

interface TextFieldProps {
  id: string
  label: string
  value: string
  placeholder?: string
  hint?: string
  disabled: boolean
  onCommit: (next: string) => void
}

function TextField(props: TextFieldProps): ReactNode {
  return (
    <label className="dsh-af__field" htmlFor={props.id}>
      <span className="dsh-af__fieldLabel">{props.label}</span>
      <input
        id={props.id}
        key={props.value}
        className="dsh-af__input"
        type="text"
        defaultValue={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onBlur={event => {
          if (event.target.value !== props.value) props.onCommit(event.target.value)
        }}
      />
      {props.hint === undefined ? null : <span className="dsh-af__hint">{props.hint}</span>}
    </label>
  )
}

interface AgentEditorProps {
  agent: AgentListItem
  /** The option lists the pickers offer, read from the page snapshot. */
  options: PageOptions
  disabled: boolean
  t: Translate<AgentForgeKey>
  patchAgent: AgentForgeActions['patchAgent']
  removeAgent: AgentForgeActions['removeAgent']
}

/** Which filter an agent's stored tool set expresses. */
function toolModeOf(agent: AgentListItem): ToolMode {
  if ((agent.tools?.allow ?? []).length > 0) return 'allow'
  if ((agent.tools?.deny ?? []).length > 0) return 'deny'
  return 'all'
}

function AgentEditor(props: AgentEditorProps): ReactNode {
  const { agent, disabled, t } = props
  // The mode is local intent: choosing "allow only" before checking anything
  // stores no filter, so reading the mode back off the stored value would snap
  // the control back to "all" under the user's cursor.
  const [toolMode, setToolMode] = useState<ToolMode>(() => toolModeOf(agent))
  const listed = toolMode === 'deny' ? (agent.tools?.deny ?? []) : (agent.tools?.allow ?? [])
  // Thinking levels belong to the chosen model, so the three route controls are
  // read together: the effort list is empty until a provider and model are set.
  const chosenProvider = props.options.providers.find(provider => provider.id === (agent.model?.provider ?? ''))
  const efforts = chosenProvider?.models.find(model => model.id === (agent.model?.model ?? ''))?.efforts ?? []
  // An empty list is not a filter: writing one would deny every tool or none,
  // neither of which is what "I have not picked anything yet" means.
  const patchTools = (mode: ToolMode, names: readonly string[]): void => {
    if (mode === 'all' || names.length === 0) {
      void props.patchAgent(agent.id, { tools: undefined })
      return
    }
    void props.patchAgent(agent.id, {
      tools: mode === 'allow' ? { allow: [...names] } : { deny: [...names] },
    })
  }
  return (
    <div className="dsh-af__editor">
      <TextField
        id={`dsh-af-label-${agent.id}`}
        label={t('field.label')}
        value={agent.label}
        disabled={disabled}
        onCommit={next => { void props.patchAgent(agent.id, { label: next }) }}
      />
      <TextField
        id={`dsh-af-description-${agent.id}`}
        label={t('field.description')}
        value={agent.description}
        disabled={disabled}
        onCommit={next => { void props.patchAgent(agent.id, { description: next }) }}
      />
      <label className="dsh-af__field" htmlFor={`dsh-af-persona-${agent.id}`}>
        <span className="dsh-af__fieldLabel">{t('field.persona')}</span>
        <textarea
          id={`dsh-af-persona-${agent.id}`}
          key={agent.persona}
          className="dsh-af__area dsh-af__area--tall"
          defaultValue={agent.persona}
          disabled={disabled}
          onBlur={event => {
            if (event.target.value !== agent.persona) {
              void props.patchAgent(agent.id, { persona: event.target.value })
            }
          }}
        />
      </label>
      {props.options.providers.length === 0 && props.options.providersError !== ''
        ? <span className="dsh-af__hint">{props.options.providersError}</span>
        : null}
      <div className="dsh-af__row">
        <ProviderPicker
          value={agent.model?.provider ?? ''}
          providers={props.options.providers}
          disabled={disabled}
          t={t}
          onCommit={next => {
            if (next === '') {
              // Clearing either half drops the whole route back to inheritance;
              // half a route is not a value the host can act on.
              void props.patchAgent(agent.id, { model: undefined })
              return
            }
            // The stored model belongs to the route it was chosen on; carrying
            // it over would name a model the new provider may not serve.
            const models = props.options.providers.find(provider => provider.id === next)?.models ?? []
            const kept = agent.model?.model ?? ''
            void props.patchAgent(agent.id, {
              model: {
                provider: next,
                model: models.some(model => model.id === kept) ? kept : (models[0]?.id ?? ''),
              },
            })
          }}
        />
        <ModelPicker
          value={agent.model?.model ?? ''}
          provider={agent.model?.provider ?? ''}
          providers={props.options.providers}
          disabled={disabled}
          t={t}
          onCommit={next => {
            const provider = agent.model?.provider ?? ''
            if (next === '' || provider === '') {
              void props.patchAgent(agent.id, { model: undefined })
              return
            }
            void props.patchAgent(agent.id, { model: { provider, model: next } })
          }}
        />
        <EffortPicker
          value={agent.reasoningEffort ?? ''}
          efforts={efforts}
          disabled={disabled}
          t={t}
          onCommit={next => {
            void props.patchAgent(agent.id, { reasoningEffort: next === '' ? undefined : next })
          }}
        />
      </div>
      <ToolPicker
        mode={toolMode}
        selected={listed}
        tools={props.options.tools}
        disabled={disabled}
        t={t}
        onMode={next => {
          setToolMode(next)
          // Only a list already stored under the incoming key survives the
          // switch; an allow-list is not a deny-list.
          const kept = next === 'deny' ? (agent.tools?.deny ?? []) : (agent.tools?.allow ?? [])
          patchTools(next, kept)
        }}
        onToggle={(name, checked) => {
          const next = checked
            ? [...listed.filter(entry => entry !== name), name]
            : listed.filter(entry => entry !== name)
          patchTools(toolMode, next)
        }}
      />
      <PluginList
        plugins={props.options.plugins}
        baseline={props.options.baseline}
        selected={agent.plugins ?? []}
        disabled={disabled}
        t={t}
        onChange={next => {
          // An empty set is the absence of a composition of its own, not a
          // composition that mounts nothing.
          void props.patchAgent(agent.id, { plugins: next.length === 0 ? undefined : next })
        }}
      />
      <PresetPicker
        value={agent.presetRef ?? ''}
        presets={props.options.presets}
        disabled={disabled}
        t={t}
        onCommit={next => {
          // Naming an existing preset makes the checkboxes above inert: this
          // agent then runs somebody else's composition, verbatim.
          void props.patchAgent(agent.id, { presetRef: next === '' ? undefined : next })
        }}
      />
      <label className="dsh-af__field" htmlFor={`dsh-af-depth-${agent.id}`}>
        <span className="dsh-af__fieldLabel">{t('field.maxDepth')}</span>
        <input
          id={`dsh-af-depth-${agent.id}`}
          key={String(agent.maxDepth)}
          className="dsh-af__num"
          type="number"
          // A cap of 0 can never admit a delegation: the child of a depth-0
          // session is already depth 1. Offering it as a valid minimum is how an
          // agent the rules route to becomes undispatched.
          min={1}
          defaultValue={agent.maxDepth === undefined ? '' : String(agent.maxDepth)}
          placeholder={t('field.inherit')}
          disabled={disabled}
          onBlur={event => {
            const raw = event.target.value.trim()
            const next = raw === '' ? undefined : Number(raw)
            if (next !== undefined && (!Number.isSafeInteger(next) || next < 0)) return
            if (next !== agent.maxDepth) void props.patchAgent(agent.id, { maxDepth: next })
          }}
        />
        {agent.maxDepth === 0
          ? <span className="dsh-af__hint dsh-af__hint--warn">{t('field.maxDepthZero')}</span>
          : null}
      </label>
      <div className="dsh-af__actions">
        {agent.overridden ? (
          <button
            type="button"
            className="dsh-af__button"
            disabled={disabled}
            onClick={() => { void props.removeAgent(agent.id) }}
          >
            {t('agents.reset')}
          </button>
        ) : null}
        {agent.builtin ? null : (
          <button
            type="button"
            className="dsh-af__button dsh-af__button--danger"
            disabled={disabled}
            onClick={() => { void props.removeAgent(agent.id) }}
          >
            {t('agents.remove')}
          </button>
        )}
      </div>
    </div>
  )
}

interface WorkspacesTabProps {
  agents: readonly AgentListItem[]
  workspaces: Readonly<Record<string, WorkspaceEntry>>
  useWorkspaces: GlobalStandardProps['useWorkspaces']
  useSessions: GlobalStandardProps['useSessions']
  disabled: boolean
  t: Translate<AgentForgeKey>
  patchWorkspace: AgentForgeActions['patchWorkspace']
}

function WorkspacesTab(props: WorkspacesTabProps): ReactNode {
  const items = props.useWorkspaces(state => state.items)
  const currentSession = props.useSessions(state => state.current)
  const [picked, setPicked] = useState<string | undefined>(undefined)

  if (items.length === 0) return <p className="dsh-af__empty">{props.t('workspaces.empty')}</p>

  // The selected session's workspace is the useful default; a pick overrides it.
  const currentId = currentSession === undefined
    ? undefined
    : items.find(item => item.sessionIds.includes(currentSession))?.workspaceId
  const activeId = picked ?? currentId ?? items[0]?.workspaceId
  const active = items.find(item => item.workspaceId === activeId)
  const stored = activeId === undefined ? undefined : props.workspaces[activeId]

  const everyId = props.agents.map(agent => agent.id)
  const enabledIds = stored?.enabled ?? []
  // An empty list means every agent, including ones authored later.
  const offers = (id: string): boolean => enabledIds.length === 0 || enabledIds.includes(id)
  const enabledAgents = props.agents.filter(agent => offers(agent.id))

  const toggle = (id: string): void => {
    if (activeId === undefined) return
    const next = everyId.filter(candidate => candidate === id ? !offers(id) : offers(candidate))
    void props.patchWorkspace(activeId, {
      // Checking everything back on returns the field to its inherited meaning
      // rather than freezing today's roster into an explicit list.
      enabled: next.length === everyId.length ? undefined : next,
    })
  }

  return (
    <div className="dsh-af__editor">
      <div className="dsh-af__field">
        <span className="dsh-af__fieldLabel">{props.t('workspaces.pick')}</span>
        <div className="dsh-af__actions">
          {items.map(item => (
            <button
              key={item.workspaceId}
              type="button"
              className="dsh-af__button"
              aria-pressed={item.workspaceId === activeId}
              onClick={() => { setPicked(item.workspaceId) }}
            >
              {item.title}
              {item.workspaceId === currentId ? ` · ${props.t('workspaces.current')}` : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="dsh-af__field">
        <span className="dsh-af__fieldLabel">{props.t('workspaces.enabled')}</span>
        <div className="dsh-af__checks">
          {props.agents.map(agent => (
            <label key={agent.id} className="dsh-af__check">
              <input
                type="checkbox"
                checked={offers(agent.id)}
                disabled={props.disabled}
                onChange={() => { toggle(agent.id) }}
              />
              <span>{agent.label}</span>
            </label>
          ))}
        </div>
        <span className="dsh-af__hint">{props.t('workspaces.enabledHint')}</span>
      </div>

      <label className="dsh-af__field" htmlFor="dsh-af-ws-lead">
        <span className="dsh-af__fieldLabel">{props.t('workspaces.lead')}</span>
        <select
          id="dsh-af-ws-lead"
          className="dsh-af__input"
          value={stored?.lead ?? ''}
          disabled={props.disabled}
          onChange={event => {
            if (activeId === undefined) return
            void props.patchWorkspace(activeId, {
              lead: event.target.value === '' ? undefined : event.target.value,
            })
          }}
        >
          <option value="">{props.t('workspaces.leadAuto')}</option>
          {enabledAgents.map(agent => (
            <option key={agent.id} value={agent.id}>{agent.label}</option>
          ))}
        </select>
      </label>

      <label className="dsh-af__field" htmlFor="dsh-af-ws-rule">
        <span className="dsh-af__fieldLabel">
          {props.t('workspaces.rule')}
          {stored?.ruleCustomized === true ? '' : ` · ${props.t('workspaces.inherited')}`}
        </span>
        <textarea
          id="dsh-af-ws-rule"
          key={`${activeId ?? ''}:${stored?.dispatchRule ?? ''}`}
          className="dsh-af__area dsh-af__area--tall"
          defaultValue={stored?.dispatchRule ?? ''}
          disabled={props.disabled}
          onBlur={event => {
            if (activeId === undefined) return
            if (event.target.value === (stored?.dispatchRule ?? '')) return
            void props.patchWorkspace(activeId, {
              dispatchRule: event.target.value.trim() === '' ? undefined : event.target.value,
            })
          }}
        />
        <span className="dsh-af__hint">{props.t('workspaces.ruleHint')}</span>
      </label>

      {active === undefined ? null : <p className="dsh-af__meta">{active.path}</p>}
    </div>
  )
}

/**
 * Renders the forge's settings page.
 * @param props - the composed props shares.
 * @returns the page.
 */
export function AgentForgeSection(props: AgentForgeSectionProps): ReactNode {
  const status = props.useAgentForge(state => state.status)
  const writable = props.useAgentForge(state => state.writable)
  const mode = props.useAgentForge(state => state.mode)
  const agents = props.useAgentForge(state => state.agents)
  const rule = props.useAgentForge(state => state.fallbackDispatchRule)
  const ruleCustomized = props.useAgentForge(state => state.fallbackDispatchRuleCustomized)
  // `useAgentForge` is a hook, not a plain accessor: it subscribes through
  // `useSyncExternalStore`. Calling it inside the tab branch below made the hook
  // count depend on which tab was showing, which React reports as "rendered more
  // hooks than during the previous render" and answers by blanking the surface.
  const workspaces = props.useAgentForge(state => state.workspaces)
  const storedOptions = props.useAgentForge(state => state.options)
  // The page reads the catalogue when it opens. The boot-time read in the plugin
  // body runs before the page can reach the route, and a read that never lands
  // is indistinguishable on screen from a deployment that has no options at all.
  const [loadedOptions, setLoadedOptions] = useState<PageOptions | undefined>(undefined)
  useEffect(() => {
    let live = true
    void loadOptions().then(next => { if (live) setLoadedOptions(next) }).catch(() => {})
    return () => { live = false }
  }, [])
  const options = loadedOptions ?? storedOptions

  const [tab, setTab] = useState<'agents' | 'workspaces' | 'rules'>('agents')
  const [saved, setSaved] = useState(false)
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)

  const selected = agents.find(agent => agent.id === selectedId) ?? agents[0]
  const disabled = !writable

  const banner = status === 'unavailable'
    ? props.t('status.unavailable')
    : mode === 'memory'
      ? props.t('status.memory')
      : writable
        ? status === 'loading' ? props.t('status.loading') : undefined
        : props.t('status.readonly')

  return (
    <section className="dsh-af">
      <header>
        <h2 className="dsh-af__title">{props.t('title')}</h2>
        <p className="dsh-af__subtitle">{props.t('subtitle')}</p>
      </header>

      {banner === undefined ? null : <div className="dsh-af__banner">{banner}</div>}

      <div className="dsh-af__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className="dsh-af__tab"
          aria-selected={tab === 'agents'}
          onClick={() => { setTab('agents') }}
        >
          {props.t('tab.agents')}
        </button>
        <button
          type="button"
          role="tab"
          className="dsh-af__tab"
          aria-selected={tab === 'workspaces'}
          onClick={() => { setTab('workspaces') }}
        >
          {props.t('tab.workspaces')}
        </button>
        <button
          type="button"
          role="tab"
          className="dsh-af__tab"
          aria-selected={tab === 'rules'}
          onClick={() => { setTab('rules') }}
        >
          {props.t('tab.rules')}
        </button>
      </div>

      {/*
        Every field commits when it loses focus, so there is nothing pending to
        flush. The button exists because a page that saves silently reads as a
        page that does not save: it re-reads the catalogue — which is what picks
        up a freshly generated preset — and says so.
      */}
      <div className="dsh-af__actions">
        <button
          type="button"
          className="dsh-af__button"
          disabled={disabled}
          onClick={() => {
            void loadOptions().then(next => {
              setLoadedOptions(next)
              setSaved(true)
            })
          }}
        >
          {props.t('save.button')}
        </button>
        <span className="dsh-af__hint">{saved ? props.t('save.done') : props.t('save.hint')}</span>
      </div>

      {tab === 'agents'
        ? (
            <div className="dsh-af__split">
              <div className="dsh-af__list">
                {agents.length === 0
                  ? <p className="dsh-af__empty">{props.t('agents.empty')}</p>
                  : agents.map(agent => (
                      <button
                        key={agent.id}
                        type="button"
                        className="dsh-af__listItem"
                        aria-current={agent.id === selected?.id}
                        onClick={() => { setSelectedId(agent.id) }}
                      >
                        <span className="dsh-af__listName">{agent.label}</span>
                        <span className="dsh-af__meta">
                          {agent.builtin ? props.t('agents.builtin') : props.t('agents.custom')}
                          {agent.overridden ? ` · ${props.t('agents.overridden')}` : ''}
                        </span>
                      </button>
                    ))}
                <button
                  type="button"
                  className="dsh-af__button"
                  disabled={disabled}
                  onClick={() => {
                    const label = props.t('agents.newLabel')
                    const id = unusedAgentId(agents, label)
                    setSelectedId(id)
                    void props.patchAgent(id, { label, persona: props.t('agents.newPersona') })
                  }}
                >
                  {props.t('agents.add')}
                </button>
              </div>
              {selected === undefined
                ? <p className="dsh-af__empty">{props.t('agents.empty')}</p>
                : (
                    <AgentEditor
                      key={selected.id}
                      agent={selected}
                      options={options}
                      disabled={disabled}
                      t={props.t}
                      patchAgent={props.patchAgent}
                      removeAgent={props.removeAgent}
                    />
                  )}
            </div>
          )
        : tab === 'workspaces'
          ? (
              <WorkspacesTab
                agents={agents}
                workspaces={workspaces}
                useWorkspaces={props.useWorkspaces}
                useSessions={props.useSessions}
                disabled={disabled}
                t={props.t}
                patchWorkspace={props.patchWorkspace}
              />
            )
          : (
            <div className="dsh-af__editor">
              <p className="dsh-af__hint">{props.t('rules.hint')}</p>
              <label className="dsh-af__field" htmlFor="dsh-af-rules">
                <span className="dsh-af__fieldLabel">
                  {props.t('rules.heading')}
                  {ruleCustomized ? ` · ${props.t('rules.custom')}` : ''}
                </span>
                <textarea
                  id="dsh-af-rules"
                  key={rule}
                  className="dsh-af__area dsh-af__area--tall"
                  defaultValue={rule}
                  disabled={disabled}
                  onBlur={event => {
                    if (event.target.value !== rule) {
                      void props.setFallbackDispatchRule(event.target.value)
                    }
                  }}
                />
              </label>
            </div>
          )}
    </section>
  )
}
