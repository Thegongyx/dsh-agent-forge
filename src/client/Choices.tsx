/**
 * The pickers the agent editor offers instead of free text.
 *
 * Every one of these degrades rather than blocks. A deployment whose catalogue
 * route did not answer, or whose model adapter is unreachable, still gets a
 * usable editor: a picker with no options keeps whatever the agent already
 * stores and says so, instead of silently writing an empty value over it.
 *
 * @module dsh-agent-forge/client/Choices
 */

import type { ReactNode } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { CatalogTool } from '../types.ts'
import type { AgentForgeKey } from './locales.ts'
import type { EffortChoice, PluginChoice, PresetChoice, ProviderChoice } from './options.ts'

/** How an agent's visible tool set is expressed. */
export type ToolMode = 'all' | 'allow' | 'deny'

interface PickerProps {
  id: string
  label: string
  value: string
  /** Options as `[value, label]` pairs; the first entry is the inherited choice. */
  choices: readonly { value: string; label: string }[]
  disabled: boolean
  onCommit: (next: string) => void
}

/** A labelled select whose first entry clears the field. */
function Picker(props: PickerProps): ReactNode {
  return (
    <label className="dsh-af__field" htmlFor={props.id}>
      <span className="dsh-af__fieldLabel">{props.label}</span>
      <select
        id={props.id}
        className="dsh-af__input"
        value={props.value}
        disabled={props.disabled}
        onChange={event => { props.onCommit(event.target.value) }}
      >
        {props.choices.map(choice => (
          <option key={choice.value} value={choice.value}>{choice.label}</option>
        ))}
      </select>
    </label>
  )
}

interface ProviderProps {
  value: string
  providers: readonly ProviderChoice[]
  disabled: boolean
  t: Translate<AgentForgeKey>
  onCommit: (next: string) => void
}

/** Provider route picker. */
export function ProviderPicker(props: ProviderProps): ReactNode {
  const choices = [
    { value: '', label: props.t('field.inherit') },
    ...props.providers.map(provider => ({ value: provider.id, label: provider.name })),
  ]
  // A route the catalogue no longer lists stays selectable, so opening the page
  // cannot quietly rewrite a working configuration.
  if (props.value !== '' && !props.providers.some(provider => provider.id === props.value)) {
    choices.push({ value: props.value, label: `${props.value} (${props.t('field.unlisted')})` })
  }
  return (
    <Picker
      id="dsh-af-provider"
      label={props.t('field.provider')}
      value={props.value}
      choices={choices}
      disabled={props.disabled}
      onCommit={props.onCommit}
    />
  )
}

interface ModelProps {
  value: string
  provider: string
  providers: readonly ProviderChoice[]
  disabled: boolean
  t: Translate<AgentForgeKey>
  onCommit: (next: string) => void
}

/** Model picker, scoped to the chosen provider. */
export function ModelPicker(props: ModelProps): ReactNode {
  const models = props.providers.find(provider => provider.id === props.provider)?.models ?? []
  const choices = [
    { value: '', label: props.t('field.inherit') },
    ...models.map(model => ({ value: model.id, label: model.name })),
  ]
  if (props.value !== '' && !models.some(model => model.id === props.value)) {
    choices.push({ value: props.value, label: `${props.value} (${props.t('field.unlisted')})` })
  }
  return (
    <Picker
      id="dsh-af-model"
      label={props.t('field.model')}
      value={props.value}
      choices={choices}
      disabled={props.disabled}
      onCommit={props.onCommit}
    />
  )
}

interface EffortProps {
  value: string
  /** Levels the chosen model declares; empty when it declares none. */
  efforts: readonly EffortChoice[]
  disabled: boolean
  t: Translate<AgentForgeKey>
  onCommit: (next: string) => void
}

/**
 * Thinking-level picker.
 *
 * The levels are the chosen model's own, not a fixed enum: dsh hands the value
 * to the adapter, which accepts whatever level that model declares and nothing
 * else. A model that declares none therefore offers inheritance only, which is
 * the truthful answer rather than a list of levels it cannot serve.
 */
