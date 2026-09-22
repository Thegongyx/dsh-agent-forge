# dsh-agent-forge

[中文](README.md) | [English](README_en.md)

A multi-agent forge for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Define named agents once — model, reasoning effort, persona, visible tool set —
then let each workspace decide which agents it offers, which one leads, and how
work is routed between them. A single canvas shows every delegation the run
produced, and each node opens the work behind it.

## Status

Complete and installed. The `agentForge` service resolves the agent list and each
workspace's decisions from the plugin's settings namespace, with three built-in
agents and shipped dispatch rules; built-in copy follows the language chosen in
the app's own language setting. The browser half contributes a settings page (the
agent roster with per-agent model provider, model, reasoning effort, persona,
visible tool set, plugin set, optional preset reference and delegation depth; the
per-workspace selections and rules; the deployment's default routing rules) and a
run canvas that shows every delegation a session made, one card per run, grouped
by the agent that ran it. The mode half contributes the delegation tool, a
subagent provider per agent, and the dispatch-rules injection.

Every surface is verified, the last ones in a real browser: the mode picker offers
the preset, the sidebar entry opens the canvas, the settings page renders the
shipped roster, every tab survives being switched to, the model pickers are filled
from the catalogue route, and a real session composed under this mode carries the
injected dispatch rules in its conversation.

`ARCHITECTURE.md` records every design decision behind this, with the evidence
each one rests on.

## Agents are presets

An agent is not a bag of options passed to a subagent call. Each agent owns a
**composition**, and in dsh a composition is an agent preset, so that is what this
plugin generates:

```
~/.dsh/.agent-presets/<agentId>/preset.yml         how it appears in the picker
~/.dsh/.agent-presets/<agentId>/agent.cordis.yml   the plugin rows it mounts
```

The checkboxes on the settings page write that second file. Checking a plugin adds
a capability to that agent. The tree groups the deployment's roster by function,
leaves out the modules the baseline already supplies — and says how many were left
out, so the list still reads as complete — and lets a whole group be checked at
once. Naming an existing preset in the preset picker makes the checkboxes inert
instead: the agent then runs somebody else's composition verbatim.

The generated file is the **baseline's rows plus the agent's own**, never the
agent's rows alone:

```
agent.cordis.yml = <baseline/agent.cordis.yml rows, embedded as they stand> + <checked plugins>
```

The baseline is a file **this package owns** (`baseline/agent.cordis.yml`): a
persistent shell, native file read/write/search, skills, and web search/fetch —
the set the deployment's `butler` mode uses, minus that mode's persona. Owning it
is the point: an agent's composition must not depend on a preset somebody else may
rename, slim, or not install at all, and `presetRef` on one agent is how a
deployment opts into `standard`, `butler`, or a hand-written preset instead.

Three consequences of "one file per agent, baseline embedded":

- A session joins exactly one standing composition, so a file holding only the
  checked rows would mount no tools at all. Embedding is what DSH leaves
  available: `mount` binds a session's scope to a single standing mount, and
  `cordis:include` names a configuration file for the Loader's root rather than a
  second composition for one agent.
- The embed is verbatim so the baseline's per-service `isolate` realms
  (`isolate: { terminals: true }`) survive; a row that publishes a service outside
  one is refused as process-global.
- The baseline is frozen at the version installed. An upgrade of dsh does not
  change it, and a row added to a future `standard` does not appear here. Edit the
  installed file to tune a deployment's agents, or point an agent at a
  hand-written preset through `presetRef`.

Two consequences worth knowing before checking a box: the plugin cannot tell which
services a package publishes before mounting it, so a checked module that
publishes one is rejected by the preset mount — install such a module as a profile
bundle instead (a `dsh.profile.bundles` entry), where it is composed once for
every session. And an agent whose id matches a preset directory this plugin did
not generate is refused rather than overwritten: rename the agent, or point it at
that preset through `presetRef`.

Delegation stays in **one process**. The mode registers one `ctx.subagents`
provider per agent, named `forge:<agentId>`, and that provider:

1. creates a session through `ctx.agents.create` — created agents inherit no
   preset, which is what makes them composable;
2. selects the agent's preset **before the first turn**, because dsh fixes a
   session's preset once it has started;
3. applies the persona and the tool filter through `applyChildComposition`, and
   enforces the depth cap by resolving the child depth before creating anything;
4. delivers the prompt and reads the final assistant text back.

Going through the subagent seam rather than around it is deliberate: lifecycle
events, the run catalog the canvas reads, cancellation and disposal all keep
working, and only the child's *composition* comes from here.

The per-request model route is unchanged. Provider, model and reasoning effort
still travel as `agentOptions`, and the reasoning-effort options are the levels
the chosen model itself declares.

## Two halves, two planes

The package exports three entry points because one plugin row cannot sit on two
planes:

