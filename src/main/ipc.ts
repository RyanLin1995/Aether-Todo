/**
 * IPC 接口层：渲染进程通过 contextBridge 调用这里的处理器
 * 本机单机应用，无需登录：所有数据归属「本机用户」。
 */
import { app, ipcMain, nativeTheme } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { understand, parseLocally, callLLM, isEmptyResponseError, extractStreamReply } from './ai';
import { buildSystemPrompt } from './prompt';
import { resolveProxy, getDispatcher } from './proxy';
import { DEFAULT_SETTINGS } from './store';
import type { Store } from './store';
import type { ReminderService, NotifierPayload } from './reminder';
import type { PomodoroService } from './pomodoro';
import type { AppSettings, IpcResult, NotifyPayload, RepeatScope, TaskPatch, User } from '../shared/types';

const OK = <T>(data: T): IpcResult<T> => ({ ok: true, data });
const FAIL = (error: string): IpcResult<never> => ({ ok: false, error });

interface IpcDeps {
  store: Store;
  reminder: ReminderService;
  pomodoro: PomodoroService;
  /** 向所有窗口广播（主界面 + 浮窗） */
  broadcast: (channel: string, payload?: unknown) => void;
  float: {
    show: () => void;
    hide: () => void;
    toggle: () => void;
    openMain: () => void;
    setOpacity: (value: number) => number;
    /** 光标不在岛内时整窗穿透（透明区域不拦截下层点击） */
    setIgnoreMouseEvents: (ignore: boolean) => void;
    /** 读取浮窗当前屏幕坐标 */
    bounds: () => { x: number; y: number } | null;
    /** 按增量移动浮窗（内部会夹进工作区）；commit=true 时把落点写进设置 */
    moveBy: (dx: number, dy: number, commit: boolean) => { x: number; y: number } | null;
  };
  setActiveUserId?: (id: string) => void;
  onLocaleChange?: (locale: string) => void;
  appInfo: Record<string, unknown>;
  /** 应用内通知窗口的动作回调 */
  notifyActions?: {
    latest: () => NotifyPayload | null;
    close: () => void;
    openTask: (id: string | null) => void;
  };
}

