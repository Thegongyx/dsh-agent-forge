# dsh-agent-forge

[中文](README.md) | [English](README_en.md)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 用的多智能体锻造台。

只需定义一次命名 agent——模型、推理强度、人格、可见工具集——之后由每个工作区决定启用哪些
agent、谁当 lead、工作如何在它们之间路由。一张画布列出一次运行产生的全部委派，每个节点都能
打开它背后那次会话。

## 现状

功能完整并已安装。`agentForge` 服务从插件的 settings 命名空间解析 agent 列表与每个工作区的
决定，内置三个 agent 与随包发布的分派规则；内置文案跟随应用自身的语言设置。浏览器半边提供
一个设置页（agent 花名册：每个 agent 的模型提供方、模型、推理强度、人格、可见工具集、插件集、
可选的 preset 引用与委派深度；每个工作区的启用项与规则；部署默认路由规则）和一张运行画布
（一次会话产生的每次委派各一张卡片，按执行它的 agent 分组）。mode 半边提供委派工具、每个
agent 一个 subagent provider，以及分派规则注入。

每个界面都已验证，最后几项在真实浏览器里跑过：模式选择器能列出这份 preset，侧边栏入口能打开
画布，设置页能渲染出随包发布的花名册，每个标签页都能被切换，模型选择器由目录路由填充，并且
在这个模式下真实新开的会话，其对话里确实带着注入的分派规则。

`ARCHITECTURE.md` 记录了以上每个设计决策及其依据。

## Agent 就是 preset

agent 不是一包塞给 subagent 调用的参数。每个 agent 拥有一份**组合（composition）**，而在 dsh
里组合就是 agent preset，所以本插件生成的就是它：

```
~/.dsh/.agent-presets/<agentId>/preset.yml         它如何出现在选择器里
~/.dsh/.agent-presets/<agentId>/agent.cordis.yml   它挂载的插件行
```

设置页上的勾选框写的就是第二个文件。勾一个插件就是给这个 agent 加一项能力。这棵树按功能给
部署的花名册分组，略去基线已经提供的模块——并说明略去了多少项，让列表看起来仍然完整——还
支持整组一次勾选。在预设选择器里指定一份现成 preset 会让勾选框失效：那个 agent 就原样跑别人
的组合。

生成文件是**基线的行加上该 agent 自己的行**，永远不是只有它自己的行：

```
agent.cordis.yml = <baseline/agent.cordis.yml 的行，原样内嵌> + <勾选的插件>
```

基线是**本包自带的一个文件**（`baseline/agent.cordis.yml`）：持久 shell、原生文件读写/检索、
技能、web 搜索/抓取——即本部署 `butler` 模式用的那套，去掉该模式的人格。自己拥有它才是关键：
agent 的组合不能取决于某份 preset 会不会被改名、被裁瘦、或者根本没装；而某一个 agent 上填
`presetRef` 就是部署选择改用 `standard`、`butler` 或手写 preset 的方式。

"每个 agent 一个文件、基线内嵌"带来三个后果：

- 一个会话只 join **一份**常驻组合，所以只装勾选行的文件会一个工具都不挂载。内嵌是 DSH 留下的
  唯一办法：`mount` 把一个会话的 scope 绑定到单一常驻挂载，而 `cordis:include` 指的是 Loader
  根部的配置文件，不是某个 agent 的第二份组合。
- 内嵌是逐字节的，这样基线里那几个**按服务名**的 `isolate` realm
  （`isolate: { terminals: true }`）才能保留；在 realm 之外发布服务的行会被当作进程级服务拒绝。
- 基线随安装的版本冻结。升级 dsh 不会改它，未来 `standard` 新增的行也不会出现在这里。要调就
  改安装后的那个文件，或者用某个 agent 的 `presetRef` 指向手写 preset。

勾选之前有两件事值得知道：插件无法在挂载之前判断一个包会发布哪些服务，所以勾一个会发布服务
的模块会被 preset 挂载拒绝——这种模块应当装成 profile bundle（写进 `dsh.profile.bundles`），
它对每个会话只组合一次。另外，如果某个 agent 的 id 撞上了一份**不是本插件生成**的 preset
目录，写入会被拒绝而不是覆盖：给 agent 改名，或者用 `presetRef` 指向那份 preset。

委派始终在**同一个进程**里。mode 为每个 agent 注册一个 `ctx.subagents` provider，名字是
`forge:<agentId>`，该 provider：

1. 通过 `ctx.agents.create` 建会话——新建的 agent 不继承任何 preset，这正是它们可被组合的前提；
2. 在**首个 turn 之前**选定该 agent 的 preset，因为 dsh 一旦开始就固定一个会话的 preset；
3. 通过 `applyChildComposition` 施加人格与工具过滤器，并在创建任何东西之前解析子层深度，以落实
   深度上限；
4. 投递 prompt，并读回最终的助手文本。

走 subagent 这条缝而不是绕过它是刻意的：生命周期事件、画布读取的运行目录、取消与释放都照常
工作，从这里来的只有子会话的**组合**。

每次请求的模型路由没有变化。provider、model 与推理强度仍然作为 `agentOptions` 传递，可选强度
就是所选模型自己声明的那些档位。

## 两半，两个平面

本包导出三个入口，因为一行插件不能同时待在两个平面上：

| 导出 | 平面 | 贡献什么 |
|---|---|---|
| `.` | Host，由 `cordis.patch.yml` 插入 | `agentForge` 服务与 settings 命名空间 |
| `./mode` | 一份 preset，由 `presets/agent-forge/agent.cordis.yml` 挂载 | 委派工具、每个 agent 一个 subagent provider、分派规则注入 |
| `./client` | 浏览器，由 `dsh.client` 发现 | 设置页 |

