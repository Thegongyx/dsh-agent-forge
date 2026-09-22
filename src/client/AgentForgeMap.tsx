/**
 * The delegation panorama.
 *
 * One card per delegated run, grouped by the agent that ran it, with the run's
 * own delegations nested inside. The research over comparable products settled
 * three of these choices: dependency edges are not drawn because the durable
 * record carries no dependency facts to draw them from, granularity stops at
 * agent × task so a card is one run rather than one tool call, and the state
 * vocabulary is limited to what a parent can actually read about its children.
 * All three live in `../panorama.ts`, which is pure and tested without a browser.
 *
 * Clicking a card opens its facts beside the canvas rather than replacing it, so
 * reading one run never costs the reader their place in the whole.
 *
 * @module dsh-agent-forge/client/AgentForgeMap
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ISessions, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { GlobalStandardProps, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Declares the `tokenUsage` projection this panel reads per row.
import type {} from '@deepseek-ai/dsh-token-meter/client'
import {
  buildDelegationTree,
  countDelegations,
  countRunning,
  durationText,
  groupByAgent,
  tokensText,
  type DelegationChild,
  type DelegationNode,
  type DelegationSubject,
} from '../panorama.ts'
import type { AgentForgeKey } from './locales.ts'

/** Address the sessions service takes when opening a delegated conversation. */
export type DelegationAddress = Parameters<ISessions['openSubagent']>[0]

/**
 * Session id, taken from the address the sessions service takes.
 *
 * Derived rather than imported: `@deepseek-ai/dsh-session` also augments
 * `Context.sessions`, and pulling that into the browser program would collide
 * with the client service of the same name.
 */
export type DelegationSessionId = DelegationAddress['childSessionId']

/** Props the four shares compose for this entry. */
export interface AgentForgeMapProps {
  /** Reactive read of the session list. */
  useSessions: GlobalStandardProps['useSessions']
  /** Open one delegated run's conversation. */
  openDelegation: (address: DelegationAddress) => void
  /** Ask the host to load one parent's delegation catalog. */
  expandDelegation: (parentSessionId: DelegationSessionId) => void
  /** Re-read a catalog that is already loaded. */
  refreshDelegation: (parentSessionId: DelegationSessionId) => void
  /** Copy lookup for this plugin's namespace. */
  t: Translate<AgentForgeKey>
}

/**
 * Reduces one session-list row to the facts the canvas uses.
 * @param sessionId - the row's id.
 * @param summary - the row.
 * @returns the subject the tree builder reads.
 */
function subjectOf(sessionId: string, summary: SessionSummary): DelegationSubject {
  const timing = summary.projectionValues?.subagentTiming
  // Elapsed time comes from recorded turn bounds rather than the clock, so the
  // derivation stays a pure function of the snapshot.
  const activeMs = timing === undefined
    ? undefined
    : timing.active === undefined
      ? timing.settledMs
      : timing.settledMs + Math.max(0, timing.active.through - timing.active.since)
  const usage = summary.projectionValues?.tokenUsage
  const tokens = usage === undefined
    ? undefined
    : usage.uncachedInputTokens + usage.outputTokens
      + usage.cacheReadTokens + usage.cacheWriteTokens
  return {
    sessionId,
    title: summary.title,
    running: summary.running,
    parentSessionId: summary.parentId,
    activeMs,
    tokens,
  }
}

/**
 * Finds one node anywhere in the tree.
 * @param nodes - the tree, or one level of it.
 * @param id - the session id to find.
 * @returns the node, or `undefined`.
 */
function findNode(nodes: readonly DelegationNode[], id: string | undefined): DelegationNode | undefined {
  if (id === undefined) return undefined
  for (const node of nodes) {
    if (node.sessionId === id) return node
    const nested = findNode(node.children, id)
    if (nested !== undefined) return nested
  }
  return undefined
}

/**
 * Renders the delegation panorama.
 * @param props - the composed props shares.
 * @returns the panel.
 */