| Export | Plane | What it contributes |
|---|---|---|
| `.` | Host, inserted by `cordis.patch.yml` | The `agentForge` service and the settings namespace |
| `./mode` | A preset, mounted by `presets/agent-forge/agent.cordis.yml` | The delegation tool, one subagent provider per agent, and the dispatch-rules injection |
| `./client` | The browser, discovered from `dsh.client` | The settings page |

`ctx.tools.register` and `ctx.on` file into the calling context's scope, so the
mode's row contributes only to sessions that joined the mode's preset.
Registering either on the Host plane would put the tool and the routing rules in
front of every session in every mode.

## Install

```sh
npm pack                                  # produce dsh-agent-forge-0.1.0.tgz
dsh plugin --profile web add ./dsh-agent-forge-0.1.0.tgz
node scripts/install-preset.mjs           # place the mode's preset
```

`install-preset.mjs` copies the preset into `~/.dsh/.agent-presets/` and then
checks that its row will resolve. That check matters because the answer is not
the obvious one: dsh resolves a preset's **package** row against the *profile*
(`rowResolves` → `packageInstalled`, an upward `node_modules` walk from the
profile directory), not against the preset's own directory. Asking Node instead
answers `MODULE_NOT_FOUND` and would report a healthy preset as broken — so the
script mirrors dsh's own test, and keeps the row's portable package name.

**Install from the packed tarball, not from the directory.** `dsh plugin add
<directory>` records a `link:` dependency, and Node resolves a symlink's imports
through its *real* path — so the plugin would import `@deepseek-ai/cordis` from
its own `node_modules` instead of the profile's. Cordis identifies its `Service`
base class by module identity, so a second copy breaks the plugin contract
silently. A packed install lands physically in
`~/.dsh/profiles/web/node_modules/`, where resolution walks up to the same tree
every other bundle uses.

You can confirm that after installing:

```sh
node -e "console.log(require('module').createRequire('$HOME/.dsh/profiles/web/node_modules/dsh-agent-forge/lib/index.js').resolve('@deepseek-ai/cordis'))"
```

It must print the same path as it does for a bundle you know works.

**A tarball install is a snapshot, and re-adding the same tarball is a no-op.**
pnpm decides by path and version, prints "Lockfile is up to date, resolution step
is skipped", and copies nothing. After rebuilding, remove and re-add, then compare
byte sizes:

```sh
npm run build
npm pack
dsh plugin --profile web remove dsh-agent-forge
dsh plugin --profile web add ./dsh-agent-forge-0.1.0.tgz
```

The install registers the Host row through `cordis.patch.yml` and ships the
browser bundle through `dsh.client`. Bundle membership is read at startup, so
restart the profile and reload the page.

The preset directory is what makes the mode appear in the new-session mode
picker. `~/.dsh/.agent-presets/` is scanned by default, and preset discovery
re-reads the roots on every list, so a preset added there shows up without a
restart — only the package install itself needs one.

## Build

```sh
npm install --ignore-scripts
npm run check             # typecheck, build all faces, then the keyless smoke suites
npm run check:installed   # the above, plus the installed-environment suite
npm run build             # writes lib/index.js, lib/core.js, lib/mode.js, lib/client.js
npm run watch             # rebuild every face on change
npm run typecheck         # both compiler faces
npm run smoke             # artifacts, resolution, the page, the panorama, the locale, and the DOM
npm run smoke:installed   # mounts the installed package against the harness's own cordis
npm run smoke:browser     # boots a throwaway harness and drives the UI in headless Chromium
npm run probe:session     # one real session in this mode, then reads its transcript
```

`smoke:installed` and `smoke:browser` need the package installed into the profile,
which is why they are separate from `check`; `check:installed` runs the lot.
`probe:session` is deliberately never automatic: it spends a real model call. It
exists because two failure modes are invisible to every offline suite: a plugin
that does not survive being mounted by the harness's real Cordis, and a settings
namespace that real schemastery refuses to register. Neither produces any output
in this deployment — the harness's logger has no exporter — so a failed mount
looks exactly like a page that renders nothing.

The browser half is covered at two levels. A server render checks what a given
snapshot draws; a jsdom mount through `react-dom/client` checks what a *mounted*
page does, which is the only way to observe an effect that runs after mount or an
interaction that changes what is drawn. Both matter here: the run canvas asks the
host for a delegation catalogue on mount, because the session list carries none
until something asks for one.

`npm install` needs `--ignore-scripts` because the DSH file sandbox refuses the
piped stdio that npm's lifecycle scripts use. esbuild's platform binary arrives
through its optional dependency, so nothing is missing.

The repository's own client preset resolves its target through the package
manifests inside the harness checkout, so a package outside it cannot use that
preset. `scripts/build.mjs` reproduces the contracts it owns: the Host half is
ESM with every harness specifier external, and the browser half is a CommonJS
factory registered through `window.__ModuleLoader__.load(...)` with exactly the
shell's platform modules external.

`lib/core.js` is the pure resolution core, bundled separately so the smoke test
can exercise the agent and workspace rules without a Cordis context. It is not
part of the plugin surface — `lib/index.js` is what the Loader mounts.

