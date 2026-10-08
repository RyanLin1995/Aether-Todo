/** 浮窗：苹果先锋灵动岛（Dynamic Island）交互形态 */
import { t, setLocale, applyStaticI18n, priorityLabel, categoryLabel } from './i18n';
import { fmtDateTime } from './utils';
import { icon } from './icons';

interface FloatTask {
  id: string;
  title: string;
  priority: string;
  category: string;
  dueAt: string | null;
  pomodoros?: number;
}

interface PomodoroStatus {
  taskId: string;
  title: string;
  minutes: number;
  remainingMs: number;
  endsAt: string;
  isPaused?: boolean;
}

interface FloatApi {
  floatState(): Promise<{
    ok: boolean;
    data?: {
      task: FloatTask | null;
      pomodoro: PomodoroStatus | null;
      opacity: number;
      locale: string;
      theme?: string;
      pomodoroMinutes?: number;
    };
    error?: string;
  }>;
  pomodoroStart(taskId: string, minutes?: number): Promise<{ ok: boolean; error?: string }>;
  pomodoroStop(): Promise<{ ok: boolean }>;
  pomodoroPause(): Promise<{ ok: boolean }>;
  pomodoroResume(): Promise<{ ok: boolean }>;
  floatSetOpacity(opacity: number): Promise<{ ok: boolean }>;
  floatSetIgnoreMouseEvents(ignore: boolean): Promise<{ ok: boolean }>;
  floatOpenMain(): Promise<{ ok: boolean }>;
  floatHide(): Promise<{ ok: boolean }>;
  floatCycleTask(dir: number): Promise<{ ok: boolean; error?: string }>;
  getSettings(): Promise<{ ok: boolean; data?: { pomodoroMinutes: number } }>;
  onPomodoroChanged(cb: (s: PomodoroStatus | null) => void): () => void;
  onTasksChanged(cb: () => void): () => void;
  onFloatStateChanged(cb: () => void): () => void;
}

const api = (window as unknown as { api: FloatApi }).api;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let currentTask: FloatTask | null = null;
let pomodoro: PomodoroStatus | null = null;
let pomodoroMinutes = 25;
let tickTimer: ReturnType<typeof setInterval> | null = null;

// 灵动岛形态管理：紧凑胶囊态 / 展开态（仅点击切换，不随悬停展开）
let isExpanded = false;

/**
 * 命中区域跟随视觉：透明窗口矩形默认整块拦截下层点击。
 * 光标不在岛内（含圆角外）时整窗穿透；岛内恢复正常命中。
 * 用 elementFromPoint 做 CSS 命中测试——border-radius 圆角外自动视为岛外，
 * 展开 / 收起动画期间矩形逐帧插值，命中区域随动画平滑伸缩，无突变。
 */
let mouseIgnoring = false;

function applyIgnore(next: boolean): void {
  if (next === mouseIgnoring) return;
  mouseIgnoring = next;
  void api.floatSetIgnoreMouseEvents(next).catch(() => {
    mouseIgnoring = !next; // 失败回滚，下轮 mousemove 重试
  });
}

function setupMousePassThrough(): void {
  const island = document.getElementById('dynamic-island');
  if (!island || !api.floatSetIgnoreMouseEvents) return;

  const overIsland = (x: number, y: number): boolean => {
    const hit = document.elementFromPoint(x, y);
    return !!hit && island.contains(hit);
  };

  window.addEventListener('mousemove', (e) => {
    applyIgnore(!overIsland(e.clientX, e.clientY));
  });
  // 光标快速甩出窗口：mouseout 无 relatedTarget 即离开文档，兜底恢复穿透
  window.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget) applyIgnore(true);
  });
  window.addEventListener('blur', () => applyIgnore(true));

  // 初始默认穿透：收起态胶囊只占窗口一小块，其余透明区域必须可点击下层
  mouseIgnoring = false;
  applyIgnore(true);
}

function updateIslandMode(): void {
  const island = $('dynamic-island');
  if (!island) return;
  if (isExpanded) {
    island.classList.remove('island-compact');
    island.classList.add('island-expanded');
  } else {
    island.classList.remove('island-expanded');
    island.classList.add('island-compact');
  }
}

