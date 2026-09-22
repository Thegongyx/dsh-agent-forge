# dsh-agent-forge — 架构决策

本文记录基于对 dsh `0.1.5-rc.2` 源码侦察得出的实现决策，以及每条决策的证据和代价。
所有 `路径:行号` 相对 `deepseek-harness/`，取自当前检出。

---

## 0. 需求回顾

1. 提供独立于「标准模式 / 创造模式」等既有模式的新模式。
2. WebUI 中创建与管理 agent：默认模型、思考强度、persona、可见工具集。
3. 工作区级配置：启用哪些 agent、默认主 agent、本工作区自己的任务分派规则；各工作区互不冲突；规则开局即进入模型上下文。
4. 多 agent 工作全景图：展示分派流转，节点可点击查看每个 agent 的工作详情。
5. 未配置时默认三个 agent（挥金如土 / 缝缝补补 / 看图说话）与默认分派规则。
6. 文案跟随系统语言。

---

## D1. 「模式」= 一个壳 preset

### 决策

新建一个 preset 目录（`agent.cordis.yml` + `preset.yml`），`agent.cordis.yml` **只有一行**，指向本插件：

```yaml
- id: agent-forge
  name: dsh-agent-forge
```

`preset.yml`：

```yaml
name: 多智能体模式
description: 由工作区配置驱动的多 agent 协作模式。
order: 5
```

### 为什么不是别的

dsh **没有模式注册表**。全仓搜索 `registerMode` / `modeRegistry` / `ModeRegistry` 零命中。
UI 上那个「模式选择器」列的就是 preset roster：

- `packages/client/ui-agent-preset/src/client/locales.ts:105,111` —— `presetStandardName: '标准模式'`、`presetCordisName: '创造模式'`
- `packages/client/ui-conversation/src/client/contract/slots.ts:163` —— `'conversation.hero.agentPreset'` 槽
- `packages/preset/agent-presets/src/discovery.ts:37` —— `COMPOSITION_FILE = 'agent.cordis.yml'`

要出现在那个选择器里，只有两条路：**本身是一个 preset**，或用不同 priority 遮蔽内置 chip 组件（等于替换产品 UI）。选前者。

### 为什么这不违反「模式不管理插件加载」

壳 preset **不枚举任何工具、插件或 persona**。全部组合由本插件在运行时读取工作区配置驱动。
preset 只是「出现在选择器里」所需的身份载体。

### 代价与约束

- **模式一旦跑过一轮就锁死**：`packages/preset/agent-presets/src/index.ts:731` 的 `swap()` 检查 `turnBoundary`，抛 `agent-preset/locked`。切模式 = 新建会话。这是 dsh 既有语义。
- **preset 是 per-preset 常驻挂载，不是每会话实例**：`mount.ts:378` 的 `mountPreset` 按 preset 建立 subfiber，多个 agent join 同一实例。本插件必须把 per-session 状态按 `Session` / `Agent` 键控。
- **在 preset 里 `provide()` 服务必须包 `isolate` realm**，否则 `mount.ts:407` 的审计拒绝挂载。壳 preset（`presets/agent-forge/`）在 preset 作用域内**不发布服务**（服务在 host 面）。生成的组合则是**本插件自带的基线文件（`baseline/agent.cordis.yml`）原样内嵌 + agent 自己勾选的行**：基线里那个 PTY 组自带的 `isolate: { terminals: true }` 随内嵌一起保留，所以内嵌是安全的。`isolate` 是「服务名 → realm 标签」的映射，写 `isolate: true` 这种布尔值**不会隔离任何东西**（`cordis-plugin-loader` 的 isolate 钩子读的是 `entry.options.isolate?.[name]`）。勾选的行放进一个不声明 realm 的 group，因此**勾一个会 `provide()` 服务的包会让整份组合挂载失败**——这种包应当装成 profile bundle（`dsh.profile.bundles`），对所有会话生效，而不是塞进某个 agent 的组合。
- **基线归本插件所有，不跟随部署的 preset**：早期版本复制 `standard` 的行，于是每个 forge agent 的能力集取决于别人会不会改名/裁剪/不装那份 preset。现在基线是本包的一个文件（`package.json` 的 `files` 里显式列出），运行时以 `new URL('../baseline/agent.cordis.yml', import.meta.url)` 读取，`presetIdOf()` 退化成 `presetRef ?? agent.id`——**roster 里不需要存在任何 preset**，host 半也不再依赖 `agentPresets` 服务（`syncPresets` 因此从 async 变回同步）。代价是基线随包冻结：升级 dsh 不会更新它，未来 `standard` 新增的行也不会自动出现；要调就改这个文件后重新打包，或用某个 agent 的 `presetRef` 指回现成 preset。
- **基线刻意不设 `complete: true` / `includeRuntimeContext: false`**：后者会调 `suppressRuntimeContext()`，而抑制沿作用域链生效，会把 `dsh-subagent` 为子代理注入的「权限已固定、被拒绝的操作不要重试」那段一起抹掉。基线里的 persona 行对子代理也基本无意义——委托 persona 用同一个 section 名（`deployment:persona-prefix`）且作用域更近，会遮蔽它；它是给人手动选这个模式时读的。
- **每个 agent 都用自己 id 命名的 preset，于是有了覆盖风险**：`writePreset` 现在会先读目标目录的 `preset.yml`，若其中没有生成标记（即不是本插件写的）就**拒绝写入并抛错**，`syncPresets` 逐 agent 捕获并只记一条 warn——一个 agent 的失败不影响其余 agent，也不会覆盖用户手写的同名 preset。
- **preset 目录发现不缓存**（`index.ts:99` 注释：`Discovery is unmemoized`），所以新增 preset 目录**不需要重启**就能在选择器出现。但插件包本身的安装需要重启（bundle 成员启动时读取）。

---

## D2. Agent 定义与工作区配置 → 一个 settings 命名空间

### 决策

命名空间 **`agent-forge`**（匹配 `settings/src/index.ts:20` 的 `/^[a-z][a-z0-9-]*$/`；已核对不在已占用清单内）。

```ts
interface AgentForgeSettings {
  /** 全局可复用的 agent 定义。 */
  agents: Record<string, AgentDefinition>
  /** 按工作区 id 的配置。 */
  workspaces: Record<string, WorkspaceAgentSettings>
  /** 找不到工作区配置时的回退分派规则。 */
  fallbackDispatchRule: string
}

interface AgentDefinition {
  label: string            // 用户可改的显示名；内置默认值来自 locale 字典
  description: string
  persona: string          // 子 agent 的角色指令（model-visible）
  model?: { provider: string; model: string }
  reasoningEffort?: string
  tools?: { allow?: string[]; deny?: string[] }
  maxDepth?: number
  builtin?: boolean        // 三个内置 agent，可改但不可删
}

interface WorkspaceAgentSettings {
  enabled: string[]        // 该工作区启用哪些 agent
  lead: string             // 默认主 agent
  dispatchRule: string     // 本工作区的任务分派规则（model-visible）
}
```

### 为什么是 settings 而不是 storage domain

