/** 全应用共享类型定义（主进程 / 渲染进程共用） */

export type Priority = 'high' | 'medium' | 'low';
export type TaskSource = 'manual' | 'ai';
export type Intent = 'create' | 'complete' | 'list' | 'chat';
export type Engine = 'ai' | 'local';
export type Locale = 'zh-CN' | 'en-US';
export type ProxyMode = 'none' | 'system' | 'custom';

/** 任务（存储与传输的统一结构） */
export interface Task {
  id: string;
  userId: string;
  title: string;
  note: string;
  priority: Priority;
  priorityReason: string;
  /** 内部统一存中文 key（工作/学习/…），显示层负责翻译 */
  category: string;
  dueAt: string | null;
  remindAt: string | null;
  completed: boolean;
  completedAt: string | null;
  reminded: boolean;
  /** 已完成的番茄钟数量 */
  pomodoros: number;
  /** 自定义排序序号（拖动排序使用） */
  order?: number;
  source: TaskSource;
  createdAt: string;
  updatedAt: string;
}

/** 创建/更新任务时可传入的字段 */
export type TaskPatch = Partial<
  Pick<
    Task,
    | 'title'
    | 'note'
    | 'priority'
    | 'priorityReason'
    | 'category'
    | 'dueAt'
    | 'remindAt'
    | 'completed'
    | 'pomodoros'
    | 'order'
    | 'source'
  >
>;

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
}

export interface AppSettings {
  locale: Locale | string;
  /** 大模型请求代理：不使用 / 跟随系统 / 自定义 */
  proxyMode: ProxyMode;
  /** 自定义代理地址，如 http://127.0.0.1:7890 */
  proxyUrl: string;
  /** 番茄钟时长（分钟） */
  pomodoroMinutes: number;
  /**
   * 整体液态程度 0.3 ~ 1（Apple Liquid Glass 主控变量）
   * 同时驱动主界面、灵动岛、通知卡的：底色浓度 / 背景模糊 / 折射 / 高光 / 描边 / 材质厚度。
   * 0.3 = 轻薄通透但仍具磨砂与高光；1 = 厚重折射。仅接近 0 或关闭时才趋于透明。
   */
  liquidOpacity?: number;
  /** 浮窗透明度 0.3 ~ 1 */
  floatOpacity: number;
  /** 浮窗位置（null = 默认右下角） */
  floatX: number | null;
  floatY: number | null;
  /** 灵动岛当前展示的任务 id（null = 自动：运行中的番茄钟任务或列表第一个） */
  floatTaskId?: string | null;
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  aiEnabled: boolean;
  reminderEnabled: boolean;
  reminderLeadMinutes: number;
}

/** 应用内通知（液态玻璃通知卡）的语义色调 */
export type NotifyTone = 'success' | 'info' | 'warning';

/** 应用内通知载荷：由主进程推给通知窗口渲染 */
export interface NotifyPayload {
  title: string;
  body: string;
  tone: NotifyTone;
  /** 关联任务 id（点击通知可定位） */
  taskId: string | null;
  /** 整体液态程度（0.3–1），驱动通知卡的玻璃材质 */
  liquid: number;
  /** 主题：跟随主界面明暗 */
  theme: 'light' | 'dark';
  /** 自动消失时间（毫秒） */
  duration?: number;
}

export interface Session {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export interface ChatMessage {
  id: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

/** 统计页用的完成记录（含分类，便于多维聚合） */
export interface CompletedPoint {
  completedAt: string;
  category: string;
}

export interface StoreStats {
  total: number;
  active: number;
  done: number;
  high: number;
}

/** AI 解析出的任务草稿（尚未入库） */
export interface AiTaskDraft {
  title: string;
  note: string;
  category: string;
  priority: Priority;
  priorityReason: string;
  dueAt: string | null;
  remindAt: string | null;
}

/** AI 理解结果（远端模型与本地引擎的统一输出） */
export interface UnderstandResult {
  reply: string;
  intent: Intent;
  tasks: AiTaskDraft[];
  matchTitles: string[];
  engine: Engine;
  error?: string | null;
}

/** 任务列表筛选条件 */
export interface TaskFilter {
  status?: 'active' | 'done' | 'all';
  category?: string;
  priority?: Priority | 'all';
  keyword?: string;
}

/** IPC 统一返回结构 */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };
