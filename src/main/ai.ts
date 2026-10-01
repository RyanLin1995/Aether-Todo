/**
 * AI 服务：自然语言 → 结构化任务
 *
 * 双引擎设计：
 *  1) 远端大模型（OpenAI 兼容接口，可配置 DeepSeek / 通义 / 智谱 / OpenAI / 本地 Ollama 等）
 *  2) 本地规则引擎（无需 Key 也能用：中文/英文时间解析 + 优先级关键词 + 类别词典）
 * 远端不可用或超时时自动降级到本地引擎，保证功能永远可用。
 */
import * as i18n from './i18n';
import { buildSystemPrompt, buildTasksDigest, CURRENT_TIME_HINT } from './prompt';
import type { AiTaskDraft, AppSettings, Intent, Locale, UnderstandResult } from '../shared/types';

const CATEGORIES = ['工作', '学习', '生活', '健康', '财务', '社交', '其他'];

/** 模型偶尔会用英文类别，这里统一归一到内部中文 key */
const CATEGORY_ALIASES: Record<string, string> = {
  work: '工作',
  study: '学习',
  school: '学习',
  learning: '学习',
  life: '生活',
  personal: '生活',
  home: '生活',
  health: '健康',
  fitness: '健康',
  finance: '财务',
  money: '财务',
  social: '社交',
  family: '社交',
  other: '其他',
  misc: '其他',
};

interface CategoryRule {
  category: string;
  words: string[];
}

/** 类别关键词词典（中英混合输入均可识别） */
const CATEGORY_KEYWORDS: CategoryRule[] = [
  { category: '工作', words: ['会议', '开会', '汇报', '项目', '需求', '方案', '报告', '周报', '邮件', '客户', '合同', '代码', 'bug', '上线', '日报', '评审', '对接', '领导', '老板', '同事', '加班', 'deadline', 'prd', '排期', '复盘', '面试', 'offer', '站会', '提测', '发版', 'meeting', 'report', 'boss', 'email', 'client', 'project', 'proposal', 'presentation', 'slides', 'contract', 'colleague', 'work'] },
  { category: '学习', words: ['学习', '复习', '考试', '课程', '作业', '论文', '读书', '背单词', '刷题', '上课', '培训', '笔记', '考研', '英语', '教程', '课件', '毕设', '答辩', '阅读', 'study', 'exam', 'homework', 'course', 'lesson', 'assignment', 'thesis', 'read', 'learn', 'textbook'] },
  { category: '生活', words: ['买', '购物', '快递', '取件', '打扫', '洗衣', '洗衣服', '做饭', '买菜', '收拾', '整理', '书架', '收纳', '家务', '倒垃圾', '维修', '水电', '物业', '搬家', '订票', '机票', '酒店', '加油', '洗车', '宠物', '遛狗', '浇花', '理发', '超市', 'buy', 'groceries', 'shopping', 'milk', 'clean', 'laundry', 'cook', 'tidy', 'repair', 'ticket', 'hotel', 'dog', 'package', 'supermarket'] },
  { category: '健康', words: ['跑步', '健身', '运动', '锻炼', '医院', '体检', '吃药', '看病', '牙医', '早睡', '喝水', '瑜伽', '就诊', '疫苗', '复诊', '理疗', '减肥', '拉伸', '健身房', 'run', 'gym', 'workout', 'exercise', 'doctor', 'hospital', 'medicine', 'pill', 'sleep', 'yoga', 'checkup', 'dentist'] },
  { category: '财务', words: ['报销', '发票', '工资', '账单', '还钱', '还款', '信用卡', '付款', '缴费', '理财', '转账', '税', '房租', '贷款', '预算', '记账', 'pay', 'rent', 'invoice', 'bill', 'tax', 'salary', 'budget', 'bank', 'loan', 'refund'] },
  { category: '社交', words: ['朋友', '聚会', '生日', '礼物', '拜访', '聚餐', '打电话', '联系', '约会', '婚礼', '同学', '家人', '爸妈', '父母', '妈妈', '爸爸', '爷爷', '奶奶', '问候', '回消息', '请客', 'call', 'mom', 'dad', 'friend', 'birthday', 'gift', 'party', 'dinner', 'visit', 'family', 'message', 'wedding'] },
];

const HIGH_KEYWORDS = [
  '紧急', '急', '马上', '立刻', '立即', '尽快', 'asap', '优先', '重要', '关键', '务必', '一定', '千万',
  '截止', 'deadline', '今天必须', '今晚必须', '老板', '领导催', '客户催', '别忘', '千万别',
  'urgent', 'important', 'critical', 'right away', 'right now', 'immediately', 'must', 'no later',
];
const LOW_KEYWORDS = [
  '有空', '顺便', '不急', '以后', '改天', '再说', '可以考虑', '也许', '或许', '大概', '闲着', '可选',
  'optional', '低优先', '不重要的', 'no rush', 'whenever', 'sometime', 'maybe', 'if possible', 'low priority',
];