/**
 * 应用内确认弹窗：替代系统原生 window.confirm（原生弹窗标题为 ai-todo、样式与软件不一致）
 * 弹窗覆盖在灵动岛内部，配色 / 圆角 / 按钮风格与岛屿保持一致
 */
function confirmDialog(opts: {
  title: string;
  message: string;
  confirmText: string;
  cancelText?: string;
  danger?: boolean;
}): Promise<boolean> {
  const wrap = document.getElementById('island-confirm');
  const card = document.getElementById('island-confirm-card');
  const titleEl = document.getElementById('island-confirm-title');
  const msgEl = document.getElementById('island-confirm-message');
  const iconBox = document.getElementById('island-confirm-icon');
  const okBtn = document.getElementById('island-confirm-ok') as HTMLButtonElement | null;
  const cancelBtn = document.getElementById('island-confirm-cancel') as HTMLButtonElement | null;
  const closeBtn = document.getElementById('island-confirm-close') as HTMLButtonElement | null;

  // 兜底：结构缺失时退回原生确认，保证功能可用
  if (!wrap || !card || !okBtn || !cancelBtn) return Promise.resolve(window.confirm(opts.message));

  return new Promise<boolean>((resolve) => {
    if (titleEl) titleEl.textContent = opts.title;
    if (msgEl) msgEl.textContent = opts.message;
    if (iconBox) {
      iconBox.innerHTML = '';
      iconBox.appendChild(icon('alertTriangle', { size: 11 }));
    }
    if (closeBtn) {
      closeBtn.innerHTML = '';
      closeBtn.appendChild(icon('close', { size: 11 }));
      closeBtn.title = t('settings.close');
    }
    okBtn.textContent = opts.confirmText;
    okBtn.className = `island-pill-btn ${opts.danger === false ? 'primary' : 'danger-btn'}`;
    cancelBtn.textContent = opts.cancelText || t('task.cancel');

    const controller = new AbortController();
    const finish = (result: boolean) => {
      controller.abort();
      wrap.classList.add('hidden');
      resolve(result);
    };

    okBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      finish(true);
    }, { signal: controller.signal });
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      finish(false);
    }, { signal: controller.signal });
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        finish(false);
      }, { signal: controller.signal });
    }
    // 点击弹窗卡片内部不关闭，点击遮罩空白区视为取消
    card.addEventListener('click', (e) => e.stopPropagation(), { signal: controller.signal });
    wrap.addEventListener('click', () => finish(false), { signal: controller.signal });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      }
    }, { signal: controller.signal });

    // 弹窗需要展开态才能容纳，紧凑胶囊态下先自动展开
    isExpanded = true;
    updateIslandMode();
    wrap.classList.remove('hidden');
    okBtn.focus();
  });
}

function fmtClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function renderTask(): void {
  const prio = $('float-prio');
  const title = $('float-title');
  const meta = $('float-meta');
  const compactTitle = $('island-compact-title');

  if (!currentTask) {
    prio.className = 'float-prio';
    const noTaskText = t('float.noTask');
    title.textContent = noTaskText;
    if (compactTitle) compactTitle.textContent = noTaskText;
    meta.innerHTML = '';
    return;
  }

  prio.className = `float-prio prio-${currentTask.priority}`;
  title.textContent = currentTask.title;
  if (compactTitle) compactTitle.textContent = currentTask.title;

  meta.innerHTML = '';
  const catSpan = document.createElement('span');
  catSpan.className = 'meta-pill cat';
  catSpan.textContent = categoryLabel(currentTask.category);
  meta.appendChild(catSpan);

  const prioSpan = document.createElement('span');
  prioSpan.className = `meta-pill prio prio-${currentTask.priority}`;
  prioSpan.textContent = priorityLabel(currentTask.priority);
  meta.appendChild(prioSpan);

  if (currentTask.dueAt) {
    const dueSpan = document.createElement('span');
    dueSpan.className = 'meta-pill time';
    dueSpan.appendChild(icon('calendar', { size: 10 }));
    dueSpan.appendChild(document.createTextNode(` ${fmtDateTime(currentTask.dueAt)}`));
    meta.appendChild(dueSpan);
  }

  // 番茄钟累计次数不再对外展示（仅保留后台统计），灵动岛元信息区只显示类别 / 优先级 / 截止时间
}

