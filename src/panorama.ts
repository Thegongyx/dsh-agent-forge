/**
 * Pure derivation of the delegation panorama from session-list facts.
 *
 * Three constraints shape this, and all three come from evidence rather than
 * taste:
 *
 * - **No edges.** Nothing in the durable record says that one delegation depends
 *   on another. Drawing them would mean inventing the relation, and the research
 *   over comparable products agrees: only one of eleven draws a node-and-edge
 *   graph, and that one is a debugger. The tree a session actually has — parent
 *   to child — is the only relation the log carries, so that is what is drawn.
 * - **Granularity stops at agent × task.** A card is one delegated run. Its tool
 *   calls are steps inside the card, never nodes: a single large task can make
 *   hundreds of calls, and a canvas that drew them would be unreadable before it
 *   was useful.
 * - **States are only the ones the data supports.** `running` and not-running
 *   are facts the session list carries. "Waiting for input" is per-session
 *   pending-interaction state that a parent cannot read for its children, so it
 *   is deliberately absent rather than guessed.
 *
 * @module dsh-agent-forge/panorama
 */

/**
 * Separator the dispatch tool writes between the agent name and the task text.
 *
 * The label is the only channel that carries "which configured agent ran this"
 * to the browser: a plugin outside the harness cannot add a session event type,
 * and the durable subagent descriptor records the composed request rather than
 * the definition it came from.
 */
export const DELEGATION_LABEL_SEPARATOR = ' · '

/** One session as the panorama reads it. */
export interface DelegationSubject {
  /** Session id. */
  readonly sessionId: string
  /** Session title, when the list carries one. */
  readonly title?: string | undefined
  /** Whether the session is running a turn right now. */
  readonly running: boolean
  /** The session this one was delegated from, when it is a delegation. */
  readonly parentSessionId?: string | undefined
  /** Milliseconds spent in turns, including the turn in flight. */
  readonly activeMs?: number | undefined
  /** Total tokens the session has used. */
  readonly tokens?: number | undefined
}

/** One delegation edge, as the parent's catalog records it. */
export interface DelegationChild {
  /** Session id of the delegated run. */
  readonly id: string
  /** Whether the run is continuable, when the catalog said. */
  readonly mode?: 'one-shot' | 'continuable' | undefined
  /** Durable creation label the dispatch wrote, when the catalog carried one. */
  readonly label?: string | undefined
  /**
   * Whether this run has delegations of its own.
   *
   * The catalog knows this without the child's own catalog being loaded, which
   * is what lets a card say "3 nested" before anyone expands it.
   */
  readonly hasChildren: boolean
}

/** One delegation on the canvas. */
export interface DelegationNode {
  /** Session id of the delegated run. */
  readonly sessionId: string
  /** The session that delegated it. */
  readonly parentSessionId: string
  /** What the card is titled with. */
  readonly title: string
  /** Agent name the label carried, when it carried one. */
  readonly agent: string | undefined
  /** Task text after the agent name. */
  readonly task: string
  /** Whether the run is in a turn right now. */
  readonly running: boolean
  /** Whether the run is continuable, when the catalog said. */
  readonly mode: 'one-shot' | 'continuable' | undefined
  /** Whether this run delegated work of its own. */
  readonly hasChildren: boolean
  /** Distance below the root session; direct children are 1. */
  readonly depth: number
  /** Milliseconds spent in turns, when recorded. */
  readonly activeMs: number | undefined
  /** Tokens used, when recorded. */
  readonly tokens: number | undefined
  /** This run's own delegations. */
  readonly children: readonly DelegationNode[]
}

/**
 * Splits a delegation label into the agent that ran it and the task text.
 * @param label - the label a dispatch wrote, or `undefined`.
 * @returns the agent name when the label leads with one, and the remaining task text.
 */
export function splitDelegationLabel(label: string | undefined): { agent: string | undefined; task: string } {
  if (label === undefined) return { agent: undefined, task: '' }
  const at = label.indexOf(DELEGATION_LABEL_SEPARATOR)
  if (at <= 0) return { agent: undefined, task: label }
  return {
    agent: label.slice(0, at),
    task: label.slice(at + DELEGATION_LABEL_SEPARATOR.length),
  }
}