export function AgentForgeMap(props: AgentForgeMapProps): ReactNode {
  const current = props.useSessions(state => state.current)
  const byId = props.useSessions(state => state.byId)
  const catalogs = props.useSessions(state => state.subagentsByParent)
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)

  // The session list carries no catalog until something asks for one, so the
  // canvas asks for the session it is showing. Without this the panel would sit
  // on its empty state while delegations existed.
  useEffect(() => {
    if (current === undefined) return
    props.expandDelegation(current)
    props.refreshDelegation(current)
  }, [current, props.expandDelegation, props.refreshDelegation])

  const tree = useMemo(() => {
    const subjects: Record<string, DelegationSubject> = {}
    for (const [sessionId, summary] of Object.entries(byId)) {
      subjects[sessionId] = subjectOf(sessionId, summary)
    }
    const children: Record<string, DelegationChild[]> = {}
    for (const [parentId, catalog] of Object.entries(catalogs)) {
      children[parentId] = catalog.entries
        // A catalog row is either a delegated child or a diagnostic about one
        // that could not be read; only the first is a delegation.
        .filter(entry => entry.kind === 'child')
        .map(entry => ({
          id: entry.id,
          mode: entry.mode,
          label: entry.label,
          hasChildren: entry.hasChildren,
        }))
    }
    return buildDelegationTree(current, subjects, children)
  }, [current, byId, catalogs])

  const total = countDelegations(tree)
  const running = countRunning(tree)
  const selected = findNode(tree, selectedId)

  return (
    <section className="dsh-af-map">
      <header className="dsh-af-map__head">
        <h2 className="dsh-af-map__title">{props.t('map.title')}</h2>
        <p className="dsh-af-map__subtitle">{props.t('map.summary', { total, running })}</p>
      </header>

      {total === 0
        ? <p className="dsh-af-map__empty">{props.t('map.empty')}</p>
        : (
            <div className="dsh-af-map__split">
              <div className="dsh-af-map__canvas">
                {groupByAgent(tree).map(group => (
                  <section key={group.agent ?? ''} className="dsh-af-map__lane">
                    <h3 className="dsh-af-map__laneTitle">
                      {group.agent ?? props.t('map.unlabelled')}
                      <span className="dsh-af-map__laneCount">{group.nodes.length}</span>
                    </h3>
                    <div className="dsh-af-map__cards">
                      {group.nodes.map(node => {
                        const duration = durationText(node.activeMs)
                        const tokens = tokensText(node.tokens)
                        return (
                          <button
                            key={node.sessionId}
                            type="button"
                            className="dsh-af-map__card"
                            data-state={node.running ? 'running' : 'idle'}
                            aria-current={node.sessionId === selectedId}
                            onClick={() => { setSelectedId(node.sessionId) }}
                          >
                            <span className="dsh-af-map__cardTask">
                              {node.task === '' ? node.title : node.task}
                            </span>
                            <span className="dsh-af-map__cardMeta">
                              <span className="dsh-af-map__state" data-state={node.running ? 'running' : 'idle'}>
                                {node.running ? props.t('map.running') : props.t('map.idle')}
                              </span>
                              {duration === undefined ? null : <span>{duration}</span>}
                              {tokens === undefined ? null : <span>{tokens}</span>}
                              {node.children.length > 0
                                ? <span>{props.t('map.children', { count: node.children.length })}</span>
                                : node.hasChildren
                                  ? <span>{props.t('map.hasChildren')}</span>
                                  : null}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </section>
                ))}
              </div>

              <aside className="dsh-af-map__detail">
                {selected === undefined
                  ? <p className="dsh-af-map__empty">{props.t('map.pick')}</p>
                  : (
                      <>
                        <p className="dsh-af-map__taskText">{selected.title}</p>
                        <dl className="dsh-af-map__facts">
                          <dt>{props.t('map.agent')}</dt>
                          <dd>{selected.agent ?? props.t('map.unlabelled')}</dd>
                          <dt>{props.t('map.state')}</dt>
                          <dd>{selected.running ? props.t('map.running') : props.t('map.idle')}</dd>
                          <dt>{props.t('map.depth')}</dt>
                          <dd>{selected.depth}</dd>
                          <dt>{props.t('map.duration')}</dt>
                          <dd>{durationText(selected.activeMs) ?? props.t('map.none')}</dd>
                          <dt>{props.t('map.tokens')}</dt>
                          <dd>{tokensText(selected.tokens) ?? props.t('map.none')}</dd>
                          <dt>{props.t('map.session')}</dt>
                          <dd className="dsh-af-map__id">{selected.sessionId}</dd>
                        </dl>
                        <div className="dsh-af__actions">
                          <button
                            type="button"
                            className="dsh-af__button"
                            onClick={() => {
                              props.openDelegation({
                                parentSessionId: brandString<DelegationSessionId>(selected.parentSessionId),
                                childSessionId: brandString<DelegationSessionId>(selected.sessionId),
                                mode: selected.mode ?? 'one-shot',
                              })
                            }}
                          >
                            {props.t('map.open')}
                          </button>
                          <button
                            type="button"
                            className="dsh-af__button"
                            disabled={!selected.hasChildren}
                            onClick={() => {
                              props.expandDelegation(brandString<DelegationSessionId>(selected.sessionId))
                            }}
                          >
                            {props.t('map.expand')}
                          </button>
                        </div>
                      </>
                    )}
              </aside>
            </div>
          )}
    </section>
  )
}
