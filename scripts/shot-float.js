'use strict';
/** 浮窗截图：单独抓取浮窗窗口的渲染结果（浮窗是独立窗口，主窗口截图看不到它） */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'tests', 'screenshots');
const PORT = 9450;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aitodo-float-shot-'));
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

  let main = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      main = list.find((t) => (t.url || '').includes('index.html'));
      if (main) break;
    } catch {
      /* ignore */
    }
    await sleep(400);
  }
  if (!main) throw new Error('主界面未就绪');

  const m = await connect(main);
  await m.send('Runtime.enable');
  await sleep(2200);
  await m.send('Runtime.evaluate', {
    expression: `(async () => {
      await window.api.createTask({ title: '把周报发给老板', category: '工作', priority: 'high',
        priorityReason: '描述中包含「很急」且今天截止', dueAt: new Date(Date.now() + 3600000).toISOString(), source: 'ai' });
      await window.api.createTask({ title: '买牛奶和面包', category: '生活', priority: 'medium', source: 'manual' });
      await window.api.floatShow();
      return 'ok';
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  await sleep(2500);

  // 开始一个番茄，让浮窗有倒计时
  await m.send('Runtime.evaluate', {
    expression: `(async () => {
      const tasks = await window.api.listTasks({ status: 'active' });
      await window.api.pomodoroStart(tasks.data[0].id, 25);
      return 'ok';
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  await sleep(2000);

  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const floatTarget = list.find((t) => (t.url || '').includes('float.html'));
  if (!floatTarget) throw new Error('浮窗未打开');

  const f = await connect(floatTarget);
  await f.send('Page.enable');
  await sleep(800);
  const shot = await f.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(OUT, 'preview-float.png'), Buffer.from(shot.data, 'base64'));
  console.log('截图: ' + path.join(OUT, 'preview-float.png'));

  // 深色主题下的浮窗
  await f.send('Runtime.evaluate', { expression: `document.documentElement.setAttribute('data-theme','dark')` });
  await sleep(600);
  const shot2 = await f.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'preview-float-dark.png'), Buffer.from(shot2.data, 'base64'));
  console.log('截图: ' + path.join(OUT, 'preview-float-dark.png'));

  m.ws.close();
  f.ws.close();
  kill();
  process.exit(0);
}

main().catch((e) => {
  console.error('浮窗截图失败:', e.message);
  process.exit(1);
});
