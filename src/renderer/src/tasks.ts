/** 任务卡片与编辑表单 */
import { el, fmtDateTime, isoToInput, inputToIso, priorityLabel, categoryLabel, CATEGORIES, t, icon } from './utils';
import type { Task, TaskPatch } from '../../shared/types';

export interface TaskHandlers {
  toggle: (id: string, completed: boolean) => void;
  edit: (id: string) => void;
  remove: (id: string) => void;
  /** 开始番茄钟 */
  focus: (id: string) => void;
  /** 把任务送入灵动岛展示 */
  sendToIsland: (id: string) => void;
  /** 拖拽排序 */
  reorder?: (srcId: string, targetId: string, position: 'before' | 'after') => void;
}

export function taskCard(task: Task, handlers: TaskHandlers): HTMLElement {
  const isDone = Boolean(task.completed);
  const overdue = !isDone && task.dueAt && new Date(task.dueAt).getTime() < Date.now();

  const metaItems: (HTMLElement | null)[] = [
    el('span', { class: 'tag cat' }, [icon('tag', { size: 11 }), categoryLabel(task.category)]),
    el('span', { class: `tag prio-${task.priority}` }, [
      task.priority === 'high' ? icon('flame', { size: 11 }) : null,
      priorityLabel(task.priority),
    ]),
  ];

  if (task.dueAt) {
    metaItems.push(
      el('span', { class: `tag time${overdue ? ' overdue' : ''}` }, [
        icon('calendar', { size: 11 }),
        `${fmtDateTime(task.dueAt)}${overdue ? ` · ${t('task.overdue')}` : ''}`,
      ])
    );
  }

  if (task.remindAt) {
    metaItems.push(
      el('span', { class: 'tag time' }, [
        icon('bell', { size: 11 }),
        t('task.remindAt', { time: fmtDateTime(task.remindAt) }),
      ])
    );
  }

  const meta = el('div', { class: 'task-meta' }, metaItems);

  const main = el('div', { class: 'task-main' }, [
    el('p', { class: 'task-title', text: task.title }),
    meta,
    task.note ? el('p', { class: 'task-note', text: task.note }) : null,
    task.priorityReason
      ? el('div', { class: 'task-reason' }, [
          icon('sparkles', { size: 12, class: 'reason-icon' }),
          el('span', { text: `${t('task.reasonPrefix')}${task.priorityReason}` }),
        ])
      : null,
  ]);

  const check = el(
    'button',
    {
      class: `check${isDone ? ' on' : ''}`,
      title: isDone ? t('task.markUndone') : t('task.markDone'),
      onclick: (e: Event) => {
        e.stopPropagation();
        handlers.toggle(task.id, !isDone);
      },
    },
    [isDone ? icon('check', { size: 13, strokeWidth: 3 }) : null]
  );

  const dragHandle = el(
    'div',
    {
      class: 'task-drag-handle',
      title: '按住拖动以排序',
    },
    [icon('grip', { size: 14, class: 'text-base-content/30' })]
  );

  const actions = el('div', { class: 'task-actions' }, [
    el(
      'button',
      {
        class: 'task-action-btn island-btn',
        title: t('task.sendToIsland'),
        onclick: (e: Event) => {
          e.stopPropagation();
          handlers.sendToIsland(task.id);
        },
      },
      [icon('window', { size: 14, class: 'btn-icon' })]
    ),
    el(
      'button',
      {
        class: 'task-action-btn pomo-btn',
        title: t('task.focus'),
        onclick: (e: Event) => {
          e.stopPropagation();
          handlers.focus(task.id);
        },
      },
      [icon('timer', { size: 14, class: 'btn-icon text-primary' })]
    ),
    el(
      'button',
      {
        class: 'task-action-btn edit-btn',
        title: t('task.edit'),
        onclick: (e: Event) => {
          e.stopPropagation();
          handlers.edit(task.id);
        },
      },
      [
        icon('edit', { size: 14, class: 'btn-icon' }),
        el('span', { class: 'task-btn-label', text: t('task.edit') }),
      ]
    ),
    el(
      'button',
      {
        class: 'task-action-btn del-btn danger-text',
        title: t('task.delete'),
        onclick: (e: Event) => {
          e.stopPropagation();
          handlers.remove(task.id);
        },
      },
      [
        icon('trash', { size: 14, class: 'btn-icon text-error' }),
        el('span', { class: 'task-btn-label', text: t('task.delete') }),
      ]
    ),
  ]);

  const card = el(
    'div',
    {
      class: `task-card${isDone ? ' done' : ''}`,
      'data-id': task.id,
      draggable: 'true',
    },
    [
      dragHandle,
      el('div', { class: `prio-bar prio-${task.priority}` }),
      check,
      main,
      actions,
    ]
  );

  // 拖拽排序逻辑
  card.addEventListener('dragstart', (e: DragEvent) => {
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', task.id);
      e.dataTransfer.effectAllowed = 'move';
    }
    card.classList.add('is-dragging');
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('is-dragging');
    document.querySelectorAll('.task-card').forEach((c) => {
      c.classList.remove('drag-over-top', 'drag-over-bottom');
    });
  });

  card.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const rect = card.getBoundingClientRect();
    const isTop = e.clientY - rect.top < rect.height / 2;
    card.classList.toggle('drag-over-top', isTop);
    card.classList.toggle('drag-over-bottom', !isTop);
  });

  card.addEventListener('dragleave', () => {
    card.classList.remove('drag-over-top', 'drag-over-bottom');
  });

  card.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    const isTop = card.classList.contains('drag-over-top');
    card.classList.remove('drag-over-top', 'drag-over-bottom');
    const srcId = e.dataTransfer?.getData('text/plain');
    if (srcId && srcId !== task.id && handlers.reorder) {
      handlers.reorder(srcId, task.id, isTop ? 'before' : 'after');
    }
  });

  return card;
}

