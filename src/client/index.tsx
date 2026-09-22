/**
 * dsh-agent-forge, browser half.
 *
 * Contributes two things. A settings page owns the configuration: the agent
 * roster with each agent's model, reasoning effort, persona and visible tool
 * set, the per-workspace selections and rules, and the deployment's default
 * routing rules. A canvas owns the view: every delegation this session made,
 * one card per run, grouped by the agent that ran it.
 *
 * The plugin registers its settings namespace on the Host and its surfaces in
 * the browser, and the shell pairs namespace to page by nothing more than the
 * name — which is what lets a package outside the harness checkout contribute
 * both without the shell learning what either means.
 *
 * @module dsh-agent-forge/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { SETTINGS_NAMESPACE, type AgentForgeSettings, type ForgeLocale } from '../types.ts'
import { AgentForgeMap, type DelegationAddress, type DelegationSessionId } from './AgentForgeMap.tsx'
import { AgentForgeSection } from './AgentForgeSection.tsx'
import { AgentForgeController, type LocaleSource } from './controller.ts'
import { NS, en, zh } from './locales.ts'
import { loadOptions } from './options.ts'
import { installStyles } from './styles.ts'
import { PanelIcon } from './PanelIcon.tsx'

/**
 * Identity shared by the sidebar entry and the main panel it addresses.
 *
 * `main` selects its occupant by the key a `sidebar.panellist` entry carries, so
 * the two registrations have to agree on this string.
 */
const PANEL_ID = 'agent-forge-map'

/** Services this half reads. */
export const inject = ['slots', 'locale', 'settingsScope', 'sessions']

/**
 * Whether an active locale id renders this plugin's built-in copy in Chinese.
 * @param id - the locale id the shell reports as active.
 * @returns true for `zh` and any region-tagged Chinese locale.
 */
function isChinese(id: string): boolean {
  return id === 'zh' || id.startsWith('zh-')
}

/**
 * Registers the dictionaries, the stylesheet, the settings page, and the canvas.
 * @param ctx - the client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'agent-forge: dictionaries')
  ctx.effect(() => installStyles(), 'agent-forge: page styles')

  const scope = ctx.settingsScope.bind<AgentForgeSettings>({ namespace: SETTINGS_NAMESPACE })
  const locale: LocaleSource = {
    // Built-in agent copy is resolved in the browser as well as on the Host, so
    // the roster follows the reader's language rather than the row's.
    current: (): ForgeLocale => (isChinese(ctx.locale.getSnapshot().active) ? 'zh' : 'en'),
    subscribe: listener => ctx.on('locale/change', () => { listener() }),
  }
  const controller = new AgentForgeController(scope, locale)
  ctx.effect(() => () => { controller.dispose() }, 'agent-forge: controller subscriptions')

  // The pickers need lists that neither the settings namespace nor the session
  // snapshot carries: the tool catalogue and the plugin roster come from the
  // Host's own route, the model catalogue from the session Remote. Loading is a
  // one-shot command, and its result lands in the controller's store so the page
  // re-renders through the seat it already reads.
  // The model catalogue is a Remote the gateway's client half provides; that
  // half can mount after this row, so reading `remote` once at apply time would
  // find nothing and every model picker would silently offer inheritance only.
  // Warm the catalogue while the shell boots. The settings page reads it again
  // when it opens; this only means the first visit renders without a wait.
  ctx.effect(() => {
    let live = true
    void loadOptions()
      .then(options => { if (live) controller.setOptions(options) })
      .catch(() => { /* the reader degrades on its own; the page loads it again */ })
    return () => { live = false }
  }, 'agent-forge: option catalogues')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    // A new id on purpose: `agent-presets` is taken by the shipped preset page,
    // and a list slot replaces an occupant that reuses its id.
    id: 'agent-forge',
    order: 50,
    label: () => ctx.locale.bind(NS)('nav'),
    locale: NS,
    inject: () => controller.inject(),
  }, AgentForgeSection))

  // The sidebar owns the button and switches `main` to the matching key itself,
  // so the two registrations need no wiring between them beyond PANEL_ID.
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    label: () => ctx.locale.bind(NS)('nav.map'),
  }, PanelIcon))

  // Created once, outside `inject`, so the panel can list them as effect
  // dependencies without the effect re-running on every render.
  const openDelegation = (address: DelegationAddress): void => {
    ctx.sessions.openSubagent(address)
  }
  /**
   * Ask the host to load one parent's delegation catalog.
   *
   * The session list carries no catalog until something asks for one, and the
   * only shipped caller is the subagent dropdown on hover. A panel that merely
   * read the snapshot would therefore sit on its empty state while delegations
   * existed, so the canvas asks for the session it is showing.
   */
  const expandDelegation = (parentSessionId: DelegationSessionId): void => {
    ctx.sessions.setSubagentCatalogOpen(parentSessionId, true)
  }
  /** Re-read a catalog that is already loaded, so a finished run stops reading as running. */
  const refreshDelegation = (parentSessionId: DelegationSessionId): void => {
    void ctx.sessions.refreshSubagents(parentSessionId)
  }

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => ({ openDelegation, expandDelegation, refreshDelegation }),
  }, AgentForgeMap))
}