| | settings | storage domain |
|---|---|---|
| 浏览器读写通道 | ✅ `ctx.settingsScope` + `settings.plugin.item` | ❌ 完全没有 |
| 仓库改动 | 零（官方 cookbook：`docs/cookbook/adding-a-settings-card.md`） | 零，但要自建传输 |
| revision 冲突栅 / 脱敏 / 热重载 | ✅ | ❌ |
| 按工作区分文件 | ❌ 单文档 | ✅ |

「按工作区一份」用**命名空间里的一个 `z.dict(...)` 字段**表达。真实先例：`packages/llm/llm-pi-ai/src/config.ts:348-349` 的 `providers: z.dict(profile)`。

### 代价

**单文档：所有工作区的写共享一个 revision。** 两个浏览器标签同时编辑不同工作区会撞 revision。可接受（概率低、可重试），但要记在案。

### 如何从 session 求工作区

Host 侧**没有** `ctx.workspaces`，只有 `ctx.workspaceRegistry`（`packages/workspace/workspace/src/index.ts:66-70`），且**没有现成 helper**。用：

```ts
const workspace = await ctx.workspaceRegistry.resolveByPath(agent.session.header.cwd)
```

（`index.ts:276`；`cwd` 在 `packages/core/session/src/types.ts:104` 是 optional。）

---

## D3. 分派规则注入 → 带来源标记的 `user/message`

### 决策

监听 `agent/pre-step`（waterfall），在第一步注入一条 `user/message`：

```ts
source: { kind: 'agent-forge/dispatch-rules', form: 'instructions', workspaceId, revision }
```

并通过 `MessageSourceMap` 声明合并注册这个 source kind。

### 为什么不是 system prompt section

两个硬原因：

1. **`systemPrompt.section()` 的 `text` 是同步的** —— `packages/core/system-prompt/src/index.ts:66` 的类型是 `string | ((context) => string)`。
2. **assembly 发生在 pre-step 瀑布之前** —— `agent-loop/src/agent.ts:245` 先 assemble，`:249` 才 waterfall。

所以**异步读工作区配置的内容无法可靠进入第一步的系统提示词**。这正是 `dsh-agent-instructions` 选择注入 user message 的原因。

### 为什么这条通道满足「模型可见 ⟺ 已记录」

loop 在 `agent-loop/src/agent.ts:373-377` 把 `decision.messages` 落成 `user/message` session 事件：

```ts
if (firstAttempt) {
  for (const message of decision.messages) {
    this.session.append('user/message', message, { surfaceOp: 'append' })
  }
}
```

`user/message` 的 JSDoc（`packages/core/session/src/types.ts:290`）明确说它承载「synthetic `agent.inject()` context」，区分靠 `source`。
**无需新增 `SessionEventMap` 成员** —— 这不只是省事，而是必须：外部插件发明的 session 事件类型会让持久化读回拒绝整份日志（`packages/session/session-persistence/src/storage-contract.ts:74` 的 `KNOWN_SESSION_EVENT_TYPES` 检查，而 `Session.append()` 无法设置 `ignorable`）。

### 必须做的去重

照 `packages/skill/tool-skill/src/index.ts:328-378` 的 digest 模式，只在规则内容或工作区变化时重新注入，否则每步都追加。

---

## D4. 派发工具 → `ctx.subagents` + agent 定义

### 决策

Host 半注册模型可见工具（如 `forge_agents` / `forge_dispatch`），`inject: ['tools', 'subagents']`：

```ts
ctx.tools.register(defineTool({
  name: 'forge_dispatch',
  parameters: { agent: {...}, prompt: {...}, background: {...} },
  output: { schema: {...}, render: (args, value) => ContentBlock[] },
  async execute(args, exec) { /* 查定义 → ctx.subagents.startContinuable(...) */ },
}))
```

从 agent 定义组装 `SubagentStartRequest`：

| 定义字段 | 请求字段 |
|---|---|
| `persona` | `persona` |
| `tools.allow` / `tools.deny` | `toolFilter` |
| `maxDepth` | `maxDepth` |
| `model` + `reasoningEffort` | `agentOptions` |

### capability 陷阱

`ctx.subagents.start()` **在启动前校验 provider 的 capability 位**（`packages/subagent/subagent/src/index.ts:641-657`）。请求里出现了 provider 不支持的字段会抛 `UNSUPPORTED_CAPABILITY`，**且不会静默降级**。

- 进程内 `spawn` / `fork` 支持全部三项（`persona` / `toolFilter` / `depthLimit`）。
- 外部后端（`acp` / `codex` / `claude-code` / `dsh-sdk`）只宣告它们能执行的。
- 已知不对称：**continuable 路径不检查 `depthLimit`**（`continuation.ts:107-110` 由 manager 自算深度）。

本插件必须在派发前做 capability 预检并给出可读错误，而不是把 `UNSUPPORTED_CAPABILITY` 直接抛给模型。

### 一条已知缺口

`SubagentStartRequest` **没有任何指定 preset（agent 类型）的字段** —— 子 agent 的 preset 硬编码为继承父级（`packages/subagent/subagent/src/child-agent.ts:144`）。

所以本插件的「agent 类型」≠ dsh 的 preset，而是**请求级的 `persona` + `toolFilter` + `agentOptions` 组合**。这是设计上必须向用户说清的边界：agent 定义能改的是「角色、模型、可见工具」，不能换掉整个插件组合。

---

## D5. 客户端 UI 挂点

### 配置台 → `settings.section`（整页）

`kind: 'list'`、`scope: 'root'`、owner props 只有 `{ close }`。一个 list 条目 = 设置面板里的一整页，正是「管理台」需要的尺寸。

```ts
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: 'agent-forge',       // 必须是新 id
  order: 50,
  label: () => t('nav'),
  locale: NS,
  inject: () => ({ t }),
}, AgentForgeSection))
```

页面内部用**普通 `useState` 做标签页**（agents / workspaces / dispatch rules），这是 `dshmarket` 已验证的做法（`MarketSection.tsx` 的 Discover/Favorites/Themes/Installed 就是纯 `useState` + sessionStorage，不走 slot 机制）。

⚠️ **`id` 必须避开已占用者**：`agent-presets` / `general` / `models` / `plugins`。撞 id 会**替换掉 shipped 的设置页**（list slot 按 id 去重）。

⚠️ **root scope 没有 `useSession` / `useProjection`**。只有 `GlobalStandardProps`（`useSessions` / `useWorkspaces`）。这够用：用 `useWorkspaces` 列工作区，用 `useSessions(s => s.current)` + `items.find(i => i.sessionIds.includes(current))` 反查当前工作区。

读写走 `ctx.settingsScope.bind({ namespace: 'agent-forge' })`，写用 `scope.mutate([{ op: 'set', path: ['workspaces', workspaceId, 'dispatchRule'], value }], revision)`（revision 由 scope 自带）。

三个 `dshmarket` 取证到、但 catalog 未列的注册选项：`label: () => t('nav')`、`locale: NS`、`inject: () => ({...})`。

**可选叠加**：再注册一个 `settings.plugin.item` 卡片（`key: 'agent-forge'`）指向同一份数据，让用户在 Settings → Plugins 里也能看到。非必需，P2 先不做。

### 全景图 → `main`（keyed, root）+ `sidebar.panellist` 入口

