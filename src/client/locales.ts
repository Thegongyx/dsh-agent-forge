/**
 * Typed copy for the forge's settings page.
 *
 * Declaring the namespace on `LocaleNamespaceMap` is what types the `t` seat the
 * slot registration receives; without it the two-argument `locale.register`
 * overload does not accept the namespace at all.
 *
 * @module dsh-agent-forge/client/locales
 */

/** Namespace this plugin's browser copy lives in. */
export const NS = 'agentForge'

/** Every copy key this plugin owns. */
export type AgentForgeKey =
  | 'nav'
  | 'title'
  | 'subtitle'
  | 'status.loading'
  | 'status.unavailable'
  | 'status.readonly'
  | 'status.memory'
  | 'tab.agents'
  | 'tab.workspaces'
  | 'tab.rules'
  | 'agents.heading'
  | 'agents.add'
  | 'agents.remove'
  | 'agents.builtin'
  | 'agents.custom'
  | 'agents.overridden'
  | 'agents.reset'
  | 'agents.empty'
  | 'agents.newLabel'
  | 'agents.newPersona'
  | 'field.label'
  | 'field.description'
  | 'field.persona'
  | 'field.provider'
  | 'field.model'
  | 'field.reasoningEffort'
  | 'field.allow'
  | 'field.deny'
  | 'field.maxDepth'
  | 'field.maxDepthZero'
  | 'field.inherit'
  | 'field.optional'
  | 'field.unlisted'
  | 'field.tools'
  | 'field.plugins'
  | 'tools.all'
  | 'tools.allowOnly'
  | 'tools.denyOnly'
  | 'tools.allHint'
  | 'tools.allowHint'
  | 'tools.denyHint'
  | 'tools.noCatalogue'
  | 'plugins.noCatalogue'
  | 'plugins.hint'
  | 'field.presetRef'
  | 'preset.own'
  | 'preset.generated'
  | 'plugins.selectAll'
  | 'plugins.clearAll'
  | 'plugins.expand'
  | 'plugins.showBaseline'
  | 'plugins.hideBaseline'
  | 'plugins.baseline'
  | 'plugins.baselineHint'
  | 'save.button'
  | 'save.done'
  | 'save.hint'
  | 'category.tools'
  | 'category.agents'
  | 'category.llm'
  | 'category.sessions'
  | 'category.delegation'
  | 'category.security'
  | 'category.storage'
  | 'category.host'
  | 'category.ui'
  | 'category.client'
  | 'category.framework'
  | 'category.thirdParty'
  | 'category.core'
  | 'rules.heading'
  | 'rules.hint'
  | 'rules.custom'
  | 'workspaces.pick'
  | 'workspaces.current'
  | 'workspaces.empty'
  | 'workspaces.enabled'
  | 'workspaces.enabledHint'
  | 'workspaces.lead'
  | 'workspaces.leadAuto'
  | 'workspaces.rule'
  | 'workspaces.ruleHint'
  | 'workspaces.inherited'
  | 'nav.map'
  | 'map.title'
  | 'map.summary'
  | 'map.empty'
  | 'map.running'
  | 'map.idle'
  | 'map.children'
  | 'map.hasChildren'
  | 'map.pick'
  | 'map.agent'
  | 'map.state'
  | 'map.depth'
  | 'map.duration'
  | 'map.tokens'
  | 'map.session'
  | 'map.none'
  | 'map.unlabelled'
  | 'map.open'
  | 'map.expand'

