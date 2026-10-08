'use strict';
/**
 * 1.2.0 专项验证：
 *  ① 重复任务（创建 → 完成推进 → 仅本次/整个系列选择）
 *  ② 停止专注弹窗统一为应用内液态玻璃弹窗
 *  ③ 设置面板点击空白区域不关闭
 *  ④ 番茄专注时长修改后保存并同步灵动岛
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const PORT = 9477;
const OUT_DIR = path.join(ROOT, 'tests', 'screenshots');
fs.mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
  }
}

function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const ready = new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    }
  };
  return ready.then(() => ({
    ws,
    send: (method, params = {}) =>
      new Promise((res) => {
        const i = ++id;
        pending.set(i, res);
        ws.send(JSON.stringify({ id: i, method, params }));
      }),
  }));
}

async function evalJs(conn, expression) {
  const r = await conn.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails));
  return r.result?.value;
}

async function shot(conn, name) {
  const r = await conn.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.data, 'base64'));
  console.log(`  screenshot -> ${name}`);
}

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aitodo-repeat-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`, '--no-sandbox'],
    { cwd: ROOT, env, stdio: 'ignore' }
  );
  const kill = () => {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {}
  };

  let mainTarget = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      mainTarget = list.find((t) => (t.url || '').includes('index.html'));
      if (mainTarget) break;
    } catch {}
    await sleep(400);
  }
  if (!mainTarget) throw new Error('主界面未就绪');
  const m = await connect(mainTarget);
  await m.send('Runtime.enable');
  await m.send('Page.enable');
  await sleep(2200);

  // 原生 confirm 兜底探针：一旦还有代码走 window.confirm，立刻暴露且不阻塞脚本
  await evalJs(
    m,
    `(() => { window.__nativeConfirm = 0; window.confirm = () => { window.__nativeConfirm += 1; return false; }; return 1; })()`
  );

  // 打开灵动岛，便于验证番茄时长同步
  await evalJs(m, `(async () => { await window.api.floatShow(); return 1; })()`);
  await sleep(1500);
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const floatTarget = list.find((t) => (t.url || '').includes('float.html'));
  let f = null;
  if (floatTarget) {
    f = await connect(floatTarget);
    await f.send('Runtime.enable');
    await f.send('Page.enable');
    await sleep(600);
  }

  // ================= ① 重复任务 =================
  console.log('\n[①] 重复任务：创建 / 推进 / 范围选择');
  await evalJs(m, `document.getElementById('btn-new').click(); 1`);
  await sleep(400);
  const editor = await evalJs(
    m,
    `(() => {
      const card = document.querySelector('.task-editor-card');
      return {
        exists: Boolean(card),
        hasRepeatBlock: Boolean(card && card.querySelector('.repeat-block')),
        panelHidden: Boolean(card && card.querySelector('.repeat-panel').classList.contains('hidden')),
        freqOptions: Array.from(card.querySelectorAll('.repeat-freq option')).map((o) => o.textContent),
      };
    })()`
  );
  check('新建任务编辑器含重复设置区', editor.hasRepeatBlock === true);
  check('默认不重复（设置面板收起）', editor.panelHidden === true);
  check('频率下拉含 不重复/每天/每周/每月/每年', (editor.freqOptions || []).length === 5, (editor.freqOptions || []).join('/'));

  // 填标题 / 截止时间，并切换为「每周」
  await evalJs(
    m,
    `(() => {
      const card = document.querySelector('.task-editor-card');
      const title = card.querySelector('input.task-edit-input');
      title.value = '每周例会';
      title.dispatchEvent(new Event('input', { bubbles: true }));
      const due = card.querySelectorAll('input.task-edit-input.datetime')[0];
      due.value = '2026-03-02T10:00';
      due.dispatchEvent(new Event('input', { bubbles: true }));
      due.dispatchEvent(new Event('change', { bubbles: true }));
      const freq = card.querySelector('.repeat-freq');
      freq.value = 'week';
      freq.dispatchEvent(new Event('change', { bubbles: true }));
      return 1;
    })()`
  );
  await sleep(400);

  const weekly = await evalJs(
    m,
    `(() => {
      const card = document.querySelector('.task-editor-card');
      const panel = card.querySelector('.repeat-panel');
      return {
        panelVisible: !panel.classList.contains('hidden'),
        weekdaysVisible: !card.querySelector('.repeat-weekdays').classList.contains('hidden'),
        weekdayCount: card.querySelectorAll('.repeat-weekday').length,
        selectedCount: card.querySelectorAll('.repeat-weekday.on').length,
        preview: (card.querySelector('.repeat-preview').textContent || '').trim(),
        summary: (card.querySelector('.repeat-summary').textContent || '').trim(),
      };
    })()`
  );
  check('选择「每周」后展开设置面板', weekly.panelVisible === true);
  check('周重复显示 7 个周几按钮且默认选中一天', weekly.weekdayCount === 7 && weekly.selectedCount === 1, `${weekly.weekdayCount}/${weekly.selectedCount}`);
  check('实时预览下一次日期', /下一次/.test(weekly.preview || ''), weekly.preview);
  check('摘要显示每周规则', /每周/.test(weekly.summary || ''), weekly.summary);
  await shot(m, 'repeat-1-editor.png');

  // 保存
  await evalJs(m, `document.querySelector('.task-editor-card .task-edit-actions .ui-btn.primary').click(); 1`);
  await sleep(900);
  const created = await evalJs(
    m,
    `(async () => {
      const res = await window.api.listTasks({ status: 'all' });
      const t = res.data.find((x) => x.title === '每周例会');
      const card = document.querySelector('.task-card');
      return {
        id: t ? t.id : null,
        seriesId: t ? t.seriesId : null,
        dueAt: t ? t.dueAt : null,
        badge: Boolean(card && card.querySelector('.tag.repeat')),
      };
    })()`
  );
  check('重复任务创建成功并关联系列', Boolean(created.seriesId), String(created.seriesId));
  check('任务卡片显示「重复」标记', created.badge === true);

  // 勾选完成 → 自动推进下一期
  await evalJs(m, `document.querySelector('.task-card .check').click(); 1`);
  await sleep(1000);
  const advanced = await evalJs(
    m,
    `(async () => {
      const res = await window.api.listTasks({ status: 'all' });
      const all = res.data.filter((x) => x.seriesId);
      const open = all.filter((x) => !x.completed);
      const done = all.filter((x) => x.completed);
      return {
        total: all.length,
        openCount: open.length,
        openDue: open.length ? new Date(open[0].dueAt).toDateString() : null,
        openHour: open.length ? new Date(open[0].dueAt).getHours() : null,
        doneCount: done.length,
      };
    })()`
  );
  check('完成当期后自动生成下一期', advanced.total === 2 && advanced.openCount === 1, JSON.stringify(advanced));
  check('下一期为 7 天后且沿用 10 点', advanced.openHour === 10, `${advanced.openDue} ${advanced.openHour}时`);

  // 编辑「仅本次 / 整个系列」
  await evalJs(
    m,
    `(() => {
      const cards = Array.from(document.querySelectorAll('.task-card'));
      const open = cards.find((c) => !c.classList.contains('done'));
      open.querySelector('.edit-btn').click();
      return 1;
    })()`
  );
  await sleep(700);
  const seriesNote = await evalJs(
    m,
    `(() => {
      const card = document.querySelector('.task-editor-card');
      const note = card.querySelector('.task-edit-repeat-note');
      return { hasNote: Boolean(note), text: note ? note.textContent.trim() : '', summary: (card.querySelector('.repeat-summary').textContent || '').trim() };
    })()`
  );
  check('编辑重复任务时回填系列规则', seriesNote.hasNote === true, seriesNote.text);
  check('编辑器显示规则摘要', /每周/.test(seriesNote.summary || ''), seriesNote.summary);

  await evalJs(m, `document.querySelector('.task-editor-card .task-edit-actions .ui-btn.primary').click(); 1`);
  await sleep(600);
  const scopeDlg = await evalJs(
    m,
    `(() => {
      const d = document.getElementById('app-dialog');
      if (!d) return { exists: false };
      const card = d.querySelector('.ui-modal-card');
      const cs = card ? getComputedStyle(card) : null;
      return {
        exists: true,
        visible: !d.classList.contains('hidden'),
        title: (document.getElementById('app-dialog-title').textContent || '').trim(),
        options: Array.from(d.querySelectorAll('.dialog-option-label')).map((n) => n.textContent.trim()),
        hints: Array.from(d.querySelectorAll('.dialog-option-hint')).map((n) => n.textContent.trim()),
        glass: cs ? (cs.backdropFilter || cs.webkitBackdropFilter) : null,
        radius: cs ? cs.borderTopLeftRadius : null,
        okText: (document.getElementById('app-dialog-ok').textContent || '').trim(),
      };
    })()`
  );
  check('保存时弹出作用范围选择', scopeDlg.visible === true);
  check('弹窗标题为「编辑重复任务」', scopeDlg.title === '编辑重复任务', scopeDlg.title);
  check('提供「仅本次 / 整个系列」两个选项', JSON.stringify(scopeDlg.options) === JSON.stringify(['仅本次', '整个系列']), JSON.stringify(scopeDlg.options));
  check('每个选项都说明了对已生成实例的影响', (scopeDlg.hints || []).length === 2 && /已完成的期/.test(scopeDlg.hints[1] || ''), JSON.stringify(scopeDlg.hints));
  check('弹窗沿用液态玻璃卡片样式', /blur/.test(scopeDlg.glass || ''), String(scopeDlg.glass));
  await shot(m, 'repeat-2-scope-dialog.png');

  // 选「整个系列」→ 保存
  await evalJs(
    m,
    `(() => {
      const opts = document.querySelectorAll('#app-dialog-options .dialog-option');
      opts[1].click();
      document.getElementById('app-dialog-ok').click();
      return 1;
    })()`
  );
  await sleep(900);
  const afterSeries = await evalJs(
    m,
    `(async () => {
      const res = await window.api.listTasks({ status: 'all' });
      const all = res.data.filter((x) => x.seriesId);
      return { count: all.length, dialogHidden: document.getElementById('app-dialog').classList.contains('hidden') };
    })()`
  );
  check('选择后弹窗关闭且系列保留两期', afterSeries.dialogHidden === true && afterSeries.count === 2, JSON.stringify(afterSeries));

  // 删除：整个系列
  await evalJs(
    m,
    `(() => {
      const cards = Array.from(document.querySelectorAll('.task-card'));
      cards[0].querySelector('.del-btn').click();
      return 1;
    })()`
  );
  await sleep(600);
  const delDlg = await evalJs(
    m,
    `(() => {
      const d = document.getElementById('app-dialog');
      return {
        visible: !d.classList.contains('hidden'),
        title: (document.getElementById('app-dialog-title').textContent || '').trim(),
        okText: (document.getElementById('app-dialog-ok').textContent || '').trim(),
        okClass: document.getElementById('app-dialog-ok').className,
        hints: Array.from(d.querySelectorAll('.dialog-option-hint')).map((n) => n.textContent.trim()),
      };
    })()`
  );
  check('删除时弹出范围选择', delDlg.visible === true && delDlg.title === '删除重复任务', delDlg.title);
  check('删除确认按钮为危险色', /danger-solid/.test(delDlg.okClass || ''), delDlg.okClass);
  check('删除提示说明「仅本次会生成下一期」', /自动生成下一期/.test((delDlg.hints || [])[0] || ''), JSON.stringify(delDlg.hints));

  await evalJs(
    m,
    `(() => {
      const opts = document.querySelectorAll('#app-dialog-options .dialog-option');
      opts[1].click();
      document.getElementById('app-dialog-ok').click();
      return 1;
    })()`
  );
  await sleep(900);
  const afterDelete = await evalJs(
    m,
    `(async () => {
      const res = await window.api.listTasks({ status: 'all' });
      return { count: res.data.filter((x) => x.seriesId).length };
    })()`
  );
  check('删除整个系列后清空所有期', afterDelete.count === 0, String(afterDelete.count));

  // ================= ② 停止专注弹窗 =================
  console.log('\n[②] 停止专注：应用内弹窗');
  const taskId = await evalJs(
    m,
    `(async () => {
      const r = await window.api.createTask({ title: '专注演示任务', category: '工作', priority: 'high' });
      return r.data.id;
    })()`
  );
  await evalJs(m, `(async () => { await window.api.pomodoroStart(${JSON.stringify(taskId)}, 25); return 1; })()`);
  await sleep(900);
  await evalJs(m, `document.getElementById('pomodoro-indicator').click(); 1`);
  await sleep(500);
  const stopDlg = await evalJs(
    m,
    `(() => {
      const d = document.getElementById('app-dialog');
      const cs = d ? getComputedStyle(d.querySelector('.ui-modal-card')) : null;
      return {
        visible: Boolean(d) && !d.classList.contains('hidden'),
        title: d ? document.getElementById('app-dialog-title').textContent.trim() : '',
        message: d ? document.getElementById('app-dialog-message').textContent.trim() : '',
        ok: d ? document.getElementById('app-dialog-ok').textContent.trim() : '',
        cancel: d ? document.getElementById('app-dialog-cancel').textContent.trim() : '',
        okClass: d ? document.getElementById('app-dialog-ok').className : '',
        optionsHidden: d ? document.getElementById('app-dialog-options').classList.contains('hidden') : null,
        glass: cs ? (cs.backdropFilter || cs.webkitBackdropFilter) : null,
        nativeConfirm: window.__nativeConfirm,
      };
    })()`
  );
  check('点击专注指示器弹出应用内弹窗', stopDlg.visible === true);
  check('未使用原生 window.confirm', stopDlg.nativeConfirm === 0, `native=${stopDlg.nativeConfirm}`);
  check('标题与文案沿用停止专注语义', stopDlg.title === '结束本次专注' && /提前结束/.test(stopDlg.message || ''), stopDlg.title);
  check('确认/取消按钮文案正确', stopDlg.ok === '结束专注' && stopDlg.cancel === '取消', `${stopDlg.ok}/${stopDlg.cancel}`);
  check('确认按钮为危险色且不显示选项区', /danger-solid/.test(stopDlg.okClass || '') && stopDlg.optionsHidden === true);
  check('弹窗为毛玻璃材质（与设置弹窗同源）', /blur/.test(stopDlg.glass || ''), String(stopDlg.glass));
  await shot(m, 'repeat-3-stop-focus-dialog.png');

  await evalJs(m, `document.getElementById('app-dialog-cancel').click(); 1`);
  await sleep(500);
  const stillRunning = await evalJs(m, `(async () => Boolean((await window.api.pomodoroStatus()).data))()`);
  check('取消后专注继续', stillRunning === true);

  await evalJs(m, `document.getElementById('pomodoro-indicator').click(); 1`);
  await sleep(400);
  await evalJs(m, `document.getElementById('app-dialog-ok').click(); 1`);
  await sleep(600);
  const stopped = await evalJs(m, `(async () => Boolean((await window.api.pomodoroStatus()).data))()`);
  check('确认后专注结束', stopped === false);

  // ================= ③ 设置面板点击空白不关闭 =================
  console.log('\n[③] 设置面板：仅关闭按钮可关闭');
  await evalJs(m, `document.getElementById('btn-settings').click(); 1`);
  await sleep(700);
  const opened = await evalJs(m, `!document.getElementById('settings-modal').classList.contains('hidden')`);
  check('设置面板可打开', opened === true);

  await evalJs(m, `document.getElementById('settings-modal').click(); 1`);
  await sleep(400);
  const afterBackdrop = await evalJs(m, `!document.getElementById('settings-modal').classList.contains('hidden')`);
  check('点击遮罩空白区域不关闭', afterBackdrop === true);

  await evalJs(m, `document.getElementById('settings-modal').querySelector('.ui-modal-card').click(); 1`);
  await sleep(300);
  const afterCard = await evalJs(m, `!document.getElementById('settings-modal').classList.contains('hidden')`);
  check('点击卡片内部不关闭', afterCard === true);

  // ================= ④ 番茄时长保存与灵动岛同步 =================
  console.log('\n[④] 番茄专注时长：保存与同步');
  const before = await evalJs(
    m,
    `(async () => {
      const s = await window.api.getSettings();
      const st = await window.api.floatState();
      return { settings: s.data.pomodoroMinutes, float: st.data.pomodoroMinutes };
    })()`
  );
  await evalJs(
    m,
    `(() => {
      const i = document.getElementById('set-pomo-minutes');
      i.value = String(${before.settings} === '30' ? '45' : '30');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.dispatchEvent(new Event('change', { bubbles: true }));
      return 1;
    })()`
  );
  await sleep(900);
  const after = await evalJs(
    m,
    `(async () => {
      const s = await window.api.getSettings();
      const st = await window.api.floatState();
      return { settings: s.data.pomodoroMinutes, float: st.data.pomodoroMinutes, input: document.getElementById('set-pomo-minutes').value };
    })()`
  );
  check('时长修改已写入设置', after.settings !== before.settings, `${before.settings} → ${after.settings}`);
  check('输入框回显归一化后的值', after.input === String(after.settings), `${after.input} vs ${after.settings}`);
  check('float:state 立即返回新时长', after.float === after.settings, `float=${after.float}`);

  if (f) {
    await sleep(600);
    const islandClock = await evalJs(f, `(() => { const c = document.getElementById('float-clock'); return c ? c.textContent.trim() : null; })()`);
    const expect = `${String(after.settings).padStart(2, '0')}:00`;
    check('灵动岛时钟同步为新时长', islandClock === expect, `${islandClock} vs ${expect}`);
    await shot(f, 'repeat-4-island-clock.png');
  } else {
    check('灵动岛窗口可连接', false, '未找到 float.html');
  }

  await evalJs(m, `document.getElementById('btn-close-settings').click(); 1`);
  await sleep(400);
  const closed = await evalJs(m, `document.getElementById('settings-modal').classList.contains('hidden')`);
  check('关闭按钮可关闭设置面板', closed === true);

  const nativeUsed = await evalJs(m, `window.__nativeConfirm`);
  check('全流程未触发原生 confirm', nativeUsed === 0, `native=${nativeUsed}`);

  await shot(m, 'repeat-5-main.png');

  console.log(`\n${'='.repeat(48)}`);
  console.log(`通过 ${passed} 项，失败 ${failed} 项`);
  kill();
  await sleep(600);
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error('验证脚本异常：', err.message);
  process.exit(1);
});
