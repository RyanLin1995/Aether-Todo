/** 渲染进程国际化（i18n） */

export type Locale = 'zh-CN' | 'en-US';

export const SUPPORTED_LOCALES: { value: Locale; label: string }[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' },
];

/** 类别内部统一存中文 key，展示时按语言翻译 */
export const CATEGORY_KEYS = ['工作', '学习', '生活', '健康', '财务', '社交', '其他'] as const;

type MessageTable = Record<string, string>;

const DEFAULT_LOCALE: Locale = 'zh-CN';

const MESSAGES: Record<string, MessageTable> = {
  'zh-CN': {
    'app.title': 'Aether Todo',
    'app.tagline': '灵动待办，心流专注',

    'topbar.settings': '设置',
    'engine.local': '本地解析',
    'engine.ai': 'AI 增强',

    'stat.active': '进行中',
    'stat.done': '已完成',
    'stat.high': '高优先级',
    'stat.total': '全部',

    'sidebar.views': '视图',
    'sidebar.categories': '类别',
    'sidebar.search': '搜索',
    'sidebar.searchPlaceholder': '搜索标题或备注',

    'view.active': '进行中',
    'view.today': '今天到期',
    'view.high': '高优先级',
    'view.done': '已完成',
    'view.all': '全部任务',
    'view.stats': '统计',
    'stats.range.week': '本周',
    'stats.range.month': '本月',
    'stats.range.year': '今年',
    'stats.completed': '已完成',
    'stats.activeDays': '活跃天数',
    'stats.perDay': '日均完成',
    'stats.perMonth': '月均完成',
    'stats.bestDay': '单日最多',
    'stats.trend': '完成趋势',
    'stats.byCategory': '分类分布',
    'stats.empty': '该时间段还没有完成记录',
    'stats.cal.title': '完成日历',
    'stats.cal.detail': '{date}完成明细',
    'stats.cal.count': '完成 {n} 项',
    'stats.cal.empty': '这一天没有完成记录',
    'weekday.1': '一',
    'weekday.2': '二',
    'weekday.3': '三',
    'weekday.4': '四',
    'weekday.5': '五',
    'weekday.6': '六',
    'weekday.7': '日',

    'category.all': '全部类别',
    'category.工作': '工作',
    'category.学习': '学习',
    'category.生活': '生活',
    'category.健康': '健康',
    'category.财务': '财务',
    'category.社交': '社交',
    'category.其他': '其他',

    'priority.high': '高优先级',
    'priority.medium': '中优先级',
    'priority.low': '低优先级',
    'priority.short.high': '高',
    'priority.short.medium': '中',
    'priority.short.low': '低',

    'float.title': 'Aether Todo · 浮窗',
    'float.brand': 'Aether 专注',
    'float.noTask': '暂无待办，休息一下',
    'float.openMain': '打开主界面',
    'float.hide': '隐藏浮窗',
    'float.startFocus': '开始专注',
    'float.pause': '暂停',
    'float.resume': '继续',
    'float.stop': '停止',
    'float.opacity': '透明度',
    'topbar.float': '浮窗',
    'task.focus': '番茄钟',
    'task.focusStop': '结束专注',
    'pomodoro.running': '专注中',
    'pomodoro.paused': '已暂停',
    'pomodoro.confirmStop': '确定要提前结束当前专注吗？已完成的专注时间将被保留。',
    'pomodoro.confirmStopTitle': '结束本次专注',
    'pomodoro.stopConfirm': '结束专注',
    'pomodoro.stopped': '已结束本次专注',
    'drop.hint': '拖放邮件 (.eml) 或文件至此，AI 自动提取任务',
    'drop.release': '释放文件开始解析',
    'assistant.parsingFile': '正在读取并解析文件内容...',
    'assistant.thinking': 'AI 正在深度思考并拆解任务...',
    'task.new': '新建任务',
    'task.titlePlaceholder': '任务标题',
    'task.notePlaceholder': '备注（可选）',
    'task.save': '保存',
    'task.cancel': '取消',
    'task.edit': '编辑',
    'task.delete': '删除',
    'task.overdue': '已逾期',
    'task.aiCreated': 'AI 创建',
    'task.reasonPrefix': 'AI 判定：',
    'task.remindAt': '提醒 {time}',
    'task.markDone': '标记为已完成',
    'task.markUndone': '标记为未完成',
    'task.sendToIsland': '送入灵动岛',
    'toast.sentToIsland': '已送入灵动岛',
    'float.prevTask': '上一个任务',
    'float.nextTask': '下一个任务',
    'float.collapse': '收起灵动岛',
    'task.empty.title': '这里还没有任务',
    'task.empty.hint': '试试在右侧对 AI 说：「明天下午三点前把周报发给老板，很急」',

    'assistant.title': 'AI 助手',
    'assistant.subtitle': '自然语言解析 · 自动判优先级与分类',
    'assistant.clear': '清空',
    'assistant.placeholder': '用一句话描述你要做的事，回车发送（Shift+Enter 换行）',
    'assistant.send': '发送',
    'assistant.parsing': '解析中…',
    'assistant.welcome':
      '你好！直接用一句话告诉我你要做什么，我来帮你拆解成待办，并自动判断优先级和类别。\n例如：「明天下午三点前把周报发给老板，很急」',
    'assistant.cleared': '对话已清空。说说接下来要做什么？',
    'assistant.proposalHead': '解析出 {n} 条任务，可修改后加入',
    'assistant.proposalIgnore': '忽略',
    'assistant.proposalAdd': '加入待办',
    'assistant.completeHead': '识别到 {n} 条可能已完成的任务',
    'assistant.completeConfirm': '确认完成',
    'assistant.noTime': '未设定时间',
    'assistant.added': '已加入 {n} 条任务到你的待办列表。',
    'assistant.completed': '已标记 {n} 条任务为完成。',
    'assistant.pickFirst': '请先勾选要添加的任务',
    'assistant.errorPrefix': '出错了：',

    'quick.1': '明天下午三点前把周报发给老板，很急',
    'quick.2': '周末有空给妈妈打个电话',
    'quick.3': '下周三之前提交项目方案',

    'settings.title': '设置',
    'settings.close': '关闭',
    'settings.language': '界面语言',
    'settings.theme': '主题',
    'theme.light': '浅色',
    'theme.dark': '深色',
    'theme.system': '跟随系统',
    'settings.languageHint': '切换后立即生效，并会记住你的选择',
    'settings.generalSection': '通用',
    'settings.aiSection': 'AI 大模型',
    'settings.baseUrl': '接口地址（OpenAI 兼容）',
    'settings.apiKey': 'API Key',
    'settings.model': '模型名称',
    'settings.aiEnabled': '启用 AI 增强解析（关闭则始终使用本地规则解析）',
    'settings.proxyMode': '网络代理',
    'settings.proxyUrl': '代理地址',
    'settings.proxyHint': '支持 HTTP / HTTPS 代理（如 http://127.0.0.1:7890）；SOCKS 代理暂不支持。',
    'proxy.none': '不使用代理',
    'proxy.system': '跟随系统代理',
    'proxy.custom': '自定义代理',
    'settings.test': '测试连接',
    'settings.testing': '正在测试…',
    'settings.testOk': '连接成功',
    'settings.testOkEmpty': '连接成功（模型未返回内容，但链路正常）',
    'settings.aiHints':
      '· 支持 DeepSeek、通义千问、智谱、OpenAI、moonshot、本地 Ollama 等所有 OpenAI 兼容接口。<br />· 未配置 Key 或调用失败时，会自动降级为本地规则解析，功能依然可用。',
    'settings.pomoSection': '专注与悬浮窗',
    'settings.pomoMinutes': '番茄钟专注时长（分钟）',
    'settings.floatOpacity': '悬浮窗玻璃透明度',
    'settings.liquidLevel': '整体液态程度',
    'settings.liquidLevelMin': '30%（轻薄通透）',
    'settings.liquidLevelMax': '100%（厚重折射）',
    'settings.reminderSection': '提醒',
    'settings.reminderEnabled': '开启任务提醒（到点弹出系统通知）',
    'settings.lead': '默认提前提醒（分钟）',
    'settings.aboutSection': '关于',
    'settings.saved': '设置已保存',
    'settings.uninstall': '卸载应用',
    'settings.uninstallConfirm': '确定要卸载 Aether Todo 吗？应用将被关闭并启动卸载程序（本地数据会保留）。',
    'settings.aboutInfo':
      '版本 {version} · Electron {electron} / Node {node}<br />数据目录：{dir}<br />开源许可：Apache-2.0 · 由 WorkBuddy 构建',

    'toast.created': '任务已创建',
    'toast.saved': '已保存',
    'toast.deleted': '已删除',

    'date.today': '今天 {time}',
    'date.tomorrow': '明天 {time}',
    'date.monthDay': '{m}月{d}日 {time}',
    'date.full': '{y}-{m}-{d} {time}',
    'date.dayOnly': '{m}月{d}日',
    'date.fullDayOnly': '{y}-{m}-{d}',
    'date.unknown': '时间待定',

    // 重复任务
    'repeat.label': '重复',
    'repeat.none': '不重复',
    'repeat.day': '每天',
    'repeat.week': '每周',
    'repeat.month': '每月',
    'repeat.year': '每年',
    'repeat.every': '每',
    'repeat.unit.day': '天',
    'repeat.unit.week': '周',
    'repeat.unit.month': '个月',
    'repeat.unit.year': '年',
    'repeat.periods': '期',
    'repeat.weekdays': '在周几',
    'repeat.startDate': '生效起始日',
    'repeat.end': '结束条件',
    'repeat.endNever': '永不结束',
    'repeat.endUntil': '到指定日期',
    'repeat.endCount': '完成指定期数',
    'repeat.preview': '下一次：{date}',
    'repeat.previewNone': '按当前结束条件不会再生成下一期',
    'repeat.badge': '重复',
    'repeat.seriesHint': '该任务属于重复系列',
    'repeat.seriesNote': '属于重复系列：{summary}',
    'repeat.summary.day': '每 {n} 天',
    'repeat.summary.week': '每 {n} 周 · 周{days}',
    'repeat.summary.weekSingle': '每周 · 周{days}',
    'repeat.summary.month': '每 {n} 个月 · {d} 号',
    'repeat.summary.monthSingle': '每月 {d} 号',
    'repeat.summary.year': '每 {n} 年 · {m} 月 {d} 日',
    'repeat.summary.yearSingle': '每年 {m} 月 {d} 日',
    'repeat.monthEndNote': '该月没有这一天时，自动回退到当月最后一天',

    // 作用范围选择（仅本次 / 整个系列）
    'scope.editTitle': '编辑重复任务',
    'scope.deleteTitle': '删除重复任务',
    'scope.editMessage': '「{title}」属于重复系列，本次修改要应用到哪里？',
    'scope.deleteMessage': '「{title}」属于重复系列，要删除哪些内容？',
    'scope.once': '仅本次',
    'scope.onceEditHint': '只改这一期；其它期与系列规则保持不变',
    'scope.onceDeleteHint': '只删这一期，并自动生成下一期（跳过本期）',
    'scope.series': '整个系列',
    'scope.seriesEditHint': '同步所有未完成的期；已完成的期保留原样',
    'scope.seriesDeleteHint': '删除所有期（含已完成），系列不再继续',
    'toast.repeatCreated': '重复任务已创建',
    'toast.repeatNext': '已完成本期，下一期：{date}',
    'toast.seriesUpdated': '已更新整个系列',
    'toast.seriesDeleted': '已删除整个系列',
    'dialog.ok': '确定',
    'dialog.cancel': '取消',
    'relative.minutesLater': '{n} 分钟后',
    'relative.hoursLater': '{n} 小时后',
    'relative.daysLater': '{n} 天后',
    'relative.minutesAgo': '{n} 分钟前',
    'relative.hoursAgo': '{n} 小时前',
    'relative.daysAgo': '{n} 天前',
    'relative.now': '刚刚',

    'month.1': '1月', 'month.2': '2月', 'month.3': '3月', 'month.4': '4月', 'month.5': '5月', 'month.6': '6月',
    'month.7': '7月', 'month.8': '8月', 'month.9': '9月', 'month.10': '10月', 'month.11': '11月', 'month.12': '12月',
  },

  'en-US': {
    'app.title': 'Aether Todo',
    'app.tagline': 'Flowing tasks, focused states',

    'topbar.settings': 'Settings',
    'engine.local': 'Local parser',
    'engine.ai': 'AI enhanced',

    'stat.active': 'Active',
    'stat.done': 'Done',
    'stat.high': 'High priority',
    'stat.total': 'All',

    'sidebar.views': 'Views',
    'sidebar.categories': 'Categories',
    'sidebar.search': 'Search',
    'sidebar.searchPlaceholder': 'Search title or notes',

    'view.active': 'Active',
    'view.today': 'Due today',
    'view.high': 'High priority',
    'view.done': 'Done',
    'view.all': 'All tasks',
    'view.stats': 'Statistics',
    'stats.range.week': 'This week',
    'stats.range.month': 'This month',
    'stats.range.year': 'This year',
    'stats.completed': 'Completed',
    'stats.activeDays': 'Active days',
    'stats.perDay': 'Per day',
    'stats.perMonth': 'Per month',
    'stats.bestDay': 'Best day',
    'stats.trend': 'Completion trend',
    'stats.byCategory': 'By category',
    'stats.empty': 'Nothing completed in this period',
    'stats.cal.title': 'Completion calendar',
    'stats.cal.detail': 'Details for {date}',
    'stats.cal.count': '{n} completed',
    'stats.cal.empty': 'No completions on this day',
    'weekday.1': 'Mon',
    'weekday.2': 'Tue',
    'weekday.3': 'Wed',
    'weekday.4': 'Thu',
    'weekday.5': 'Fri',
    'weekday.6': 'Sat',
    'weekday.7': 'Sun',

    'category.all': 'All categories',
    'category.工作': 'Work',
    'category.学习': 'Study',
    'category.生活': 'Life',
    'category.健康': 'Health',
    'category.财务': 'Finance',
    'category.社交': 'Social',
    'category.其他': 'Other',

    'priority.high': 'High priority',
    'priority.medium': 'Medium priority',
    'priority.low': 'Low priority',
    'priority.short.high': 'High',
    'priority.short.medium': 'Med',
    'priority.short.low': 'Low',

    'float.title': 'Aether Todo · Floating',
    'float.brand': 'Aether Focus',
    'float.noTask': 'Nothing pending — enjoy a break',
    'float.openMain': 'Open main window',
    'float.hide': 'Hide floating window',
    'float.startFocus': 'Start focus',
    'float.pause': 'Pause',
    'float.resume': 'Resume',
    'float.stop': 'Stop',
    'float.opacity': 'Opacity',
    'topbar.float': 'Float',
    'task.focus': 'Pomodoro',
    'task.focusStop': 'Stop focus',
    'pomodoro.running': 'Focusing',
    'pomodoro.paused': 'Paused',
    'pomodoro.confirmStop': 'Are you sure you want to stop this focus session early? Completed time will be saved.',
    'pomodoro.confirmStopTitle': 'End this focus session',
    'pomodoro.stopConfirm': 'End focus',
    'pomodoro.stopped': 'Focus session ended',
    'drop.hint': 'Drop email (.eml) or file here for AI extraction',
    'drop.release': 'Release file to analyze',
    'assistant.parsingFile': 'Reading and parsing file...',
    'assistant.thinking': 'AI is analyzing and organizing tasks...',
    'task.new': 'New task',
    'task.titlePlaceholder': 'Task title',
    'task.notePlaceholder': 'Notes (optional)',
    'task.save': 'Save',
    'task.cancel': 'Cancel',
    'task.edit': 'Edit',
    'task.delete': 'Delete',
    'task.overdue': 'Overdue',
    'task.aiCreated': 'AI created',
    'task.reasonPrefix': 'AI verdict: ',
    'task.remindAt': 'Remind {time}',
    'task.markDone': 'Mark as done',
    'task.markUndone': 'Mark as not done',
    'task.sendToIsland': 'Send to island',
    'toast.sentToIsland': 'Sent to Dynamic Island',
    'float.prevTask': 'Previous task',
    'float.nextTask': 'Next task',
    'float.collapse': 'Collapse island',
    'task.empty.title': 'No tasks here yet',
    'task.empty.hint':
      'Try telling the AI on the right: "send the weekly report to my boss before 3pm tomorrow, it\'s urgent"',

    'assistant.title': 'AI assistant',
    'assistant.subtitle': 'Natural language parsing · auto priority & category',
    'assistant.clear': 'Clear',
    'assistant.placeholder': 'Describe what you need to do in one sentence — Enter to send (Shift+Enter for newline)',
    'assistant.send': 'Send',
    'assistant.parsing': 'Parsing…',
    'assistant.welcome':
      'Hi! Just tell me in one sentence what you need to do — I will break it into tasks with priority and category.\nFor example: "send the weekly report to my boss before 3pm tomorrow, it\'s urgent"',
    'assistant.cleared': 'Conversation cleared. What would you like to do next?',
    'assistant.proposalHead': 'Parsed {n} task(s) — edit before adding',
    'assistant.proposalIgnore': 'Ignore',
    'assistant.proposalAdd': 'Add to tasks',
    'assistant.completeHead': 'Found {n} task(s) that look finished',
    'assistant.completeConfirm': 'Mark as done',
    'assistant.noTime': 'No time set',
    'assistant.added': 'Added {n} task(s) to your list.',
    'assistant.completed': 'Marked {n} task(s) as done.',
    'assistant.pickFirst': 'Select at least one task first',
    'assistant.errorPrefix': 'Something went wrong: ',

    'quick.1': 'Send the weekly report to my boss before 3pm tomorrow, it\'s urgent',
    'quick.2': 'Call mom this weekend when I have time',
    'quick.3': 'Submit the project proposal before next Wednesday',

    'settings.title': 'Settings',
    'settings.close': 'Close',
    'settings.language': 'Language',
    'settings.theme': 'Theme',
    'theme.light': 'Light',
    'theme.dark': 'Dark',
    'theme.system': 'System',
    'settings.languageHint': 'Applies immediately and is remembered',
    'settings.generalSection': 'General',
    'settings.aiSection': 'AI model',
    'settings.baseUrl': 'API base URL (OpenAI compatible)',
    'settings.apiKey': 'API key',
    'settings.model': 'Model name',
    'settings.aiEnabled': 'Enable AI parsing (off = always use the local rule engine)',
    'settings.proxyMode': 'Network proxy',
    'settings.proxyUrl': 'Proxy address',
    'settings.proxyHint': 'HTTP/HTTPS proxies only (e.g. http://127.0.0.1:7890); SOCKS is not supported.',
    'proxy.none': 'No proxy',
    'proxy.system': 'Use system proxy',
    'proxy.custom': 'Custom proxy',
    'settings.test': 'Test connection',
    'settings.testing': 'Testing…',
    'settings.testOk': 'Connected',
    'settings.testOkEmpty': 'Connected (model returned no content, link is fine)',
    'settings.aiHints':
      '· Works with DeepSeek, Qwen, Zhipu, OpenAI, Moonshot, a local Ollama — any OpenAI-compatible endpoint.<br />· With no key configured, or when a call fails, it silently falls back to local parsing.',
    'settings.pomoSection': 'Focus & Floating Window',
    'settings.pomoMinutes': 'Focus duration (minutes)',
    'settings.floatOpacity': 'Floating window glass opacity',
    'settings.liquidLevel': 'Liquid glass intensity',
    'settings.liquidLevelMin': '30% (thin & sheer)',
    'settings.liquidLevelMax': '100% (thick refraction)',
    'settings.reminderSection': 'Reminders',
    'settings.reminderEnabled': 'Enable reminders (system notification when due)',
    'settings.lead': 'Default lead time (minutes)',
    'settings.aboutSection': 'About',
    'settings.saved': 'Settings saved',
    'settings.uninstall': 'Uninstall app',
    'settings.uninstallConfirm': 'Uninstall Aether Todo? The app will close and the uninstaller will start (your data folder is kept).',
    'settings.aboutInfo':
      'Version {version} · Electron {electron} / Node {node}<br />Data folder: {dir}<br />License: Apache-2.0 · Built by WorkBuddy',

    'toast.created': 'Task created',
    'toast.saved': 'Saved',
    'toast.deleted': 'Deleted',

    'date.today': 'Today {time}',
    'date.tomorrow': 'Tomorrow {time}',
    'date.monthDay': '{monthShort} {d}, {time}',
    'date.full': '{y}-{m}-{d} {time}',
    'date.dayOnly': '{monthShort} {d}',
    'date.fullDayOnly': '{y}-{m}-{d}',
    'date.unknown': 'Time TBD',

    // Recurring tasks
    'repeat.label': 'Repeat',
    'repeat.none': 'Does not repeat',
    'repeat.day': 'Daily',
    'repeat.week': 'Weekly',
    'repeat.month': 'Monthly',
    'repeat.year': 'Yearly',
    'repeat.every': 'Every',
    'repeat.unit.day': 'day(s)',
    'repeat.unit.week': 'week(s)',
    'repeat.unit.month': 'month(s)',
    'repeat.unit.year': 'year(s)',
    'repeat.periods': 'times',
    'repeat.weekdays': 'On',
    'repeat.startDate': 'Starts on',
    'repeat.end': 'Ends',
    'repeat.endNever': 'Never',
    'repeat.endUntil': 'On a date',
    'repeat.endCount': 'After a number of times',
    'repeat.preview': 'Next: {date}',
    'repeat.previewNone': 'No further occurrence with the current end rule',
    'repeat.badge': 'Repeats',
    'repeat.seriesHint': 'This task belongs to a repeating series',
    'repeat.seriesNote': 'Part of a repeating series: {summary}',
    'repeat.summary.day': 'Every {n} days',
    'repeat.summary.week': 'Every {n} weeks · {days}',
    'repeat.summary.weekSingle': 'Weekly · {days}',
    'repeat.summary.month': 'Every {n} months · day {d}',
    'repeat.summary.monthSingle': 'Monthly · day {d}',
    'repeat.summary.year': 'Every {n} years · {m}/{d}',
    'repeat.summary.yearSingle': 'Yearly · {m}/{d}',
    'repeat.monthEndNote': 'When a month is shorter, it falls back to its last day',

    // Scope picker (this occurrence / entire series)
    'scope.editTitle': 'Edit repeating task',
    'scope.deleteTitle': 'Delete repeating task',
    'scope.editMessage': '"{title}" belongs to a repeating series. Where should this change apply?',
    'scope.deleteMessage': '"{title}" belongs to a repeating series. What should be deleted?',
    'scope.once': 'This occurrence only',
    'scope.onceEditHint': 'Only this occurrence changes; other occurrences stay as they are',
    'scope.onceDeleteHint': 'Delete only this occurrence and generate the next one (skip this time)',
    'scope.series': 'The entire series',
    'scope.seriesEditHint': 'Update every open occurrence; completed ones keep their history',
    'scope.seriesDeleteHint': 'Delete every occurrence including completed ones; the series stops',
    'toast.repeatCreated': 'Repeating task created',
    'toast.repeatNext': 'Done — next occurrence: {date}',
    'toast.seriesUpdated': 'Entire series updated',
    'toast.seriesDeleted': 'Entire series deleted',
    'dialog.ok': 'OK',
    'dialog.cancel': 'Cancel',
    'relative.minutesLater': 'in {n} min',
    'relative.hoursLater': 'in {n} h',
    'relative.daysLater': 'in {n} d',
    'relative.minutesAgo': '{n} min ago',
    'relative.hoursAgo': '{n} h ago',
    'relative.daysAgo': '{n} d ago',
    'relative.now': 'just now',

    'month.1': 'Jan', 'month.2': 'Feb', 'month.3': 'Mar', 'month.4': 'Apr', 'month.5': 'May', 'month.6': 'Jun',
    'month.7': 'Jul', 'month.8': 'Aug', 'month.9': 'Sep', 'month.10': 'Oct', 'month.11': 'Nov', 'month.12': 'Dec',
  },
};