function renderPomodoro(): void {
  const clock = $('float-clock');
  const compactClock = $('island-compact-clock');
  const startBtn = $('float-pomo');
  const pauseBtn = $('float-pause');
  const resumeBtn = $('float-resume');
  const stopBtn = $('float-stop');
  const pulse = $('island-pulse');
  const statusLabel = $('island-clock-status');
  const progressBar = $('island-progress-bar');

  const running = Boolean(pomodoro);
  const isPaused = Boolean(pomodoro && pomodoro.isPaused);

  let formattedTime = fmtClock(pomodoroMinutes * 60000);
  let progressPercent = 0;

  if (!running) {
    startBtn.classList.remove('hidden');
    pauseBtn.classList.add('hidden');
    resumeBtn.classList.add('hidden');
    stopBtn.classList.add('hidden');
    clock.classList.remove('running', 'paused');
    if (statusLabel) statusLabel.textContent = '未开始';
    if (pulse) pulse.className = 'island-pulse pulse-idle';
    progressPercent = 0;
  } else if (isPaused) {
    startBtn.classList.add('hidden');
    pauseBtn.classList.add('hidden');
    resumeBtn.classList.remove('hidden');
    stopBtn.classList.remove('hidden');
    formattedTime = fmtClock(pomodoro!.remainingMs);
    clock.classList.remove('running');
    clock.classList.add('paused');
    if (statusLabel) statusLabel.textContent = t('pomodoro.paused');
    if (pulse) pulse.className = 'island-pulse pulse-paused';

    const totalMs = (pomodoro!.minutes || pomodoroMinutes) * 60000;
    progressPercent = Math.max(0, Math.min(100, (1 - pomodoro!.remainingMs / totalMs) * 100));
  } else {
    startBtn.classList.add('hidden');
    pauseBtn.classList.remove('hidden');
    resumeBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    formattedTime = fmtClock(pomodoro!.remainingMs);
    clock.classList.add('running');
    clock.classList.remove('paused');
    if (statusLabel) statusLabel.textContent = t('pomodoro.running');
    if (pulse) pulse.className = 'island-pulse pulse-running';

    const totalMs = (pomodoro!.minutes || pomodoroMinutes) * 60000;
    progressPercent = Math.max(0, Math.min(100, (1 - pomodoro!.remainingMs / totalMs) * 100));
  }

  clock.textContent = formattedTime;
  if (compactClock) compactClock.textContent = formattedTime;
  if (progressBar) progressBar.style.width = `${progressPercent.toFixed(1)}%`;

  startBtn.innerHTML = '';
  startBtn.appendChild(icon('play', { size: 12 }));
  startBtn.appendChild(document.createTextNode(` ${t('float.startFocus')}`));

  pauseBtn.innerHTML = '';
  pauseBtn.appendChild(icon('pause', { size: 12 }));
  pauseBtn.appendChild(document.createTextNode(` ${t('float.pause')}`));

  resumeBtn.innerHTML = '';
  resumeBtn.appendChild(icon('play', { size: 12 }));
  resumeBtn.appendChild(document.createTextNode(` ${t('float.resume')}`));

  stopBtn.innerHTML = '';
  stopBtn.appendChild(icon('stop', { size: 12 }));
  stopBtn.appendChild(document.createTextNode(` ${t('float.stop')}`));
}

async function refresh(): Promise<void> {
  const res = await api.floatState();
  if (!res.ok || !res.data) return;
  const { task, pomodoro: p, opacity, locale, theme, pomodoroMinutes: mins } = res.data;
  currentTask = task;
  pomodoro = p;
  // 专注时长以主进程设置为准：设置面板改完后主进程广播 float:state-changed → 这里即时同步
  if (typeof mins === 'number' && mins > 0) pomodoroMinutes = mins;
  setLocale(locale || 'zh-CN');
  document.documentElement.lang = locale || 'zh-CN';
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
  if (opacity !== undefined) {
    // 主控变量：灵动岛背景、按钮、弹窗的玻璃材质全部由它派生
    document.documentElement.style.setProperty('--liquid', String(opacity));
  }
  applyStaticI18n();
  renderTask();
  renderPomodoro();
}