```ts
// 入口图标
{ name: 'sidebar.panellist', id: 'agent-forge-map', label: () => t('nav.map') }
// 面板本体
{ name: 'main', key: 'agent-forge-map' }
```

catalog 明文说明 panellist 的每个 list id 对应**同名** main panel —— 两个 id 必须一致。切页用 `ctx.layout.selectPanel(id)`（`packages/client/ui-layout/src/client/service.ts:29-34`，未注册的 key 会 **throw**，所以要先注册 main 再切）；读当前页用 `usePanelInfo(info => info.activePanelId)`。

这两个 slot **当前都无占用**，且是 shipped 组合里唯一「root 级 + additive + 全尺寸中央视图」的一对。

**`main` 的 key 不能是 `conversation`** —— 那个 key 已被 `main.conversation` 占用，顶掉等于整个对话区消失。

**节点详情**先做成 `main` 页内的左右分栏（右侧详情由 React 本地 state 驱动），P4 若需要再升级到 `sidebar.right.pane.tab`（右栏 tab，需要两步注册：先 `ctx.sidebarRight` 注册 tab 类型，再注册 body）。

**绝对不要碰** `root` / `sidebar` / `rightbar` / `rightbar.session` / `main.conversation` —— 都是 `single` 且已占用，注册会 **shadow** 而非并列，结果是只剩你的组件、它声明的所有子 slot 全部消失。catalog 对 `root` 有明文 `DO NOT register here`。

### 全景图数据：不需要新 RPC

| 数据 | 来源 |
|---|---|
| 每个 parent 的直接子目录 | `useSessions(s => s.subagentsByParent)` → `SubagentCatalogSnapshot` |
| 会话身份 / 运行态 / 血缘 | `useSessions(s => s.byId)` → `title` / `running` / `origin` / `parentSessionId` / `projectionValues` |
| 子 agent 投影 | `projectionValues.subagentCatalog` / `.subagentTiming` / `.subagent` |

⚠️ **一处真实不一致**：`ui-subagent` 读 `summary.parentId`，但权威类型 `SessionSummary` 的字段是 **`parentSessionId`**（`packages/api/session-controller/src/types.ts:163-172`）。本插件用后者。

`subagent/catalog` 与 `subagent/descriptor` 这两个 session 事件**不能按事件名在客户端直接读**，只能经由上面三个投影。

### 画图

shell 注入的共享模块表只有 9 个（`packages/client/web/src/platform.ts:8-14`）。**第三方图库必须 inline 进 bundle**（ReactFlow 等不在表里）。仓库内没有现成节点图组件可复用；最接近的是 `ui-trajectory` 的时间轴（绝对定位 span + CSS 变量），可借鉴模式而非代码。

`dsh-client-bundle-purity` 门禁只拦 `@deepseek-ai/*` 前缀且只在仓库的 tsdown preset 内生效，**不约束本包的外置构建**。

---

## D6. 默认三 agent 与默认分派规则

未配置时（`agents` 为空）种子写入三个内置定义：

| id | 中文名 | 定位 | 默认绑定 |
|---|---|---|---|
| `spendthrift` | 挥金如土 | 重要任务：架构决策、复杂重构、深度分析 | 模型**继承** |
| `patchwork` | 缝缝补补 | 低价值但费 token 的批量活：机械改写、批量检索、样板填充 | 模型**继承** |
| `sightreader` | 看图说话 | 多模态：截图判读、图表理解、UI 视觉核对 | 模型**继承** |

默认分派规则参考 ohmyopenagent 的职责划分，写成一段可编辑的提示词，要点：先判定任务性质 → 重要/高风险交 `spendthrift`；量大利薄交 `patchwork`；含图像或视觉判断交 `sightreader`；无法归类时交主 agent。

**模型一律留空 = 继承当前会话模型。** 理由：当前部署的 provider（`lemonade`）模型列表里没有任何从名字可判定为多模态的条目，猜错比留空更糟。用户在配置页里显式绑定。

---

## D7. i18n

| 面 | 做法 |
|---|---|
| 客户端 UI 文案 | `ctx.locale.register(NS, { zh, en })` + `t` seat。字典扁平 `Record<string, string>`，支持 `{name}` 插值，无嵌套无复数 |
| 内置 agent 的 label / description | 走 locale 字典（随语言变） |
| 内置 agent 的 persona、默认分派规则 | **model-visible 文本**，需要中英两版，按生效语言选择 |
| 用户自建 agent 的文本 | 原样存储、原样渲染（那是数据，不是文案） |
| Host 侧文案 | 无官方 i18n，用 `Config` 承载 |

「跟随系统」是 dsh 的默认行为而非一个选项：`preference` 缺省时按 `navigator.languages` 探测，兜底 `en`（`packages/client/locale/src/client/index.ts:496-528`）。用户一旦在设置里显式选过语言，UI 上没有「回到跟随系统」的入口（只能清掉 `locale.preference`）。

**Host 拿不到浏览器语言。** 桥接方案：客户端半边在 apply 时把解析后的生效语言写进本插件命名空间的一个字段（如 `effectiveLocale`），Host 读它来决定内置 persona / 规则的语种。这是刻意的单向派生，不引入第二个真相源。

外部插件**不受** `verify-client-ui-i18n` 门禁约束（该脚本只 glob 仓库内 `packages/**`），但规范上仍走字典，否则切语言时本插件 UI 不跟随。

---

## D8. 分期

| 期 | 内容 | 验证方式 |
|---|---|---|
| **P1** ✅ | 包骨架、双半区构建链、产物契约测试 | `npm run check` 全绿 |
| **P2a** ✅ | Host 侧：settings 命名空间 + `agentForge` 服务 + 内置三 agent + 纯解析核心 | `npm run smoke` 覆盖解析规则与跨字段校验 |
| **P2b** ✅ | 客户端配置页：agent 名单 + 编辑器（模型 / 强度 / persona / 工具 / 深度）+ 默认规则 | `npm run smoke-client` 用 `react-dom/server` 真渲染并驱动写入 |
| **P3b** ✅ | 分派规则注入：`agent/pre-step` + 带来源标记的 `user/message`，去重从日志反推 | `npm run smoke-mode` 覆盖注入、去重、子 agent 跳过、resume 不重复 |
| **P3c** ✅ | 派发工具：按 agent 定义组装 `persona` / `toolFilter` / `maxDepth` / `agentOptions` | `npm run smoke-mode` 覆盖请求组装与 capability 预检 |
| **P3a** ✅ | 工作区配置页：选择工作区、勾选启用哪些 agent、指定主 agent、本工作区规则 | `npm run smoke-client` 覆盖写入链路与「继承 vs 自定义」的投影 |
| **P4** ✅ | 全景图：`main` 面板 + `sidebar.panellist` 入口 + 卡片详情 | `npm run smoke-client` 渲染画布并驱动两个动作；`npm run smoke` 覆盖树/分组/环/深度 |
| **P5** ✅ | 语言跟随系统：Host 读 dsh 自己的语言设置 | `npm run smoke` 覆盖偏好解析与两个字符串常量 |
| **安装** ✅ | 已装入 `~/.dsh/profiles/web`，构建产物与本地**逐字节一致** | 见下「加载验证」 |

### 语言跟随系统：读 dsh 自己的设置，不发明第二个通道

