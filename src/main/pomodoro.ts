/**
 * 番茄钟服务（主进程持有状态，所有窗口共享）
 * 一个时刻只跑一个番茄：开始 → 倒计时 → 到点通知 + 任务计数 +1
 */
import * as i18n from './i18n';
import type { Store } from './store';
import type { NotifyTone } from '../shared/types';

export interface PomodoroStatus {
  taskId: string;
  title: string;
  /** 开始时间与结束时间（ISO） */
  startedAt: string;
  endsAt: string;
  minutes: number;
  remainingMs: number;
  isPaused: boolean;
}

export interface CurrentTaskInfo {
  id: string;
  title: string;
  priority: string;
  category: string;
  dueAt: string | null;
}

export interface PomodoroService {
  start(taskId: string, minutes: number): PomodoroStatus;
  stop(): void;
  pause(): PomodoroStatus | null;
  resume(): PomodoroStatus | null;
  status(): PomodoroStatus | null;
  /** 当前任务（浮窗展示用）：按优先级 + 截止时间挑一条未完成的 */
  currentTask(): CurrentTaskInfo | null;
}

function createPomodoroService({
  store,
  getActiveUserId,
  notify,
  broadcast,
}: {
  store: Store;
  getActiveUserId: () => string | null;
  notify: (payload: { title: string; body: string; tone?: NotifyTone }) => void;
  broadcast: (channel: string, payload?: unknown) => void;
}): PomodoroService {
  let timer: ReturnType<typeof setInterval> | null = null;
  let current: {
    taskId: string;
    title: string;
    startedAt: number;
    endsAt: number;
    minutes: number;
    isPaused: boolean;
    remainingMs: number;
  } | null = null;

  function status(): PomodoroStatus | null {
    if (!current) return null;
    const remaining = current.isPaused
      ? current.remainingMs
      : Math.max(0, current.endsAt - Date.now());
    return {
      taskId: current.taskId,
      title: current.title,
      startedAt: new Date(current.startedAt).toISOString(),
      endsAt: new Date(current.endsAt).toISOString(),
      minutes: current.minutes,
      remainingMs: remaining,
      isPaused: Boolean(current.isPaused),
    };
  }

  function clearTimer(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function finish(): void {
    const finished = current;
    clearTimer();
    current = null;

    const userId = getActiveUserId();
    if (finished && userId) {
      store.incrementPomodoro(userId, finished.taskId);
      const locale = store.getSettings(userId).locale;
      notify({
        title: i18n.t(locale, 'pomodoro.done.title'),
        body: i18n.t(locale, 'pomodoro.done.body', { title: finished.title }),
        tone: 'success',
      });
    }
    broadcast('pomodoro:changed', null);
    broadcast('tasks:changed', null);
  }

  function start(taskId: string, minutes: number): PomodoroStatus {
    const userId = getActiveUserId();
    const task = userId ? store.getTask(userId, taskId) : null;
    if (!task) throw new Error('任务不存在');

    clearTimer();
    const now = Date.now();
    const duration = Math.max(1, Math.min(180, Math.round(minutes || 25)));
    current = {
      taskId,
      title: task.title,
      startedAt: now,
      endsAt: now + duration * 60000,
      minutes: duration,
      isPaused: false,
      remainingMs: duration * 60000,
    };
    timer = setInterval(() => {
      if (current && !current.isPaused && Date.now() >= current.endsAt) {
        finish();
      } else {
        broadcast('pomodoro:tick', status());
      }
    }, 1000);
    if (timer.unref) timer.unref();

    broadcast('pomodoro:changed', status());
    broadcast('tasks:changed', null);
    return status() as PomodoroStatus;
  }

  function pause(): PomodoroStatus | null {
    if (!current || current.isPaused) return status();
    clearTimer();
    current.remainingMs = Math.max(0, current.endsAt - Date.now());
    current.isPaused = true;
    broadcast('pomodoro:changed', status());
    return status();
  }

  function resume(): PomodoroStatus | null {
    if (!current || !current.isPaused) return status();
    const now = Date.now();
    current.endsAt = now + current.remainingMs;
    current.isPaused = false;
    timer = setInterval(() => {
      if (current && !current.isPaused && Date.now() >= current.endsAt) {
        finish();
      } else {
        broadcast('pomodoro:tick', status());
      }
    }, 1000);
    if (timer.unref) timer.unref();

    broadcast('pomodoro:changed', status());
    return status();
  }

  function stop(): void {
    if (!current) return;
    clearTimer();
    current = null;
    broadcast('pomodoro:changed', null);
    broadcast('tasks:changed', null);
  }

  function currentTask(): CurrentTaskInfo | null {
    const userId = getActiveUserId();
    if (!userId) return null;
    const list = store.listTasks(userId, { status: 'active' });
    if (!list.length) return null;
    // listTasks 已按优先级 + 截止时间排序
    const t = list[0];
    return { id: t.id, title: t.title, priority: t.priority, category: t.category, dueAt: t.dueAt };
  }

  return { start, stop, pause, resume, status, currentTask };
}

export { createPomodoroService };