export const zh: Record<AgentForgeKey, string> = {
  'nav': '多智能体',
  'title': '多智能体铸造厂',
  'subtitle': '定义 agent，交给每个工作区决定启用哪些、由谁牵头、以及任务如何分派。',
  'status.loading': '正在读取配置…',
  'status.unavailable': '当前部署没有提供该配置命名空间，本页只读。',
  'status.readonly': '当前页面无法写入宿主的设置文档，改动只在本进程内有效。',
  'status.memory': '非 loopback 访问，改动不会持久化。',
  'tab.agents': 'Agent',
  'tab.workspaces': '工作区',
  'tab.rules': '分派规则',
  'agents.heading': 'Agent 列表',
  'agents.add': '新建 agent',
  'agents.remove': '删除',
  'agents.builtin': '内置',
  'agents.custom': '自建',
  'agents.overridden': '已修改',
  'agents.reset': '恢复默认',
  'agents.empty': '还没有任何 agent。',
  'agents.newLabel': '新 agent',
  'agents.newPersona': '你是一个专注的子 agent。先确认任务边界再动手，不确定的地方明确说出来，不要猜。',
  'field.label': '名称',
  'field.description': '一句话说明',
  'field.persona': '角色指令（persona）',
  'field.provider': '模型提供方',
  'field.model': '模型',
  'field.reasoningEffort': '思考强度',
  'field.allow': '只允许这些工具（每行一个）',
  'field.deny': '禁止这些工具（每行一个）',
  'field.maxDepth': '最大委派深度',
  'field.maxDepthZero': '深度 0 会让这个 agent 无法被派发：从深度 0 的会话派出的子会话至少是深度 1。改成正整数，或留空继承。',
  'field.inherit': '留空则继承',
  'field.optional': '可选',
  'field.unlisted': '不在列表里？直接填',
  'field.presetRef': '改用已有预设（留空则用本 agent 自己的组合）',
  'preset.own': '本 agent 自己的组合（插件自带基线 + 勾选上面的插件）',
  'preset.generated': '本插件生成',
  'plugins.selectAll': '全选',
  'plugins.clearAll': '清空',
  'plugins.expand': '展开本组',
  'plugins.showBaseline': '显示基础插件',
  'plugins.hideBaseline': '收起基础插件',
  'plugins.baseline': '插件基线已带',
  'plugins.baselineHint': '以上之外，还有若干项已由本插件自带的基础组合提供（持久 shell、文件读写/检索、技能、web 搜索/抓取）：生成的每个组合都会原样带上这些行，所以不在此列出，也不计入全选/清空。',
  'save.button': '保存并刷新',
  'save.done': '已保存（所有修改在失焦时已自动写入）',
  'save.hint': '所有修改在输入框失焦时自动保存；这个按钮用来重新读取插件与预设列表',
  'category.tools': '模型可用工具',
  'category.agents': '智能体与提示',
  'category.llm': '模型接入',
  'category.sessions': '会话与记录',
  'category.delegation': '任务委派',
  'category.security': '权限与沙箱',
  'category.storage': '存储与投影',
  'category.host': '宿主与接口',
  'category.ui': '界面组件',
  'category.client': '浏览器运行时',
  'category.framework': '框架基础设施',
  'category.thirdParty': '第三方扩展',
  'category.core': '其他',
  'field.tools': '工具集',
  'field.plugins': '已安装插件',
  'tools.all': '允许全部工具',
  'tools.allowOnly': '只允许勾选的工具',
  'tools.denyOnly': '只禁止勾选的工具',
  'tools.allHint': '该 agent 可以使用全部已注册工具。',
  'tools.allowHint': '只有勾选的工具对该 agent 可见，其余全部隐藏。',
  'tools.denyHint': '勾选的工具对该 agent 隐藏，其余全部可用。',
  'tools.noCatalogue': '读不到工具目录：Host 的目录路由没有应答。若刚更新过插件，需要重启 dsh（profile）后再刷新页面。',
  'plugins.noCatalogue': '读不到插件目录，原因同上；重启 dsh 后刷新页面即可。',
  'plugins.hint': '勾选的插件会追加到本插件自带的基础组合之上，写进这个 agent 自己的组合（一份由本插件生成的 preset）：生成文件 = 基线的行 + 你勾选的行。基线偏轻（持久 shell、文件读写/检索、技能、web 搜索/抓取），要完整编码 Agent 就用下面的「改用已有预设」。子 agent 在独立会话里按这份组合运行。',
  'rules.heading': '默认分派规则',
  'rules.hint': '没有单独配置的工作区会使用这段规则。它会在会话开始时进入模型上下文。',
  'rules.custom': '已由本部署自定义',
  'workspaces.pick': '选择工作区',
  'workspaces.current': '当前',
  'workspaces.empty': '还没有任何工作区。先创建一个工作区，再回来配置它。',
  'workspaces.enabled': '本工作区启用的 agent',
  'workspaces.enabledHint': '全部勾选表示启用所有 agent（含以后新增的）；取消勾选即写入显式列表。',
  'workspaces.lead': '默认主 agent',
  'workspaces.leadAuto': '自动（第一个启用的 agent）',
  'workspaces.rule': '本工作区的分派规则',
  'workspaces.ruleHint': '留空则继承上面的部署默认规则。',
  'workspaces.inherited': '继承部署默认',
  'nav.map': '工作全景图',
  'map.title': '多 agent 工作全景图',
  'map.summary': '本会话共 {total} 次委派，其中 {running} 次正在运行。',
  'map.empty': '本会话还没有委派过任务。进入多智能体模式并让 agent 按分派规则派出子任务后，这里会显示每一次委派。',
  'map.running': '运行中',
  'map.idle': '已结束',
  'map.children': '含 {count} 次下级委派',
  'map.hasChildren': '有下级委派',
  'map.pick': '点击左侧任意一张卡片查看该次委派的详情。',
  'map.agent': '负责的 agent',
  'map.state': '状态',
  'map.depth': '层级',
  'map.duration': '累计耗时',
  'map.tokens': 'token 用量',
  'map.session': '会话 id',
  'map.none': '未记录',
  'map.unlabelled': '未标注 agent',
  'map.open': '打开该会话',
  'map.expand': '展开它的下级委派',
}

