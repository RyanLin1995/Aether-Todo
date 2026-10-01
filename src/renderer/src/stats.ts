/** 统计页：本周 / 本月 / 今年的完成情况（纯 CSS 柱状图与月历，无图表库依赖） */
import { el, t, icon, categoryLabel, type IconName } from './utils';
import { Stats } from './api';
import type { CompletedPoint } from '../../shared/types';

type Range = 'week' | 'month' | 'year';

interface Bucket {
  label: string;
  count: number;
  /** 用于 tooltip：完整描述 */
  hint: string;
  /** 月历模式下的日期 key（YYYY-MM-DD） */
  key?: string;
}

interface Aggregation {
  total: number;
  activeDays: number;
  passedDays: number;
  bestDay: { label: string; count: number } | null;
  buckets: Bucket[];
  categories: { category: string; count: number }[];
}

const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** 本周一 00:00 */
function startOfWeek(now: Date): Date {
  const d = startOfDay(now);
  const dow = (d.getDay() + 6) % 7; // 周一 = 0
  d.setDate(d.getDate() - dow);
  return d;
}

function fmtMonthDay(d: Date): string {
  return t('date.monthDay', { monthShort: t(`month.${d.getMonth() + 1}`), m: d.getMonth() + 1, d: d.getDate(), time: '' }).trim();
}

