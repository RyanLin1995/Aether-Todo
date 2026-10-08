/** 应用入口：任务列表、视图切换、语言切换 */
import { $, $$, el, toast, fmtDate, CATEGORIES, categoryLabel, initTheme, icon, type IconName } from './utils';
import { t, setLocale, getLocale, applyStaticI18n } from './i18n';
import { Tasks, Settings, App, Pomodoro, FloatWindow, type PomodoroStatus } from './api';
import { taskCard, taskEditor } from './tasks';
import { confirmDialog, choiceDialog } from './dialog';
import { mountAssistant, type AssistantPanel } from './assistant';
import { mountSettings, type SettingsPanel } from './settings';
import { renderStats } from './stats';
import type { AppSettings, Task, TaskFilter } from '../../shared/types';

const state = {
  tasks: [] as Task[],
  settings: null as AppSettings | null,
  view: 'active' as 'active' | 'today' | 'high' | 'done' | 'all' | 'stats',
  category: 'all',
  keyword: '',
  editingId: null as string | null,
  creating: false,
};

let pomodoroTimer: ReturnType<typeof setInterval> | null = null;

function fmtClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** 顶栏的专注计时指示器 */
function renderPomodoroIndicator(status: PomodoroStatus | null): void {
  const node = $('#pomodoro-indicator') as HTMLElement;
  if (!status) {
    node.classList.add('hidden');
    node.innerHTML = '';
    if (pomodoroTimer) {
      clearInterval(pomodoroTimer);
      pomodoroTimer = null;
    }
    return;
  }
  node.classList.remove('hidden');
  node.title = status.title;
  const paint = () => {
    const left = status.isPaused
      ? status.remainingMs
      : Math.max(0, new Date(status.endsAt).getTime() - Date.now());
    node.innerHTML = '';
    const dot = document.createElement('span');
    dot.className = `pomo-dot${status.isPaused ? ' paused' : ''}`;
    node.appendChild(dot);
    node.appendChild(
      icon(status.isPaused ? 'pause' : 'timer', {
        size: 13,
        class: status.isPaused ? 'text-warning' : 'text-primary',
      })
    );
    node.appendChild(
      document.createTextNode(
        ` ${status.isPaused ? t('pomodoro.paused') : t('pomodoro.running')} ${fmtClock(left)}`
      )
    );
  };
  paint();
  if (!pomodoroTimer) pomodoroTimer = setInterval(paint, 1000);
}

const statsState = { range: 'week' as 'week' | 'month' | 'year' };

let assistant: AssistantPanel | null = null;
let settingsModal: SettingsPanel | null = null;

function buildFilter(opts: TaskFilter = {}): TaskFilter {
  const filter: TaskFilter = { status: 'active', category: state.category, keyword: state.keyword };
  if (state.view === 'done') filter.status = 'done';
  if (state.view === 'all') filter.status = 'all';
  if (state.view === 'high') {
    filter.status = 'active';
    filter.priority = 'high';
  }
  return { ...filter, ...opts };
}

function todayRangeTasks(list: Task[]): Task[] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 86400000);
  return list.filter((x) => {
    if (!x.dueAt) return false;
    const ts = new Date(x.dueAt).getTime();
    return ts >= start.getTime() && ts < end.getTime();
  });
}