/** How deep the walk descends before it stops, so a runaway tree cannot hang a render. */
const MAX_DEPTH = 4

/**
 * Builds the delegation tree under one session.
 * @param rootId - the session to walk from, or `undefined` when none is selected.
 * @param subjects - sessions the list knows about, keyed by id.
 * @param childrenByParent - child ids keyed by parent id, in catalog order.
 * @returns the root's direct delegations, each carrying its own.
 */
export function buildDelegationTree(
  rootId: string | undefined,
  subjects: Readonly<Record<string, DelegationSubject>>,
  childrenByParent: Readonly<Record<string, readonly DelegationChild[]>>,
): readonly DelegationNode[] {
  if (rootId === undefined) return []
  const visited = new Set<string>([rootId])

  const walk = (parentId: string, depth: number): DelegationNode[] => {
    if (depth > MAX_DEPTH) return []
    const children = childrenByParent[parentId] ?? []
    const nodes: DelegationNode[] = []
    for (const child of children) {
      // A cycle would mean the catalog disagrees with itself; skipping is better
      // than recursing until the stack ends.
      if (visited.has(child.id)) continue
      visited.add(child.id)
      const subject = subjects[child.id]
      // The catalog's own label is what the dispatch wrote; the session title is
      // only a fallback for a run whose descriptor carried none.
      const label = child.label ?? subject?.title
      const { agent, task } = splitDelegationLabel(label)
      nodes.push({
        sessionId: child.id,
        parentSessionId: parentId,
        title: label ?? child.id,
        agent,
        task,
        running: subject?.running ?? false,
        mode: child.mode,
        hasChildren: child.hasChildren,
        depth,
        activeMs: subject?.activeMs,
        tokens: subject?.tokens,
        children: walk(child.id, depth + 1),
      })
    }
    return nodes
  }

  return walk(rootId, 1)
}

/**
 * Counts every delegation in a tree.
 * @param nodes - the tree, or one level of it.
 * @returns the total node count.
 */
export function countDelegations(nodes: readonly DelegationNode[]): number {
  let total = 0
  for (const node of nodes) total += 1 + countDelegations(node.children)
  return total
}

/** How many runs under this tree are in a turn. */
export function countRunning(nodes: readonly DelegationNode[]): number {
  let total = 0
  for (const node of nodes) total += (node.running ? 1 : 0) + countRunning(node.children)
  return total
}

/**
 * Groups a tree's nodes by the agent that ran them, keeping tree order.
 * @param nodes - the tree, or one level of it.
 * @returns one entry per agent name plus one for unlabelled runs.
 */
export function groupByAgent(nodes: readonly DelegationNode[]): readonly { agent: string | undefined; nodes: readonly DelegationNode[] }[] {
  const order: (string | undefined)[] = []
  const buckets = new Map<string, DelegationNode[]>()
  const collect = (level: readonly DelegationNode[]): void => {
    for (const node of level) {
      const key = node.agent ?? ''
      const bucket = buckets.get(key)
      if (bucket === undefined) {
        order.push(node.agent)
        buckets.set(key, [node])
      } else {
        bucket.push(node)
      }
      collect(node.children)
    }
  }
  collect(nodes)
  return order.map(agent => ({ agent, nodes: buckets.get(agent ?? '') ?? [] }))
}

/**
 * Renders a duration in whole seconds.
 * @param ms - milliseconds, or `undefined`.
 * @returns a short label, or `undefined` when nothing was recorded.
 */
export function durationText(ms: number | undefined): string | undefined {
  if (ms === undefined) return undefined
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/**
 * Renders a token count compactly.
 * @param tokens - the count, or `undefined`.
 * @returns a short label, or `undefined` when nothing was recorded.
 */
export function tokensText(tokens: number | undefined): string | undefined {
  if (tokens === undefined) return undefined
  if (tokens < 1000) return `${tokens}`
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`
  return `${(tokens / 1_000_000).toFixed(2)}M`
}