/** 按范围聚合完成记录 */
export function aggregate(points: CompletedPoint[], range: Range, now: Date = new Date()): Aggregation {
  const times = points
    .map((p) => ({ ts: new Date(p.completedAt).getTime(), category: p.category }))
    .filter((p) => !Number.isNaN(p.ts));

  let from: Date;
  let buckets: Bucket[] = [];
  let passedDays = 1;

  if (range === 'week') {
    from = startOfWeek(now);
    passedDays = Math.min(7, Math.floor((startOfDay(now).getTime() - from.getTime()) / 86400000) + 1);
    const names = [1, 2, 3, 4, 5, 6, 7].map((i) => t(`weekday.${i}`));
    buckets = names.map((label, i) => {
      const day = new Date(from.getTime() + i * 86400000);
      return { label, count: 0, hint: fmtMonthDay(day) };
    });
  } else if (range === 'month') {
    // 月维度：按天分桶（日历呈现），而不是按周
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    passedDays = now.getDate();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    buckets = Array.from({ length: lastDay }, (_, i) => {
      const day = new Date(now.getFullYear(), now.getMonth(), i + 1);
      return { label: String(i + 1), count: 0, hint: fmtMonthDay(day), key: dayKey(day) };
    });
  } else {
    from = new Date(now.getFullYear(), 0, 1);
    passedDays = Math.ceil((startOfDay(now).getTime() - from.getTime()) / 86400000) + 1;
    buckets = Array.from({ length: 12 }, (_, i) => ({
      label: t(`month.${i + 1}`),
      count: 0,
      hint: `${now.getFullYear()} ${t(`month.${i + 1}`)}`,
    }));
  }

  const fromTs = from.getTime();
  const inRange = times.filter((p) => p.ts >= fromTs);

  const perDay = new Map<string, number>();
  for (const p of inRange) {
    const d = new Date(p.ts);
    perDay.set(dayKey(d), (perDay.get(dayKey(d)) || 0) + 1);
    if (range === 'week') {
      const idx = Math.floor((startOfDay(d).getTime() - fromTs) / 86400000);
      if (buckets[idx]) buckets[idx].count += 1;
    } else if (range === 'month') {
      const idx = d.getDate() - 1;
      if (buckets[idx]) buckets[idx].count += 1;
    } else {
      if (buckets[d.getMonth()]) buckets[d.getMonth()].count += 1;
    }
  }

  const catMap = new Map<string, number>();
  for (const p of inRange) catMap.set(p.category, (catMap.get(p.category) || 0) + 1);

  let bestDay: Aggregation['bestDay'] = null;
  for (const [key, count] of perDay) {
    if (!bestDay || count > bestDay.count) {
      const [, m, d] = key.split('-').map(Number);
      bestDay = { label: `${m}/${d}`, count };
    }
  }

  return {
    total: inRange.length,
    activeDays: perDay.size,
    passedDays: Math.max(1, passedDays),
    bestDay,
    buckets,
    categories: Array.from(catMap, ([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
  };
}

function metric(labelKey: string, value: string, iconName: IconName, sub?: string): HTMLElement {
  const top = el('div', { class: 'stats-metric-top' }, [
    el('span', { class: 'stats-metric-label', text: t(labelKey) }),
    icon(iconName, { size: 14, class: 'stats-metric-icon' }),
  ]);
  return el('div', { class: 'stats-metric' }, [
    top,
    el('span', { class: 'stats-metric-value', text: value }),
    sub ? el('span', { class: 'stats-metric-sub', text: sub }) : null,
  ]);
}

function chart(buckets: Bucket[]): HTMLElement {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const chartEl = el('div', { class: 'stats-chart' });
  for (const b of buckets) {
    const heightPct = b.count === 0 ? 4 : Math.max(10, Math.round((b.count / max) * 100));
    chartEl.appendChild(
      el('div', { class: 'stats-col', title: `${b.hint} · ${b.count}` }, [
        el('span', { class: 'stats-col-value', text: b.count > 0 ? String(b.count) : '' }),
        el('div', { class: `stats-bar${b.count === 0 ? ' empty' : ''}`, style: `height:${heightPct}%` }),
        el('span', { class: 'stats-col-label', text: b.label }),
      ])
    );
  }
  return chartEl;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 月历：整月网格，每天用颜色深浅反映当天完成量；点击某天查看当天明细 */
function monthCalendar(
  buckets: Bucket[],
  selectedKey: string,
  now: Date,
  onSelect: (key: string) => void
): HTMLElement {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const todayKey = dayKey(now);
  const grid = el('div', { class: 'stats-cal-grid' });
  for (let i = 1; i <= 7; i++) {
    grid.appendChild(el('span', { class: 'stats-cal-dow', text: t(`weekday.${i}`) }));
  }
  const lead = (new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7; // 周一 = 0
  for (let i = 0; i < lead; i++) {
    grid.appendChild(el('span', { class: 'stats-cal-blank' }));
  }
  for (const b of buckets) {
    const key = b.key || '';
    const level = b.count === 0 ? '' : b.count / max >= 0.66 ? ' l3' : b.count / max >= 0.33 ? ' l2' : ' l1';
    const isFuture = key > todayKey;
    grid.appendChild(
      el(
        'button',
        {
          class: `stats-cal-day${b.count ? ' has-done' : ''}${level}${key === todayKey ? ' today' : ''}${
            key === selectedKey ? ' selected' : ''
          }${isFuture ? ' future' : ''}`,
          type: 'button',
          title: `${b.hint} · ${t('stats.cal.count', { n: b.count })}`,
          onclick: () => onSelect(key),
        },
        [el('span', { class: 'stats-cal-num', text: b.label }), el('span', { class: 'stats-cal-dot' })]
      )
    );
  }
  return grid;
}

/** 所选当天的完成明细（时间 + 分类） */
function dayDetail(points: CompletedPoint[], key: string): HTMLElement {
  const records = points
    .map((p) => ({ ts: new Date(p.completedAt).getTime(), category: p.category }))
    .filter((p) => !Number.isNaN(p.ts) && dayKey(new Date(p.ts)) === key)
    .sort((a, b) => a.ts - b.ts);
  const [, m, d] = key.split('-').map(Number);
  const dateLabel = t('date.monthDay', { monthShort: t(`month.${m}`), m, d, time: '' }).trim();
  const head = el('div', { class: 'stats-day-head' }, [
    icon('calendar', { size: 14, class: 'text-primary' }),
    el('h3', { class: 'stats-section-title', text: t('stats.cal.detail', { date: dateLabel }) }),
    el('span', { class: 'stats-day-count', text: t('stats.cal.count', { n: records.length }) }),
  ]);
  const body = el('div', { class: 'stats-day-list' });
  if (!records.length) {
    body.appendChild(el('p', { class: 'hint', text: t('stats.cal.empty') }));
  } else {
    for (const r of records) {
      const time = new Date(r.ts);
      body.appendChild(
        el('div', { class: 'stats-day-row' }, [
          el('span', { class: 'stats-day-time', text: `${pad2(time.getHours())}:${pad2(time.getMinutes())}` }),
          el('span', { class: 'stats-day-cat', text: categoryLabel(r.category) }),
          icon('check', { size: 13, class: 'stats-day-check' }),
        ])
      );
    }
  }
  return el('div', { class: 'stats-day-detail' }, [head, body]);
}

function categoryList(categories: Aggregation['categories']): HTMLElement {
  const wrap = el('div', { class: 'stats-cats' });
  if (!categories.length) return el('p', { class: 'hint', text: t('stats.empty') });
  const max = Math.max(...categories.map((c) => c.count));
  for (const { category, count } of categories) {
    wrap.appendChild(
      el('div', { class: 'stats-cat-row' }, [
        el('div', { class: 'stats-cat-name-box' }, [
          icon('tag', { size: 11, class: 'cat-icon' }),
          el('span', { class: 'stats-cat-name', text: t(`category.${category}`) }),
        ]),
        el('div', { class: 'stats-cat-track' }, [
          el('div', { class: 'stats-cat-fill', style: `width:${Math.max(4, Math.round((count / max) * 100))}%` }),
        ]),
        el('span', { class: 'stats-cat-value', text: String(count) }),
      ])
    );
  }
  return wrap;
}

/** 渲染统计视图到指定容器 */
export async function renderStats(
  container: HTMLElement,
  state: { range: Range; selectedDay?: string },
  now: Date = new Date()
): Promise<void> {
  container.innerHTML = '';
  const points = await Stats.timeline();
  const agg = aggregate(points, state.range, now);

  // 维度切换
  const ranges: Range[] = ['week', 'month', 'year'];
  const tabs = el('div', { class: 'stats-tabs' });
  for (const r of ranges) {
    const btn = el('button', {
      class: `stats-tab${state.range === r ? ' active' : ''}`,
      text: t(`stats.range.${r}`),
      onclick: () => {
        state.range = r;
        void renderStats(container, state);
      },
    });
    tabs.appendChild(btn);
  }

  // 年度维度用「月均」更有参考价值，周/月维度用「日均」
  const isYear = state.range === 'year';
  const avg = isYear
    ? (agg.total / (now.getMonth() + 1)).toFixed(1)
    : (agg.total / agg.passedDays).toFixed(1);
  const cards = el('div', { class: 'stats-metrics' }, [
    metric('stats.completed', String(agg.total), 'checkCheck'),
    metric('stats.activeDays', String(agg.activeDays), 'flame'),
    metric(isYear ? 'stats.perMonth' : 'stats.perDay', avg, 'calendar'),
    metric('stats.bestDay', agg.bestDay ? String(agg.bestDay.count) : '0', 'sparkles', agg.bestDay ? agg.bestDay.label : undefined),
  ]);

  // 月维度：完成趋势改为「完成日历」（按天），并附所选当天的完成明细
  let trend: HTMLElement;
  if (state.range === 'month') {
    const monthSection = el('section', { class: 'stats-section stats-month' });
    let selectedKey = state.selectedDay && /^\d{4}-\d{2}-\d{2}$/.test(state.selectedDay) ? state.selectedDay : dayKey(now);
    const paintMonth = (): void => {
      monthSection.innerHTML = '';
      monthSection.appendChild(
        el('div', { class: 'stats-section-head' }, [
          icon('calendar', { size: 14, class: 'text-primary' }),
          el('h3', { class: 'stats-section-title', text: t('stats.cal.title') }),
        ])
      );
      monthSection.appendChild(
        monthCalendar(agg.buckets, selectedKey, now, (key) => {
          selectedKey = key;
          state.selectedDay = key;
          paintMonth();
        })
      );
      monthSection.appendChild(dayDetail(points, selectedKey));
    };
    paintMonth();
    trend = monthSection;
  } else {
    trend = el('section', { class: 'stats-section' }, [
      el('div', { class: 'stats-section-head' }, [
        icon('stats', { size: 14, class: 'text-primary' }),
        el('h3', { class: 'stats-section-title', text: t('stats.trend') }),
      ]),
      chart(agg.buckets),
    ]);
  }

  const cats = el('section', { class: 'stats-section' }, [
    el('div', { class: 'stats-section-head' }, [
      icon('tag', { size: 14, class: 'text-primary' }),
      el('h3', { class: 'stats-section-title', text: t('stats.byCategory') }),
    ]),
    categoryList(agg.categories),
  ]);

  container.appendChild(el('div', { class: 'stats-page' }, [tabs, cards, trend, cats]));
}