// ---------------- 渲染 ----------------
async function refresh(): Promise<void> {
  try {
    // 统计视图：隐藏任务区，渲染统计面板
    const statsEl = $('#stats-view') as HTMLElement;
    const listEl = $('#task-list') as HTMLElement;
    const isStats = state.view === 'stats';
    statsEl.classList.toggle('hidden', !isStats);
    listEl.classList.toggle('hidden', isStats);
    ($('#empty-state') as HTMLElement).classList.toggle('hidden', isStats);
    ($('#btn-new') as HTMLElement).classList.toggle('hidden', isStats);
    if (isStats) {
      await renderStats(statsEl, statsState);
      return;
    }

    const [tasks, stats] = await Promise.all([Tasks.list(buildFilter()), Tasks.stats()]);
    state.tasks = tasks;
    const view = state.view === 'today' ? todayRangeTasks(tasks) : tasks;

    $('#stat-active')!.textContent = String(stats.active);
    $('#stat-done')!.textContent = String(stats.done);
    $('#stat-high')!.textContent = String(stats.high);
    $('#stat-total')!.textContent = String(stats.total);

    listEl.innerHTML = '';
    if (state.creating) {
      listEl.appendChild(
        taskEditor(
          {
            title: '',
            note: '',
            priority: 'medium',
            category: state.category === 'all' ? '其他' : state.category,
          },
          {
            onCancel: () => {
              state.creating = false;
              void refresh();
            },
            onSave: async (patch) => {
              try {
                const repeating = Boolean(patch.repeat);
                await Tasks.create({ ...patch, remindAt: patch.remindAt || patch.dueAt, source: 'manual' });
                state.creating = false;
                toast(repeating ? t('toast.repeatCreated') : t('toast.created'), 'success');
                void refresh();
              } catch (err) {
                toast((err as Error).message, 'error');
              }
            },
          }
        )
      );
    }

    ($('#empty-state') as HTMLElement).classList.toggle('hidden', view.length > 0 || state.creating);

    for (const task of view) {
      if (state.editingId === task.id) {
        // 重复任务：回填系列规则供编辑器展示与修改
        const series = task.seriesId ? await Tasks.seriesOf(task.id) : null;
        listEl.appendChild(
          taskEditor(
            task,
            {
              onCancel: () => {
                state.editingId = null;
                void refresh();
              },
              onSave: async (patch) => {
                try {
                  if (task.seriesId) {
                    const scope = await choiceDialog({
                      title: t('scope.editTitle'),
                      message: t('scope.editMessage', { title: task.title }),
                      iconName: 'repeat',
                      options: [
                        { value: 'once', label: t('scope.once'), hint: t('scope.onceEditHint') },
                        { value: 'series', label: t('scope.series'), hint: t('scope.seriesEditHint') },
                      ],
                      confirmText: t('task.save'),
                      cancelText: t('task.cancel'),
                    });
                    if (!scope) return;
                    await Tasks.updateScoped(task.id, patch, scope === 'series' ? 'series' : 'once');
                    state.editingId = null;
                    toast(scope === 'series' ? t('toast.seriesUpdated') : t('toast.saved'), 'success');
                  } else {
                    await Tasks.update(task.id, patch);
                    state.editingId = null;
                    toast(t('toast.saved'), 'success');
                  }
                  void refresh();
                } catch (err) {
                  toast((err as Error).message, 'error');
                }
              },
            },
            series
          )
        );
      } else {
        listEl.appendChild(
          taskCard(task, {
            toggle: async (id, completed) => {
              try {
                const target = state.tasks.find((x) => x.id === id);
                if (target && target.seriesId) {
                  // 重复任务：完成当期后由主进程推进出下一期
                  const res = await Tasks.toggle(id, completed);
                  if (completed && res.next && res.next.dueAt) {
                    toast(t('toast.repeatNext', { date: fmtDate(new Date(res.next.dueAt)) }), 'success');
                  }
                } else {
                  await Tasks.update(id, { completed });
                }
                void refresh();
              } catch (err) {
                toast((err as Error).message, 'error');
              }
            },
            edit: (id) => {
              state.editingId = id;
              void refresh();
            },
            focus: async (id) => {
              try {
                const duration = state.settings?.pomodoroMinutes || 25;
                const status = await Pomodoro.start(id, duration);
                renderPomodoroIndicator(status);
                toast(t('task.focus'), 'info');
                await FloatWindow.show();
              } catch (err) {
                toast((err as Error).message, 'error');
              }
            },
            sendToIsland: async (id) => {
              try {
                await FloatWindow.sendTask(id);
                await FloatWindow.show();
                toast(t('toast.sentToIsland'), 'success');
              } catch (err) {
                toast((err as Error).message, 'error');
              }
            },
            remove: async (id) => {
              try {
                const target = state.tasks.find((x) => x.id === id);
                if (target && target.seriesId) {
                  const scope = await choiceDialog({
                    title: t('scope.deleteTitle'),
                    message: t('scope.deleteMessage', { title: target.title }),
                    iconName: 'trash',
                    danger: true,
                    options: [
                      { value: 'once', label: t('scope.once'), hint: t('scope.onceDeleteHint') },
                      { value: 'series', label: t('scope.series'), hint: t('scope.seriesDeleteHint') },
                    ],
                    confirmText: t('task.delete'),
                    cancelText: t('task.cancel'),
                  });
                  if (!scope) return;
                  const res = await Tasks.removeScoped(id, scope === 'series' ? 'series' : 'once');
                  if (scope === 'series') {
                    toast(t('toast.seriesDeleted'), 'info');
                  } else if (res.next && res.next.dueAt) {
                    toast(t('toast.repeatNext', { date: fmtDate(new Date(res.next.dueAt)) }), 'info');
                  } else {
                    toast(t('toast.deleted'), 'info');
                  }
                } else {
                  await Tasks.remove(id);
                  toast(t('toast.deleted'), 'info');
                }
                void refresh();
              } catch (err) {
                toast((err as Error).message, 'error');
              }
            },
            reorder: async (srcId, targetId, pos) => {
              try {
                const currentIds = view.map((t) => t.id);
                const fromIdx = currentIds.indexOf(srcId);
                let toIdx = currentIds.indexOf(targetId);
                if (fromIdx < 0 || toIdx < 0) return;
                currentIds.splice(fromIdx, 1);
                toIdx = currentIds.indexOf(targetId);
                const insertIdx = pos === 'before' ? toIdx : toIdx + 1;
                currentIds.splice(insertIdx, 0, srcId);
                await Tasks.reorder(currentIds);
                void refresh();
              } catch (err) {
                toast((err as Error).message, 'error');
              }
            },
          })
        );
      }
    }
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}

function renderEngineBadge(settings: AppSettings | Partial<AppSettings> | null): void {
  const badge = $('#engine-badge') as HTMLElement;
  const enabled = Boolean(settings && settings.aiEnabled && settings.aiApiKey);
  badge.innerHTML = '';
  badge.appendChild(icon('sparkles', { size: 11, class: enabled ? 'text-primary' : 'text-base-content/50' }));
  badge.appendChild(document.createTextNode(` ${enabled ? t('engine.ai') : t('engine.local')}`));
  badge.classList.toggle('ai', enabled);
}

const VIEW_ICONS: Record<string, IconName> = {
  active: 'circleDot',
  today: 'calendar',
  high: 'flame',
  done: 'checkCircle',
  all: 'layers',
  stats: 'stats',
};

/** 重建视图列表（添加 Lucide 矢量图标） */
function renderViewFilter(): void {
  const viewList = $('#view-filter') as HTMLElement;
  viewList.innerHTML = '';
  const views = [
    { key: 'active', i18nKey: 'view.active' },
    { key: 'today', i18nKey: 'view.today' },
    { key: 'high', i18nKey: 'view.high' },
    { key: 'done', i18nKey: 'view.done' },
    { key: 'all', i18nKey: 'view.all' },
    { key: 'stats', i18nKey: 'view.stats' },
  ];

  for (const v of views) {
    const li = el(
      'li',
      {
        'data-view': v.key,
        class: state.view === v.key ? 'active' : '',
      },
      [icon(VIEW_ICONS[v.key] || 'circle', { size: 14, class: 'view-icon' }), el('span', { text: t(v.i18nKey) })]
    );
    viewList.appendChild(li);
  }
}

/** 重建类别列表（语言切换后需要重渲染） */
function renderCategoryList(): void {
  const catList = $('#category-filter') as HTMLElement;
  catList.innerHTML = '';
  catList.appendChild(
    el(
      'li',
      { 'data-category': 'all', class: state.category === 'all' ? 'active' : '' },
      [icon('tag', { size: 13, class: 'cat-icon' }), el('span', { text: t('category.all') })]
    )
  );
  for (const c of CATEGORIES) {
    catList.appendChild(
      el(
        'li',
        { 'data-category': c, class: state.category === c ? 'active' : '' },
        [icon('tag', { size: 13, class: 'cat-icon' }), el('span', { text: categoryLabel(c) })]
      )
    );
  }
}

/** 内容区标题跟随当前视图 */
function syncContentTitle(): void {
  const active = $('#view-filter li.active');
  if (active) {
    const span = active.querySelector('span');
    ($('#content-title') as HTMLElement).textContent = span ? span.textContent || '' : active.textContent || '';
  }
}

/** 挂载静态 Lucide 装饰性图标 */
function mountStaticIcons(): void {
  // 顶栏浮窗与设置按钮
  const floatIcon = $('#btn-float-icon') as HTMLElement;
  if (floatIcon) {
    floatIcon.innerHTML = '';
    floatIcon.appendChild(icon('window', { size: 14 }));
  }

  const settingsIcon = $('#btn-settings-icon') as HTMLElement;
  if (settingsIcon) {
    settingsIcon.innerHTML = '';
    settingsIcon.appendChild(icon('settings', { size: 14 }));
  }

  // 新建任务按钮
  const newIcon = $('#btn-new-icon') as HTMLElement;
  if (newIcon) {
    newIcon.innerHTML = '';
    newIcon.appendChild(icon('plus', { size: 15, strokeWidth: 2.5 }));
  }

  // 搜索框图标插槽
  const searchSlot = $('#search-icon-slot') as HTMLElement;
  if (searchSlot && !searchSlot.hasChildNodes()) {
    searchSlot.appendChild(icon('search', { size: 14, class: 'text-base-content/40' }));
  }

  // 空状态大图标插槽（杜绝 Emoji）
  const emptySlot = $('#empty-icon-slot') as HTMLElement;
  if (emptySlot && !emptySlot.hasChildNodes()) {
    emptySlot.appendChild(icon('inbox', { size: 44, strokeWidth: 1.5, class: 'empty-main-icon' }));
  }
}

/** 应用语言：静态 DOM + 动态列表 + 重新渲染 */
function applyLocale(locale: string): void {
  setLocale(locale);
  document.documentElement.lang = locale;
  applyStaticI18n();
  renderViewFilter();
  renderCategoryList();
  mountStaticIcons();
  syncContentTitle();
  renderEngineBadge(state.settings);
  assistant?.relocalize();
  settingsModal?.relocalize();
  void refresh();
}

/** 应用「整体液态程度」主控变量；界面与灵动岛的全部玻璃材质由它派生 */
export function applyLiquidOpacity(val?: number): void {
  const level = Math.min(1, Math.max(0.3, typeof val === 'number' ? val : 0.92));
  document.documentElement.style.setProperty('--liquid', String(level));
}

async function loadSettings(): Promise<AppSettings | null> {
  try {
    state.settings = await Settings.get();
    renderEngineBadge(state.settings);
    applyLiquidOpacity(state.settings?.liquidOpacity ?? state.settings?.floatOpacity);
    return state.settings;
  } catch {
    return null;
  }
}

// ---------------- 主界面事件 ----------------
function bindApp(): void {
  $('#btn-settings')!.addEventListener('click', () => void settingsModal!.open());
  $('#btn-new')!.addEventListener('click', () => {
    state.creating = true;
    state.editingId = null;
    void refresh();
  });

  $('#view-filter')!.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest('li');
    if (!li) return;
    $$('#view-filter li').forEach((x) => x.classList.remove('active'));
    li.classList.add('active');
    state.view = (li as HTMLElement).dataset.view as typeof state.view;
    syncContentTitle();
    void refresh();
  });

  $('#category-filter')!.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest('li');
    if (!li) return;
    $$('#category-filter li').forEach((x) => x.classList.remove('active'));
    li.classList.add('active');
    state.category = (li as HTMLElement).dataset.category || 'all';
    void refresh();
  });

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  $('#search-input')!.addEventListener('input', (e) => {
    if (searchTimer) clearTimeout(searchTimer);
    const v = (e.target as HTMLInputElement).value;
    searchTimer = setTimeout(() => {
      state.keyword = v;
      void refresh();
    }, 250);
  });

  $('#btn-float')!.addEventListener('click', () => void FloatWindow.toggle());
  // 结束专注：统一走应用内液态玻璃弹窗（原生 confirm 标题取自 document.title，风格割裂）
  ($('#pomodoro-indicator') as HTMLElement).addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: t('pomodoro.confirmStopTitle'),
      message: t('pomodoro.confirmStop'),
      confirmText: t('pomodoro.stopConfirm'),
      cancelText: t('task.cancel'),
      iconName: 'timer',
      danger: true,
    });
    if (!ok) return;
    await Pomodoro.stop();
    renderPomodoroIndicator(null);
    toast(t('pomodoro.stopped'), 'info');
  });

  Pomodoro.onChanged((s) => renderPomodoroIndicator(s));
  Pomodoro.onTick((s) => {
    if (s) renderPomodoroIndicator(s);
  });
  App.onTasksChanged(() => void refresh());
  App.onReminderOpen(() => void refresh());
}

// ---------------- 启动 ----------------
async function boot(): Promise<void> {
  initTheme();
  bindApp();

  assistant = mountAssistant({
    getTasks: () => state.tasks,
    onTasksChanged: () => void refresh(),
  });
  settingsModal = mountSettings({
    getSettings: () => state.settings || {},
    onChanged: (next) => {
      state.settings = next;
      renderEngineBadge(next);
      applyLiquidOpacity(next.liquidOpacity ?? next.floatOpacity);
    },
    onLocaleChange: (locale) => applyLocale(locale),
  });

  try {
    renderPomodoroIndicator(await Pomodoro.status());
  } catch {
    /* 忽略 */
  }

  const settings = await loadSettings();
  // 语言优先级：设置里的值 > 上次本地保存 > 默认简体中文
  applyLocale(settings?.locale || getLocale());
  await assistant.loadHistory();
}

document.addEventListener('DOMContentLoaded', () => void boot());
