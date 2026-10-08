/**
 * 统一 Lucide 图标生成模块
 * 规则：界面全程禁止使用表情符号（Emoji），所有图标统一使用 Lucide 矢量图标
 */
import {
  createElement,
  Check,
  Circle,
  CircleDot,
  Plus,
  Calendar,
  Clock,
  Timer,
  Flame,
  SquarePen,
  Trash2,
  Sparkles,
  Send,
  RotateCcw,
  Settings,
  AppWindow,
  ExternalLink,
  X,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  XCircle,
  Inbox,
  Search,
  Layers,
  BarChart3,
  Tag,
  CheckCheck,
  Bell,
  Play,
  Square,
  Sliders,
  Maximize2,
  Minimize2,
  Loader2,
  Pause,
  GripVertical,
  FileText,
  Upload,
  Mail,
  Paperclip,
  ChevronRight,
  ChevronLeft,
  Bot,
  Repeat,
  CalendarDays,
  type IconNode,
} from 'lucide';

export const ICONS = {
  check: Check,
  circle: Circle,
  circleDot: CircleDot,
  plus: Plus,
  calendar: Calendar,
  clock: Clock,
  timer: Timer,
  flame: Flame,
  edit: SquarePen,
  trash: Trash2,
  sparkles: Sparkles,
  send: Send,
  reset: RotateCcw,
  settings: Settings,
  window: AppWindow,
  externalLink: ExternalLink,
  close: X,
  checkCircle: CheckCircle2,
  alertCircle: AlertCircle,
  alertTriangle: AlertTriangle,
  xCircle: XCircle,
  inbox: Inbox,
  search: Search,
  layers: Layers,
  stats: BarChart3,
  tag: Tag,
  checkCheck: CheckCheck,
  bell: Bell,
  play: Play,
  pause: Pause,
  stop: Square,
  sliders: Sliders,
  maximize: Maximize2,
  minimize: Minimize2,
  loader: Loader2,
  grip: GripVertical,
  fileText: FileText,
  upload: Upload,
  mail: Mail,
  paperclip: Paperclip,
  chevronRight: ChevronRight,
  chevronLeft: ChevronLeft,
  bot: Bot,
  repeat: Repeat,
  calendarDays: CalendarDays,
} as const;

export type IconName = keyof typeof ICONS;

export interface IconOptions {
  size?: number;
  class?: string;
  strokeWidth?: number;
}

/**
 * 渲染 Lucide 图标 SVG 节点
 * @param name 图标名称
 * @param options 配置项（尺寸、自定义 class、描边粗细）
 */
export function icon(name: IconName, options: IconOptions = {}): SVGElement {
  const iconDef = ICONS[name] as unknown as IconNode;
  if (!iconDef) {
    console.warn(`[Icon] 未找到图标: ${name}`);
    return document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  }

  const size = options.size ?? 16;
  const strokeWidth = options.strokeWidth ?? 2;
  const className = `lucide-icon lucide-${name} ${options.class ?? ''}`.trim();

  const svg = createElement(iconDef);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('stroke-width', String(strokeWidth));
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}
