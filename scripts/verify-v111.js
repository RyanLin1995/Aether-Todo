'use strict';
/** 1.1.1 三项改动专项验证：①透明度拉条映射与反馈 ②收起按钮区分度 ③灵动岛应用内确认弹窗 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const PORT = 9463;
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
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log(`  📷 ${file}`);
}

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aitodo-v111-'));
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

  // ---- 准备：建任务 + 打开灵动岛 ----
  const taskId = await evalJs(
    m,
    `(async () => {
      const created = await window.api.createTask({ title: 'Q3 周报发给老板', category: '工作', priority: 'high' });
      await window.api.floatShow();
      await window.api.floatSetTask(created.data.id);
      return created.data.id;
    })()`
  );
  await sleep(1800);

  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const floatTarget = list.find((t) => (t.url || '').includes('float.html'));
  if (!floatTarget) throw new Error('灵动岛未打开');
  const f = await connect(floatTarget);
  await f.send('Runtime.enable');
  await f.send('Page.enable');
  await sleep(600);

  // ================= ② 收起按钮区分度 =================
  console.log('\n[②] 灵动岛按钮区分度');
  await evalJs(f, `document.getElementById('island-compact-view').click(); 1`);
  await sleep(700);
  const btnInfo = await evalJs(
    f,
    `(() => {
      const g = (id) => {
        const el = document.getElementById(id);
        const cs = getComputedStyle(el);
        const svg = el.querySelector('svg');
        return {
          icon: svg ? svg.getAttribute('class') : null,
          bg: cs.backgroundColor,
          border: cs.borderTopWidth + ' ' + cs.borderTopColor,
          radius: cs.borderTopLeftRadius,
          color: cs.color,
          title: el.getAttribute('title'),
          box: JSON.stringify(el.getBoundingClientRect()),
        };
      };
      return { collapse: g('island-toggle-compact'), next: g('island-next-task'), prev: g('island-prev-task') };
    })()`
  );
  check('收起按钮使用 minimize 图标', /lucide-minimize/.test(btnInfo.collapse.icon || ''), btnInfo.collapse.icon);
  check('下一个任务仍是 chevronRight', /lucide-chevronRight/.test(btnInfo.next.icon || ''), btnInfo.next.icon);
  check('收起按钮底色与「下一个任务」不同', btnInfo.collapse.bg !== btnInfo.next.bg, `${btnInfo.collapse.bg} vs ${btnInfo.next.bg}`);
  check('收起按钮描边与「下一个任务」不同', btnInfo.collapse.border !== btnInfo.next.border, `${btnInfo.collapse.border} vs ${btnInfo.next.border}`);
  check('收起按钮文案为「收起灵动岛」', btnInfo.collapse.title === '收起灵动岛', btnInfo.collapse.title);
  check('上一个任务保持原样式（无底色描边）', btnInfo.prev.bg === btnInfo.next.bg && btnInfo.prev.border === btnInfo.next.border, btnInfo.prev.bg);
  await shot(f, 'v111-1-island-expanded.png');

  // ================= ③ 应用内确认弹窗 =================
  console.log('\n[③] 灵动岛停止确认弹窗');
  await evalJs(m, `(async () => { await window.api.pomodoroStart(${JSON.stringify(taskId)}, 25); return 1; })()`);
  await sleep(1200);
  await evalJs(f, `document.getElementById('float-stop').click(); 1`);
  await sleep(500);
  const dlg = await evalJs(
    f,
    `(() => {
      const wrap = document.getElementById('island-confirm');
      const card = document.getElementById('island-confirm-card');
      const cs = card ? getComputedStyle(card) : null;
      return {
        visible: !wrap.classList.contains('hidden'),
        insideIsland: Boolean(wrap.closest('#dynamic-island')),
        title: document.getElementById('island-confirm-title').textContent,
        message: (document.getElementById('island-confirm-message').textContent || '').slice(0, 24),
        ok: document.getElementById('island-confirm-ok').textContent.trim(),
        cancel: document.getElementById('island-confirm-cancel').textContent.trim(),
        okClass: document.getElementById('island-confirm-ok').className,
        bg: cs && cs.backgroundColor,
        radius: cs && cs.borderTopLeftRadius,
        backdrop: cs && (cs.backdropFilter || cs.webkitBackdropFilter),
        hasIcon: Boolean(document.querySelector('#island-confirm-icon svg')),
        pillFont: cs && getComputedStyle(document.getElementById('island-confirm-ok')).fontSize,
      };
    })()`
  );
  check('点击停止弹出应用内确认弹窗', dlg.visible === true);
  check('弹窗标题为「结束本次专注」', dlg.title === '结束本次专注', dlg.title);
  check('弹窗沿用确认文案', /确定要提前结束/.test(dlg.message || ''), dlg.message);
  check('确认/取消按钮文案正确', dlg.ok === '结束专注' && dlg.cancel === '取消', `${dlg.ok} / ${dlg.cancel}`);
  check('确认按钮沿用岛屿药丸样式', /island-pill-btn danger-btn/.test(dlg.okClass) && dlg.pillFont === '11px', `${dlg.okClass} ${dlg.pillFont}`);
  check('弹窗位于灵动岛内且不越界', dlg.insideIsland === true);
  check('弹窗为毛玻璃卡片风格', /rgba\(24, 24, 30/.test(dlg.bg || '') && dlg.radius === '16px', `${dlg.bg} r=${dlg.radius}`);
  check('弹窗标题带警示图标', dlg.hasIcon === true);
  await shot(f, 'v111-2-island-confirm.png');

  // 取消 → 专注继续
  await evalJs(f, `document.getElementById('island-confirm-cancel').click(); 1`);
  await sleep(600);
  const afterCancel = await evalJs(
    m,
    `(async () => {
      const st = await window.api.pomodoroStatus();
      return { running: Boolean(st.data) };
    })()`
  );
  const dlgHidden = await evalJs(f, `document.getElementById('island-confirm').classList.contains('hidden')`);
  check('取消后弹窗关闭且专注继续', dlgHidden === true && afterCancel.running === true, JSON.stringify(afterCancel));

  // 关闭按钮 → 关闭
  await evalJs(f, `document.getElementById('float-stop').click(); 1`);
  await sleep(400);
  await evalJs(f, `document.getElementById('island-confirm-close').click(); 1`);
  await sleep(400);
  check('右上角关闭按钮可关闭弹窗', (await evalJs(f, `document.getElementById('island-confirm').classList.contains('hidden')`)) === true);
  check('关闭后专注仍在进行', (await evalJs(m, `(async () => Boolean((await window.api.pomodoroStatus()).data))()`)) === true);

  // 确认 → 停止专注
  await evalJs(f, `document.getElementById('float-stop').click(); 1`);
  await sleep(400);
  await evalJs(f, `document.getElementById('island-confirm-ok').click(); 1`);
  await sleep(900);
  const afterOk = await evalJs(
    m,
    `(async () => {
      const st = await window.api.pomodoroStatus();
      return { running: Boolean(st.data), stopVisible: true };
    })()`
  );
  check('确认后结束专注', afterOk.running === false, JSON.stringify(afterOk));
  check('结束后弹窗已关闭', (await evalJs(f, `document.getElementById('island-confirm').classList.contains('hidden')`)) === true);

  // ================= ① 透明度拉条 =================
  console.log('\n[①] 液态玻璃透明度拉条');
  await evalJs(m, `document.getElementById('btn-settings').click(); 1`);
  await sleep(700);
  const range = await evalJs(
    m,
    `(() => {
      const el = document.getElementById('set-float-opacity');
      return { min: el.min, max: el.max, value: el.value };
    })()`
  );
  check('拉条范围 0–100', range.min === '0' && range.max === '100', `${range.min}–${range.max}`);

  const setSlider = (v) =>
    evalJs(
      m,
      `(() => {
        const el = document.getElementById('set-float-opacity');
        el.value = ${v};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return 1;
      })()`
    );
  const readState = () =>
    evalJs(
      m,
      `(() => {
        const el = document.getElementById('set-float-opacity');
        const glass = document.getElementById('opacity-preview-glass');
        const preview = document.getElementById('opacity-preview');
        return {
          slider: el.value,
          label: document.getElementById('val-float-opacity').textContent,
          liquid: getComputedStyle(document.documentElement).getPropertyValue('--liquid').trim(),
          glassOpacity: getComputedStyle(document.documentElement).getPropertyValue('--glass-opacity').trim(),
          preview: preview.style.getPropertyValue('--liquid').trim(),
          previewBg: getComputedStyle(glass).backgroundColor,
        };
      })()`
    );

  await setSlider(0);
  await sleep(500);
  const at0 = await readState();
  check('拉到最左端 = 液态程度 30%', at0.label === '30%' && Math.abs(Number(at0.liquid) - 0.3) < 0.005, JSON.stringify(at0));
  check('预览卡同步到 30%', Math.abs(Number(at0.preview) - 0.3) < 0.005, at0.previewBg);
  check(
    '30% 时材质仍不透明（底色 > 30%）',
    Number(at0.glassOpacity) > 0.3,
    `--glass-opacity=${at0.glassOpacity}`
  );
  await shot(m, 'v111-3-opacity-30.png');

  await setSlider(100);
  await sleep(600);
  const at100 = await readState();
  const floatOpacity = await evalJs(m, `(async () => (await window.api.floatState()).data.opacity)()`);
  check('拖到最右端 = 液态程度 100%', at100.label === '100%' && Math.abs(Number(at100.liquid) - 1) < 0.005, JSON.stringify(at100));
  check('最右端时悬浮窗真正不透明', Math.abs(floatOpacity - 1) < 0.01, String(floatOpacity));
  await shot(m, 'v111-4-opacity-100.png');

  await setSlider(50);
  await sleep(600);
  const at50 = await readState();
  check('中间位置 ≈ 65%', at50.label === '65%' && Math.abs(Number(at50.liquid) - 0.65) < 0.006, JSON.stringify(at50));
  check('不同取值的预览底色不同', at50.previewBg !== at100.previewBg && at50.previewBg !== at0.previewBg, `${at0.previewBg} / ${at50.previewBg} / ${at100.previewBg}`);

  // 持久化 + 重开设置回显
  const saved = await evalJs(m, `(async () => { const s = await window.api.getSettings(); return { liquid: s.data.liquidOpacity, float: s.data.floatOpacity }; })()`);
  check('取值已持久化（65%）', Math.abs(saved.liquid - 0.65) < 0.006 && Math.abs(saved.float - 0.65) < 0.006, JSON.stringify(saved));
  await evalJs(m, `document.getElementById('btn-close-settings').click(); 1`);
  await sleep(300);
  await evalJs(m, `document.getElementById('btn-settings').click(); 1`);
  await sleep(700);
  const reopened = await readState();
  check('重开设置回显一致', reopened.label === '65%' && reopened.slider === '50', JSON.stringify(reopened));
  check('设置项已改名为「整体液态程度」', (await evalJs(m, `document.querySelector('[data-i18n="settings.liquidLevel"]').textContent`)) === '整体液态程度');

  console.log(`\n================================================\n通过 ${passed} 项，失败 ${failed} 项`);
  kill();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('执行异常：', e.message);
  process.exit(1);
});
