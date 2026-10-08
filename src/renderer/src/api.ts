/** 主进程 API 封装：统一处理错误（本机单机应用，无登录态） */
import type {
  AppSettings,
  CompletedPoint,
  IpcResult,
  RepeatScope,
  RepeatSeries,
  StoreStats,
  Task,
  TaskFilter,
  TaskPatch,
} from '../../shared/types';

/** window.api 的类型（由 src/preload.ts 注入） */
export interface ApiBridge {
  listTasks(filter: TaskFilter): Promise<IpcResult<Task[]>>;
  createTask(task: TaskPatch): Promise<IpcResult<Task>>;
  createTasks(tasks: TaskPatch[]): Promise<IpcResult<Task[]>>;
  updateTask(id: string, patch: TaskPatch): Promise<IpcResult<Task>>;
  deleteTask(id: string): Promise<IpcResult<{ deleted: boolean }>>;
  toggleCompleteTask(id: string, completed: boolean): Promise<IpcResult<{ task: Task; next: Task | null }>>;
  updateTaskScoped(id: string, patch: TaskPatch, scope: RepeatScope): Promise<IpcResult<Task>>;
  deleteTaskScoped(id: string, scope: RepeatScope): Promise<IpcResult<{ deleted: boolean; next: Task | null }>>;
  seriesForTask(id: string): Promise<IpcResult<RepeatSeries | null>>;
  bulkComplete(ids: string[]): Promise<IpcResult<Task[]>>;
  reorderTasks(ids: string[]): Promise<IpcResult<{ reordered: boolean }>>;
  stats(): Promise<IpcResult<StoreStats>>;
  statsTimeline(): Promise<IpcResult<CompletedPoint[]>>;

  aiChat(text: string): Promise<IpcResult<unknown>>;
  aiPreview(text: string): Promise<IpcResult<unknown>>;
  aiHistory(): Promise<IpcResult<{ role: 'user' | 'assistant'; content: string }[]>>;
  aiClearHistory(): Promise<IpcResult<Record<string, never>>>;
  aiTest(settings: Partial<AppSettings>): Promise<IpcResult<{ raw: string; empty?: boolean }>>;
  onAiChatChunk(cb: (data: { reply: string }) => void): () => void;

  getSettings(): Promise<IpcResult<AppSettings>>;
  updateSettings(patch: Partial<AppSettings>): Promise<IpcResult<AppSettings>>;
  getDefaults(): Promise<IpcResult<AppSettings>>;

  checkReminders(): Promise<IpcResult<{ count: number; tasks: Task[] }>>;
  appInfo(): Promise<IpcResult<Record<string, string | boolean>>>;
  appUninstall(): Promise<IpcResult<{ uninstaller: string }>>;

  pomodoroStart(taskId: string, minutes?: number): Promise<IpcResult<PomodoroStatus>>;
  pomodoroStop(): Promise<IpcResult<Record<string, never>>>;
  pomodoroPause(): Promise<IpcResult<PomodoroStatus | null>>;
  pomodoroResume(): Promise<IpcResult<PomodoroStatus | null>>;
  pomodoroStatus(): Promise<IpcResult<PomodoroStatus | null>>;

  floatShow(): Promise<IpcResult<Record<string, never>>>;
  floatHide(): Promise<IpcResult<Record<string, never>>>;
  floatToggle(): Promise<IpcResult<Record<string, never>>>;
  floatSetOpacity(opacity: number): Promise<IpcResult<{ opacity: number }>>;
  floatState(): Promise<IpcResult<FloatState>>;
  floatSetTask(id: string): Promise<IpcResult<{ id: string }>>;
  floatCycleTask(dir: number): Promise<IpcResult<{ id: string; title: string }>>;
  onFloatStateChanged(cb: () => void): () => void;

  onPomodoroChanged(cb: (s: PomodoroStatus | null) => void): () => void;
  onPomodoroTick(cb: (s: PomodoroStatus | null) => void): () => void;
  onTasksChanged(cb: () => void): () => void;

  onReminderOpen(cb: (id: string | null) => void): () => void;
}

