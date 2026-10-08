'use strict';
/**
 * 灵动岛专项走查（v1.1.6）
 *   ① 托盘菜单文案：悬浮窗 → 灵动岛
 *   ② 展开态：点击非灵动岛区域（岛外留白 / 窗口失焦）即收起
 *   ③ 手动拖拽：岛可自由移动，落在松手处并持久化
 *   ④ 回归：岛内点击不收起、按钮上按下不拖拽、不再有原生 app-region 拖拽叠加
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const PORT = 9461;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  const pending = new Map();
  let id = 0;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    }
  };
  const send = (method, params = {}) => {
    const msgId = ++id;
    ws.send(JSON.stringify({ id: msgId, method, params }));
    return new Promise((res) => pending.set(msgId, res));
  };
  return { ws, send };
}

async function evaluate(send, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r && r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || 'evaluate 抛错');
  }
  return r?.result?.value;
}

async function main() {
  // ---------- ① 文案（直接读源码字典，托盘菜单是原生菜单，CDP 拿不到） ----------
  console.log('\n[①] 托盘菜单与相关文案：悬浮窗 → 灵动岛');
  const mainI18n = fs.readFileSync(path.join(ROOT, 'src', 'main', 'i18n.ts'), 'utf8');
  const rendI18n = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'src', 'i18n.ts'), 'utf8');

  ok('托盘菜单中文改为「灵动岛」', /'tray\.float':\s*'灵动岛'/.test(mainI18n));
  ok('托盘菜单英文改为「Dynamic Island」', /'tray\.float':\s*'Dynamic Island'/.test(mainI18n));
  ok('托盘菜单不再出现「悬浮窗」', !/'tray\.float':\s*'悬浮窗'/.test(mainI18n));
  ok('设置分区改为「专注与灵动岛」', /'settings\.pomoSection':\s*'专注与灵动岛'/.test(rendI18n));
  ok('设置项改为「灵动岛玻璃透明度」', /'settings\.floatOpacity':\s*'灵动岛玻璃透明度'/.test(rendI18n));
  ok('顶栏按钮改为「灵动岛」', /'topbar\.float':\s*'灵动岛'/.test(rendI18n));
  ok('岛内隐藏按钮改为「隐藏灵动岛」', /'float\.hide':\s*'隐藏灵动岛'/.test(rendI18n));
  ok('英文设置分区同步', /'settings\.pomoSection':\s*'Focus & Dynamic Island'/.test(rendI18n));

  // ---------- 启动应用 ----------
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aitodo-island-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`, '--no-sandbox', '--disable-gpu'],
    { cwd: ROOT, env, stdio: 'ignore' }
  );
  const kill = () => {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* ignore */
    }
  };

  let mainTarget = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      mainTarget = list.find((t) => (t.url || '').includes('index.html'));
      if (mainTarget) break;
    } catch {
      /* ignore */
    }
    await sleep(400);
  }
  if (!mainTarget) throw new Error('主界面未就绪');

  const m = await connect(mainTarget);
  await m.send('Runtime.enable');
  await sleep(1800);

  await evaluate(
    m.send,
    `(async () => {
      await window.api.createTask({ title: '把周报发给老板', category: '工作', priority: 'high',
        priorityReason: '今天截止', dueAt: new Date(Date.now() + 3600000).toISOString(), source: 'ai' });
      await window.api.floatShow();
      return 'ok';
    })()`
  );
  await sleep(2200);

  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const floatTarget = list.find((t) => (t.url || '').includes('float.html'));
  if (!floatTarget) throw new Error('灵动岛窗口未打开');
  const f = await connect(floatTarget);
  await f.send('Runtime.enable');
  await sleep(1200);

  // ---------- ② 展开态：点外部收起 ----------
  console.log('\n[②] 展开后点击非灵动岛区域即收起');

  const modeOf = () => evaluate(f.send, `document.getElementById('dynamic-island').className`);
  const expand = () =>
    evaluate(f.send, `document.getElementById('island-toggle-expand').click(); document.getElementById('dynamic-island').className`);

  ok('初始为紧凑胶囊态', (await modeOf()).includes('island-compact'));
  ok('点击展开按钮后进入展开态', (await expand()).includes('island-expanded'));

  // 岛内点击不应收起
  await evaluate(
    f.send,
    `document.getElementById('dynamic-island').dispatchEvent(
       new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`
  );
  await sleep(120);
  ok('岛内点击不收起', (await modeOf()).includes('island-expanded'));

  // 岛外留白（窗口矩形内、岛矩形外）按下 → 收起
  await evaluate(
    f.send,
    `document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`
  );
  await sleep(150);
  ok('岛外留白按下即收起', (await modeOf()).includes('island-compact'), await modeOf());

  // 窗口失焦（点到其他窗口 / 桌面）→ 收起
  await expand();
  await evaluate(f.send, `window.dispatchEvent(new Event('blur'))`);
  await sleep(150);
  ok('窗口失焦（点到别处）即收起', (await modeOf()).includes('island-compact'));

  // 岛内确认弹窗打开时不收起
  await expand();
  await evaluate(f.send, `document.getElementById('island-confirm').classList.remove('hidden')`);
  await evaluate(
    f.send,
    `document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`
  );
  await sleep(150);
  ok('确认弹窗打开中不被外部点击收起', (await modeOf()).includes('island-expanded'));
  await evaluate(f.send, `document.getElementById('island-confirm').classList.add('hidden')`);

  // ---------- ③ 手动拖拽 ----------
  console.log('\n[③] 灵动岛可自由移动');

  const bounds = () => evaluate(f.send, `(async () => await window.api.floatBounds().then(r => r.data))()`);
  const start = await bounds();
  ok('可读取岛当前坐标', !!start && Number.isFinite(start.x), JSON.stringify(start));

  // 先挪到一个确定的位置（同时验证 moveBy 与落盘）
  const parked = await evaluate(
    f.send,
    `(async () => {
      const b = await window.api.floatBounds().then(r => r.data);
      return await window.api.floatMoveBy(300 - b.x, 200 - b.y, true).then(r => r.data);
    })()`
  );
  await sleep(200);
  ok('moveBy 能把岛挪到指定坐标', parked.x === 300 && parked.y === 200, JSON.stringify(parked));

  const dragBy = async (dx, dy, onButton) => {
    await evaluate(
      f.send,
      `(async () => {
        const island = document.getElementById('dynamic-island');
        const target = ${onButton ? "document.getElementById('island-toggle-expand')" : 'island'};
        const box = island.getBoundingClientRect();
        const cx = Math.round(box.left + box.width / 2);
        const cy = Math.round(box.top + 12);
        const win = await window.api.floatBounds().then(r => r.data);
        const mk = (type, sx, sy) => new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true,
          button: 0, buttons: 1, clientX: cx, clientY: cy, screenX: sx, screenY: sy,
        });
        const sx0 = win.x + cx, sy0 = win.y + cy;
        target.dispatchEvent(mk('pointerdown', sx0, sy0));
        target.dispatchEvent(mk('pointermove', sx0 + ${dx}, sy0 + ${dy}));
        target.dispatchEvent(mk('pointerup', sx0 + ${dx}, sy0 + ${dy}));
        return 'ok';
      })()`
    );
    await sleep(350);
    return bounds();
  };

  const moved = await dragBy(150, 100, false);
  ok('拖拽 (+150,+100) 后岛确实移动了', moved.x === 450 && moved.y === 300, `${JSON.stringify(parked)} → ${JSON.stringify(moved)}`);

  const st = await evaluate(f.send, `(async () => await window.api.getSettings().then(r => r.data))()`);
  ok('拖拽结果已持久化到设置', st.floatX === 450 && st.floatY === 300, `floatX=${st.floatX} floatY=${st.floatY}`);

  const again = await dragBy(-80, -60, false);
  ok('可连续拖拽（不被吸附回边缘）', again.x === 370 && again.y === 240, JSON.stringify(again));

  // 按钮上按下不应触发拖拽
  const beforeBtn = await bounds();
  await dragBy(60, 40, true);
  const afterBtn = await bounds();
  ok(
    '在按钮上按下不触发拖拽',
    beforeBtn.x === afterBtn.x && beforeBtn.y === afterBtn.y,
    `${JSON.stringify(beforeBtn)} → ${JSON.stringify(afterBtn)}`
  );

  // ---------- ④ 无原生 app-region 拖拽叠加 ----------
  console.log('\n[④] 拖拽实现一致性');
  const region = await evaluate(
    f.send,
    `getComputedStyle(document.getElementById('dynamic-island')).webkitAppRegion`
  );
  ok('岛容器为 no-drag（不再与手动拖拽叠加）', region === 'no-drag', String(region));

  const css = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'styles.css'), 'utf8');
  ok('CSS 中已无 -webkit-app-region: drag', !/-webkit-app-region:\s*drag/.test(css));

  console.log(`\n================================================\n通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) {
    console.log('失败项：\n  - ' + failures.join('\n  - '));
  } else {
    console.log('灵动岛专项走查全部通过 ✅');
  }

  m.ws.close();
  f.ws.close();
  kill();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('灵动岛走查失败:', e && e.message);
  process.exit(1);
});