export interface EditorHandlers {
  onSave: (patch: TaskPatch) => void;
  onCancel: () => void;
}

export function taskEditor(task: Partial<Task>, { onSave, onCancel }: EditorHandlers): HTMLElement {
  const titleInput = el('input', {
    type: 'text',
    class: 'task-edit-input',
    value: task.title || '',
    placeholder: t('task.titlePlaceholder'),
  }) as HTMLInputElement;

  const noteInput = el('textarea', {
    rows: '2',
    class: 'task-edit-textarea',
    placeholder: t('task.notePlaceholder'),
  }) as HTMLTextAreaElement;
  noteInput.value = task.note || '';

  const prioSel = el('select', { class: 'task-edit-select' }) as HTMLSelectElement;
  for (const v of ['high', 'medium', 'low'] as const) {
    const o = el('option', { value: v, text: priorityLabel(v) }) as HTMLOptionElement;
    if (task.priority === v) o.selected = true;
    prioSel.appendChild(o);
  }

  const catSel = el('select', { class: 'task-edit-select' }) as HTMLSelectElement;
  for (const c of CATEGORIES) {
    const o = el('option', { value: c, text: categoryLabel(c) }) as HTMLOptionElement;
    if (task.category === c) o.selected = true;
    catSel.appendChild(o);
  }

  const dueInput = el('input', {
    type: 'datetime-local',
    class: 'task-edit-input datetime',
    value: isoToInput(task.dueAt ?? null),
  }) as HTMLInputElement;

  const remindInput = el('input', {
    type: 'datetime-local',
    class: 'task-edit-input datetime',
    value: isoToInput(task.remindAt ?? null),
  }) as HTMLInputElement;

  const row = el('div', { class: 'task-edit-row' }, [prioSel, catSel, dueInput, remindInput]);

  const actions = el('div', { class: 'task-edit-actions' }, [
    el(
      'button',
      { class: 'ui-btn tiny ghost', onclick: () => onCancel() },
      [icon('close', { size: 12 }), t('task.cancel')]
    ),
    el(
      'button',
      {
        class: 'ui-btn tiny primary',
        onclick: () =>
          onSave({
            title: titleInput.value.trim() || t('task.titlePlaceholder'),
            note: noteInput.value.trim(),
            priority: prioSel.value as TaskPatch['priority'],
            category: catSel.value,
            dueAt: inputToIso(dueInput.value),
            remindAt: inputToIso(remindInput.value),
          }),
      },
      [icon('check', { size: 12 }), t('task.save')]
    ),
  ]);

  return el('div', { class: 'task-card task-editor-card' }, [
    titleInput,
    noteInput,
    row,
    actions,
  ]);
}
