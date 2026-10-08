/**
 * 重复任务日期计算（主进程与渲染进程共用的纯函数）
 *
 * 统一约定：
 * 1. 所有「周期日期」都以**本地日历日**计算（getFullYear/getMonth/getDate），
 *    避免 UTC 偏移导致跨日错位；最终再转回 ISO 字符串存储（与既有 dueAt 一致）。
 * 2. 规则里的 startDate / endDate 是 YYYY-MM-DD 的本地日历日。
 * 3. nextOccurrence 只算「日期」，时刻由调用方用 timeOfDay 拼装。
 */
import type { RepeatFreq, RepeatRule } from './types';

const DAY_MS = 86400000;

export const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Date → 本地日历日 key：YYYY-MM-DD */
export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** YYYY-MM-DD → 本地 00:00 的 Date；非法返回 null */
export function parseDateKey(key: unknown): Date | null {
  if (typeof key !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, mo - 1, d, 0, 0, 0, 0);
  // 拒绝 2 月 31 日这类会被 Date 自动进位的非法日期
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

/** 今天的本地日历日 key */
export function todayKey(now: Date = new Date()): string {
  return toDateKey(now);
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), 0, 0);
}

/** 加 N 个月，返回目标月份的 1 号（日期由调用方 clamp，避免 1/31 + 1月 溢出到 3 月） */
export function addMonths(d: Date, n: number): Date {
  const total = d.getMonth() + n;
  const y = d.getFullYear() + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  return new Date(y, m, 1, 0, 0, 0, 0);
}

/** 某年某月（m: 1-12）的天数 */
export function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/** 把「锚定日」夹到目标月的最后一天（1/31 → 2/28 或 2/29） */
export function clampDay(y: number, m: number, day: number): number {
  return Math.min(Math.max(1, day), daysInMonth(y, m));
}

/** ISO 周几：周一=1 … 周日=7 */
export function isoWeekday(d: Date): number {
  const w = d.getDay();
  return w === 0 ? 7 : w;
}

/** 以周一为一周起点的该周首日 */
export function startOfISOWeek(d: Date): Date {
  return addDays(startOfDay(d), -(isoWeekday(d) - 1));
}

/** 两个日期相距多少个 ISO 周（按各自所在周的周一计算，round 消除夏令时误差） */
export function diffWeeks(from: Date, to: Date): number {
  return Math.round((startOfISOWeek(to).getTime() - startOfISOWeek(from).getTime()) / (7 * DAY_MS));
}

/** 把 HH:mm 拼到本地日期上；非法时刻回退 09:00 */
export function applyTimeOfDay(date: Date, timeOfDay: string | null | undefined): Date {
  const hhmm = typeof timeOfDay === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(timeOfDay.trim()) : null;
  const hh = hhmm ? Math.min(23, Number(hhmm[1])) : 9;
  const mm = hhmm ? Math.min(59, Number(hhmm[2])) : 0;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hh, mm, 0, 0);
}

/** 从 Date 取出 HH:mm */
export function extractTimeOfDay(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const FREQS: RepeatFreq[] = ['day', 'week', 'month', 'year'];

/** 规范化周几列表：去重、排序、只保留 1-7；空则回退为起始日的周几 */
export function normalizeWeekdays(list: unknown, fallback?: Date | null): number[] {
  const raw = Array.isArray(list) ? list : [];
  const set = new Set<number>();
  for (const v of raw) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 1 && n <= 7) set.add(Math.floor(n));
  }
  if (set.size) return Array.from(set).sort((a, b) => a - b);
  return fallback ? [isoWeekday(fallback)] : [1];
}

