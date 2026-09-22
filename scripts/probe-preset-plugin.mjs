/**
 * One-shot probe for the load-bearing primitive of the single-process design.
 *
 * It answers, inside a real dsh process: can a plugin create an agent, compose it
 * from a *different* preset than its context inherits, and observe the result?
 * Everything else in the plan (per-agent plugin sets, cross-session dispatch)
 * rests on that answer, so it is verified before any feature code is written.
 *
 * Loaded as a loader row by absolute path; writes its findings to the file named
 * by `FORGE_PROBE_OUT` and prints them, then leaves the run alone.
 *
 * @module dsh-agent-forge/scripts/probe-preset-plugin
 */

import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

export const name = 'forge-preset-probe'
export const inject = ['agents', 'agentPresets']

/**
 * Runs the probe once the injected services are ready.
 * @param ctx - the plugin's context.
 */
export function apply(ctx) {
  const out = { steps: [] }
  const finish = () => {
    const text = JSON.stringify(out, null, 2)
    if (process.env.FORGE_PROBE_OUT !== undefined) writeFileSync(process.env.FORGE_PROBE_OUT, text, 'utf8')
    process.stdout.write(`FORGE-PROBE ${text}\n`)
  }
  // Deferred on purpose: composing an agent from a preset inside `apply` ran
  // against an inactive context ("cannot create effect on inactive context"),
  // because the runtime is still assembling itself at that point. The delay only
  // has to outlast startup; the probe stops at the first preset that mounts.
  const timer = setTimeout(() => { void run() }, Number(process.env.FORGE_PROBE_DELAY_MS ?? 4000))
  ctx.effect(() => () => { clearTimeout(timer) }, 'forge-preset-probe: deferral')

  const run = async () => {
    try {
      const presets = await ctx.agentPresets.list()
      out.presets = presets.map(preset => preset.id)

      // One fresh agent per preset: `select` refuses a session that has already
      // been composed, so reusing one agent would only ever test the first.
      out.attempts = []
      for (const preset of presets) {
        const attempt = { preset: preset.id }
        let childCtx
        let child
        const handle = await ctx.agents.create({
          sessionId: randomUUID(),
          setup: (createdCtx, created) => {
            // `setup` is the only place the child's own context is handed over,
            // and it is what the in-process driver uses to compose a child.
            childCtx = createdCtx
            child = created
          },
        })
        attempt.created = handle.agent.id
        attempt.setupRan = child !== undefined
        // A created agent inherits no preset; that is what makes it composable.
        attempt.composedBefore = childCtx === undefined ? null : (ctx.agentPresets.composedPreset(childCtx) ?? null)
        try {
          // Must happen before the session runs a turn: a started session's preset is fixed.
          await ctx.agentPresets.select(child, preset.id)
          attempt.composedAfter = ctx.agentPresets.composedPreset(childCtx) ?? null
          attempt.ok = attempt.composedAfter === preset.id
        } catch (error) {
          attempt.ok = false
          attempt.error = error instanceof Error ? error.message : String(error)
        }
        out.attempts.push(attempt)
      }
      out.ok = out.attempts.some(attempt => attempt.ok === true)
    } catch (error) {
      out.ok = false
      out.error = error instanceof Error ? `${error.message}` : String(error)
    }
    finish()
  }
}
