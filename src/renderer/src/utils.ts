/** DOM 与格式化工具 */
import { t, priorityLabel, categoryLabel, CATEGORY_KEYS } from './i18n';

export { CATEGORY_KEYS as CATEGORIES, priorityLabel, categoryLabel, t };

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T =>
  root.querySelector(sel) as T;
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] =>
  Array.from(root.querySelectorAll(sel)) as T[];

type AttrValue = string | number | boolean | ((e: Event) => void) | null | undefined;

export function el(
  tag: string,
  attrs: Record<string, AttrValue> = {},
  children: (Node | string | null | undefined)[] = []
): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else if (k === 'html') node.innerHTML = String(v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v as EventListener);
    else node.setAttribute(k, String(v));
  }
  for (const c of children as (Node | string)[]) {
    if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );
}

const pad = (n: number): string => String(n).padStart(2, '0');

export function fmtDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400000);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return t('date.today', { time });
  if (d.toDateString() === tomorrow.toDateString()) return t('date.tomorrow', { time });
  const m = d.getMonth() + 1;
  if (d.getFullYear() === now.getFullYear()) {
    return t('date.monthDay', { monthShort: t(`month.${m}`), m, d: d.getDate(), time });
  }
  return t('date.full', { y: d.getFullYear(), m: pad(m), d: pad(d.getDate()), time });
}

/** 只显示日期（重复规则预览 / 下一期日期用） */
export function fmtDate(d: Date): string {
  const now = new Date();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if (d.getFullYear() === now.getFullYear()) return t('date.dayOnly', { m, d: day });
  return t('date.fullDayOnly', { y: d.getFullYear(), m: pad(m), d: pad(day) });
}

export function fmtRelative(iso: string | null): string {
  if (!iso) return '';
  const diff = new Date(iso).getTime() - Date.now();
  const mins = Math.round(Math.abs(diff) / 60000);
  const suffix = diff >= 0 ? 'Later' : 'Ago';
  if (mins < 1) return t('relative.now');
  if (mins < 60) return t(`relative.minutes${suffix}`, { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t(`relative.hours${suffix}`, { n: hours });
  return t(`relative.days${suffix}`, { n: Math.round(hours / 24) });
}

/** ISO → datetime-local 输入框需要的本地字符串 */
export function isoToInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function inputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

import { icon, type IconName } from './icons';

export { icon, type IconName };

let toastTimer: ReturnType<typeof setTimeout> | null = null;
export type ToastType = 'info' | 'success' | 'error' | 'warning';

export function toast(msg: string, type: ToastType = 'info'): void {
  const node = document.getElementById('toast');
  if (!node) return;

  node.innerHTML = '';
  node.className = `ui-toast ui-toast-${type}`;

  let iconName: IconName = 'checkCircle';
  if (type === 'error') iconName = 'alertCircle';
  else if (type === 'warning') iconName = 'alertTriangle';
  else if (type === 'info') iconName = 'sparkles';

  const iconEl = icon(iconName, { size: 16, strokeWidth: 2 });
  const textEl = document.createElement('span');
  textEl.className = 'toast-text';
  textEl.textContent = msg;

  node.appendChild(iconEl);
  node.appendChild(textEl);
  node.classList.remove('hidden');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.classList.add('hidden');
  }, 2800);
}

/* ---------- 主题（daisyUI data-theme，三态） ---------- */
export type ThemeChoice = 'light' | 'dark' | 'system';
const THEME_KEY = 'ai_todo_theme';
const THEME_VALUES: ThemeChoice[] = ['light', 'dark', 'system'];
const media = window.matchMedia('(prefers-color-scheme: dark)');

function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice === 'system') return media.matches ? 'dark' : 'light';
  return choice;
}

function paintTheme(choice: ThemeChoice): void {
  document.documentElement.setAttribute('data-theme', resolveTheme(choice));
}

/** 应用并持久化主题选择 */
export function setTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* 忽略 */
  }
  paintTheme(choice);
}

/** 读取主题选择；默认跟随系统 */
export function getTheme(): ThemeChoice {
  try {
    const saved = localStorage.getItem(THEME_KEY) as ThemeChoice | null;
    if (saved && THEME_VALUES.includes(saved)) return saved;
  } catch {
    /* 忽略 */
  }
  return 'system';
}

/** 启动时应用主题，并监听系统外观变化 */
export function initTheme(): ThemeChoice {
  const choice = getTheme();
  paintTheme(choice);
  media.addEventListener('change', () => paintTheme(getTheme()));
  return choice;
}
