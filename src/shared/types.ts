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
  /** 所属重复系列 id；null / 缺失 = 普通一次性任务（老数据天然兼容） */
  seriesId?: string | null;
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
> & {
  /** 仅在创建任务时生效：附带重复规则 → 自动建立重复系列并生成首实例 */
  repeat?: RepeatRule | null;
};

// ---------------- 重复任务 ----------------

/** 重复频率 */
export type RepeatFreq = 'day' | 'week' | 'month' | 'year';

/** 重复系列的结束方式 */
export type RepeatEndMode = 'never' | 'until' | 'count';

/**
 * 重复规则（纯数据，可被主进程与渲染进程共用）
 * 日期一律以「本地日历日 YYYY-MM-DD」表达，避免 UTC 偏移导致跨日错位。
 */
export interface RepeatRule {
  freq: RepeatFreq;
  /** 间隔：每 N 个周期，>= 1 */
  interval: number;
  /** freq='week' 时生效：ISO 周几 1=周一 … 7=周日；空数组表示沿用起始日的周几 */
  weekdays: number[];
  /** 生效起始日（YYYY-MM-DD，本地日历日） */
  startDate: string;
  endMode: RepeatEndMode;
  /** endMode='until'：结束日期（YYYY-MM-DD，含当天） */
  endDate: string | null;
  /** endMode='count'：系列总共产生多少期（含首期） */
  endCount: number | null;
}

/**
 * 重复系列：保存「模板」与「规则」，实例都是普通 Task（通过 task.seriesId 关联）
 */
export interface RepeatSeries {
  id: string;
  userId: string;
  title: string;
  note: string;
  priority: Priority;
  priorityReason: string;
  category: string;
  rule: RepeatRule;
  /** 每期的时刻 HH:mm（来自首实例 dueAt）；null = 09:00 */
  timeOfDay: string | null;
  /** 提前提醒分钟数；null = 不提醒 */
  remindLeadMinutes: number | null;
  /** 已生成的期数（含首期，用于 endMode='count' 判定） */
  generatedCount: number;
  /** 已完成的期数（统计用，不参与结束判定） */
  completedCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 编辑 / 删除重复任务时的作用范围 */
export type RepeatScope = 'once' | 'series';

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
  /** 开机自动启动（Windows 登录时启动应用） */
  launchOnStartup: boolean;
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
  /** 重复规则：模型/本地引擎识别出「每天/每周/每月…」时给出；null = 不重复 */
  repeat?: RepeatRule | null;
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
