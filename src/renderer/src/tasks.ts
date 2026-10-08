/** 任务卡片与编辑表单 */
import { el, fmtDateTime, fmtDate, isoToInput, inputToIso, priorityLabel, categoryLabel, CATEGORIES, t, icon } from './utils';
import { nextOccurrence, normalizeRule, normalizeWeekdays, toDateKey } from '../../shared/recurrence';
import type { RepeatFreq, RepeatRule, RepeatSeries, Task, TaskPatch } from '../../shared/types';

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
  // 重复任务（属于某个重复系列）按「周期重生」语义处理，不标记过期：
  // 当前期未完成只是尚未勾掉，完成时会自动生成下一期，因此不存在「逾期」状态。
  const overdue = !isDone && !task.seriesId && task.dueAt && new Date(task.dueAt).getTime() < Date.now();

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

  // 重复任务标记：卡片层只做「属于重复系列」的提示，规则详情在编辑器里查看
  if (task.seriesId) {
    metaItems.push(
      el('span', { class: 'tag repeat', title: t('repeat.seriesHint') }, [
        icon('repeat', { size: 11 }),
        t('repeat.badge'),
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

/** 频率下拉的备选项 */
const FREQ_OPTIONS: RepeatFreq[] = ['day', 'week', 'month', 'year'];

const FREQ_LABEL_KEY: Record<RepeatFreq, string> = {
  day: 'repeat.day',
  week: 'repeat.week',
  month: 'repeat.month',
  year: 'repeat.year',
};

const FREQ_UNIT_KEY: Record<RepeatFreq, string> = {
  day: 'repeat.unit.day',
  week: 'repeat.unit.week',
  month: 'repeat.unit.month',
  year: 'repeat.unit.year',
};

/** 规则摘要（卡片 / 编辑器标题用）：每 2 周 · 周一、周三 */
export function repeatSummary(rule: RepeatRule | null): string {
  if (!rule) return t('repeat.none');
  const n = rule.interval;
  const startDay = Number(rule.startDate.slice(8, 10)) || 1;
  const startMonth = Number(rule.startDate.slice(5, 7)) || 1;
  if (rule.freq === 'day') return n === 1 ? t('repeat.day') : t('repeat.summary.day', { n });
  if (rule.freq === 'week') {
    const days = normalizeWeekdays(rule.weekdays)
      .map((w) => t(`weekday.${w}`))
      .join('、');
    return n === 1 ? t('repeat.summary.weekSingle', { days }) : t('repeat.summary.week', { n, days });
  }
  if (rule.freq === 'month') {
    return n === 1 ? t('repeat.summary.monthSingle', { d: startDay }) : t('repeat.summary.month', { n, d: startDay });
  }
  return n === 1
    ? t('repeat.summary.yearSingle', { m: startMonth, d: startDay })
    : t('repeat.summary.year', { n, m: startMonth, d: startDay });
}

/**
 * 重复设置区：频率 + 间隔 + 周几（周重复）+ 生效起始日 + 结束条件，
 * 并实时预览「下一次」日期（跨月 / 月末回退等边界由 recurrence 统一处理）。
 */
function buildRepeatBlock(initial: RepeatRule | null, dueAt: string | null): {
  node: HTMLElement;
  getRule: () => RepeatRule | null;
  /** 截止时间变化时把「生效起始日」同步过去（用户未手动改过起始日时才联动） */
  syncStartFromDue: (iso: string | null) => void;
} {
  const seedDate = dueAt ? new Date(dueAt) : new Date();
  const init: RepeatRule = initial || {
    freq: 'week',
    interval: 1,
    weekdays: [normalizeWeekdays([], seedDate)[0]],
    startDate: toDateKey(seedDate),
    endMode: 'never',
    endDate: null,
    endCount: null,
  };

  const freqSel = el('select', { class: 'task-edit-select repeat-freq' }) as HTMLSelectElement;
  freqSel.appendChild(el('option', { value: 'none', text: t('repeat.none') }) as HTMLOptionElement);
  for (const f of FREQ_OPTIONS) {
    freqSel.appendChild(el('option', { value: f, text: t(FREQ_LABEL_KEY[f]) }) as HTMLOptionElement);
  }
  freqSel.value = initial ? initial.freq : 'none';

  const intervalInput = el('input', {
    type: 'number',
    min: '1',
    max: '99',
    class: 'task-edit-input repeat-interval',
    value: String(init.interval),
  }) as HTMLInputElement;

  const unitLabel = el('span', { class: 'repeat-unit', text: t(FREQ_UNIT_KEY[init.freq]) });

  const intervalRow = el('label', { class: 'repeat-field' }, [
    el('span', { class: 'repeat-field-label', text: t('repeat.every') }),
    intervalInput,
    unitLabel,
  ]);

  // 周几选择（仅周重复显示）
  const weekdayRow = el('div', { class: 'repeat-weekdays' }) as HTMLElement;
  weekdayRow.appendChild(el('span', { class: 'repeat-field-label', text: t('repeat.weekdays') }));
  const weekBtns: HTMLButtonElement[] = [];
  const picked = new Set<number>(init.weekdays.length ? init.weekdays : [normalizeWeekdays([], seedDate)[0]]);
  // 用户手动点过周几后，就不再跟随起始日自动变更
  let weekdayTouched = Boolean(initial);
  for (let w = 1; w <= 7; w += 1) {
    const btn = el('button', {
      type: 'button',
      class: `repeat-weekday${picked.has(w) ? ' on' : ''}`,
      text: t(`weekday.${w}`),
      onclick: () => {
        weekdayTouched = true;
        if (picked.has(w)) picked.delete(w);
        else picked.add(w);
        btn.classList.toggle('on', picked.has(w));
        refresh();
      },
    }) as HTMLButtonElement;
    weekBtns.push(btn);
    weekdayRow.appendChild(btn);
  }

  const startInput = el('input', {
    type: 'date',
    class: 'task-edit-input',
    value: init.startDate,
  }) as HTMLInputElement;
  // 用户手动改过生效起始日后，就不再跟随截止时间联动
  let startTouched = Boolean(initial);
  startInput.addEventListener('change', () => {
    startTouched = true;
  });

  const endSel = el('select', { class: 'task-edit-select' }) as HTMLSelectElement;
  endSel.appendChild(el('option', { value: 'never', text: t('repeat.endNever') }) as HTMLOptionElement);
  endSel.appendChild(el('option', { value: 'until', text: t('repeat.endUntil') }) as HTMLOptionElement);
  endSel.appendChild(el('option', { value: 'count', text: t('repeat.endCount') }) as HTMLOptionElement);
  endSel.value = init.endMode;

  const endDateInput = el('input', {
    type: 'date',
    class: 'task-edit-input',
    value: init.endDate || '',
  }) as HTMLInputElement;

  const endCountInput = el('input', {
    type: 'number',
    min: '1',
    max: '99',
    class: 'task-edit-input repeat-count',
    value: String(init.endCount || 5),
  }) as HTMLInputElement;

  const preview = el('p', { class: 'repeat-preview' }) as HTMLElement;

  const panel = el('div', { class: 'repeat-panel' }, [
    el('div', { class: 'repeat-grid' }, [
      intervalRow,
      el('label', { class: 'repeat-field' }, [
        el('span', { class: 'repeat-field-label', text: t('repeat.startDate') }),
        startInput,
      ]),
      el('label', { class: 'repeat-field' }, [
        el('span', { class: 'repeat-field-label', text: t('repeat.end') }),
        endSel,
      ]),
      el('label', { class: 'repeat-field repeat-end-date' }, [endDateInput]),
      el('label', { class: 'repeat-field repeat-end-count' }, [
        endCountInput,
        el('span', { class: 'repeat-unit', text: t('repeat.periods') }),
      ]),
    ]),
    weekdayRow,
    preview,
  ]);

  const summary = el('span', { class: 'repeat-summary' }) as HTMLElement;
  const head = el('label', { class: 'repeat-field repeat-head' }, [
    el('span', { class: 'repeat-field-label', text: t('repeat.label') }),
    freqSel,
    summary,
  ]);

  function currentRule(): RepeatRule | null {
    if (freqSel.value === 'none') return null;
    const freq = freqSel.value as RepeatFreq;
    const interval = Math.max(1, Math.min(99, Math.floor(Number(intervalInput.value) || 1)));
    const start = startInput.value || toDateKey(new Date());
    const endMode = endSel.value === 'until' || endSel.value === 'count' ? endSel.value : 'never';
    return normalizeRule({
      freq,
      interval,
      weekdays: freq === 'week' ? Array.from(picked) : [],
      startDate: start,
      endMode,
      endDate: endMode === 'until' ? endDateInput.value || null : null,
      endCount: endMode === 'count' ? Math.max(1, Math.floor(Number(endCountInput.value) || 1)) : null,
    });
  }

  function refresh(): void {
    const freq = freqSel.value as RepeatFreq | 'none';
    const on = freq !== 'none';
    panel.classList.toggle('hidden', !on);
    summary.classList.toggle('hidden', !on);
    if (!on) {
      summary.textContent = '';
      preview.textContent = '';
      return;
    }
    weekdayRow.classList.toggle('hidden', freq !== 'week');
    // 周重复且用户没手动选过周几时，默认沿用生效起始日所在的周几（必须先于 currentRule）
    if (freq === 'week' && !weekdayTouched) {
      const seed = startInput.value ? new Date(`${startInput.value}T00:00:00`) : seedDate;
      const only = normalizeWeekdays([], seed)[0];
      if (picked.size !== 1 || !picked.has(only)) {
        picked.clear();
        picked.add(only);
        weekBtns.forEach((b, i) => b.classList.toggle('on', picked.has(i + 1)));
      }
    }
    const rule = currentRule();
    summary.textContent = repeatSummary(rule);
    unitLabel.textContent = t(FREQ_UNIT_KEY[freq]);
    (panel.querySelector('.repeat-end-date') as HTMLElement | null)?.classList.toggle(
      'hidden',
      endSel.value !== 'until'
    );
    (panel.querySelector('.repeat-end-count') as HTMLElement | null)?.classList.toggle(
      'hidden',
      endSel.value !== 'count'
    );
    // 预览下一次：以「起始日」为基准推一期
    if (!rule) {
      preview.textContent = '';
      return;
    }
    const base = startInput.value ? new Date(`${startInput.value}T00:00:00`) : seedDate;
    const next = nextOccurrence(base, rule);
    preview.textContent = next ? t('repeat.preview', { date: fmtDate(next) }) : t('repeat.previewNone');
  }

  function syncStartFromDue(iso: string | null): void {
    if (startTouched || !iso) return;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return;
    startInput.value = toDateKey(d);
    refresh();
  }

  freqSel.addEventListener('change', refresh);
  intervalInput.addEventListener('input', refresh);
  intervalInput.addEventListener('change', refresh);
  startInput.addEventListener('change', refresh);
  endSel.addEventListener('change', refresh);
  endDateInput.addEventListener('change', refresh);
  endCountInput.addEventListener('input', refresh);
  endCountInput.addEventListener('change', refresh);
  refresh();

  return {
    node: el('div', { class: 'repeat-block' }, [head, panel]),
    getRule: currentRule,
    syncStartFromDue,
  };
}

export function taskEditor(
  task: Partial<Task>,
  { onSave, onCancel }: EditorHandlers,
  series: RepeatSeries | null = null
): HTMLElement {
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

  // 重复设置：新建时在「时间行」下方设置规则；编辑已有重复任务时回填系列规则
  const repeatBlock = buildRepeatBlock(series ? series.rule : null, task.dueAt ?? null);
  // 截止时间决定首期日期，顺带同步「生效起始日」，避免两者不一致导致下一期算不出来
  dueInput.addEventListener('change', () => repeatBlock.syncStartFromDue(inputToIso(dueInput.value)));

  const seriesNote = series
    ? el('p', { class: 'task-edit-repeat-note' }, [
        icon('repeat', { size: 11 }),
        el('span', { text: t('repeat.seriesNote', { summary: repeatSummary(series.rule) }) }),
      ])
    : null;

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
            repeat: repeatBlock.getRule(),
          }),
      },
      [icon('check', { size: 12 }), t('task.save')]
    ),
  ]);

  return el('div', { class: 'task-card task-editor-card' }, [
    titleInput,
    noteInput,
    row,
    seriesNote,
    repeatBlock.node,
    actions,
  ]);
}