function startTicking(): void {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    if (!pomodoro) return;
    if (pomodoro.isPaused) {
      renderPomodoro();
      return;
    }
    pomodoro.remainingMs = Math.max(0, new Date(pomodoro.endsAt).getTime() - Date.now());
    renderPomodoro();
    if (pomodoro.remainingMs <= 0) {
      pomodoro = null;
      void refresh();
    }
  }, 500);
}

function bind(): void {
  const compactView = $('island-compact-view');
  const toggleExpand = $('island-toggle-expand');
  const toggleCompact = $('island-toggle-compact');
  const prevBtn = $('island-prev-task');
  const nextBtn = $('island-next-task');
  const openBtn = $('float-open');
  const closeBtn = $('float-close');

  if (toggleExpand) {
    toggleExpand.innerHTML = '';
    toggleExpand.appendChild(icon('maximize', { size: 11 }));
    toggleExpand.addEventListener('click', (e) => {
      e.stopPropagation();
      isExpanded = true;
      updateIslandMode();
    });
  }

  if (toggleCompact) {
    // 收起按钮：独立图标（向内收拢）+ 独立描边样式，与「下一个任务」的 chevron 明显区分
    toggleCompact.innerHTML = '';
    toggleCompact.appendChild(icon('minimize', { size: 12, strokeWidth: 2.4 }));
    toggleCompact.addEventListener('click', (e) => {
      e.stopPropagation();
      isExpanded = false;
      updateIslandMode();
    });
  }

  // 紧凑胶囊：点击展开（不再随鼠标悬停展开）
  if (compactView) {
    compactView.addEventListener('click', () => {
      isExpanded = true;
      updateIslandMode();
    });
  }

  // 岛内循环切换任务
  if (prevBtn) {
    prevBtn.innerHTML = '';
    prevBtn.appendChild(icon('chevronLeft', { size: 12 }));
    prevBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.floatCycleTask(-1);
      await refresh();
    });
  }
  if (nextBtn) {
    nextBtn.innerHTML = '';
    nextBtn.appendChild(icon('chevronRight', { size: 12 }));
    nextBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.floatCycleTask(1);
      await refresh();
    });
  }

  if (openBtn) {
    openBtn.innerHTML = '';
    openBtn.appendChild(icon('externalLink', { size: 12 }));
    openBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void api.floatOpenMain();
    });
  }

  if (closeBtn) {
    closeBtn.innerHTML = '';
    closeBtn.appendChild(icon('close', { size: 12 }));
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void api.floatHide();
    });
  }

  $('float-pomo').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!currentTask) return;
    await api.pomodoroStart(currentTask.id, pomodoroMinutes);
    await refresh();
  });

  $('float-pause').addEventListener('click', async (e) => {
    e.stopPropagation();
    await api.pomodoroPause();
    await refresh();
  });

  $('float-resume').addEventListener('click', async (e) => {
    e.stopPropagation();
    await api.pomodoroResume();
    await refresh();
  });

  $('float-stop').addEventListener('click', async (e) => {
    e.stopPropagation();
    const confirmed = await confirmDialog({
      title: t('pomodoro.confirmStopTitle'),
      message: t('pomodoro.confirmStop'),
      confirmText: t('pomodoro.stopConfirm'),
      cancelText: t('task.cancel'),
      danger: true,
    });
    if (!confirmed) return;
    await api.pomodoroStop();
    await refresh();
  });

  api.onPomodoroChanged((s) => {
    pomodoro = s;
    renderPomodoro();
  });

  // 主界面「送入灵动岛」/ 切换任务时实时刷新
  api.onFloatStateChanged(() => void refresh());

  api.onTasksChanged(async () => {
    const s = await api.getSettings();
    if (s.ok && s.data && s.data.pomodoroMinutes) {
      pomodoroMinutes = s.data.pomodoroMinutes;
    }
    await refresh();
  });
}

async function boot(): Promise<void> {
  bind();
  setupMousePassThrough();
  const settings = await api.getSettings();
  if (settings.ok && settings.data) pomodoroMinutes = settings.data.pomodoroMinutes || 25;
  await refresh();
  startTicking();
}

document.addEventListener('DOMContentLoaded', () => void boot());
