/**
 * 轻量 JSON 文件数据库
 * 零原生依赖，写入采用「临时文件 + 原子重命名」保证断电不损坏数据。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createId, createToken } from './crypto';
import {
  applyTimeOfDay,
  extractTimeOfDay,
  isCountExhausted,
  nextOccurrence,
  normalizeRule,
  parseDateKey,
  startOfDay,
  toDateKey,
} from '../shared/recurrence';
import type {
  AppSettings,
  CompletedPoint,
  RepeatRule,
  RepeatScope,
  RepeatSeries,
  Session,
  StoreStats,
  Task,
  TaskFilter,
  TaskPatch,
  User,
} from '../shared/types';

const LOCAL_USERNAME = '本机用户';

/** 当前数据格式版本：2 = 引入重复任务（series 表 + task.seriesId） */
const DB_VERSION = 2;

interface DbShape {
  version: number;
  users: User[];
  sessions: Session[];
  tasks: Task[];
  /** 重复系列（模板 + 规则）；实例始终是普通 Task，通过 task.seriesId 关联 */
  series: RepeatSeries[];
  messages: { id: string; userId: string; role: 'user' | 'assistant'; content: string; createdAt: string }[];
  settings: Record<string, Partial<AppSettings>>;
}

const EMPTY_DB: DbShape = {
  version: DB_VERSION,
  users: [],
  sessions: [],
  tasks: [],
  series: [],
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
  launchOnStartup: false,
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
  // ---------------- 重复任务 ----------------
  /** 勾选完成 / 取消完成；完成时自动推进出下一期 */
  toggleComplete(
    userId: string,
    id: string,
    completed: boolean
  ): { task: Task; next: Task | null } | null;
  /** 编辑重复任务：scope='once' 只改这一期，scope='series' 同步整个系列 */
  updateTaskScoped(userId: string, id: string, patch: TaskPatch, scope: RepeatScope): Task | null;
  /** 删除重复任务：scope='once' 删这一期并推进下一期，scope='series' 删整个系列 */
  deleteTaskScoped(userId: string, id: string, scope: RepeatScope): { deleted: boolean; next: Task | null };
  /** 取任务所属的重复系列（普通任务返回 null） */
  getSeriesForTask(userId: string, taskId: string): RepeatSeries | null;
  listSeries(userId: string): RepeatSeries[];
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

  /**
   * 版本迁移。
   * v1 → v2：新增 series 表。老任务没有 seriesId 字段，normalizeTask 会补成 null，
   * 即「普通一次性任务」，因此无需任何数据改写，纯增量兼容。
   */
  function migrate(db: DbShape): DbShape {
    if (!Array.isArray(db.series)) db.series = [];
    // 老任务没有 seriesId：补成 null，让「普通任务」的判定在读取时无需再判 undefined
    for (const t of db.tasks) {
      if (t && typeof t === 'object' && t.seriesId === undefined) t.seriesId = null;
    }
    db.version = DB_VERSION;
    return db;
  }

  function load(): DbShape {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<DbShape>;
      return migrate({ ...structuredClone(EMPTY_DB), ...parsed });
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
      seriesId: t.seriesId || null,
      createdAt: t.createdAt || now,
      updatedAt: now,
    };
  }

  // ---------------- 重复系列 ----------------
  function findSeries(userId: string, id: string | null | undefined): RepeatSeries | null {
    if (!id) return null;
    return db.series.find((s) => s.id === id && s.userId === userId) || null;
  }

  /** 该系列当前是否存在「未完成」的期 */
  function hasOpenInstance(userId: string, seriesId: string, exceptId?: string): boolean {
    return db.tasks.some(
      (x) => x.userId === userId && x.seriesId === seriesId && !x.completed && x.id !== exceptId
    );
  }

  /** 从模板 + 目标日期组装一个实例（不落库，由调用方 push） */
  function buildInstance(series: RepeatSeries, dateLocal: Date): Task {
    const now = new Date().toISOString();
    const due = applyTimeOfDay(dateLocal, series.timeOfDay);
    const remind =
      series.remindLeadMinutes != null
        ? new Date(due.getTime() - series.remindLeadMinutes * 60000).toISOString()
        : null;
    return normalizeTask({
      id: createId('t'),
      userId: series.userId,
      title: series.title,
      note: series.note,
      priority: series.priority,
      priorityReason: series.priorityReason,
      category: series.category,
      dueAt: due.toISOString(),
      remindAt: remind,
      completed: false,
      completedAt: null,
      reminded: false,
      pomodoros: 0,
      source: 'manual',
      seriesId: series.id,
      createdAt: now,
      updatedAt: now,
    } as Task);
  }

  /**
   * 推进出下一期。
   * @param fromDate 当前这一期的日期（取其本地日历日作为基准）
   * @returns 新建的实例；系列已结束或已存在后续期时返回 null
   */
  function spawnNextInstance(series: RepeatSeries, fromDate: Date): Task | null {
    const now = new Date().toISOString();
    if (isCountExhausted(series.rule, series.generatedCount)) return null;
    const next = nextOccurrence(fromDate, series.rule);
    if (!next) return null;
    // 幂等保护：该系列若已有未完成期落在下一期当天或之后，不重复生成
    const floor = startOfDay(next).getTime();
    const exists = db.tasks.some(
      (x) =>
        x.userId === series.userId &&
        x.seriesId === series.id &&
        !x.completed &&
        x.dueAt &&
        startOfDay(new Date(x.dueAt)).getTime() >= floor
    );
    if (exists) return null;
    const task = buildInstance(series, next);
    db.tasks.push(task);
    series.generatedCount += 1;
    series.updatedAt = now;
    return task;
  }

  /** 建立重复系列；startSeed 为首实例的日期时间（用于推导时刻与提醒偏移） */
  function createSeries(userId: string, payload: TaskPatch, rule: RepeatRule, startSeed: Date): RepeatSeries {
    const now = new Date().toISOString();
    const leadRaw = payload.remindAt ? (startSeed.getTime() - new Date(payload.remindAt).getTime()) / 60000 : null;
    const series: RepeatSeries = {
      id: createId('s'),
      userId,
      title: String(payload.title || '未命名任务').slice(0, 200),
      note: payload.note ? String(payload.note).slice(0, 2000) : '',
      priority: (ALLOWED_PRIORITY as string[]).includes(String(payload.priority))
        ? (payload.priority as Task['priority'])
        : 'medium',
      priorityReason: payload.priorityReason ? String(payload.priorityReason).slice(0, 300) : '',
      category: sanitizeCategory(payload.category),
      rule,
      timeOfDay: extractTimeOfDay(startSeed),
      remindLeadMinutes: leadRaw != null && Number.isFinite(leadRaw) ? Math.max(0, Math.round(leadRaw)) : null,
      generatedCount: 1,
      completedCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    db.series.push(series);
    return series;
  }

  /**
   * 实例化一条任务：若 payload 含合法 repeat 规则，则建立重复系列并关联 seriesId；
   * 否则作为普通一次性任务。本函数只构建对象、push 进内存，**不落盘**（由调用方统一 save）。
   */
  function materializeTask(userId: string, payload: TaskPatch): Task {
    const { repeat, ...rest } = payload;
    // 首实例日期：优先用用户填的截止时间，否则用规则起始日 09:00，再兜底为现在
    const seedSource = rest.dueAt ? new Date(rest.dueAt) : null;
    const rule = normalizeRule({
      ...(repeat || {}),
      startDate: (repeat as RepeatRule | undefined)?.startDate || toDateKey(seedSource || new Date()),
    });
    let seriesId: string | null = null;
    if (rule) {
      // 重复任务必须有时间锚点：没填截止时间时，落在生效起始日的 09:00
      const startDay = parseDateKey(rule.startDate) || new Date();
      const seed = seedSource || applyTimeOfDay(startDay, '09:00');
      rest.dueAt = seed.toISOString();
      const series = createSeries(userId, { ...rest, dueAt: seed.toISOString() }, rule, seed);
      seriesId = series.id;
    }
    return normalizeTask({ ...rest, userId, id: createId('t'), seriesId } as Task);
  }

  function createTask(userId: string, payload: TaskPatch): Task {
    const task = materializeTask(userId, payload);
    db.tasks.push(task);
    save();
    return task;
  }

  function createTasks(userId: string, payloads: TaskPatch[]): Task[] {
    const created = payloads.map((p) => materializeTask(userId, p));
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

  // ---------------- 重复任务的作用域操作 ----------------
  /**
   * 勾选完成 / 取消完成（重复任务会自动推进或回滚下一期）
   * - 完成当前期 → 若系列未结束且没有其它未完成期，生成下一期
   * - 取消完成 → 撤掉此前推进出来的后续期，回到「这一期未完成」的状态
   */
  function toggleComplete(
    userId: string,
    id: string,
    completed: boolean
  ): { task: Task; next: Task | null } | null {
    const t = getTask(userId, id);
    if (!t) return null;
    const updated = updateTask(userId, id, { completed });
    if (!updated) return null;
    const series = findSeries(userId, t.seriesId);
    let next: Task | null = null;
    if (series) {
      const now = new Date().toISOString();
      if (completed) {
        series.completedCount += 1;
        series.updatedAt = now;
        if (!hasOpenInstance(userId, series.id, id)) {
          next = spawnNextInstance(series, updated.dueAt ? new Date(updated.dueAt) : new Date());
        }
      } else {
        const drop = db.tasks.filter(
          (x) => x.userId === userId && x.seriesId === series.id && !x.completed && x.id !== id
        );
        if (drop.length) {
          const dropIds = new Set(drop.map((x) => x.id));
          db.tasks = db.tasks.filter((x) => !dropIds.has(x.id));
          series.generatedCount = Math.max(1, series.generatedCount - drop.length);
        }
        if (series.completedCount > 0) series.completedCount -= 1;
        series.updatedAt = now;
      }
      save();
    }
    return { task: updated, next };
  }

  /**
   * 编辑任务（可选作用范围）
   * - once：只改这一期
   * - series：更新系列模板 + 同步所有「未完成」的期（已完成的期保留历史原样）
   */
  function updateTaskScoped(userId: string, id: string, patch: TaskPatch, scope: RepeatScope): Task | null {
    const t = getTask(userId, id);
    if (!t) return null;
    const series = findSeries(userId, t.seriesId);
    const { repeat, ...rest } = patch;

    if (!series || scope === 'once') {
      const updated = updateTask(userId, id, rest);
      // 单期也可能改重复规则（此时同步回系列，后续期按新规则推进）
      if (updated && series && repeat !== undefined) {
        const rule = normalizeRule({
          ...repeat,
          startDate: repeat?.startDate || toDateKey(updated.dueAt ? new Date(updated.dueAt) : new Date()),
        });
        if (rule) {
          series.rule = rule;
          series.updatedAt = new Date().toISOString();
          save();
        }
      }
      return updated;
    }

    const now = new Date().toISOString();
    if (rest.title !== undefined) series.title = String(rest.title || '未命名任务').slice(0, 200);
    if (rest.note !== undefined) series.note = String(rest.note).slice(0, 2000);
    if (rest.priority !== undefined && (ALLOWED_PRIORITY as string[]).includes(rest.priority)) {
      series.priority = rest.priority as Task['priority'];
    }
    if (rest.category !== undefined) series.category = sanitizeCategory(rest.category);
    if (rest.dueAt) series.timeOfDay = extractTimeOfDay(new Date(rest.dueAt));
    if (rest.remindAt !== undefined) {
      const dueRef = rest.dueAt ? new Date(rest.dueAt) : t.dueAt ? new Date(t.dueAt) : new Date();
      series.remindLeadMinutes = rest.remindAt
        ? Math.max(0, Math.round((dueRef.getTime() - new Date(rest.remindAt).getTime()) / 60000))
        : null;
    }
    if (repeat !== undefined) {
      const rule = normalizeRule({
        ...repeat,
        startDate: repeat?.startDate || toDateKey(t.dueAt ? new Date(t.dueAt) : new Date()),
      });
      if (rule) series.rule = rule;
    }
    series.updatedAt = now;

    let current: Task | null = null;
    for (const x of db.tasks) {
      if (x.userId !== userId || x.seriesId !== series.id || x.completed) continue;
      if (rest.title !== undefined) x.title = series.title;
      if (rest.note !== undefined) x.note = series.note;
      if (rest.priority !== undefined) x.priority = series.priority;
      if (rest.category !== undefined) x.category = series.category;
      if (rest.dueAt && x.dueAt) x.dueAt = applyTimeOfDay(new Date(x.dueAt), series.timeOfDay).toISOString();
      x.remindAt =
        series.remindLeadMinutes != null && x.dueAt
          ? new Date(new Date(x.dueAt).getTime() - series.remindLeadMinutes * 60000).toISOString()
          : null;
      x.updatedAt = now;
      if (x.id === id) current = x;
    }
    save();
    return current || getTask(userId, id);
  }

  /**
   * 删除任务（可选作用范围）
   * - once：只删这一期；系列未结束时自动推进出下一期（跳过本期）
   * - series：删除整个系列及其所有期（含已完成的期）
   */
  function deleteTaskScoped(userId: string, id: string, scope: RepeatScope): { deleted: boolean; next: Task | null } {
    const t = getTask(userId, id);
    if (!t) return { deleted: false, next: null };
    const series = findSeries(userId, t.seriesId);

    if (!series || scope === 'once') {
      const deleted = deleteTask(userId, id);
      let next: Task | null = null;
      if (deleted && series && !hasOpenInstance(userId, series.id)) {
        next = spawnNextInstance(series, t.dueAt ? new Date(t.dueAt) : new Date());
        save();
      }
      return { deleted, next };
    }

    db.tasks = db.tasks.filter((x) => !(x.userId === userId && x.seriesId === series.id));
    db.series = db.series.filter((s) => s.id !== series.id);
    save();
    return { deleted: true, next: null };
  }

  function getSeriesForTask(userId: string, taskId: string): RepeatSeries | null {
    const t = getTask(userId, taskId);
    if (!t || !t.seriesId) return null;
    return findSeries(userId, t.seriesId);
  }

  function listSeries(userId: string): RepeatSeries[] {
    return db.series.filter((s) => s.userId === userId);
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
    toggleComplete,
    updateTaskScoped,
    deleteTaskScoped,
    getSeriesForTask,
    listSeries,
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