Host 侧**没有** locale 服务（官方 i18n 只在浏览器半边），所以内置 agent 的 persona 和默认分派规则需要一个语言来源。两个做法里我选了不侵入的那个：

- ❌ 让浏览器把自己解析出的语言**写进本插件的命名空间** —— 会把派生事实混进用户可编辑的配置文档，`describe()` 里还会显示成「用户覆盖过」。
- ✅ **读 locale 插件自己持久化的 `locale.preference`** —— 浏览器本来就跟随这个字段，Host 读同一个。没有第二个真相源，也不碰别人的命名空间。

命名空间与字段名在本包里**拼写为字面量而非 import**：locale 是浏览器包，Host 半边为两个常量去依赖浏览器面是不划算的。代价是 dsh 若改名我这边静默失效 —— 所以测试里**钉死了这两个字符串**，改名会红。

**残余缺口说清楚**：没有存偏好时浏览器回退到 `navigator.languages`，而 Host 看不到它。所以「显式选过语言」时两边必然一致；没选过时 Host 用行配置的 `builtinLocale`。

### 加载验证：在真实进程里跑过

离线测试证明不了「dsh 真的能把它挂起来」。所以在**不干扰正在运行的 3080** 的前提下起了一个临时实例：

```sh
dsh --profile web --no-open --port 0     # 0 = 让 OS 挑空闲端口
```

然后带 token 抓取 index HTML，检查浏览器实际收到的 boot graph：

- `dsh-agent-forge/client.js` 出现在**预加载批次**的 combo URL 里，与 `dshmarket` / `dsh-free-search` 并列
- 它还有自己的 bootstrap 批次：`/plugins/??dsh-agent-forge/client.js&rev=8f894ad9419d7705-44`
- 直接 GET 该 URL 返回 **200**，开头是 `window.__ModuleLoader__.load({ id: "dsh-agent-forge", ...`
- 内容里含**最近两轮才加的标记**（`map.hasChildren`、`workspaces.inherited`、`agent-forge-map`、`sidebar.panellist`、`dsh-af-map__card`），证明服务的是当前构建

这证明了一条完整链路：Host 行挂载 → `dsh.client` 清单被解析 → `./client` 导出解析到产物 → 浏览器拿到真实内容版本号。

抓下来的字节数比本地多 53 字节，原因是 dsh 把尾部 sourcemap 注释重写成了插件路由 —— 差值恰好等于注释长度之差，不是内容陈旧。

### 日志在这个部署里是静的，所以「无报错」不是证据

Cordis 的级别映射是 `error=0, info=1, warn=2, debug=3`，过滤条件是「阈值 < 级别则跳过」，默认阈值 1 —— 按代码 `info` 本该打印。但实测：

- 启动的 stdout/stderr 只有 CLI 那一行 URL；
- 连仓库自己的 `include` 插件那行 `ctx.logger.info("watching …")` 也没出现（而 `patchReload: live` 是开着的）；
- 全仓搜不到任何 logger 级别配置。

结论：**这个部署没有注册 logger exporter**，所以日志整体静默。两个推论：

1. 插件挂载时打的日志（本包在 Host 与 mode 各留了一行）在当前部署里**看不见** —— 它们语义正确、将来装了 exporter 就有用，但**不能当作验证手段**。
2. 更要紧的是：**「启动无报错」什么也证明不了**，因为报错同样不会打印。

### 真正可用的验证：用真实的 Cordis 手动挂载

绕开 harness 启动，直接用**它自己的** Cordis 实例挂载插件 —— 这也是最强的离线证据：

```js
const require = createRequire('<profile>/node_modules/dsh-agent-forge/lib/index.js')
const cordis = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
```

用 `createRequire` 从**插件自己的位置**解析 cordis，拿到的就是 harness 那份实例（实测与 `dshmarket` 一致）。然后：

1. 挂载 Host 半区 → 实测 `ctx.get('agentForge')` 返回 `AgentForge`，`listAgents()` 给出 `spendthrift/挥金如土, patchwork/缝缝补补, sightreader/看图说话`，`workspace(undefined)` 解析出 423 字的默认规则，`settings()` 在**没有 settings provider** 时正确回退到组合层。
2. 只替身 `tools` 与 `subagents` 两个服务，挂载 mode 半区 → 实测工具以配置的名字注册，`execute()` 走完「查定义 → 组装请求 → `subagents.start` → 扁平化结果」，标签是 `缝缝补补 · rename the files`（带 agent 前缀，正是画布分组的依据），persona 是 patchwork 的中文内置文案。

这覆盖了 `lib/index.js` 与 `lib/mode.js` 的全部运行期契约，只差浏览器里的渲染。



### 全景图的四个实现决定

**1. 不画连线。** 持久记录里**没有任何**「A 依赖于 B」的事实。画出来就是编造关系。产品调研也支持这个判断：十一个同类产品里只有一个画节点-边图，而那个是调试器。会话真正拥有的关系只有父子，所以只画这个。

**2. 粒度停在「Agent × 任务」。** 一张卡 = 一次委派。它的工具调用是卡内的步骤，永远不是节点 —— 一个大任务可能有几百次调用，画出来的图在变得有用之前先变得不可读。

**3. 状态只画数据支持的。** `running` 与否是会话列表携带的事实；「等待人输入」是每个会话自己的 pending-interaction 状态，父会话读不到子会话的这个值 —— 所以它**刻意缺席**，而不是猜一个。

**4. 时间从记录的轮次边界算，不读时钟。** `subagentTiming.active.{since,through}` 是同一截面的记录值，所以整棵树的推导是 snapshot 的纯函数，`useMemo` 不会因为一次无关重渲染给出不同的数字。

### 三条被 0.1.5-rc.2 的**已安装**类型纠正的判断

侦察报告说的是源码检出，而源码检出与已安装包在几处并不一致。以下以**已安装**的为准：

| 侦察报告 | 实际（已安装） | 影响 |
|---|---|---|
| 客户端 `SessionSummary.parentSessionId` | **`parentId`** | 报告引用的是 Host 侧**同名但不同定义**的类型；客户端类型用的是 `parentId` |
| `subagentCatalog` 投影给逐条子项 | `subagentsByParent` 的 `entries` 是 **`SubagentListEntry`**，`child` 与 `diagnostic` 的联合 | 必须按 `kind === 'child'` 过滤，否则把「读不出来」的诊断行画成一次委派 |
| 需要从会话标题推委派标签 | `SubagentListEntry` 自带 **`label`** 与 **`hasChildren`** | 用 durably 记录的 label 比用标题准；`hasChildren` 让卡片在展开前就能说「有下级委派」 |

另外 `tokenUsage` 投影来自 `@deepseek-ai/dsh-token-meter`，不装它就只是 `Partial<SessionProjectionMap>` 上一个不存在的键。

### 必须拆编译器面

Host 与 Client **不能共用同一个 tsconfig**。`@deepseek-ai/dsh-session`（Host 包）声明 `ctx.sessions: SessionStore`，而 `@deepseek-ai/dsh-api-session-controller/client` 声明 `ctx.sessions: ISessions` —— 单 program 下 Host 的增强会泄漏进客户端检查，`ctx.sessions` 直接变成错误的那个类型。所以本包用 `tsconfig.host.json` / `tsconfig.client.json` 两个叶子加一个 solution-only 根，与仓库做法一致。同理，客户端需要 `SessionId` 时**从 `ISessions` 派生**而不是从 `dsh-session` 导入。