export const en: Record<AgentForgeKey, string> = {
  'nav': 'Multi-agent',
  'title': 'Multi-agent forge',
  'subtitle': 'Define agents; let each workspace decide which ones it offers, which leads, and how work is routed.',
  'status.loading': 'Reading configuration…',
  'status.unavailable': 'This deployment serves no settings namespace for this plugin, so the page is read-only.',
  'status.readonly': 'This page cannot write the host settings document; changes stay in this process.',
  'status.memory': 'Opened outside loopback, so changes are not persisted.',
  'tab.agents': 'Agents',
  'tab.workspaces': 'Workspaces',
  'tab.rules': 'Dispatch rules',
  'agents.heading': 'Agents',
  'agents.add': 'New agent',
  'agents.remove': 'Remove',
  'agents.builtin': 'Built-in',
  'agents.custom': 'Custom',
  'agents.overridden': 'Edited',
  'agents.reset': 'Reset to default',
  'agents.empty': 'No agents yet.',
  'agents.newLabel': 'New agent',
  'agents.newPersona': 'You are a focused sub-agent. Confirm the task boundary before starting, and say what you are unsure about instead of guessing.',
  'field.label': 'Name',
  'field.description': 'One-line purpose',
  'field.persona': 'Role instructions (persona)',
  'field.provider': 'Model provider',
  'field.model': 'Model',
  'field.reasoningEffort': 'Reasoning effort',
  'field.allow': 'Allow only these tools (one per line)',
  'field.deny': 'Deny these tools (one per line)',
  'field.maxDepth': 'Maximum delegation depth',
  'field.maxDepthZero': 'A depth of 0 makes this agent impossible to dispatch: the child of a depth-0 session is already depth 1. Use a positive number, or leave it blank to inherit.',
  'field.inherit': 'Empty inherits',
  'field.optional': 'optional',
  'field.unlisted': 'Not listed? type it',
  'field.presetRef': 'Compose from an existing preset (blank uses this agent\'s own)',
  'preset.own': "This agent's own composition (this plugin's baseline + the plugins checked above)",
  'preset.generated': 'generated',
  'plugins.selectAll': 'Select all',
  'plugins.clearAll': 'Clear all',
  'plugins.expand': 'Expand this group',
  'plugins.showBaseline': 'Show baseline plugins',
  'plugins.hideBaseline': 'Hide baseline plugins',
  'plugins.baseline': 'supplied by this plugin\'s baseline',
  'plugins.baselineHint': 'Beyond these, some rows are already supplied by this plugin\'s own baseline composition (persistent shell, file read/write/search, skills, web search/fetch): every generated composition carries them as they stand, so they are not listed here and take no part in select-all or clear-all.',
  'save.button': 'Save & refresh',
  'save.done': 'Saved — every edit was written when its field lost focus',
  'save.hint': 'Edits save automatically on blur; this button re-reads the plugin and preset lists',
  'category.tools': 'Model-facing tools',
  'category.agents': 'Agents & prompts',
  'category.llm': 'Model providers',
  'category.sessions': 'Sessions & logs',
  'category.delegation': 'Delegation',
  'category.security': 'Permissions & sandbox',
  'category.storage': 'Storage & projections',
  'category.host': 'Host & APIs',
  'category.ui': 'Interface components',
  'category.client': 'Browser runtime',
  'category.framework': 'Framework',
  'category.thirdParty': 'Third-party',
  'category.core': 'Other',
  'field.tools': 'Tools',
  'field.plugins': 'Installed plugins',
  'tools.all': 'Allow every tool',
  'tools.allowOnly': 'Allow only the checked tools',
  'tools.denyOnly': 'Deny the checked tools',
  'tools.allHint': 'This agent may use every registered tool.',
  'tools.allowHint': 'Only the checked tools are visible to this agent; everything else is hidden.',
  'tools.denyHint': 'The checked tools are hidden from this agent; everything else stays available.',
  'tools.noCatalogue': 'The tool catalogue is unreachable: the Host route did not answer. If this plugin was just updated, restart dsh and reload this page.',
  'plugins.noCatalogue': 'The plugin catalogue is unreachable for the same reason; restart dsh and reload this page.',
  'plugins.hint': 'Checked plugins are appended to this plugin\'s own baseline composition in the agent\'s generated preset: the file is the baseline\'s rows plus yours. The baseline is deliberately light (persistent shell, file read/write/search, skills, web search/fetch) — pick a preset below when an agent needs the full coding agent instead. Its children run in their own session composed from that file.',
  'rules.heading': 'Default dispatch rules',
  'rules.hint': 'Workspaces without their own rules run on this text. It enters the model context at the start of a session.',
  'rules.custom': 'Customized by this deployment',
  'workspaces.pick': 'Workspace',
  'workspaces.current': 'current',
  'workspaces.empty': 'No workspaces yet. Create one, then come back to configure it.',
  'workspaces.enabled': 'Agents this workspace offers',
  'workspaces.enabledHint': 'All checked means every agent, including ones added later. Unchecking one writes an explicit list.',
  'workspaces.lead': 'Leading agent',
  'workspaces.leadAuto': 'Automatic (the first enabled agent)',
  'workspaces.rule': 'Dispatch rules for this workspace',
  'workspaces.ruleHint': 'Empty inherits the deployment default above.',
  'workspaces.inherited': 'inherited from the deployment default',
  'nav.map': 'Run canvas',
  'map.title': 'Multi-agent run canvas',
  'map.summary': '{total} delegations in this session, {running} running.',
  'map.empty': 'This session has delegated nothing yet. Once an agent dispatches by the routing rules, every delegation shows up here.',
  'map.running': 'Running',
  'map.idle': 'Finished',
  'map.children': '{count} nested',
  'map.hasChildren': 'has nested runs',
  'map.pick': 'Pick a card on the left to see that delegation.',
  'map.agent': 'Agent',
  'map.state': 'State',
  'map.depth': 'Depth',
  'map.duration': 'Turn time',
  'map.tokens': 'Tokens',
  'map.session': 'Session id',
  'map.none': 'not recorded',
  'map.unlabelled': 'Unlabelled',
  'map.open': 'Open the conversation',
  'map.expand': 'Load its own delegations',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Multi-agent forge settings copy. */
    'agentForge': AgentForgeKey
  }
}