/** 常见动作词：一句话里出现这些词（或明确时间），才认为用户在描述任务 */
const TASK_VERBS = [
  // 中文
  '提醒', '记得', '要做', '得做', '需要', '帮我', '安排', '准备', '提交', '整理', '清理', '检查',
  '跟进', '确认', '预约', '报名', '缴费', '发送', '发给', '回复', '处理', '完成', '优化', '修复',
  '买', '约', '开会', '写', '看', '读', '练', '跑', '走', '学', '复习', '背', '打卡', '联系',
  '还', '交', '打', '取', '送', '去', '修', '换', '洗', '做饭', '收拾', '体检', '报销',
  // English
  'send', 'email', 'call', 'text', 'buy', 'pay', 'submit', 'review', 'prepare', 'book', 'schedule',
  'finish', 'write', 'read', 'study', 'run', 'go', 'get', 'take', 'fix', 'clean', 'wash', 'check',
  'confirm', 'order', 'deliver', 'pick', 'renew', 'cancel', 'attend', 'meet', 'practice', 'exercise',
  'update', 'ship', 'organize', 'plan', 'do', 'make',
];

interface TimeParseResult {
  dueAt: string | null;
  matched: string | null;
}

/** 中文数字 → 阿拉伯数字，便于解析「八点半」「十月五号」「两点」 */
function normalizeChineseNumbers(s: string): string {
  const map: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let out = String(s || '');
  out = out.replace(/([一二三四五六七八九两])?十([一二三四五六七八九])?/g, (_m, tens: string, ones: string) => {
    return String((tens ? map[tens] : 1) * 10 + (ones ? map[ones] : 0));
  });
  out = out.replace(/[零一二三四五六七八九两]/g, (m) => String(map[m]));
  return out;
}

function parseZhDateTime(text: string, now: Date): TimeParseResult {
  const src = normalizeChineseNumbers(String(text || ''));
  if (!src) return { dueAt: null, matched: null };
  const lower = src.toLowerCase();

  let date: { y: number; m: number; d: number } | null = null;
  let dateMatched: string | null = null;

  const setDay = (base: Date, offsetDays: number): void => {
    const d = new Date(base.getTime());
    d.setDate(d.getDate() + offsetDays);
    date = { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
  };

  // 相对天数
  const relMap: [RegExp, number][] = [
    [/大后天|大大后天/, 3],
    [/后天/, 2],
    [/明天|明日|明早|明晚|明儿/, 1],
    [/今天|今日|今晚|今早|今儿/, 0],
    [/昨天/, -1],
  ];
  for (const [re, off] of relMap) {
    if (re.test(lower)) {
      setDay(now, off);
      dateMatched = lower.match(re)![0];
      break;
    }
  }

  // 周 N（本周 / 下周 / 本周五 / 下周三）
  if (!date) {
    const weekMatch = src.match(/(下{1,2}周|本周|这周|下周)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/);
    if (weekMatch) {
      const mapIdx: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7 };
      const target = mapIdx[weekMatch[2]];
      const cur = now.getDay() === 0 ? 7 : now.getDay();
      let delta = target - cur;
      const prefix = weekMatch[1] || '';
      if (prefix.includes('下')) {
        delta += 7 * (prefix.startsWith('下下') ? 2 : 1);
      } else if (delta < 0) {
        delta += 7;
      }
      setDay(now, delta);
      dateMatched = weekMatch[0];
    }
  }

  // X月X日 / X月X号 / X/X / X-X
  if (!date) {
    const md = src.match(/(\d{1,2})\s*[\/月\-]\s*(\d{1,2})\s*[日号]?/);
    if (md) {
      const month = Number(md[1]);
      const day = Number(md[2]);
      let year = now.getFullYear();
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        if (month < now.getMonth() + 1) year += 1;
        date = { y: year, m: month - 1, d: day };
        dateMatched = md[0];
      }
    }
  }

  // N 天后 / N 小时后 / N 分钟后
  let timeMatched: string | null = null;
  let hours: number | null = null;
  let minutes: number | null = null;
  let plusMinutes = 0;

  const relUnit = src.match(/(\d{1,4})\s*(分钟|分|小时|钟头|天|周|个?月)\s*(后|以内|之内)?/);
  if (relUnit && /后/.test(src.slice(relUnit.index!, relUnit.index! + relUnit[0].length + 2))) {
    const n = Number(relUnit[1]);
    const unit = relUnit[2];
    if (unit.includes('分钟') || unit === '分') plusMinutes = n;
    else if (unit.includes('小时') || unit.includes('钟头')) plusMinutes = n * 60;
    else if (unit.includes('天')) plusMinutes = n * 1440;
    else if (unit.includes('周')) plusMinutes = n * 10080;
    else if (unit.includes('月')) plusMinutes = n * 43200;
    timeMatched = relUnit[0];
  }

  // 明确时间点：下午3点 / 3点半 / 15:30 / 晚上八点
  const hm = src.match(/(上午|早上|早晨|凌晨|中午|下午|傍晚|晚上|夜里|今晚|明晚)?\s*(\d{1,2})\s*[:：点時时]\s*(\d{1,2})?\s*(分|半)?/);
  if (hm) {
    let h = Number(hm[2]);
    const m = hm[3] ? Number(hm[3]) : /半/.test(hm[0]) ? 30 : 0;
    const period = hm[1] || '';
    if (
      (period.includes('下午') || period.includes('晚上') || period.includes('傍晚') || period.includes('夜里') || period.includes('今晚') || period.includes('明晚')) &&
      h < 12
    ) {
      h += 12;
    }
    if (period.includes('中午') && h < 12) h = 12;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      hours = h;
      minutes = m;
      timeMatched = hm[0].trim();
    }
  } else {
    const periodMap: [RegExp, number][] = [
      [/早上|早晨|上午|今早|明早/, 9],
      [/中午|午休/, 12],
      [/下午/, 15],
      [/傍晚/, 18],
      [/晚上|夜里|今晚|明晚/, 20],
      [/睡前/, 22],
    ];
    for (const [re, h] of periodMap) {
      if (re.test(src)) {
        hours = h;
        minutes = 0;
        timeMatched = re.exec(src)![0];
        break;
      }
    }
  }

  if (plusMinutes > 0) {
    const d = new Date(now.getTime() + plusMinutes * 60 * 1000);
    return { dueAt: d.toISOString(), matched: timeMatched || `${plusMinutes}分钟后` };
  }

  if (!date && (hours === null || hours === undefined)) return { dueAt: null, matched: null };

  const base = date || { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
  const hh = hours === null || hours === undefined ? 18 : hours; // 未指定时间默认当天 18:00
  const mm = minutes || 0;
  const result = new Date(base.y, base.m, base.d, hh, mm, 0, 0);
  return { dueAt: result.toISOString(), matched: dateMatched || timeMatched };
}