### 安装是快照，不是链接

tarball 安装把包**复制**进 profile，所以每次重新构建后都必须重装。而且 **`pnpm add <同一路径的 tarball>` 是空操作** —— 它按路径与版本判缓存，会打印 "Lockfile is up to date, resolution step is skipped" 然后什么都不做。正确姿势是先 `remove` 再 `add`，并**逐字节比对**安装产物与本地产物：

```sh
npm pack
dsh plugin --profile web remove dsh-agent-forge
dsh plugin --profile web add ./dsh-agent-forge-0.1.0.tgz
# 然后比对 lib/*.js 的字节数，不同就是没生效
```

### preset 行名：由 **profile** 解析，不是 preset 目录

preset 的行 `name` 是模块说明符。对**包名**，dsh 走 `rowResolves` → `packageInstalled(specifier, harnessBase)` —— 一次从 **harnessBase（即 profile 目录）**向上的 `node_modules` 查找。只有 `file:` 与相对说明符才相对 preset 自己的目录解析。源码注释把意图写得很直白：「every plugin a preset names is installed beside the roster」。

**这里有个坑，我自己踩了。** 我一开始用 **Node 自己**从 preset 目录解析来验证，得到 `MODULE_NOT_FOUND`（`.agent-presets/` 向上的路径确实不经过 profile），于是判定「裸包名不可用」，改成把安装副本的行名重写为机器相关的绝对路径。**但 dsh 根本不问 Node 这个问题** —— 那个测试测的是另一套机制，结论是错的。

权威验证方式是直接跑 dsh 自己的发现函数：

```
discoverPresets(
  [{ path: SHIPPED_PRESET_ROOT, trust: 'system' },
   { path: '~/.dsh/.agent-presets', trust: 'user' }],
  pathToFileURL(profileDir).href,      // harnessBase 必须是 file URL
)
```

实测输出（6 个 preset 全部 `OK`，无一 `broken`）：

```
OK  standard     trust=system  name="标准模式"
OK  ptc          trust=system  name="PTC 模式"
OK  minimal      trust=system  name="极简模式"
OK  cordis       trust=system  name="创造模式"
OK  agent-forge  trust=user    name="多智能体模式"
OK  butler       trust=user    name="助手模式"
```

所以行名保持**可移植的包名**，不写机器路径。`scripts/install-preset.mjs` 只做两件事：拷贝 preset，以及**镜像 dsh 那次向上查找**来确认它能解析 —— 不通过就报错，因为 dsh 会把该 preset 标记为 `broken`；同一诊断，早一步给出。

顺带一个副产品：这台机器上还有一个既有用户 preset `butler`（助手模式），未被我的操作影响。




### 安装方式：必须用打包后的 tarball，不能用目录

`dsh plugin add <目录>` 记录的是 **`link:`** 依赖。Node 解析符号链接时会用**真实路径**，所以插件会从**自己的 `node_modules`** 里 import `@deepseek-ai/cordis`，而不是 profile 那份。Cordis 靠**模块身份**识别 `Service` 基类，第二份副本会让插件契约静默失效。

打包安装会把包**物理落在** `~/.dsh/profiles/web/node_modules/` 下，解析向上走到 `profiles/node_modules` —— 与 `dshmarket`、`dsh-free-search`、以及 harness 自身**同一棵树**。已实测验证：三个包对 `@deepseek-ai/cordis` / `dsh-tools` / `dsh-llm` 解析到完全相同的路径。

顺带纠正一个容易忽略的事实：**`dsh --dump-config` 本身就会写 `~/.dsh/profiles/web/cordis.yml`**，所以任何触及 profile 的操作都在工作区之外，都需要提权。

### 工作区配置页的两个语义决定

**勾选全部 = 清空该字段（继承「全部」），而不是写入一份显式清单。** 显式清单会把「今天有哪些 agent」冻结进配置 —— 之后新建的 agent 不会自动进入这个工作区。清空字段的表达是「所有 agent，含以后新增的」，这才是用户勾选全部时想说的意思。

**规则框显示的是「生效值」而非「存储值」。** 工作区没有自己的规则时，框里显示的是部署默认规则（并标注「继承部署默认」），而不是一个空框。用户看到的就是这个工作区里的会话实际会跑的内容；一旦编辑就物化成本工作区的副本，清空则回到继承。

### P3 的核心决定：两块面，两个平面

插件导出**两个半边，挂在不同平面**：

| 导出 | 平面 | 内容 | 为什么在这 |
|---|---|---|---|
| `.`（`lib/index.js`） | **Host**（bundle patch 插入的行） | `agentForge` 服务 + settings 命名空间 | 注册表与设置命名空间是**进程级事实** |
| `./mode`（`lib/mode.js`） | **Preset**（模式的 `agent.cordis.yml` 里的行） | 派发工具 + 分派规则注入 | 两者都是**按模式的事实** |

关键在于 `ctx.tools.register` 与 `ctx.on` **按调用上下文的作用域入账**。preset 的常驻组合挂载出的行，只对 join 了该 preset 的 session 生效 —— 所以放在 `./mode` 里的工具和监听器**只在本模式下出现**。放在 Host 平面会把工具和分派规则推给**每一个模式里的每一个 session**。

**这条假设已从源码验证**（它是需求 (1)「新模式独立于标准模式」的全部依据，不能只靠推断）：

- Agent 的事件派发走 `packages/core/agent/src/dispatch.ts`，其 `waterfall`/`serial` 的文档写明是「in the agent's **scope**」。
- `scopeTarget(base, key)`（`packages/core/scope/src/index.ts`）构造的过滤器：监听器的 `scopeOf(ctx) === undefined` 时放行全部；否则**沿 agent 的 scope 父链**从 `key` 向上查找，只有祖先或相等才放行。
- `mountPreset` 会 `bindScopeParent(agentKey, standing.key)`，所以 agent 的作用域父链**包含**它所用 preset 的常驻作用域。

⇒ 注册在 preset 作用域里的监听器只对 join 了该 preset 的 agent 触发；注册在 Host 平面（`scopeOf` 为 undefined）的则触发于所有 agent。


### 分派规则注入的三个实现约束

**1. 为什么不是 system prompt section。** 两个都是 loop 的性质而非偏好：`systemPrompt.section()` 只接受同步文本提供者；而且 prompt assembly 发生在 pre-step 瀑布**之前**。所以「异步读工作区配置」的内容**不可能**进入第一步请求。pre-step 监听器可以 await，且仍然在它构造的请求之前。

**2. 为什么注入必然被记录。** loop 在 `packages/core/agent-loop/src/agent.ts:373-377` 把 pre-step 决策里的每条消息落成 `user/message`（`firstAttempt` 指的是**一步内的重试**，不是步序号）。所以注入 = 必然入日志，不需要新增 session 事件类型 —— 这也不只是省事：外部插件发明的 session 事件类型会让持久化读回**拒绝整份日志**。