export function EffortPicker(props: EffortProps): ReactNode {
  const choices = [
    { value: '', label: props.t('field.inherit') },
    ...props.efforts.map(effort => ({ value: effort.id, label: effort.name })),
  ]
  if (props.value !== '' && !props.efforts.some(effort => effort.id === props.value)) {
    choices.push({ value: props.value, label: `${props.value} (${props.t('field.unlisted')})` })
  }
  return (
    <Picker
      id="dsh-af-effort"
      label={props.t('field.reasoningEffort')}
      value={props.value}
      choices={choices}
      disabled={props.disabled}
      onCommit={props.onCommit}
    />
  )
}

interface ToolPickerProps {
  mode: ToolMode
  selected: readonly string[]
  tools: readonly CatalogTool[]
  disabled: boolean
  t: Translate<AgentForgeKey>
  onMode: (next: ToolMode) => void
  onToggle: (name: string, next: boolean) => void
}

/**
 * The visible-tool control.
 *
 * A tool filter is an allow-list or a deny-list, never both in practice; asking
 * a user to fill two independent text areas invited configurations that were
 * neither. One mode plus one list says the same thing unambiguously.
 */
export function ToolPicker(props: ToolPickerProps): ReactNode {
  const restricted = props.mode !== 'all'
  return (
    <div className="dsh-af__field">
      <label className="dsh-af__fieldLabel" htmlFor="dsh-af-toolmode">{props.t('field.tools')}</label>
      <select
        id="dsh-af-toolmode"
        className="dsh-af__input"
        value={props.mode}
        disabled={props.disabled}
        onChange={event => { props.onMode(event.target.value as ToolMode) }}
      >
        <option value="all">{props.t('tools.all')}</option>
        <option value="allow">{props.t('tools.allowOnly')}</option>
        <option value="deny">{props.t('tools.denyOnly')}</option>
      </select>

      {!restricted ? null : props.tools.length === 0
        ? <span className="dsh-af__hint">{props.t('tools.noCatalogue')}</span>
        : (
            <div className="dsh-af__checks dsh-af__checks--tall">
              {props.tools.map(tool => (
                <label key={tool.name} className="dsh-af__check" title={tool.description}>
                  <input
                    type="checkbox"
                    checked={props.selected.includes(tool.name)}
                    disabled={props.disabled}
                    onChange={event => { props.onToggle(tool.name, event.target.checked) }}
                  />
                  <span>{tool.name}</span>
                </label>
              ))}
            </div>
          )}
      <span className="dsh-af__hint">
        {props.mode === 'allow'
          ? props.t('tools.allowHint')
          : props.mode === 'deny' ? props.t('tools.denyHint') : props.t('tools.allHint')}
      </span>
    </div>
  )
}

interface PresetProps {
  value: string
  presets: readonly PresetChoice[]
  disabled: boolean
  t: Translate<AgentForgeKey>
  onCommit: (next: string) => void
}

/**
 * Preset picker: run another composition instead of this agent's own.
 *
 * The roster is the deployment's real preset list — the same one the mode picker
 * shows — so naming one is choosing a composition that already exists rather
 * than retyping its id.
 */
export function PresetPicker(props: PresetProps): ReactNode {
  const choices = [
    { value: '', label: props.t('preset.own') },
    ...props.presets.map(preset => ({
      value: preset.id,
      label: `${preset.name} · ${preset.id}${preset.generated ? ` · ${props.t('preset.generated')}` : ''}`,
    })),
  ]
  // A named preset that the roster no longer lists stays selectable, so opening
  // the page cannot silently rewrite a working configuration.
  if (props.value !== '' && !props.presets.some(preset => preset.id === props.value)) {
    choices.push({ value: props.value, label: `${props.value} (${props.t('field.unlisted')})` })
  }
  return (
    <Picker
      id="dsh-af-presetref"
      label={props.t('field.presetRef')}
      value={props.value}
      choices={choices}
      disabled={props.disabled}
      onCommit={props.onCommit}
    />
  )
}

interface PluginListProps {
  plugins: readonly PluginChoice[]
  /** Module specifiers this agent mounts. */
  selected: readonly string[]
  /** Modules every session already composes, whatever the agent is. */
  baseline: readonly string[]
  disabled: boolean
  t: Translate<AgentForgeKey>
  onChange: (next: string[]) => void
}

