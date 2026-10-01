/**
 * 轻量 JSON 文件数据库
 * 零原生依赖，写入采用「临时文件 + 原子重命名」保证断电不损坏数据。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createId, createToken } from './crypto';
import type {
  AppSettings,
  CompletedPoint,
  Session,
  StoreStats,
  Task,
  TaskFilter,
  TaskPatch,
  User,
} from '../shared/types';

const LOCAL_USERNAME = '本机用户';

interface DbShape {
  version: number;
  users: User[];
  sessions: Session[];
  tasks: Task[];
  messages: { id: string; userId: string; role: 'user' | 'assistant'; content: string; createdAt: string }[];
  settings: Record<string, Partial<AppSettings>>;
}

const EMPTY_DB: DbShape = {
  version: 1,
  users: [],
  sessions: [],
  tasks: [],
  messages: [],
  settings: {},
};

export const DEFAULT_SETTINGS: AppSettings = {
  locale: 'zh-CN',
  proxyMode: 'none',
  pomodoroMinutes: 25,
  liquidOpacity: 0.92,
  floatOpacity: 0.92,
  floatX: null,
  floatY: null,
  floatTaskId: null,
  proxyUrl: '',
  aiBaseUrl: 'https://api.deepseek.com/v1',
  aiApiKey: '',
  aiModel: 'deepseek-chat',
  aiEnabled: true, // 未配置 Key 时自动降级为本地规则解析
  reminderEnabled: true,
  reminderLeadMinutes: 0,
};

const ALLOWED_CATEGORIES = ['工作', '学习', '生活', '健康', '财务', '社交', '其他'] as const;
const ALLOWED_PRIORITY: Task['priority'][] = ['high', 'medium', 'low'];

export interface Store {
  file: string;
  dir: string;
  findUserByName(username: string): User | null;
  findUserById(id: string): User | null;
  createUser(input: { username: string; passwordHash: string }): User;
  ensureLocalUser(): User;
  createSession(userId: string): Session;
  getUserByToken(token: string): User | null;
  deleteSession(token: string): void;
  listTasks(userId: string, filter?: TaskFilter): Task[];
  createTask(userId: string, payload: TaskPatch): Task;
  createTasks(userId: string, payloads: TaskPatch[]): Task[];
  getTask(userId: string, id: string): Task | null;
  incrementPomodoro(userId: string, id: string): Task | null;
  updateTask(userId: string, id: string, patch: TaskPatch): Task | null;
  reorderTasks(userId: string, taskIds: string[]): boolean;
  deleteTask(userId: string, id: string): boolean;
  pullDueReminders(userId: string, now?: number): Task[];
  markReminded(ids: string[]): boolean;
  listUpcoming(userId: string, minutes?: number, now?: number): Task[];
  getSettings(userId: string): AppSettings;
  updateSettings(userId: string, patch: Partial<AppSettings>): AppSettings;
  addMessage(userId: string, role: 'user' | 'assistant', content: string): void;
  getHistory(userId: string, limit?: number): { role: 'user' | 'assistant'; content: string }[];
  clearHistory(userId: string): void;
  stats(userId: string): StoreStats;
  completedTimeline(userId: string): CompletedPoint[];
  reload(): void;
}

function createStore(dataDir?: string): Store {
  const dir = dataDir || path.join(os.tmpdir(), 'ai-todo-data');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'db.json');

  let db: DbShape = load();

  function load(): DbShape {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<DbShape>;
      return { ...structuredClone(EMPTY_DB), ...parsed };
    } catch {
      return structuredClone(EMPTY_DB);
    }
  }

  function save(): void {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  // ---------------- 用户 ----------------
  function findUserByName(username: string): User | null {
    const name = String(username || '').trim().toLowerCase();
    return db.users.find((u) => u.username.toLowerCase() === name) || null;
  }

  function findUserById(id: string): User | null {
    return db.users.find((u) => u.id === id) || null;
  }

  function createUser({ username, passwordHash }: { username: string; passwordHash: string }): User {
    const user: User = {
      id: createId('u'),
      username: String(username).trim(),
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    db.settings[user.id] = { ...DEFAULT_SETTINGS };
    save();
    return user;
  }

  /**
   * 取本机默认用户；首次运行自动创建。
   * 兼容旧版本：如果数据里已有用户，直接复用第一个，避免历史数据丢失。
   */
  function ensureLocalUser(): User {
    if (db.users.length) return db.users[0];
    return createUser({ username: LOCAL_USERNAME, passwordHash: '' });
  }

  // ---------------- 会话 ----------------
  function createSession(userId: string): Session {
    const session: Session = {
      token: createToken(),
      userId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    };
    db.sessions.push(session);
    save();
    return session;
  }

  function getUserByToken(token: string): User | null {
    const s = db.sessions.find((x) => x.token === token);
    if (!s) return null;
    if (new Date(s.expiresAt).getTime() < Date.now()) {
      db.sessions = db.sessions.filter((x) => x.token !== token);
      save();
      return null;
    }
    return findUserById(s.userId);
  }

  function deleteSession(token: string): void {
    db.sessions = db.sessions.filter((s) => s.token !== token);
    save();
  }

  // ---------------- 任务 ----------------
  function listTasks(userId: string, filter: TaskFilter = {}): Task[] {
    let list = db.tasks.filter((x) => x.userId === userId);
    const { status = 'active', category = 'all', priority = 'all', keyword = '' } = filter;
    if (status === 'active') list = list.filter((x) => !x.completed);
    if (status === 'done') list = list.filter((x) => x.completed);
    if (category && category !== 'all') list = list.filter((x) => x.category === category);
    if (priority && priority !== 'all') list = list.filter((x) => x.priority === priority);
    if (keyword && keyword.trim()) {
      const k = keyword.trim().toLowerCase();
      list = list.filter(
        (x) =>
          String(x.title || '').toLowerCase().includes(k) ||
          String(x.note || '').toLowerCase().includes(k)
      );
    }
    return list.sort((a, b) => {
      const hasOrderA = typeof a.order === 'number';
      const hasOrderB = typeof b.order === 'number';
      if (hasOrderA && hasOrderB) return (a.order as number) - (b.order as number);
      if (hasOrderA) return -1;
      if (hasOrderB) return 1;
      const pa = { high: 0, medium: 1, low: 2 }[a.priority] ?? 3;
      const pb = { high: 0, medium: 1, low: 2 }[b.priority] ?? 3;
      if (pa !== pb) return pa - pb;
      const da = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
      const dbb = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
      if (da !== dbb) return da - dbb;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  function sanitizeCategory(c: unknown): string {
    return (ALLOWED_CATEGORIES as readonly string[]).includes(String(c)) ? String(c) : '其他';
  }

  function normalizeDate(v: unknown): string | null {
    if (!v) return null;
    const d = new Date(String(v));
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function normalizeTask(t: Task): Task {
    const now = new Date().toISOString();
    return {
      id: t.id,
      userId: t.userId,
      title: String(t.title || '未命名任务').slice(0, 200),
      note: t.note ? String(t.note).slice(0, 2000) : '',
      priority: (ALLOWED_PRIORITY as string[]).includes(t.priority) ? t.priority : 'medium',
      priorityReason: t.priorityReason ? String(t.priorityReason).slice(0, 300) : '',
      category: sanitizeCategory(t.category),
      dueAt: normalizeDate(t.dueAt),
      remindAt: normalizeDate(t.remindAt),
      completed: Boolean(t.completed),
      completedAt: t.completed ? t.completedAt || now : null,
      reminded: Boolean(t.reminded),
      pomodoros: Number.isFinite(Number(t.pomodoros)) ? Math.max(0, Math.floor(Number(t.pomodoros))) : 0,
      order: typeof t.order === 'number' && Number.isFinite(t.order) ? t.order : undefined,
      source: t.source === 'ai' ? 'ai' : 'manual',
      createdAt: t.createdAt || now,
      updatedAt: now,
    };
  }

  function createTask(userId: string, payload: TaskPatch): Task {
    const task = normalizeTask({ ...payload, userId, id: createId('t') } as Task);
    db.tasks.push(task);
    save();
    return task;
  }

  function createTasks(userId: string, payloads: TaskPatch[]): Task[] {
    const created = payloads.map((p) => normalizeTask({ ...p, userId, id: createId('t') } as Task));
    db.tasks.push(...created);
    save();
    return created;
  }

  function getTask(userId: string, id: string): Task | null {
    return db.tasks.find((x) => x.userId === userId && x.id === id) || null;
  }

  function updateTask(userId: string, id: string, patch: TaskPatch): Task | null {
    const t = getTask(userId, id);
    if (!t) return null;
    const merged = normalizeTask({ ...t, ...patch, id: t.id, userId, createdAt: t.createdAt });
    if (patch.completed === true && !t.completed) merged.completedAt = new Date().toISOString();
    if (patch.completed === false) merged.completedAt = null;
    const idx = db.tasks.findIndex((x) => x.id === id);
    db.tasks[idx] = merged;
    save();
    return merged;
  }

  /** 番茄钟完成 +1 */
  function incrementPomodoro(userId: string, id: string): Task | null {
    const t = getTask(userId, id);
    if (!t) return null;
    t.pomodoros = (t.pomodoros || 0) + 1;
    t.updatedAt = new Date().toISOString();
    save();
    return t;
  }

  /** 自定义任务排序（按传入的任务 ID 顺序设置 order 权重） */
  function reorderTasks(userId: string, taskIds: string[]): boolean {
    if (!Array.isArray(taskIds) || !taskIds.length) return false;
    let changed = false;
    taskIds.forEach((id, index) => {
      const task = db.tasks.find((x) => x.userId === userId && x.id === id);
      if (task && task.order !== index) {
        task.order = index;
        task.updatedAt = new Date().toISOString();
        changed = true;
      }
    });
    if (changed) save();
    return true;
  }

  function deleteTask(userId: string, id: string): boolean {
    const before = db.tasks.length;
    db.tasks = db.tasks.filter((x) => !(x.userId === userId && x.id === id));
    save();
    return db.tasks.length < before;
  }

  /** 取出需要触发提醒的任务 */
  function pullDueReminders(userId: string, now: number = Date.now()): Task[] {
    const due: Task[] = [];
    for (const t of db.tasks) {
      if (t.userId !== userId) continue;
      if (t.completed || t.reminded || !t.remindAt) continue;
      if (new Date(t.remindAt).getTime() <= now) due.push(t);
    }
    return due;
  }

  function markReminded(ids: string[]): boolean {
    const set = new Set(ids);
    let changed = false;
    for (const t of db.tasks) {
      if (set.has(t.id) && !t.reminded) {
        t.reminded = true;
        changed = true;
      }
    }
    if (changed) save();
    return changed;
  }

  /** 距离现在 N 分钟内到期、但还没到点的任务（用于提前预告） */
  function listUpcoming(userId: string, minutes = 60, now: number = Date.now()): Task[] {
    const limit = now + minutes * 60 * 1000;
    return db.tasks.filter((t) => {
      if (t.userId !== userId || t.completed || !t.dueAt) return false;
      const ts = new Date(t.dueAt).getTime();
      return ts > now && ts <= limit;
    });
  }

  // ---------------- 设置 ----------------
  function getSettings(userId: string): AppSettings {
    return { ...DEFAULT_SETTINGS, ...(db.settings[userId] || {}) };
  }

  function updateSettings(userId: string, patch: Partial<AppSettings>): AppSettings {
    db.settings[userId] = { ...getSettings(userId), ...patch };
    save();
    return getSettings(userId);
  }

  // ---------------- 对话历史 ----------------
  function addMessage(userId: string, role: 'user' | 'assistant', content: string): void {
    db.messages.push({ id: createId('m'), userId, role, content, createdAt: new Date().toISOString() });
    // 每个用户最多保留 200 条历史
    const list = db.messages.filter((m) => m.userId === userId);
    if (list.length > 200) {
      const drop = list.slice(0, list.length - 200).map((m) => m.id);
      db.messages = db.messages.filter((m) => !drop.includes(m.id));
    }
    save();
  }

  function getHistory(userId: string, limit = 12): { role: 'user' | 'assistant'; content: string }[] {
    return db.messages
      .filter((m) => m.userId === userId)
      .slice(-limit)
      .map(({ role, content }) => ({ role, content }));
  }

  function clearHistory(userId: string): void {
    db.messages = db.messages.filter((m) => m.userId !== userId);
    save();
  }

  function stats(userId: string): StoreStats {
    const all = db.tasks.filter((t) => t.userId === userId);
    return {
      total: all.length,
      active: all.filter((t) => !t.completed).length,
      done: all.filter((t) => t.completed).length,
      high: all.filter((t) => !t.completed && t.priority === 'high').length,
    };
  }

  /** 完成任务的时间线（用于周/月/年统计） */
  function completedTimeline(userId: string): CompletedPoint[] {
    return db.tasks
      .filter((t) => t.userId === userId && t.completed)
      .map((t) => ({ completedAt: t.completedAt || t.updatedAt, category: t.category }))
      .filter((p) => Boolean(p.completedAt));
  }

  return {
    file,
    dir,
    findUserByName,
    findUserById,
    createUser,
    ensureLocalUser,
    createSession,
    getUserByToken,
    deleteSession,
    listTasks,
    createTask,
    createTasks,
    getTask,
    updateTask,
    reorderTasks,
    deleteTask,
    incrementPomodoro,
    pullDueReminders,
    markReminded,
    listUpcoming,
    getSettings,
    updateSettings,
    addMessage,
    getHistory,
    clearHistory,
    stats,
    completedTimeline,
    reload: () => {
      db = load();
    },
  };
}

export { createStore };