`ctx.tools.register` 与 `ctx.on` 会落进调用上下文的 scope，所以 mode 那一行只对 join 了该模式
preset 的会话生效。把这两者注册到 Host 平面，会让这个工具和路由规则出现在所有模式的每个会话
面前。

## 安装

```sh
npm pack                                  # 产出 dsh-agent-forge-0.1.0.tgz
dsh plugin --profile web add ./dsh-agent-forge-0.1.0.tgz
node scripts/install-preset.mjs           # 放置 mode 的 preset
```

`install-preset.mjs` 把 preset 拷进 `~/.dsh/.agent-presets/`，然后检查它的行能否被解析。这个检查
有必要，因为答案不是想当然的那个：dsh 是把 preset 的**包**行对着 *profile* 解析的
（`rowResolves` → `packageInstalled`，从 profile 目录向上走 `node_modules`），而不是对着 preset
自己的目录。直接问 Node 会得到 `MODULE_NOT_FOUND`，把一份健康的 preset 报成坏的——所以脚本
镜像了 dsh 自己的判定，并保留该行的可移植包名。

**要从打好的 tarball 安装，不要从目录安装。** `dsh plugin add <目录>` 记的是 `link:` 依赖，而
Node 解析软链接的 import 时走的是它的**真实**路径——于是插件会从自己的 `node_modules` 而不是
profile 的那份导入 `@deepseek-ai/cordis`。Cordis 靠模块身份识别它的 `Service` 基类，第二份拷贝
会无声地破坏插件契约。tarball 安装是物理落在 `~/.dsh/profiles/web/node_modules/`，解析会向上走
到与其他每个 bundle 相同的树。

装完可以这样确认：

```sh
node -e "console.log(require('module').createRequire('$HOME/.dsh/profiles/web/node_modules/dsh-agent-forge/lib/index.js').resolve('@deepseek-ai/cordis'))"
```

它打印的路径必须与一个你确定能用的 bundle 打出来的一致。

**tarball 安装是快照，重复 add 同一个 tarball 是空操作。** pnpm 按路径和版本判断，打印
"Lockfile is up to date, resolution step is skipped"，什么都不拷。所以重建之后要 remove 再
add，然后比对字节大小：

```sh
npm run build
npm pack
dsh plugin --profile web remove dsh-agent-forge
dsh plugin --profile web add ./dsh-agent-forge-0.1.0.tgz
```

安装会通过 `cordis.patch.yml` 注册 Host 行，并通过 `dsh.client` 交付浏览器 bundle。bundle 成员
是在启动时读取的，所以要重启 profile 并刷新页面。

preset 目录才是让这个 mode 出现在"新建会话"模式选择器里的东西。`~/.dsh/.agent-presets/` 默认
会被扫描，而 preset 发现每次列举都会重读各个 root，所以放进那里的 preset 不用重启就会出现——
只有这个包本身的安装需要重启。

## 构建

```sh
npm install --ignore-scripts
npm run check             # 类型检查、构建全部面，然后跑无密钥 smoke 套件
npm run check:installed   # 上面这些，外加已安装环境套件
npm run build             # 写出 lib/index.js、lib/core.js、lib/mode.js、lib/client.js
npm run watch             # 改动时重建每个面
npm run typecheck         # 两个编译器面
npm run smoke             # 产物、解析、页面、全景图、语言与 DOM
npm run smoke:installed   # 把已安装的包挂到 harness 自己的 cordis 上
npm run smoke:browser     # 起一个一次性 harness，在无头 Chromium 里驱动 UI
npm run probe:session     # 在这个模式下跑一次真实会话，然后读它的轨迹
```

`smoke:installed` 与 `smoke:browser` 需要包已安装进 profile，所以它们与 `check` 分开；
`check:installed` 一次跑全套。`probe:session` 刻意从不自动运行：它会花掉一次真实模型调用。

`smoke:installed` 之所以与 `check` 分开，是因为有两种失败模式对所有离线套件都不可见：插件经不
起被 harness 真实的 Cordis 挂载，以及真实 schemastery 拒绝注册某个 settings 命名空间。这两种
在本部署里都不产生任何输出——harness 的 logger 没有导出器——所以一次失败的挂载看起来和"页面
什么都没渲染"一模一样。

浏览器半边有两层覆盖。服务端渲染检查给定快照画出什么；通过 `react-dom/client` 的 jsdom 挂载
检查一个**已挂载**的页面会做什么——这是观察"挂载后才跑的 effect"或"改变绘制结果的交互"的
唯一办法。两者在这里都重要：运行画布在挂载时向 host 要一份委派目录，因为在有东西主动要之前，
会话列表里什么都不带。

`npm install` 需要 `--ignore-scripts`，因为 DSH 的文件沙箱拒绝 npm 生命周期脚本使用的管道
stdio。esbuild 的平台二进制通过它的可选依赖到达，所以不缺东西。

本仓库自己的 client preset 是通过 harness 检出内的包清单来解析目标的，所以检出之外的包用不了
那份 preset。`scripts/build.mjs` 复现了它拥有的两份契约：Host 半边是 ESM、所有 harness
specifier 都外部化；浏览器半边是 CommonJS 工厂，通过 `window.__ModuleLoader__.load(...)`
注册，只把 shell 的平台模块外部化。

`lib/core.js` 是纯解析核心，单独打包，好让 smoke 测试在没有 Cordis 上下文的情况下检验 agent
与工作区规则。它不属于插件表面——Loader 挂载的是 `lib/index.js`。