/**
 * The agent's plugin set, grouped by what each package does.
 *
 * Checking a row adds that module to the agent's own composition, which is the
 * preset this plugin generates for it — so the checkboxes are the composition,
 * not a summary of it.
 *
 * Two things keep a roster of well over a hundred rows usable. The modules the
 * deployment always composes — its infrastructure and the smallest preset's own
 * rows — are never offered at all, because they are on in every session and
 * cannot be turned off; the hint states how many were left out, so the list still
 * reads as complete. Each remaining group then collapses to a header that toggles
 * the whole group, so choosing a capability means choosing a category rather than
 * hunting individual rows.
 */
export function PluginList(props: PluginListProps): ReactNode {
  const baseline = new Set(props.baseline)
  const visible = props.plugins.filter(plugin => !baseline.has(plugin.name))

  const groups = new Map<string, PluginChoice[]>()
  for (const plugin of visible) {
    const rows = groups.get(plugin.category) ?? []
    rows.push(plugin)
    groups.set(plugin.category, rows)
  }
  const every = props.plugins.filter(plugin => !baseline.has(plugin.name)).map(plugin => plugin.name)
  // Baseline rows are already composed for every session, so they read as on and
  // cannot be turned off here. They never take part in a bulk toggle either: that
  // would write rows into an agent's composition that the deployment already
  // provides.
  const isOn = (name: string): boolean => baseline.has(name) || props.selected.includes(name)
  const toggle = (names: readonly string[], on: boolean): void => {
    props.onChange(on
      ? [...props.selected, ...names.filter(name => !props.selected.includes(name))]
      : props.selected.filter(name => !names.includes(name)))
  }
  const label = (category: string): string => props.t(`category.${category}` as AgentForgeKey)

  return (
    <div className="dsh-af__field">
      <span className="dsh-af__fieldLabel">{props.t('field.plugins')}</span>
      {props.plugins.length === 0
        ? <span className="dsh-af__hint">{props.t('plugins.noCatalogue')}</span>
        : (
            <>
              <div className="dsh-af__actions">
                <button
                  type="button"
                  className="dsh-af__button"
                  disabled={props.disabled}
                  onClick={() => { toggle(every, true) }}
                >
                  {props.t('plugins.selectAll')}
                </button>
                <button
                  type="button"
                  className="dsh-af__button"
                  disabled={props.disabled}
                  onClick={() => { toggle(every, false) }}
                >
                  {props.t('plugins.clearAll')}
                </button>
              </div>
              {baseline.size === 0
                ? null
                : (
                    <span className="dsh-af__hint">
                      {`${props.t('plugins.baselineHint')} (${String(baseline.size)})`}
                    </span>
                  )}
              {[...groups].map(([category, rows]) => {
                const names = rows.filter(row => !baseline.has(row.name)).map(row => row.name)
                const all = names.length > 0 && names.every(isOn)
                return (
                  <div key={category} className="dsh-af__group">
                    <label className="dsh-af__check dsh-af__groupHead">
                      <input
                        type="checkbox"
                        checked={all}
                        disabled={props.disabled || names.length === 0}
                        onChange={event => { toggle(names, event.target.checked) }}
                      />
                      <span>{label(category)} · {rows.length}</span>
                    </label>
                    <details className="dsh-af__details">
                      <summary>{props.t('plugins.expand')}</summary>
                      <div className="dsh-af__checks dsh-af__checks--tall">
                        {rows.map(row => {
                          const locked = baseline.has(row.name)
                          return (
                            <label key={row.id} className="dsh-af__check">
                              <input
                                type="checkbox"
                                checked={isOn(row.name)}
                                disabled={props.disabled || locked}
                                onChange={event => { toggle([row.name], event.target.checked) }}
                              />
                              <span className="dsh-af__listName">{row.id}</span>
                              {locked ? <span className="dsh-af__meta">{props.t('plugins.baseline')}</span> : null}
                              {row.description === ''
                                ? null
                                : <span className="dsh-af__meta dsh-af__meta--wrap">{row.description}</span>}
                            </label>
                          )
                        })}
                      </div>
                    </details>
                  </div>
                )
              })}
            </>
          )}
      <span className="dsh-af__hint">{props.t('plugins.hint')}</span>
    </div>
  )
}
