/**
 * 提醒调度器：轮询到期任务并发送系统通知
 */
import * as i18n from './i18n';
import type { Store } from './store';
import type { Task, NotifyTone } from '../shared/types';

const TICK_MS = 20000;

function formatTime(d: Date): string {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return i18n.t('zh-CN', 'date.unknown');
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface NotifierPayload {
  title: string;
  body: string;
  task?: Task;
  /** 语义色调：高优先级用 warning，其余 info */
  tone?: NotifyTone;
}

export interface ReminderService {
  start(): void;
  stop(): void;
  check(): Task[];
}

function createReminderService({
  store,
  getActiveUserId,
  notify,
}: {
  store: Store;
  getActiveUserId: () => string | null;
  notify: (payload: NotifierPayload) => void;
}): ReminderService {
  let timer: ReturnType<typeof setInterval> | null = null;
  const fired = new Set<string>(); // 本次进程内已提醒的任务，避免重复弹窗

  function check(): Task[] {
    const userId = getActiveUserId();
    if (!userId) return [];
    const locale = (store.getSettings(userId) || {}).locale;
    const due = store.pullDueReminders(userId);
    for (const task of due) {
      if (fired.has(task.id)) continue;
      fired.add(task.id);
      const when = task.dueAt ? new Date(task.dueAt) : new Date(task.remindAt as string);
      notify({
        title: i18n.t(locale, task.priority === 'high' ? 'notify.title.high' : 'notify.title.normal'),
        body: i18n.t(locale, 'notify.body', {
          title: task.title,
          category: task.category,
          time: formatTime(when),
        }),
        task,
        tone: task.priority === 'high' ? 'warning' : 'info',
      });
    }
    if (due.length) {
      store.markReminded(due.map((t) => t.id));
    }
    return due;
  }

  function start(): void {
    if (timer) return;
    check();
    timer = setInterval(check, TICK_MS);
    if (timer.unref) timer.unref();
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, check };
}

export { createReminderService, formatTime, TICK_MS };