let currentLocale: Locale = DEFAULT_LOCALE;

// 启动时先取上次保存的语言，避免界面闪烁（随后会被设置里的值覆盖）
try {
  const saved = localStorage.getItem('ai_todo_locale');
  if (saved) currentLocale = normalizeLocale(saved);
} catch {
  /* 忽略 */
}

export function normalizeLocale(locale: string | undefined | null): Locale {
  if (!locale) return DEFAULT_LOCALE;
  if (locale in MESSAGES) return locale as Locale;
  const lower = String(locale).toLowerCase();
  if (lower.startsWith('en')) return 'en-US';
  if (lower.startsWith('zh')) return 'zh-CN';
  return DEFAULT_LOCALE;
}

export function setLocale(locale: string): Locale {
  currentLocale = normalizeLocale(locale);
  try {
    localStorage.setItem('ai_todo_locale', currentLocale);
  } catch {
    /* 忽略 */
  }
  return currentLocale;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function isEnglish(): boolean {
  return currentLocale === 'en-US';
}

/** 翻译，支持 {param} 插值 */
export function t(key: string, params: Record<string, string | number> = {}): string {
  const table = MESSAGES[currentLocale] || MESSAGES[DEFAULT_LOCALE];
  let text = table[key];
  if (text === undefined) text = MESSAGES[DEFAULT_LOCALE][key];
  if (text === undefined) return key;
  for (const [k, v] of Object.entries(params)) {
    text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}

/** 类别 key → 当前语言的显示名 */
export function categoryLabel(key: string): string {
  return t(`category.${key}`);
}

/** 优先级 → 显示名（完整 / 简短） */
export function priorityLabel(priority: string, short = false): string {
  return t(`priority.${short ? 'short.' : ''}${priority}`);
}

/**
 * 把当前语言应用到静态 DOM：
 *   data-i18n → textContent；data-i18n-placeholder → placeholder；
 *   data-i18n-title → title；data-i18n-html → innerHTML
 */
export function applyStaticI18n(root: ParentNode = document): void {
  for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-i18n]'))) {
    node.textContent = t(node.dataset.i18n as string);
  }
  for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]'))) {
    node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder as string));
  }
  for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-i18n-title]'))) {
    node.setAttribute('title', t(node.dataset.i18nTitle as string));
  }
  for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-i18n-html]'))) {
    node.innerHTML = t(node.dataset.i18nHtml as string);
  }
  const title = root.querySelector<HTMLTitleElement>('title[data-i18n]');
  if (title) title.textContent = t(title.dataset.i18n as string);
}