export interface PomodoroStatus {
  taskId: string;
  title: string;
  startedAt: string;
  endsAt: string;
  minutes: number;
  remainingMs: number;
  isPaused: boolean;
}

export interface FloatState {
  task: { id: string; title: string; priority: string; category: string; dueAt: string | null } | null;
  pomodoro: PomodoroStatus | null;
  opacity: number;
  locale: string;
  pomodoroMinutes: number;
}

declare global {
  interface Window {
    api: ApiBridge;
  }
}

function unwrap<T>(res: IpcResult<T>): T {
  if (!res) throw new Error('无响应');
  if (!res.ok) throw new Error(res.error || '操作失败');
  return res.data;
}

const api = window.api;

export const Tasks = {
  list: async (filter: TaskFilter) => unwrap(await api.listTasks(filter)),
  create: async (task: TaskPatch) => unwrap(await api.createTask(task)),
  createMany: async (tasks: TaskPatch[]) => unwrap(await api.createTasks(tasks)),
  update: async (id: string, patch: TaskPatch) => unwrap(await api.updateTask(id, patch)),
  remove: async (id: string) => unwrap(await api.deleteTask(id)),
  toggle: async (id: string, completed: boolean) => unwrap(await api.toggleCompleteTask(id, completed)),
  updateScoped: async (id: string, patch: TaskPatch, scope: RepeatScope) =>
    unwrap(await api.updateTaskScoped(id, patch, scope)),
  removeScoped: async (id: string, scope: RepeatScope) => unwrap(await api.deleteTaskScoped(id, scope)),
  seriesOf: async (id: string) => unwrap(await api.seriesForTask(id)),
  bulkComplete: async (ids: string[]) => unwrap(await api.bulkComplete(ids)),
  reorder: async (ids: string[]) => unwrap(await api.reorderTasks(ids)),
  stats: async () => unwrap(await api.stats()),
};

export const AI = {
  chat: async (text: string) => unwrap(await api.aiChat(text)),
  history: async () => unwrap(await api.aiHistory()),
  clear: async () => unwrap(await api.aiClearHistory()),
  test: async (settings: Partial<AppSettings>) => unwrap(await api.aiTest(settings)),
  onChunk: (cb: (data: { reply: string }) => void) => api.onAiChatChunk(cb),
};

export const Pomodoro = {
  start: async (taskId: string, minutes?: number) => unwrap(await api.pomodoroStart(taskId, minutes)),
  stop: async () => unwrap(await api.pomodoroStop()),
  pause: async () => unwrap(await api.pomodoroPause()),
  resume: async () => unwrap(await api.pomodoroResume()),
  status: async () => unwrap(await api.pomodoroStatus()),
  onChanged: (cb: (s: PomodoroStatus | null) => void) => api.onPomodoroChanged(cb),
  onTick: (cb: (s: PomodoroStatus | null) => void) => api.onPomodoroTick(cb),
};

export const FloatWindow = {
  show: async () => unwrap(await api.floatShow()),
  hide: async () => unwrap(await api.floatHide()),
  toggle: async () => unwrap(await api.floatToggle()),
  setOpacity: async (v: number) => unwrap(await api.floatSetOpacity(v)),
  state: async () => unwrap(await api.floatState()),
  sendTask: async (id: string) => unwrap(await api.floatSetTask(id)),
  cycleTask: async (dir: number) => unwrap(await api.floatCycleTask(dir)),
  onStateChanged: (cb: () => void) => api.onFloatStateChanged(cb),
};

export const Settings = {
  get: async () => unwrap(await api.getSettings()),
  update: async (patch: Partial<AppSettings>) => unwrap(await api.updateSettings(patch)),
};

export const Stats = {
  timeline: async () => unwrap(await api.statsTimeline()),
};

export const App = {
  info: async () => unwrap(await api.appInfo()),
  uninstall: async () => unwrap(await api.appUninstall()),
  checkReminders: async () => unwrap(await api.checkReminders()),
  onReminderOpen: (cb: (id: string | null) => void) => api.onReminderOpen(cb),
  onTasksChanged: (cb: () => void) => api.onTasksChanged(cb),
};
