'use strict';
/**
 * 主进程国际化（i18n）
 * 覆盖：本地规则引擎的文案、系统提示词语言、提醒通知、托盘菜单、窗口标题。
 * 渲染进程有自己的一份（src/renderer/src/i18n.ts），key 命名保持一致。
 */

import type { Locale } from '../shared/types';

const DEFAULT_LOCALE = 'zh-CN';

type MessageTable = Record<string, string>;

const MESSAGES: Record<string, MessageTable> = {
  'zh-CN': {
    'app.title': 'Aether Todo',
    'priority.short.high': '高',
    'priority.short.medium': '中',
    'priority.short.low': '低',
    'engine.local': '本地解析',
    'engine.ai': 'AI 增强',

    // 本地规则引擎
    'local.priority.keywordUrgent': '描述中包含「{word}」，判定为紧急事项',
    'local.priority.keywordRelaxed': '描述中包含「{word}」，时间上并不紧迫',
    'local.priority.dueWithin24h': '24 小时内到期，时间紧迫',
    'local.priority.dueWithin3d': '三天内到期，需要提前安排',
    'local.priority.farAway': '距离截止时间尚早，可从容安排',
    'local.priority.noPressure': '未识别到明确的时间压力，按常规优先级处理',
    'local.note.timeRecognized': '从「{matched}」自动识别',
    'local.reply.created': '已解析出 {count} 条任务{timePart}{highPart}。确认无误后点击「加入待办」即可。',
    'local.reply.timePart': '，其中 {count} 条识别到了时间',
    'local.reply.highPart': '，{count} 条标记为高优先级',
    'local.reply.completeFound': '我找到 {count} 条可能已完成的任务，确认后我会帮你标记完成。',
    'local.reply.listHeader': '你当前有 {count} 条待办：',
    'local.reply.listEmpty': '当前没有待办，可以说一句「明天下午三点开会」让我帮你记下来。',
    'local.reply.chatHint':
      '我主要帮你把想法变成待办。试试这样说：「明天下午三点前把周报发给老板，很急」或「周末有空的话给妈妈打个电话」。',
    'local.reply.listItem': '· {title}（{priority}优先级 · {category}）',
    'local.error.prefix': 'AI 调用失败已降级本地解析：',
    'local.fallback.empty': '模型这次没返回内容（属正常波动），已改用本地规则解析。',

    // 提醒通知
    'notify.title.high': '高优先级任务提醒',
    'notify.title.normal': '待办提醒',
    'notify.body': '{title}\n{category} · {time}',
    'notify.check.title': '提醒检查',
    'notify.check.due': '{count} 条任务已到期：{first}',
    'notify.check.none': '暂无到期任务',

    // 托盘
    'tray.tooltip': 'Aether Todo',
    'tray.open': '打开主界面',
    'tray.float': '灵动岛',
    'tray.check': '立即检查提醒',
    'float.title': 'Aether Todo · 灵动岛',
    'notify.windowTitle': 'Aether Todo · 通知',
    'pomodoro.done.title': '专注完成',
    'pomodoro.done.body': '「{title}」的一个番茄钟已完成，休息一下吧。',
    'tray.exit': '退出',
  },

  'en-US': {
    'app.title': 'Aether Todo',
    'priority.short.high': 'High',
    'priority.short.medium': 'Med',
    'priority.short.low': 'Low',
    'engine.local': 'Local parser',
    'engine.ai': 'AI enhanced',

    // Local rule engine
    'local.priority.keywordUrgent': 'Contains "{word}" — marked as urgent',
    'local.priority.keywordRelaxed': 'Contains "{word}" — no time pressure detected',
    'local.priority.dueWithin24h': 'Due within 24 hours, time is tight',
    'local.priority.dueWithin3d': 'Due within three days, plan ahead',
    'local.priority.farAway': 'Deadline is far away, plenty of time',
    'local.priority.noPressure': 'No time pressure detected, treating as normal priority',
    'local.note.timeRecognized': 'Recognized from "{matched}"',
    'local.reply.created': 'Parsed {count} task(s){timePart}{highPart}. Review and hit "Add to tasks" to confirm.',
    'local.reply.timePart': ', {count} of them with a detected time',
    'local.reply.highPart': ', {count} flagged as high priority',
    'local.reply.completeFound': 'I found {count} task(s) that look finished — confirm and I will tick them off.',
    'local.reply.listHeader': 'You currently have {count} task(s):',
    'local.reply.listEmpty':
      'Nothing pending right now. Try saying "meeting tomorrow at 3pm" and I will note it down for you.',
    'local.reply.chatHint':
      'I turn thoughts into tasks. Try: "send the weekly report to my boss before 3pm tomorrow, it\'s urgent" or "call mom this weekend".',
    'local.reply.listItem': '· {title} ({priority} priority · {category})',
    'local.error.prefix': 'AI call failed, fell back to local parsing: ',
    'local.fallback.empty': 'The model returned no content this time (normal fluctuation) — used local parsing instead.',

    // Notifications
    'notify.title.high': 'High-priority reminder',
    'notify.title.normal': 'Task reminder',
    'notify.body': '{title}\n{category} · {time}',
    'notify.check.title': 'Reminder check',
    'notify.check.due': '{count} task(s) are due: {first}',
    'notify.check.none': 'Nothing due right now',

    // Tray
    'tray.tooltip': 'Aether Todo',
    'tray.open': 'Open main window',
    'tray.float': 'Dynamic Island',
    'tray.check': 'Check reminders now',
    'float.title': 'Aether Todo · Dynamic Island',
    'notify.windowTitle': 'Aether Todo · Notification',
    'pomodoro.done.title': 'Focus session complete',
    'pomodoro.done.body': 'One pomodoro on "{title}" is done — take a break.',
    'tray.exit': 'Quit',
  },
};

const SUPPORTED = Object.keys(MESSAGES) as Locale[];

function normalizeLocale(locale: string | undefined | null): Locale {
  if (!locale) return DEFAULT_LOCALE;
  if ((MESSAGES as Record<string, MessageTable>)[locale]) return locale as Locale;
  // 宽松匹配：en / en-GB → en-US；zh / zh-TW → zh-CN
  const lower = String(locale).toLowerCase();
  if (lower.startsWith('en')) return 'en-US';
  if (lower.startsWith('zh')) return 'zh-CN';
  return DEFAULT_LOCALE as Locale;
}

/** 翻译，支持 {param} 插值 */
function t(locale: string | undefined | null, key: string, params: Record<string, string | number> = {}): string {
  const loc = normalizeLocale(locale);
  const table = MESSAGES[loc] || MESSAGES[DEFAULT_LOCALE];
  let text = table[key];
  if (text === undefined) text = MESSAGES[DEFAULT_LOCALE][key];
  if (text === undefined) return key;
  for (const [k, v] of Object.entries(params)) {
    text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}

function isEnglish(locale: string | undefined | null): boolean {
  return normalizeLocale(locale) === 'en-US';
}

export { t, MESSAGES, SUPPORTED, DEFAULT_LOCALE, normalizeLocale, isEnglish };