**3. 去重从日志反推，不靠进程内缓存。** 既然每条决策消息都会被记录，那么每步都注入就等于每步追加一份副本。监听器按 session 记住「已经告知过的规则摘要」，但**首次见到某个 session 时先读它自己的日志**（`session.deriveMessages()`），而不是假设内存为空。所以重启后 resume 的会话不会被重复告知 —— 存的是日志的事实，不是进程的记忆。

### 派发工具的 capability 预检

`ctx.subagents.start()` 在启动前校验 provider 的 capability 位，不满足会抛 `UNSUPPORTED_CAPABILITY`。那个错误**指的是 capability 标志名，不是提出该要求的 agent 字段名**。所以工具自己先查一遍，报错直接点名「哪个 agent 要了什么、当前 provider 不支持、怎么解决」—— 这对于跑进程外 provider（`acp` / `codex` / `claude-code`）的部署才是有用的信息。


### P2b 已落地的两个决定

**组件不碰 ctx、不开订阅。** 页面只通过四份 props 读数据：`useAgentForge`（框架从 controller 的 `hooks` 隔间合成的选择器钩子）、三个写入回调、以及 `t`。controller 是唯一持有 `settingsScope` 的对象，它把 scope 投影成纯数据。这样 UI 与 Host 用的是**同一个 `resolveAgents`** —— 用户在页面上看到的名单不可能和派发时解析出的名单不一致。

**文本输入非受控、失焦提交，并按已提交值重挂载（`key={value}`）。** 一次慢的宿主往返不会静默覆盖用户随后输入的内容 —— 值从外部变了就换掉整个输入框，丢弃草稿。

### 客户端半区的可验证性

没有浏览器也能验证：`scripts/smoke-client.mjs` 执行构建产物、用替身客户端上下文调用 `apply`、取出注册的 slot 条目，再用 `react-dom/server` 把它渲染成 HTML 并驱动写入。React 函数组件本身就是函数，所以这条路跑的是**真实打包代码**而不是副本。

替身只实现 `apply` 碰到的东西，并且替身 store 只实现四个方法 —— **API 形状由 `tsc` 对着真声明检查，行为由替身验证**。上游 `@deepseek-ai/dsh-client-store` 的已发布 manifest 既没声明 `zustand` 也没声明 `immer`，而它的 `lib/index.js` 两个都 import；浏览器里它们由构建期解析，所以这个缺口只在 Node 消费方暴露。

### P2a 已落地的两个决定

**内置 agent 的文案放在代码里，不进 settings 文档。** 存进文档的默认值会被固化在播种时的语言里，而需求是内置文案跟随语言。放在代码里，切语言时重新渲染；用户一旦编辑，就在 settings map 里物化一条同 id 的覆盖项。

**服务不缓存。** 每次读都对着 settings provider 的当前 source 重新解析，所以提交写入后下一次读就生效，不需要一条可能过期的失效路径。`installSection` 的 `onChange` 因此是空的 —— 没有注册期的派生状态。

**跨字段校验走 `validate` 钩子。** schemastery 表达不了「只有非内置 id 才必须带 label/persona」，也表达不了「工作区不能指定一个它没启用的 lead」。这两条交给 `installSection` 的 `validate`，写坏的值会被**拒绝入库**而不是存下来。

### 一个会让配置页彻底失效的 schema bug（已修）

**`.required(false)` 让对象可选，不让它的成员可选** —— 但 schemastery 解析对象 schema 时**无论调用方是否提供了该对象，都会校验其嵌套成员**。所以：

```ts
model: z.object({ provider: z.string().required(), model: z.string().required() }).required(false)
```

这行看起来是「model 可选」，实际是「**省略 model 的 agent 条目一律被拒绝**」。

后果的时机很刁钻：**全新安装时用户层为空，注册正常**；一旦用户新建一个没配模型的 agent（也就是这个功能的默认用法），`register` 就抛 `missing required value`，命名空间注册失败，**整个配置页变成只读空白**。

而且极难发现：错误被 Cordis 收进 fiber，而这个部署**没有 logger exporter**，日志全静默 —— 从外面看就是「设置页什么都没有」，没有任何报错。

修法遵循本包已有的分工：**存储宽松、判定集中**。`model` 的两个成员改为均可选（这样省略整个 route 的条目能被接受），「要么两半都有、要么都没有」交给 `validateSettings`；`resolveModel()` 在读取侧把只有一半的 route 当作没有 route。三者各有测试。

发现方式也值得记：用真实的 `dsh-settings-file` 起一个 provider、喂一份**含用户自建 agent 的文档**、手动调 `installSection`，错误就直接抛出来了 —— 而不是被 Cordis 吞掉。这个探针现在是回归验证的一部分。

### 回归守卫，以及它被证明过有效

那些探针已经固化成 `scripts/installed-smoke.mjs`（`npm run smoke:installed`）。它挂载的是**安装后的包**，对着 harness 自己的 `cordis` 与 `dsh-settings-file`，分三节断言：host 服务挂载与解析、settings 命名空间注册与用户层生效、mode 注册工具并跑完一次委派。文档里的 `auditor` 条目**故意写成最稀疏的形式**（不带 model route、不带 tool filter），因为那正是让上面那个 bug 现形的输入。

守卫本身也验证过：把 schema 改回 `provider/model` 必填、重新构建并安装后跑它 ——

```
installed-smoke: the host half mounts and resolves
AssertionError: installed-smoke: the settings namespace never registered
[exit: 1]
```

**它确实在未修复的代码上失败。** 一个只在修好之后才通过的守卫什么也守不住。

### 客户端半区的第二层：DOM 挂载

`renderToStaticMarkup` 能证明「给定快照画出什么」，但证明不了**挂载之后才发生的事** —— 它不执行 effect，也不能交互。而对本插件来说这两件恰好都要紧：

- 画布在挂载时向宿主索取委派目录（会话列表在没有东西主动请求之前不带任何目录数据）；
- 配置页要能切标签页、字段失焦时提交。

所以 `scripts/dom-smoke.mjs` 用 **jsdom + `react-dom/client`** 把真实产物挂载进一个文档，然后像用户一样驱动它：点标签页、在输入框里打字并失焦、点卡片、点动作按钮。effect 是真跑的，所以「挂载时请求目录」是被**观察到**的，不是被假设的。

同一个纪律也用在它身上：把那个 effect 去掉、重新构建后跑它 ——

```
AssertionError: dom-smoke: mounting the canvas did not ask the host for the session catalogue
[exit: 1]
```

jsdom 不是浏览器（没有布局、没有 CSS、没有外壳的 slot），所以它建立的是「组件能挂载、能响应、能触达被授予的服务」，而不是「页面看起来对」。

### 最后一层：真实浏览器与真实会话

`scripts/browser-smoke.mjs` 起一个**临时 harness**（OS 选端口，不碰正在跑的那个），用机器上**已有的 Chromium**（playwright 浏览器缓存，不下载任何东西）打开页面并驱动它。它断言四件事：

```
browser-smoke: the browser half mounted and installed its stylesheet
browser-smoke: the mode picker offers the multi-agent preset
browser-smoke: the sidebar entry opens the run canvas
browser-smoke: the settings page renders the shipped roster
```