/** 英文时间表达：tomorrow / next monday / at 3pm / in 2 hours */
function parseEnglishDateTime(text: string, now: Date): TimeParseResult {
  const src = String(text || '').toLowerCase();
  if (!src) return { dueAt: null, matched: null };

  let date: { y: number; m: number; d: number } | null = null;
  let dateMatched: string | null = null;
  const setDay = (offsetDays: number): void => {
    const d = new Date(now.getTime());
    d.setDate(d.getDate() + offsetDays);
    date = { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
  };

  const dayMap: [RegExp, number][] = [
    [/today|tonight|this morning|this evening/, 0],
    [/tomorrow|tmrw|tmr/, 1],
    [/day after tomorrow/, 2],
    [/yesterday/, -1],
  ];
  for (const [re, off] of dayMap) {
    if (re.test(src)) {
      setDay(off);
      dateMatched = src.match(re)![0];
      break;
    }
  }

  const weekdays: Record<string, number> = {
    monday: 1, mon: 1, tuesday: 2, tue: 2, wednesday: 3, wed: 3,
    thursday: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 0, sun: 0,
  };
  if (!date) {
    const m = src.match(/\b((?:next|this)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/);
    if (m) {
      const target = weekdays[m[2]];
      const cur = now.getDay();
      let delta = target - cur;
      if (/next/.test(m[1] || '')) delta += 7;
      else if (delta <= 0) delta += 7;
      setDay(delta);
      dateMatched = m[0];
    }
  }

  if (!date) {
    const md = src.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/);
    if (md) {
      const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const month = months.indexOf(md[1]);
      let year = now.getFullYear();
      if (month + 1 < now.getMonth() + 1) year += 1;
      date = { y: year, m: month, d: Number(md[2]) };
      dateMatched = md[0];
    }
  }

  // in 2 hours / in 30 minutes / in 3 days
  const rel = src.match(/\bin\s+(\d{1,4})\s*(minutes?|mins?|hours?|hrs?|days?|weeks?)\b/);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2];
    let plus = 0;
    if (unit.startsWith('minute') || unit.startsWith('min')) plus = n;
    else if (unit.startsWith('hour') || unit.startsWith('hr')) plus = n * 60;
    else if (unit.startsWith('day')) plus = n * 1440;
    else if (unit.startsWith('week')) plus = n * 10080;
    return { dueAt: new Date(now.getTime() + plus * 60000).toISOString(), matched: rel[0] };
  }

  let hours: number | null = null;
  let minutes: number | null = null;
  let timeMatched: string | null = null;
  const hm = src.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\bat\s+(\d{1,2})(?::(\d{2}))?\b/);
  if (hm) {
    let h = Number(hm[1] ?? hm[4]);
    const m = Number(hm[2] ?? hm[5] ?? 0);
    const meridiem = hm[3];
    if (meridiem === 'pm' && h < 12) h += 12;
    if (meridiem === 'am' && h === 12) h = 0;
    hours = h;
    minutes = m;
    timeMatched = hm[0].trim();
  } else {
    const periodMap: [RegExp, number][] = [
      [/\bmorning\b/, 9],
      [/\bnoon\b|\bmidday\b/, 12],
      [/\bafternoon\b/, 15],
      [/\bevening\b/, 19],
      [/\btonight\b/, 20],
      [/\bnight\b/, 21],
    ];
    for (const [re, h] of periodMap) {
      if (re.test(src)) {
        hours = h;
        minutes = 0;
        timeMatched = src.match(re)![0];
        break;
      }
    }
  }

  if (!date && hours === null) return { dueAt: null, matched: null };
  const base = date || { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
  return {
    dueAt: new Date(base.y, base.m, base.d, hours === null ? 18 : hours, minutes || 0, 0, 0).toISOString(),
    matched: dateMatched || timeMatched,
  };
}

