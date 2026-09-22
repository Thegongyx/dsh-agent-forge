/**
 * The pure core of this package, bundled on its own.
 *
 * Nothing here belongs to the plugin surface: `lib/index.js` is what the Loader
 * mounts and `lib/client.js` is what the page loads. This entry exists so the
 * keyless smoke tests can exercise the rules that decide what agents exist, what
 * a workspace's dispatch rules are, and how a delegation tree is shaped — all
 * without a Cordis context, a browser, or a running harness. `composition.ts`
 * comes along for its renderer: which rows a generated preset carries is a rule
 * of the same kind, and the one whose mistake costs a child its tool catalogue.
 *
 * @module dsh-agent-forge/core
 */

export * from './composition.ts'
export * from './panorama.ts'
export * from './resolve.ts'
export * from './schema.ts'