判据里最干净的一个是**本插件在 `apply` 里装的那张样式表** —— 页面里没有别的东西会产生 `<style data-plugin-css="dsh-agent-forge/page.css">`，所以它出现就等于浏览器半区真的挂载并跑完了 `apply`。

`scripts/session-probe.mjs` 再往前一步：选模式、发一句话、然后**读那段对话**。分派规则在 pre-step 注入，而那在模型调用**之前**，所以轮次一旦开始就已经证明了问题 —— 模型答不答、答得好不好都不影响。实测输出：

```
session-probe: the picker staged the multi-agent mode
session-probe: sent one prompt
session-probe: the conversation carries the injected dispatch rules
```

对话视图是**从会话日志渲染**的，所以「对话里看得到」与「日志里有」是同一个事实，而且不必去解码一个还在写的日志。

### 这一层踩到的两个坑

**模式菜单项是 `role="menuitem"`。** 我一开始点的是内层的文本 `<div>`：点了、菜单关了、chip 也变了 —— 但**会话仍然按部署默认 preset 组合**（头部写的是 `agentPreset: "butler"`），没有任何报错。写 UI 测试时「点了没反应」和「点了但选择没生效」是完全不同的两件事，而表面上一样。

**会话日志是多个 zstd 帧拼接的。** 整块 `zstdDecompressSync` **只解第一帧**，于是 7.3 KB 的日志看起来只有 1 行、像是「轮次从没开始」。要用流式 `createZstdDecompress` 才能读全。这个坑让一次本已成功的验证看起来像失败 —— 所以最后把判据从「读日志」换成了「读对话」，因为后者不依赖我对日志格式的理解。






---

## D9. 需要用户确认或注意的事

1. **一次性安装 + 重启**：带 UI 的插件必须作为包装进 `~/.dsh/profiles/web/`（写工作区外，需要一次沙箱授权），且 profile 的 bundle 成员只在启动时读取 —— **会重启当前 3080 实例、打断本会话**（会话有持久化日志，可恢复）。
2. **默认模型的绑定**：建议留空继承，由用户在配置页显式绑定。
3. **模式锁死语义**：跑过一轮后不可切模式，只能新建会话。这是 dsh 既有行为。
4. **agent 类型 ≠ preset**：agent 定义控制「角色 / 模型 / 可见工具」，不控制插件组合。

---

## D10. 选项目录（供应商 / 模型 / 工具 / 插件）

需求：配置页里的供应商、模型、插件**必须是选项**，不能是填空。

- **两条通道**。工具目录与插件花名册 Published 不到客户端插件，因此由 host 半边在 `webServer` 上注册精确路由 `CATALOG_PATH`（`src/catalog.ts`），浏览器半边 `fetch` 它；模型目录本来就是 `@Remote`（`ctx.remote.session.modelCatalog()`），直接读。
- **读取是一次命令，不是订阅**（`src/client/options.ts` 的 `loadOptions`）。`src/client/index.tsx` 在挂载时跑一次，结果写进 controller 的 store（`setOptions`），页面照旧只通过它已有的 seat 重渲染，不需要新的 props 通道。
- **每个选择器都降级而不是阻断**。目录路由没答、模型适配器不可达时，选择器只留「继承」一项，并把 agent 里已有的值以 `(不在列表里)` 的形式保留为可选项 —— 打开配置页永远不会静默改写一个能用的配置。
- **工具集改成「一个模式 + 一份勾选」**：`all` / `allow` / `deny` 三选一加一个复选框列表，取代原来两个各自独立的文本框（那种设计会鼓励写出既是白名单又是黑名单的配置）。**空列表不等于过滤器**：未勾选任何工具时不写入 `tools`，而不是写入 `allow: []`（那等于禁止全部工具）。模式是组件本地意图（`useState`，`AgentEditor` 以 `key={agent.id}` 重挂载），否则「先选 allow 再勾」会在勾选之前被存回来的值弹回 `all`。
- **插件列表只做展示**。dsh 没有「按 agent 加载插件」的机制，因此这一项是信息性的（渲染已挂载的插件行），真正决定能力的是上面的工具集；`plugins.hint` 明说了这一点。
- **路由只在 host 半边**，所以刷新页面即可拿到新的选择器，但**工具/插件目录要等 profile 重启**后路由才存在（供应商/模型来自 Remote，刷新即可）。
- **防回归**：`scripts/dom-smoke.mjs` 现在断言供应商/模型/思考强度/工具四个控件是 `<select>` 而不是 `<input>`。

### 思考强度为什么是「跟着模型走」的下拉

`reasoningEffort` 在 dsh 里是**适配器自有的自由字符串**（`packages/core/agent-loop/src/index.ts:370` 是 `z.string().min(1)`），没有一个全局枚举可以照抄。真正决定「哪些值合法」的是模型自己的声明：模型目录里每个 `ModelCatalogModel` 带 `reasoning?: { efforts: [{id, name}], defaultEffort? }`（`packages/api/session-controller/src/types.ts:109-126`，由 `catalog.ts:26-43` 从 `llm.resolveModelInfo` 投影出来）。

所以思考强度的选项 = 当前选中模型声明的 levels；没选模型、或模型不声明任何 level 时，只提供「继承」——这比编一套 `low/medium/high` 更诚实，因为编出来的值会被适配器拒绝。

### 实测：目录路由需要重启

对**改动前启动**的实例直接探测 `http://127.0.0.1:3080/dsh-agent-forge/catalog` 得到 `404`，也就是说 host 半边的新路由在当前进程里**不存在**——profile 的 bundle 成员只在启动时读取。因此：

- 刷新页面即可拿到新的**选择器**（供应商/模型/思考强度走已有的 `session/modelCatalog` Remote，不依赖新路由）；
- **工具**和**插件**两个列表必须等 profile 重启，路由才存在。

### 坑：`npm run check:installed` 并不安装

`check:installed` = `check` + `smoke:installed` + `smoke:browser`，**没有任何安装步骤**。装进 profile 必须显式做三件事，然后重启：

```sh
npm pack
dsh plugin --profile web remove dsh-agent-forge
dsh plugin --profile web add C:/xiangmu/dsh/dsh-agent-forge/dsh-agent-forge-0.1.0.tgz
```

验证装的是新构建：比较 `~/.dsh/profiles/web/node_modules/dsh-agent-forge/lib/index.js` 与本地 `lib/index.js` 的字节数，并在里面搜 `catalog`——**旧构建里这个字符串出现 0 次**。2026-09-15 就是漏了这一步：重启了 profile，但装的是 22:20 的旧包，路由依旧 404。

---

## D11. 把 agent 提升到预设级（出进程子 agent）

目标：每个 agent 拥有自己的组合，从而能按 agent 选插件集；同时**保留**模型提供方/模型/思考强度三个下拉与 persona、工具筛选。

### 为什么必须走出进程 provider

`@deepseek-ai/dsh-subagent` 的服务定义里 **provider 是逐次请求选的**（`packages/subagent/subagent/src/index.ts:552`：`@param name - the provider to use`）。进程内 provider（`subagent-spawn-in-process`）让所有子 agent 共享当前会话的 composition，所以插件不可选；`subagent-fork-in-process` 同理。只有出进程 provider 能给每个 agent 一份独立装配。

### 能力切分（决定了哪些设置要搬家）

