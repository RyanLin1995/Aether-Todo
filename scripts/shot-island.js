'use strict';
/** 灵动岛走查：紧凑态截图 → 点击展开 → 展开态截图 → 切换下一个任务再截图 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const PORT = 9452;
const OUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aitodo-island-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const pending = new Map();
  let id = 0;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  };
  const send = (method, params = {}) => {
    const msgId = ++id;
    pending.set(msgId, () => {});
    return new Promise((res) => pending.set(msgId, res)).then(() => {
      ws.send(JSON.stringify({ id: msgId, method, params }));
      return new Promise((r) => pending.set(msgId, r));
    });
  };
  return { ws, send: (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); }) };
}

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aitodo-island-data-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`, '--no-sandbox'],
    { cwd: ROOT, env, stdio: 'ignore' }
  );
  const kill = () => { try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} };

  let main = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      main = list.find((t) => (t.url || '').includes('index.html'));
      if (main) break;
    } catch {}
    await sleep(400);
  }
  if (!main) throw new Error('主界面未就绪');
  const m = await connect(main);
  await m.send('Runtime.enable');
  await sleep(2200);

  await m.send('Runtime.evaluate', {
    expression: `(async () => {
      await window.api.createTask({ title: '把 Q3 周报发给老板', category: '工作', priority: 'high', dueAt: new Date(Date.now() + 3600000).toISOString() });
      await window.api.createTask({ title: '买牛奶和面包', category: '生活', priority: 'medium' });
      await window.api.createTask({ title: '晚上健身 40 分钟', category: '健康', priority: 'low' });
      await window.api.floatShow();
      return 'ok';
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  await sleep(2200);

  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const floatTarget = list.find((t) => (t.url || '').includes('float.html'));
  if (!floatTarget) throw new Error('浮窗未打开');
  const f = await connect(floatTarget);
  await f.send('Page.enable');
  await sleep(600);

  const shot = async (name) => {
    const r = await f.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.data, 'base64'));
    console.log('saved', name);
  };

  // 1. 紧凑胶囊态
  await shot('island-1-compact.png');

  // 2. 点击展开
  await f.send('Runtime.evaluate', { expression: `document.getElementById('island-compact-view').click(); 1` });
  await sleep(700);
  await shot('island-2-expanded.png');

  // 3. 切换下一个任务
  await f.send('Runtime.evaluate', { expression: `document.getElementById('island-next-task').click(); 1` });
  await sleep(800);
  await shot('island-3-next-task.png');

  console.log('OUT_DIR=' + OUT_DIR);
  kill();
  process.exit(0);
}

main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