/** 统一入口：先中文，再英文 */
function parseDateTime(text: string, now: Date = new Date()): TimeParseResult {
  const zh = parseZhDateTime(text, now);
  if (zh.dueAt) return zh;
  return parseEnglishDateTime(text, now);
}

/** 抽取「提前 X 分钟提醒」 */
function parseRemindLead(text: string): number {
  const m = String(text || '').match(/提前\s*(\d{1,4})\s*(分钟|分|小时)/);
  if (!m) return 0;
  const n = Number(m[1]);
  return m[2].includes('小时') ? n * 60 : n;
}

/** 关键词分类 */
function detectCategory(text: string): string {
  const t = String(text || '').toLowerCase();
  let best = '其他';
  let bestScore = 0;
  for (const { category, words } of CATEGORY_KEYWORDS) {
    let score = 0;
    for (const w of words) {
      if (t.includes(w.toLowerCase())) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = category;
    }
  }
  return best;
}

interface PriorityVerdict {
  priority: 'high' | 'medium' | 'low';
  reason: string;
}

/** 关键词判优先级（含理由） */
function detectPriority(text: string, dueAt: string | null, locale: string = 'zh-CN'): PriorityVerdict {
  const t = String(text || '').toLowerCase();
  for (const w of HIGH_KEYWORDS) {
    if (t.includes(w)) {
      return { priority: 'high', reason: i18n.t(locale, 'local.priority.keywordUrgent', { word: w }) };
    }
  }
  for (const w of LOW_KEYWORDS) {
    if (t.includes(w)) {
      return { priority: 'low', reason: i18n.t(locale, 'local.priority.keywordRelaxed', { word: w }) };
    }
  }
  if (dueAt) {
    const diffHours = (new Date(dueAt).getTime() - Date.now()) / 3600000;
    if (diffHours <= 24) return { priority: 'high', reason: i18n.t(locale, 'local.priority.dueWithin24h') };
    if (diffHours <= 72) return { priority: 'medium', reason: i18n.t(locale, 'local.priority.dueWithin3d') };
    return { priority: 'low', reason: i18n.t(locale, 'local.priority.farAway') };
  }
  return { priority: 'medium', reason: i18n.t(locale, 'local.priority.noPressure') };
}

/** 把一段话切成多条任务 */
function splitTasks(text: string): string[] {
  const s = String(text || '').trim();
  if (!s) return [];
  const byLine = s
    .split(/[\n；;]+/)
    .map((x) => x.replace(/^\s*[-*•·\d]+[.、)]?\s*/, '').trim())
    .filter(Boolean);
  const result: string[] = [];
  for (const line of byLine) {
    // 行内再用「然后、接着、还有、另外、以及」切分（保守：只在有逗号/顿号时切）
    const parts = line
      .split(/[，,](?=\s*(?:然后|接着|还有|另外|再|以及))/)
      .map((x) => x.trim())
      .filter(Boolean);
    result.push(...(parts.length ? parts : [line]));
  }
  return result.filter((x) => x.length >= 2).slice(0, 20);
}