`subagent-dsh-sdk` 的 README:32-56 与 `src/index.ts:79-93`：

| 配置 | 归属 | 结论 |
|---|---|---|
| `provider` / `model` / `reasoningEffort` / `maxTokens` | 请求参数 `agentOptions`（provider 声明 `agentOptions: true`） | **现有三个下拉与 persona 之外的模型设置原样保留** |
| `outputSchema` / `depthLimit` / `toolFilter` / `persona` | 子进程自有（provider 声明 false，会**拒绝**而不是忽略） | 必须写进生成的子组合 |

注意：通用的 `subagent/src/out-of-process.ts:54-58` 里 `agentOptions: false`，那是**通用出进程能力表**，`dsh-sdk` 覆盖了它——不要照抄那一行判断。

### 装配面

provider 的 Config（`subagent-dsh-sdk/src/index.ts:79-93`）关键字段：

- `providerName`（默认 `dsh-sdk`）——**可配置**，所以可以按 agent 挂 N 个实例，各注册 `forge:<agentId>`；
- `dshBin`：默认走 SDK 依赖，不用配；
- `profile`（默认 `sdk`）+ `patches`（有序 patch 文件）——**这就是每个 agent 的组合**；
- `dshHome`：*"Absolute isolated Harness home for every nested child process"*，子进程的 profile 在这里，不在用户 `~/.dsh`。

**实测（本轮）**：在一个隔离 `DSH_HOME` 下执行 `dsh --profile headless --dump-config`，dsh **按需自动创建**了这份 profile：

```
$DSH_HOME/profiles/headless/{cordis.yml,cordis.patch.yml,package.json,pnpm-workspace.yaml}
```

配置正常输出（第一层 `@deepseek-ai/dsh-base`）。所以子 profile 不需要手工搭，一条命令就有；每个 agent 的差异写进 provider 的 `patches`。

### 依赖前提（已在本机验证）

- `@deepseek-ai/dsh-subagent-dsh-sdk` **不声明 `dsh.bundle`**——它是靠 composition 插入行使用的函数式插件（导出 `{ Config, apply, inject, name }`），**因此也可以运行时 `ctx.plugin(...)` 挂载，不必改 composition、不必重启**。
- 它的 peer `@deepseek-ai/dsh-sdk-client` **不会自动装**：缺了它连 `import` 都进不去（`Cannot find package ... imported from .../dsh-subagent-dsh-sdk/lib/index.js`）。两个包都以普通依赖装进 profile 即可，**不进 `dsh.profile.bundles`**，因此不改变 composition、不影响运行中的实例。
- 装好后从**插件自身目录**也能解析到该包（`import('@deepseek-ai/dsh-subagent-dsh-sdk')` → `Config,apply,inject,name`），且 profile 的 `--dump-config` 仍正常。pnpm 可能打印一行 `pnpm failed in profile directory`，但依赖已写入 manifest 并安装成功——以 import 能否成功为准。

### 子进程的确切启动方式（已实测）

`dsh-sdk-client/lib/index.js:161-191` 的 `resolveDshLaunch`：

```
node <dsh-bin.js> --profile <profile> [--patch <path>...]
env: DSH_HOME=<dshHome>          cwd: processCwd
```

**每个 agent 的差异就是那串 `--patch`。** 实测（隔离 `DSH_HOME`，`--dump-config` 不起进程）：

| 运行 | `forge-agent-a` 行 |
|---|---|
| `dsh --profile headless --patch agent-a.cordis.yml --dump-config` | **1**（行内容 `- id: forge-agent-a / name: '@deepseek-ai/dsh-tool-todo'`） |
| `dsh --profile headless --dump-config`（对照） | **0** |

同时该 home 下按需生成了 `profiles/headless/`。结论：**per-agent 组合 = 每个 agent 一份生成的 patch 文件**，机制成立且有对照证据。

注意：`--patch` 的路径按 **cwd** 解析（`resolve(callerCwd, path)`），所以生成 patch 时必须写绝对路径或确保子进程 cwd 正确。

---

## D12. 正式方案改为单进程（D11 的多进程路线作废）

用户 2026-09-16 决定：**不启动子进程**，改为「一个 dsh 进程内的会话间派活」。D11 记录的机制与实测仍然有效（作为回退方案保留），但不再是实现路线。

### 承重原语：已在完整 web 组合里实测通过

探针（`scripts/probe-preset-plugin.mjs`，加载方式见下）在真实进程里对全部 preset 逐个尝试，结果：

```
"ok": true
attempts: standard/ptc/minimal/cordis/agent-forge/butler
  每个都是 composedBefore: null → composedAfter: <该 preset id> → ok: true
```

四条结论：

1. **`ctx.agents.create({ sessionId, setup })` 插件内可用**；`setup(childCtx, child)` 是拿到子 agent「自己的 context」的唯一入口，也是进程内 driver 组合子 agent 的地方（`subagent-in-process-driver/src/index.ts:122-143`）。
2. **新建 agent 的 `composedPreset` 恒为 `null`** —— 它**不继承父的 standing scope**。这正是"单进程也能每个 agent 一套插件"的立足点：能建出未绑定的 agent，就能按任意 preset 组合它。
3. **`agentPresets.select(agent, presetId)` 会真的完成组合**（`agent-presets/src/index.ts:717`），且**必须在会话跑第一轮之前**调用（`:741`：session has already started; its agent preset is fixed）。
4. `agentPresets.list()` 是 **async**（`index.ts:265`），返回花名册（含用户的 `agent-forge`）。

### 运行探针踩到的四个坑（都会在正式实现里复现，务必照此处理）

1. **不能在 `apply` 里做这套组合**：会报 `cannot create effect on inactive context` / `cannot get required service "agents" in inactive context`。必须**等运行时就绪后触发**（探针用延迟触发验证了这一点）。
2. **`dsh web` 是 `--profile web` 的语法糖，两者不能组合**：`web takes none of parent --profile, --patch, --dump-config ...`。要在别的 profile 上跑，用纯 `node bin.js --profile <name>`。
3. **patch 行按 id 覆盖会替换目标行的整个 `config`**（不是深合并）。要改端口必须重述 webserver 全部字段（`host`/`port`/`compression`/`compressionLevel`/`compressionThresholdBytes`），否则 `invalid config`。
4. **探针/插件文件不能放在同一个包里又被当作 Loader 行与 bundle 同时引用**：会报 `package dsh-agent-forge resolves from multiple active Loader sources ... remove one entry`。探针文件放在包目录**之外**即可。

### 正式实现要点

- `composition.ts`：从"生成 patch 行"改为**生成 preset 目录**（`preset.yml` + `agent.cordis.yml`），每个 agent 一份；`agent.cordis.yml` 的行就是该 agent 的插件集。
- 分派：`ctx.agents.create({ sessionId, agentOptions: { provider, model, reasoningEffort }, setup })` → `agentPresets.select(agent, <agent 的 preset>)` → `agent.followup(createUserMessage(...))` → `await agent.whenIdle()` → 读最终 assistant 文本。模型/思考强度**仍按请求传**（`agentOptions`），persona/工具筛选走 `applyChildComposition`。
- 这些"agent 会话"是真实会话，需要在会话列表中可辨认，并定义生命周期。