/** 校验并补全一条重复规则；非法输入返回 null（调用方按「不重复」处理） */
export function normalizeRule(raw: unknown): RepeatRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<RepeatRule>;
  const freq = FREQS.includes(r.freq as RepeatFreq) ? (r.freq as RepeatFreq) : null;
  if (!freq) return null;
  const start = parseDateKey(r.startDate);
  if (!start) return null;
  const interval = Math.max(1, Math.min(999, Math.floor(Number(r.interval) || 1)));
  const endMode = r.endMode === 'until' || r.endMode === 'count' ? r.endMode : 'never';
  let endDate: string | null = null;
  let endCount: number | null = null;
  if (endMode === 'until') {
    const e = parseDateKey(r.endDate);
    // 结束日期早于起始日视为非法，降级为永不结束
    if (e && e.getTime() >= start.getTime()) endDate = toDateKey(e);
    else return null;
  }
  if (endMode === 'count') {
    const c = Math.floor(Number(r.endCount));
    if (Number.isFinite(c) && c >= 1) endCount = Math.min(999, c);
    else return null;
  }
  return {
    freq,
    interval,
    weekdays: freq === 'week' ? normalizeWeekdays(r.weekdays, start) : [],
    startDate: toDateKey(start),
    endMode,
    endDate,
    endCount,
  };
}

/**
 * 计算下一次发生的**本地日期**（不含时刻）。
 * @param from 当前这一期的日期（取其本地日历日作为基准）
 * @param rule 已规范化的规则
 * @returns 下一期日期；系列已结束返回 null
 */
export function nextOccurrence(from: Date, rule: RepeatRule): Date | null {
  const start = parseDateKey(rule.startDate);
  if (!start) return null;
  // 当前期早于「生效起始日」（例如把截止时间手动改到过去）时，从起始日开始推算，
  // 保证系列仍能向前推进，而不是因为早于起始日就永远停住。
  const startDay = startOfDay(start);
  const rawBase = startOfDay(from);
  const base = rawBase.getTime() < startDay.getTime() ? startDay : rawBase;
  const interval = Math.max(1, Math.floor(rule.interval || 1));
  let cand: Date | null = null;

  if (rule.freq === 'day') {
    cand = addDays(base, interval);
  } else if (rule.freq === 'week') {
    const wds = normalizeWeekdays(rule.weekdays, start);
    const anchor = startOfISOWeek(start);
    // 最多向后扫描 interval 周 + 一周，足以覆盖所有合法候选
    const limit = 7 * (interval + 1);
    for (let i = 1; i <= limit; i += 1) {
      const d = addDays(base, i);
      if (!wds.includes(isoWeekday(d))) continue;
      const w = diffWeeks(anchor, d);
      if (((w % interval) + interval) % interval !== 0) continue;
      cand = d;
      break;
    }
  } else if (rule.freq === 'month') {
    const anchorDay = start.getDate();
    const target = addMonths(base, interval);
    const y = target.getFullYear();
    const m = target.getMonth() + 1;
    cand = new Date(y, m - 1, clampDay(y, m, anchorDay));
  } else {
    // year：锚定「起始日的月 + 日」，2/29 在平年回退到 2/28
    const anchorDay = start.getDate();
    const month = start.getMonth() + 1;
    const y = base.getFullYear() + interval;
    cand = new Date(y, month - 1, clampDay(y, month, anchorDay));
  }

  if (!cand || Number.isNaN(cand.getTime())) return null;
  // 不得早于生效起始日
  if (cand.getTime() < startOfDay(start).getTime()) return null;
  // 到指定日期结束（含当天）
  if (rule.endMode === 'until' && rule.endDate) {
    const end = parseDateKey(rule.endDate);
    if (end && cand.getTime() > startOfDay(end).getTime()) return null;
  }
  return cand;
}

/**
 * 达到「总共 N 期」上限后是否停止生成。
 * @param generatedCount 系列已生成的期数（含首期）
 */
export function isCountExhausted(rule: RepeatRule, generatedCount: number): boolean {
  if (rule.endMode !== 'count' || rule.endCount == null) return false;
  return generatedCount >= rule.endCount;
}

/** 规则是否永不结束（用于 UI 提示） */
export function isEndless(rule: RepeatRule): boolean {
  return rule.endMode === 'never';
}