function registerIpc({
  store,
  reminder,
  pomodoro,
  broadcast,
  float,
  setActiveUserId,
  onLocaleChange,
  appInfo,
  notifyActions,
}: IpcDeps): void {
  const user: User = store.ensureLocalUser();
  if (setActiveUserId) setActiveUserId(user.id);

  const notify = notifyActions ?? {
    latest: (): NotifyPayload | null => null,
    close: () => undefined,
    openTask: (_id: string | null) => undefined,
  };

  /** 统一异常兜底，处理函数只管业务逻辑（payload 由各 handler 自行声明形状） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function safe<T>(handler: (user: User, payload: any, event?: unknown) => Promise<IpcResult<T>> | IpcResult<T>) {
    return async (_event: unknown, payload: Record<string, any> = {}): Promise<IpcResult<T>> => {
      try {
        return await handler(user, payload, _event);
      } catch (err) {
        return FAIL(err instanceof Error ? err.message : String(err));
      }
    };
  }

  // ---------------- 任务 ----------------
  ipcMain.handle('tasks:list', safe(async (u, { filter }) => OK(store.listTasks(u.id, filter))));

  ipcMain.handle('tasks:create', safe(async (u, { task }: { task: TaskPatch }) => {
    const created = store.createTask(u.id, task);
    broadcast('tasks:changed', null);
    return OK(created);
  }));

  ipcMain.handle('tasks:createMany', safe(async (u, { tasks }: { tasks: TaskPatch[] }) => {
    const created = store.createTasks(u.id, tasks || []);
    broadcast('tasks:changed', null);
    return OK(created);
  }));

  ipcMain.handle('tasks:update', safe(async (u, { id, patch }: { id: string; patch: TaskPatch }) => {
    const updated = store.updateTask(u.id, id, patch);
    if (!updated) return FAIL('任务不存在');
    broadcast('tasks:changed', null);
    return OK(updated);
  }));

  ipcMain.handle('tasks:delete', safe(async (u, { id }: { id: string }) => {
    const deleted = store.deleteTask(u.id, id);
    broadcast('tasks:changed', null);
    return OK({ deleted });
  }));

  ipcMain.handle('tasks:bulkComplete', safe(async (u, { ids }: { ids: string[] }) => {
    const done = (ids || [])
      .map((id) => store.updateTask(u.id, id, { completed: true }))
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
    broadcast('tasks:changed', null);
    return OK(done);
  }));

  // ---------------- 重复任务 ----------------
  /** 勾选完成 / 取消完成：重复系列会自动推进或回滚下一期 */
  ipcMain.handle('tasks:toggleComplete', safe(async (u, { id, completed }: { id: string; completed: boolean }) => {
    const res = store.toggleComplete(u.id, String(id), Boolean(completed));
    if (!res) return FAIL('任务不存在');
    broadcast('tasks:changed', null);
    return OK(res);
  }));

  /** 编辑重复任务：scope = 'once' 仅本次 / 'series' 整个系列 */
  ipcMain.handle('tasks:updateScoped', safe(async (u, { id, patch, scope }: { id: string; patch: TaskPatch; scope: RepeatScope }) => {
    const updated = store.updateTaskScoped(u.id, String(id), patch || {}, scope === 'series' ? 'series' : 'once');
    if (!updated) return FAIL('任务不存在');
    broadcast('tasks:changed', null);
    return OK(updated);
  }));

  /** 删除重复任务：scope = 'once' 仅本次 / 'series' 整个系列 */
  ipcMain.handle('tasks:deleteScoped', safe(async (u, { id, scope }: { id: string; scope: RepeatScope }) => {
    const res = store.deleteTaskScoped(u.id, String(id), scope === 'series' ? 'series' : 'once');
    broadcast('tasks:changed', null);
    return OK({ deleted: res.deleted, next: res.next });
  }));

  /** 取任务所属重复系列（普通任务返回 null），编辑弹窗用于回填规则 */
  ipcMain.handle('series:forTask', safe(async (u, { id }: { id: string }) => {
    return OK(store.getSeriesForTask(u.id, String(id)));
  }));

  ipcMain.handle('tasks:reorder', safe(async (u, { ids }: { ids: string[] }) => {
    const ok = store.reorderTasks(u.id, ids || []);
    broadcast('tasks:changed', null);
    return OK({ reordered: ok });
  }));

  ipcMain.handle('tasks:stats', safe(async (u) => OK(store.stats(u.id))));

  ipcMain.handle('stats:timeline', safe(async (u) => OK(store.completedTimeline(u.id))));

  // ---------------- AI ----------------
  ipcMain.handle('ai:chat', safe(async (u, { text }: { text: string }, event) => {
    const input = String(text || '').trim();
    if (!input) return FAIL('请输入内容');
    const settings = store.getSettings(u.id);
    const history = store.getHistory(u.id, 10);
    const tasks = store.listTasks(u.id, { status: 'active' }).slice(0, 50);
    store.addMessage(u.id, 'user', input);
    const aiUrl = settings.aiBaseUrl || '';
    const proxy = await resolveProxy(settings, aiUrl);
    // 流式增量：从模型输出里提取 reply 字段的当前值推给渲染进程，边生成边显示
    const sender = (event as { sender?: { send: (channel: string, data: unknown) => void } } | undefined)?.sender;
    let lastPushed = '';
    const onChunk = sender
      ? (full: string) => {
          const reply = extractStreamReply(full);
          if (reply && reply.length > lastPushed.length) {
            lastPushed = reply;
            sender.send('ai:chat:chunk', { reply });
          }
        }
      : undefined;
    const result = await understand({
      text: input,
      settings,
      history,
      tasks,
      now: new Date(),
      dispatcher: getDispatcher(proxy.url),
      onChunk,
    });
    store.addMessage(u.id, 'assistant', result.reply);
    return OK(result);
  }));

  ipcMain.handle('ai:history', safe(async (u) => OK(store.getHistory(u.id, 50))));

  ipcMain.handle('ai:clearHistory', safe(async (u) => {
    store.clearHistory(u.id);
    return OK({});
  }));

  ipcMain.handle('ai:test', safe(async (u, { settings: patch }: { settings?: Partial<AppSettings> }) => {
    const settings: AppSettings = { ...store.getSettings(u.id), ...(patch || {}) };
    if (!settings.aiApiKey) return FAIL('请先填写 API Key');
    try {
      const proxy = await resolveProxy(settings, settings.aiBaseUrl || '');
      const content = await callLLM({
        settings,
        timeoutMs: 25000,
        dispatcher: getDispatcher(proxy.url),
        messages: [
          { role: 'system', content: buildSystemPrompt(new Date(), settings.locale) },
          { role: 'user', content: '回复 {"reply":"连接成功","intent":"chat","tasks":[],"matchTitles":[]}' },
        ],
      });
      return OK({ raw: String(content).slice(0, 300), empty: false });
    } catch (err) {
      // 测活的目标是“链路通不通”：模型偶尔返回空内容属正常波动，仍算连接成功
      if (isEmptyResponseError(err)) return OK({ raw: '', empty: true });
      return FAIL(`连接失败：${(err as Error).message}`);
    }
  }));

  // ---------------- 设置 ----------------
  ipcMain.handle('settings:get', safe(async (u) => OK(store.getSettings(u.id))));

  ipcMain.handle('settings:update', safe(async (u, { patch }: { patch?: Partial<AppSettings> }) => {
    const next = store.updateSettings(u.id, patch || {});
    if (patch && patch.locale && onLocaleChange) onLocaleChange(patch.locale);
    // 外观类设置（整体液态程度 / 主题 / 语言）与番茄钟时长变化后立即同步灵动岛：
    // 前者让背景与按钮的玻璃材质跟主界面保持同一套材质参数，
    // 后者让岛内「开始专注」直接使用最新时长（否则岛内缓存的仍是旧值）。
    if (
      patch &&
      (patch.floatOpacity !== undefined ||
        patch.liquidOpacity !== undefined ||
        patch.locale !== undefined ||
        patch.pomodoroMinutes !== undefined)
    ) {
      broadcast('float:state-changed', null);
    }
    return OK(next);
  }));

  ipcMain.handle('settings:defaults', async () => OK(DEFAULT_SETTINGS));

  // ---------------- 提醒与应用 ----------------
  ipcMain.handle('reminder:checkNow', safe(async () => {
    const due = reminder.check();
    return OK({ count: due.length, tasks: due });
  }));

  /** 安装版才有卸载程序；绿色版/开发模式下返回不可用 */
  function findUninstaller(): string | null {
    try {
      const dir = path.dirname(process.execPath);
      const hit = fs.readdirSync(dir).find((f) => /^uninstall.*.exe$/i.test(f));
      return hit ? path.join(dir, hit) : null;
    } catch {
      return null;
    }
  }

  ipcMain.handle('app:info', async () => OK({ ...appInfo, dataDir: store.dir, canUninstall: Boolean(findUninstaller()) }));

  ipcMain.handle('app:uninstall', async () => {
    const uninstaller = findUninstaller();
    if (!uninstaller) return FAIL('未找到卸载程序（开发模式或免安装版不可用）');
    try {
      spawn(uninstaller, [], { detached: true, stdio: 'ignore' }).unref();
      setTimeout(() => app.quit(), 600);
      return OK({ uninstaller });
    } catch (err) {
      return FAIL((err as Error).message);
    }
  });

  /** 本地规则引擎的即时预览（不写历史，用于输入框实时提示） */
  ipcMain.handle('ai:preview', safe(async (u, { text }: { text: string }) => {
    const tasks = store.listTasks(u.id, { status: 'active' }).slice(0, 50);
    const locale = store.getSettings(u.id).locale;
    return OK(parseLocally(String(text || ''), { now: new Date(), tasks, locale }));
  }));

  // ---------------- 番茄钟 ----------------
  ipcMain.handle('pomodoro:start', safe(async (_u, { taskId, minutes }: { taskId: string; minutes?: number }) => {
    try {
      const duration = Number(minutes) || store.getSettings(user.id).pomodoroMinutes || 25;
      return OK(pomodoro.start(String(taskId), duration));
    } catch (err) {
      return FAIL(err instanceof Error ? err.message : String(err));
    }
  }));

  ipcMain.handle('pomodoro:stop', safe(async () => {
    pomodoro.stop();
    return OK({});
  }));

  ipcMain.handle('pomodoro:pause', safe(async () => {
    return OK(pomodoro.pause());
  }));

  ipcMain.handle('pomodoro:resume', safe(async () => {
    return OK(pomodoro.resume());
  }));

  ipcMain.handle('pomodoro:status', safe(async () => OK(pomodoro.status())));

  // ---------------- 浮窗 ----------------
  ipcMain.handle('float:show', safe(async () => {
    float.show();
    return OK({});
  }));

  ipcMain.handle('float:hide', safe(async () => {
    float.hide();
    return OK({});
  }));

  ipcMain.handle('float:toggle', safe(async () => {
    float.toggle();
    return OK({});
  }));

  ipcMain.handle('float:openMain', safe(async () => {
    float.openMain();
    return OK({});
  }));

  ipcMain.handle('float:setOpacity', safe(async (_u, { opacity }: { opacity: number }) => {
    return OK({ opacity: float.setOpacity(Number(opacity)) });
  }));

  ipcMain.handle('float:setIgnoreMouse', safe(async (_u, { ignore }: { ignore: boolean }) => {
    float.setIgnoreMouseEvents(Boolean(ignore));
    return OK({});
  }));

  /** 浮窗当前屏幕坐标（拖拽基准点） */
  ipcMain.handle('float:bounds', safe(async () => OK(float.bounds())));

  /** 拖拽移动浮窗：commit=true 时落盘保存，下次启动仍在原地 */
  ipcMain.handle(
    'float:moveBy',
    safe(async (_u, { dx, dy, commit }: { dx: number; dy: number; commit?: boolean }) =>
      OK(float.moveBy(Number(dx), Number(dy), Boolean(commit))))
  );

  /** 浮窗内容：当前任务 + 番茄状态 + 透明度 + 语言 */
  ipcMain.handle('float:state', safe(async (u) => {
    const settings = store.getSettings(u.id);
    const pomo = pomodoro.status();
    const all = store.listTasks(u.id, { status: 'all' });
    const active = all.filter((x) => !x.completed);
    const pick = (x: (typeof all)[number]) => ({
      id: x.id,
      title: x.title,
      priority: x.priority,
      category: x.category,
      dueAt: x.dueAt,
      pomodoros: x.pomodoros || 0,
    });
    // 展示优先级：运行中的番茄钟任务 > 用户固定（送入灵动岛）的任务 > 兜底列表第一个
    let task: ReturnType<typeof pick> | null = null;
    if (pomo) {
      const hit = all.find((x) => x.id === pomo.taskId);
      task = hit
        ? pick(hit)
        : { id: pomo.taskId, title: pomo.title, priority: 'medium', category: '其他', dueAt: null, pomodoros: 0 };
    }
    if (!task && settings.floatTaskId) {
      const pinned = all.find((x) => x.id === settings.floatTaskId);
      if (pinned) task = pick(pinned);
    }
    if (!task && active.length) task = pick(active[0]);
    return OK({
      task,
      pomodoro: pomo,
      opacity: settings.liquidOpacity ?? settings.floatOpacity,
      locale: settings.locale,
      // 主题跟随系统明暗，保证灵动岛与主界面同一套配色
      theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      pomodoroMinutes: settings.pomodoroMinutes,
    });
  }));

  /** 把指定任务送入灵动岛展示 */
  ipcMain.handle('float:setTask', safe(async (u, { id }: { id: string }) => {
    const hit = store.listTasks(u.id, { status: 'all' }).find((x) => x.id === String(id));
    if (!hit) return FAIL('任务不存在');
    store.updateSettings(u.id, { floatTaskId: hit.id });
    broadcast('float:state-changed', null);
    return OK({ id: hit.id });
  }));

  /** 灵动岛内切换上/下一个任务（按进行中列表循环） */
  ipcMain.handle('float:cycleTask', safe(async (u, { dir }: { dir: number }) => {
    const active = store.listTasks(u.id, { status: 'active' });
    if (!active.length) return FAIL('暂无进行中的任务');
    const settings = store.getSettings(u.id);
    const pomo = pomodoro.status();
    const n = active.length;
    // 以「当前正在展示的任务」为基准：运行中的番茄钟任务 > 固定任务 > 兜底第一个
    const currentId = pomo ? pomo.taskId : settings.floatTaskId;
    const idx = active.findIndex((x) => x.id === currentId);
    const base = idx >= 0 ? idx : 0;
    const next = active[(((base + (dir >= 0 ? 1 : -1)) % n) + n) % n];
    store.updateSettings(u.id, { floatTaskId: next.id });
    broadcast('float:state-changed', null);
    return OK({ id: next.id, title: next.title });
  }));

  // ---------------- 应用内通知（液态玻璃通知卡） ----------------
  /** 通知窗口加载完成后拉取当前（或最近一条）通知，避免创建窗口时的推送丢失 */
  ipcMain.handle('notify:init', safe(async () => OK(notify.latest())));

  /** 关闭通知卡 */
  ipcMain.handle('notify:close', safe(async () => {
    notify.close();
    return OK({});
  }));

  /** 点击通知：打开主界面并定位任务 */
  ipcMain.handle('notify:openTask', safe(async (_u, { id }: { id: string | null }) => {
    notify.openTask(typeof id === 'string' ? id : null);
    return OK({});
  }));
}

export { registerIpc };
export type { NotifierPayload };