/** 清理标题：去掉「提醒我」「帮我」等口水词与时间修饰，保留核心动作 */
function cleanTitle(sentence: string): string {
  const origin = String(sentence || '').trim();
  let t = origin;
  // 中文：连接词与口水词
  t = t.replace(
    /^(另外|然后|接着|还有|以及|并且|再|请|帮我|麻烦|记得|提醒我|待会儿|一会儿|等下|顺便|有空的时候|有空的话|有空)\s*/,
    ''
  );
  // 中文：开头的时间表达（时间已单独存到 dueAt 字段，标题里不必重复）
  t = t.replace(
    /^(今天|明天|后天|大后天|今晚|明晚|明早|今早|周末|下周[一二三四五六日天1-7]|周[一二三四五六日天1-7]|星期[一二三四五六日天1-7])?\s*(上午|下午|晚上|早上|中午|傍晚)?\s*\d{1,2}\s*[:：点时]?\s*(\d{1,2}|半)?\s*分?\s*(之前|以前|前)?\s*/,
    ''
  );
  t = t.replace(/^(今天|明天|后天|大后天|今晚|明晚|明早|今早|周末|下周|本周)\s*/, '');
  // 英文：please / remind me to / don't forget to
  t = t.replace(/^(please|pls|kindly)\s+/i, '');
  t = t.replace(/^(remind me to|remind me|don'?t forget to|remember to|i need to|i have to|i must)\s+/i, '');
  t = t.replace(
    /^(today|tomorrow|tonight|this evening|this afternoon|this morning|next week|next (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))[\s,]*(?:at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?[\s,]*)?(?:before|by|on)?[\s,]*/i,
    ''
  );
  t = t.replace(/^(by|before|at)\s+\d{1,2}(?::\d{2})?\s*(am|pm)?[\s,]*/i, '');
  // 句中残留的英文时间短语（时间已存到 dueAt，标题里不必重复）
  t = t.replace(
    /\s+(today|tomorrow|tonight|this (?:morning|afternoon|evening)|next (?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday))(\s*,?\s*(?:at|by|before)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/gi,
    ''
  );
  t = t.replace(/\s*,?\s*(?:at|by|before)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?/gi, '');
  // 结尾的情绪/程度修饰（已体现在优先级与理由里）
  t = t.replace(/[，,、]?\s*(很急|紧急|很紧急|挺急|比较急|有点急|急|非常重要|很重要|重要的|很重要的事)$/, '');
  t = t.replace(/[,\s]*(it'?s urgent|urgent|asap|very urgent|super urgent|important)$/i, '');
  t = t.replace(/^(when i have time|if i have time|sometime|whenever)[\s,]*/i, '');
  t = t.replace(/[。！!？?.；;\s]+$/, '');
  return t.trim() || origin;
}

/** 两个字符串的最长公共子串 */
function longestCommonSubstr(a: string, b: string): string {
  const s1 = String(a || '');
  const s2 = String(b || '');
  if (!s1 || !s2) return '';
  let best = '';
  const dp: number[][] = Array.from({ length: s1.length + 1 }, () => new Array(s2.length + 1).fill(0));
  for (let i = 1; i <= s1.length; i += 1) {
    for (let j = 1; j <= s2.length; j += 1) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
        if (dp[i][j] > best.length) best = s1.slice(i - dp[i][j], i);
      }
    }
  }
  return best;
}

/** 从模型输出中稳健地提取 JSON（兼容 ```json 代码块与前后废话） */
function extractJson(text: string): Record<string, unknown> | null {
  const s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : s;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeIso(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** 规范化模型返回的字段 */
function normalizeAiTasks(list: unknown, _now: Date, locale = 'zh-CN'): AiTaskDraft[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((t: any): t is Record<string, unknown> => t && (t.title || t.task || t.name))
    .slice(0, 20)
    .map((t) => {
      const title = String(t.title || t.task || t.name).slice(0, 200);
      const dueAt = (t.dueAt || t.due_time || t.dueDate || null) as string | null;
      const rawCategory = String(t.category || '').trim();
      const category = (CATEGORIES as string[]).includes(rawCategory)
        ? rawCategory
        : CATEGORY_ALIASES[rawCategory.toLowerCase()] || detectCategory(`${title} ${t.note || ''}`);
      let priority = String(t.priority || '').toLowerCase();
      if (!['high', 'medium', 'low'].includes(priority)) {
        const zh = ({ 高: 'high', 中: 'medium', 低: 'low' } as Record<string, 'high' | 'medium' | 'low'>)[String(t.priority || '')];
        priority = zh || detectPriority(title, dueAt, locale).priority;
      }
      const fallbackReason = detectPriority(title, dueAt, locale).reason;
      return {
        title,
        note: t.note ? String(t.note).slice(0, 2000) : '',
        category,
        priority: priority as AiTaskDraft['priority'],
        priorityReason: String(t.priorityReason || t.reason || fallbackReason || ''),
        dueAt: normalizeIso(dueAt),
        remindAt: normalizeIso(t.remindAt || dueAt),
      };
    });
}

/** 空响应（HTTP 通了但模型没给内容）——这类情况不算“调用失败” */
const EMPTY_RESPONSE = 'EMPTY_RESPONSE';

function emptyResponseError(): Error {
  const err = new Error(EMPTY_RESPONSE);
  (err as Error & { code?: string }).code = EMPTY_RESPONSE;
  return err;
}

function isEmptyResponseError(err: unknown): boolean {
  return Boolean(err && (err as Error & { code?: string }).code === EMPTY_RESPONSE);
}

/**
 * 尽力从响应体里取出可用文本，兼容各种 OpenAI 兼容实现的差异：
 * - 标准 message.content
 * - 多模态分片数组
 * - 只返回 reasoning_content 的推理模型
 * - 只返回 tool_calls 参数的模型
 * - 旧 completion 风格的 choices[0].text
 */
function extractContent(data: unknown): string {
  const body = data as {
    choices?: {
      message?: { content?: unknown; reasoning_content?: unknown; tool_calls?: { function?: { arguments?: unknown } }[] };
      text?: unknown;
    }[];
  };
  const choice = body?.choices?.[0] ?? {};
  const msg = choice.message ?? {};

  let content: unknown = msg.content;
  if (Array.isArray(content)) {
    content = content
      .map((part) => (typeof part === 'string' ? part : ((part as { text?: string })?.text ?? '')))
      .join('');
  }
  let text = typeof content === 'string' ? content : '';

  if (!text.trim() && typeof msg.reasoning_content === 'string') text = msg.reasoning_content;
  if (!text.trim()) {
    const args = msg.tool_calls?.[0]?.function?.arguments;
    if (typeof args === 'string') text = args;
  }
  if (!text.trim() && typeof choice.text === 'string') text = choice.text;

  return String(text || '').trim();
}

/** 读取 SSE 流式响应体，边收边回调累积全文，最终返回完整文本 */
async function readSSE(body: ReadableStream<Uint8Array>, onChunk: (full: string) => void): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx = buf.indexOf('\n');
      while (idx >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        idx = buf.indexOf('\n');
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const j = JSON.parse(payload) as {
            choices?: { delta?: { content?: unknown; reasoning_content?: unknown } }[];
          };
          const delta = j.choices?.[0]?.delta ?? {};
          let piece = '';
          const c = delta.content;
          if (typeof c === 'string') piece = c;
          else if (Array.isArray(c)) {
            piece = c.map((p) => (typeof p === 'string' ? p : ((p as { text?: string })?.text ?? ''))).join('');
          }
          // 推理模型：思考过程不推给界面（只透传正式 content），但仍计入 full 以便最终解析
          if (piece) {
            full += piece;
            onChunk(full);
          }
        } catch {
          /* 半行 JSON，等下一片段 */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return full.trim();
}

/**
 * 调用远端大模型（OpenAI 兼容 /chat/completions）
 * - 传入 dispatcher 时走代理（由主进程按设置解析）
 * - stream + onChunk 时走 SSE 流式，每收到一片就回调累积全文（感知提速关键）
 * - 空响应会自动重试一次（模型偶尔会返回空内容，属正常波动）
 */
async function callLLM({
  messages,
  settings,
  timeoutMs = 60000,
  dispatcher,
  retryOnEmpty = true,
  stream = false,
  onChunk,
}: {
  messages: { role: string; content: string }[];
  settings: Pick<AppSettings, 'aiBaseUrl' | 'aiApiKey' | 'aiModel'>;
  timeoutMs?: number;
  dispatcher?: unknown;
  retryOnEmpty?: boolean;
  stream?: boolean;
  onChunk?: (full: string) => void;
}): Promise<string> {
  const base = String(settings.aiBaseUrl || '').replace(/\/+$/, '');
  const model = settings.aiModel || 'deepseek-chat';
  const url = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
  // 有代理时使用 undici 的 fetch（可挂 ProxyAgent），否则用全局 fetch 直连
  const doFetch: typeof fetch = dispatcher
    ? ((await import('undici')).fetch as unknown as typeof fetch)
    : fetch;

  const attempts = retryOnEmpty ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // 空响应重试时补一条约束提示，明显提升拿到内容的概率
      const attemptMessages =
        attempt === 0 ? messages : [...messages, { role: 'user', content: 'Please reply with JSON only.' }];
      const init = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.aiApiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: attemptMessages,
          temperature: 0.3,
          max_tokens: 2000,
          stream: stream && attempt === 0,
        }),
        signal: controller.signal,
      } as RequestInit & { dispatcher?: unknown };
      if (dispatcher) init.dispatcher = dispatcher;

      const res = await doFetch(url, init);
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${detail.slice(0, 200)}`);
      }
      // 流式：仅当服务端真的返回事件流时按 SSE 读；否则按普通 JSON 兜底
      if (stream && attempt === 0 && onChunk && res.body) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('text/event-stream')) {
          const streamed = await readSSE(res.body as unknown as ReadableStream<Uint8Array>, onChunk);
          if (streamed) return streamed;
        } else {
          const data = await res.json();
          const text = extractContent(data);
          if (text) {
            onChunk(text);
            return text;
          }
        }
      } else {
        const data = await res.json();
        const text = extractContent(data);
        if (text) return text;
      }
      // 空内容：再试一次，仍为空则按“空响应”处理
    } finally {
      clearTimeout(timer);
    }
  }
  throw emptyResponseError();
}

interface UnderstandParams {
  text: string;
  settings: AppSettings;
  history?: { role: 'user' | 'assistant'; content: string }[];
  tasks?: { id: string; title: string; completed: boolean; category: string; priority: string; dueAt?: string | null }[];
  now?: Date;
  /** 代理 dispatcher（可选，由主进程解析） */
  dispatcher?: unknown;
  /** 流式回调：每收到一片输出就回传累积全文（仅远端引擎生效） */
  onChunk?: (full: string) => void;
}

/** 统一入口：解析用户自然语言输入 */
async function understand({
  text,
  settings,
  history = [],
  tasks = [],
  now = new Date(),
  dispatcher,
  onChunk,
}: UnderstandParams): Promise<UnderstandResult> {
  const locale: Locale = i18n.normalizeLocale(settings?.locale);
  const canUseAI = Boolean(settings.aiEnabled && settings.aiApiKey && settings.aiBaseUrl);
  if (!canUseAI) {
    return { ...parseLocally(text, { now, tasks, locale }), error: null };
  }

  // 把当前任务列表注入对话，让模型「看见」现有任务（查询/完成都依赖它）
  const digest = buildTasksDigest(tasks, now, locale);
  const messages = [
    { role: 'system', content: buildSystemPrompt(now, locale) },
    ...history.slice(-10),
    { role: 'user', content: `${text}\n\n${CURRENT_TIME_HINT(now, locale)}${digest ? `\n\n${digest}` : ''}` },
  ];

  try {
    const content = await callLLM({ messages, settings, dispatcher, stream: Boolean(onChunk), onChunk });
    const parsed = extractJson(content);
    if (!parsed) throw new Error('模型输出不是合法 JSON');
    const intent = (['create', 'complete', 'list', 'chat'] as Intent[]).includes(parsed.intent as Intent)
      ? (parsed.intent as Intent)
      : 'create';
    const defaultReply =
      locale === 'en-US' ? 'Here is what I understood — please confirm.' : '已为你整理好任务，请确认。';
    return {
      reply: String(parsed.reply || defaultReply),
      intent,
      tasks: intent === 'create' ? normalizeAiTasks(parsed.tasks, now, locale) : [],
      matchTitles: Array.isArray(parsed.matchTitles) ? (parsed.matchTitles as string[]) : [],
      engine: 'ai',
      error: null,
    };
  } catch (err) {
    // 远端不可用 → 降级本地引擎；空响应属正常波动，用温和提示而非“调用失败”
    const fallback = parseLocally(text, { now, tasks, locale });
    return {
      ...fallback,
      engine: 'local',
      error: isEmptyResponseError(err)
        ? i18n.t(locale, 'local.fallback.empty')
        : `${i18n.t(locale, 'local.error.prefix')}${(err as Error).message}`,
    };
  }
}

interface LocalParseContext {
  now?: Date;
  tasks?: { id: string; title: string; completed: boolean; category: string; priority: string }[];
  locale?: string;
}

/** 本地规则引擎：把自然语言解析为结构化任务 */
function parseLocally(text: string, ctx: LocalParseContext = {}): UnderstandResult {
  const now = ctx.now || new Date();
  const tasks = ctx.tasks || [];
  const locale = i18n.normalizeLocale(ctx.locale);
  const raw = String(text || '');
  const lower = raw.toLowerCase();

  // 意图：完成/勾选已有任务（用最长公共子串做模糊匹配）
  const completeSignal = /完成|做完|搞定了|已做|结束掉|划掉|勾掉|完了|已交|已发|done|finish/i.test(lower);
  if (completeSignal && tasks.length) {
    const matched = tasks
      .filter((x) => !x.completed)
      .filter((x) => {
        const title = String(x.title || '').toLowerCase();
        if (!title) return false;
        return lower.includes(title) || longestCommonSubstr(title, lower).length >= 2;
      })
      .slice(0, 5);
    if (matched.length) {
      return {
        reply: i18n.t(locale, 'local.reply.completeFound', { count: matched.length }),
        intent: 'complete',
        matchTitles: matched.map((x) => x.id),
        tasks: [],
        engine: 'local',
      };
    }
  }

  // 意图：查询
  const isQuery =
    /(有哪些|看看|列出|查询|还剩|有什么|今天要做什么|待办有哪些)/.test(lower) ||
    /\b(what|show|list|any|remaining|todo|to-do|pending)\b/.test(lower);
  const isCreating = /(提醒|记得|帮我|需要|得|安排)/.test(lower) || /\b(remind|add|create|need to|have to)\b/.test(lower);
  if (isQuery && !isCreating) {
    const active = tasks.filter((x) => !x.completed);
    const summary = active.length
      ? active
          .slice(0, 8)
          .map((x) =>
            i18n.t(locale, 'local.reply.listItem', {
              title: x.title,
              priority: i18n.t(locale, `priority.short.${x.priority}`),
              category: x.category,
            })
          )
          .join('\n')
      : i18n.t(locale, 'local.reply.listEmpty');
    return {
      reply: `${i18n.t(locale, 'local.reply.listHeader', { count: active.length })}\n${summary}`,
      intent: 'list',
      tasks: [],
      matchTitles: [],
      engine: 'local',
    };
  }

  const sentences = splitTasks(raw);
  const hasVerb = TASK_VERBS.some((v) => lower.includes(v));
  const hasTime = parseDateTime(raw, now).dueAt !== null;
  const isTaskLike = hasVerb || hasTime;
  if (!sentences.length || !isTaskLike) {
    return {
      reply: i18n.t(locale, 'local.reply.chatHint'),
      intent: 'chat',
      tasks: [],
      matchTitles: [],
      engine: 'local',
    };
  }

  const lead = parseRemindLead(raw);
  const parsed: AiTaskDraft[] = sentences.map((s) => {
    const dt = parseDateTime(s, now);
    const pr = detectPriority(s, dt.dueAt, locale);
    const category = detectCategory(s);
    let remindAt = dt.dueAt;
    if (dt.dueAt && lead > 0) {
      remindAt = new Date(new Date(dt.dueAt).getTime() - lead * 60000).toISOString();
    }
    return {
      title: cleanTitle(s),
      note: dt.matched ? i18n.t(locale, 'local.note.timeRecognized', { matched: dt.matched }) : '',
      category,
      priority: pr.priority,
      priorityReason: pr.reason,
      dueAt: dt.dueAt,
      remindAt,
    };
  });

  const highCount = parsed.filter((p) => p.priority === 'high').length;
  const timeCount = parsed.filter((p) => p.dueAt).length;
  const reply = i18n.t(locale, 'local.reply.created', {
    count: parsed.length,
    timePart: timeCount ? i18n.t(locale, 'local.reply.timePart', { count: timeCount }) : '',
    highPart: highCount ? i18n.t(locale, 'local.reply.highPart', { count: highCount }) : '',
  });

  return { reply, intent: 'create', tasks: parsed, matchTitles: [], engine: 'local' };
}

/**
 * 从流式累积的（可能不完整的）模型输出里增量提取 reply 字段文本。
 * 完整匹配优先；其次匹配未闭合的尾部字符串。无法提取时返回空串（界面继续显示思考动画）。
 */
function extractStreamReply(raw: string): string {
  const s = String(raw || '');
  const m = s.match(/"reply"\s*:\s*"/);
  if (!m || m.index === undefined) return '';
  const openQuote = m.index + m[0].length - 1;
  let out = '';
  let closed = false;
  for (let i = openQuote + 1; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '\\') {
      const next = s[i + 1];
      if (next === undefined) break;
      if (next === 'n') out += '\n';
      else if (next === 't') out += '\t';
      else if (next === 'r') out += '\r';
      else if (next === '"') out += '"';
      else if (next === '\\') out += '\\';
      else if (next === '/') out += '/';
      else if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) {
        out += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16));
        i += 4;
      } else out += next;
      i += 1;
      continue;
    }
    if (ch === '"') {
      closed = true;
      break;
    }
    out += ch;
  }
  return closed || out ? out : '';
}

export {
  understand,
  parseLocally,
  parseDateTime,
  parseEnglishDateTime,
  normalizeAiTasks,
  detectCategory,
  detectPriority,
  extractJson,
  extractContent,
  extractStreamReply,
  isEmptyResponseError,
  callLLM,
  CATEGORIES,
};
