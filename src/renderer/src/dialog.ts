/**
 * 应用内弹窗（液态玻璃风格）
 * 替代 window.confirm / window.alert：原生弹窗标题取自 document.title、样式与整体割裂。
 * 复用 .ui-modal / .ui-btn 体系，保证与设置弹窗同一套材质与按钮风格。
 */
import { icon, type IconName } from './icons';
import { t } from './i18n';

interface DialogDom {
  root: HTMLElement;
  title: HTMLElement;
  leadIcon: HTMLElement;
  message: HTMLElement;
  options: HTMLElement;
  ok: HTMLButtonElement;
  cancel: HTMLButtonElement;
  close: HTMLButtonElement;
}

let dom: DialogDom | null = null;

function ensureDom(): DialogDom | null {
  if (dom && document.body.contains(dom.root)) return dom;

  const root = document.createElement('div');
  root.className = 'ui-modal hidden';
  root.id = 'app-dialog';

  const card = document.createElement('div');
  card.className = 'ui-modal-card dialog-card';

  const head = document.createElement('div');
  head.className = 'ui-modal-head';
  const title = document.createElement('h3');
  title.id = 'app-dialog-title';
  const close = document.createElement('button');
  close.className = 'ui-btn tiny ghost';
  close.id = 'app-dialog-close';
  close.title = t('settings.close');
  head.appendChild(title);
  head.appendChild(close);

  const body = document.createElement('div');
  body.className = 'ui-modal-body dialog-body';
  const lead = document.createElement('div');
  lead.className = 'dialog-lead';
  const leadIcon = document.createElement('span');
  leadIcon.className = 'dialog-lead-icon';
  const message = document.createElement('p');
  message.className = 'dialog-message';
  message.id = 'app-dialog-message';
  lead.appendChild(leadIcon);
  lead.appendChild(message);
  const options = document.createElement('div');
  options.className = 'dialog-options hidden';
  options.id = 'app-dialog-options';
  body.appendChild(lead);
  body.appendChild(options);

  const foot = document.createElement('div');
  foot.className = 'dialog-foot';
  const cancel = document.createElement('button');
  cancel.className = 'ui-btn ghost';
  cancel.id = 'app-dialog-cancel';
  const ok = document.createElement('button');
  ok.className = 'ui-btn primary';
  ok.id = 'app-dialog-ok';
  foot.appendChild(cancel);
  foot.appendChild(ok);

  card.appendChild(head);
  card.appendChild(body);
  card.appendChild(foot);
  root.appendChild(card);
  document.body.appendChild(root);

  dom = { root, title, leadIcon, message, options, ok, cancel, close };
  return dom;
}

interface BaseOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** true = 主按钮用危险色（删除/结束专注） */
  danger?: boolean;
  iconName?: IconName;
}

function paint(d: DialogDom, opts: BaseOptions, cancelVisible: boolean): void {
  d.title.textContent = opts.title;
  d.message.textContent = opts.message;
  // 选项区默认收起，只有 choiceDialog 会展开（避免上一次弹窗的状态残留）
  d.options.classList.add('hidden');
  d.options.innerHTML = '';
  d.leadIcon.innerHTML = '';
  d.leadIcon.appendChild(icon(opts.iconName || (opts.danger ? 'alertTriangle' : 'sparkles'), { size: 15 }));
  d.leadIcon.className = `dialog-lead-icon${opts.danger ? ' danger' : ''}`;
  d.ok.textContent = opts.confirmText || t('dialog.ok');
  d.ok.className = `ui-btn ${opts.danger ? 'danger-solid' : 'primary'}`;
  d.cancel.textContent = opts.cancelText || t('task.cancel');
  d.cancel.classList.toggle('hidden', !cancelVisible);
  d.close.innerHTML = '';
  d.close.appendChild(icon('close', { size: 14 }));
}

function bindDismiss(
  d: DialogDom,
  controller: AbortController,
  finish: (value: string | null) => void
): void {
  const opts = { signal: controller.signal };
  d.root.addEventListener('click', (e) => {
    if (e.target === d.root) finish(null);
  }, opts);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(null);
    }
  }, opts);
}

function open(d: DialogDom): void {
  d.root.classList.remove('hidden');
  d.ok.focus();
}

/**
 * 确认弹窗（确定 / 取消）
 * @returns true = 确定，false = 取消或关闭
 */
export function confirmDialog(opts: BaseOptions): Promise<boolean> {
  const d = ensureDom();
  if (!d) return Promise.resolve(window.confirm(opts.message));
  return new Promise<boolean>((resolve) => {
    const controller = new AbortController();
    const finish = (value: boolean) => {
      controller.abort();
      d.root.classList.add('hidden');
      resolve(value);
    };
    paint(d, opts, true);
    d.ok.addEventListener('click', () => finish(true), { signal: controller.signal });
    d.cancel.addEventListener('click', () => finish(false), { signal: controller.signal });
    d.close.addEventListener('click', () => finish(false), { signal: controller.signal });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      }
    }, { signal: controller.signal });
    bindDismiss(d, controller, () => finish(false));
    open(d);
  });
}

export interface ChoiceOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * 单选弹窗：用于「仅本次 / 整个系列」这类必须二选一的场景。
 * 必须选中一项并点确定，避免误操作；关闭或取消返回 null。
 */
export function choiceDialog(
  opts: BaseOptions & { options: ChoiceOption[]; selected?: string }
): Promise<string | null> {
  const d = ensureDom();
  if (!d) {
    return Promise.resolve(window.confirm(opts.message) ? (opts.selected || opts.options[0]?.value || null) : null);
  }
  return new Promise<string | null>((resolve) => {
    const controller = new AbortController();
    let selected = opts.selected || opts.options[0]?.value || '';
    const finish = (value: string | null) => {
      controller.abort();
      d.root.classList.add('hidden');
      resolve(value);
    };

    paint(d, opts, true);
    d.options.innerHTML = '';
    d.options.classList.remove('hidden');
    for (const opt of opts.options) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `dialog-option${opt.value === selected ? ' selected' : ''}`;
      const radio = document.createElement('span');
      radio.className = 'dialog-option-dot';
      const text = document.createElement('span');
      text.className = 'dialog-option-text';
      const label = document.createElement('span');
      label.className = 'dialog-option-label';
      label.textContent = opt.label;
      text.appendChild(label);
      if (opt.hint) {
        const hint = document.createElement('span');
        hint.className = 'dialog-option-hint';
        hint.textContent = opt.hint;
        text.appendChild(hint);
      }
      item.appendChild(radio);
      item.appendChild(text);
      item.addEventListener('click', () => {
        selected = opt.value;
        d.options.querySelectorAll('.dialog-option').forEach((n) => n.classList.remove('selected'));
        item.classList.add('selected');
      }, { signal: controller.signal });
      d.options.appendChild(item);
    }

    d.ok.addEventListener('click', () => finish(selected), { signal: controller.signal });
    d.cancel.addEventListener('click', () => finish(null), { signal: controller.signal });
    d.close.addEventListener('click', () => finish(null), { signal: controller.signal });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(selected);
      }
    }, { signal: controller.signal });
    bindDismiss(d, controller, finish);
    open(d);
  });
}
