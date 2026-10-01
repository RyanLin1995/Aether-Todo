'use strict';
/** 界面走查：启动应用（独立临时数据目录），造示例任务，截主界面/设置/收起助手三张图 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const PORT = 9447;
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aitodo-shot-'));
const OUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aitodo-shots-'));
const electronBin =
  process.platform === 'win32'
    ? path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    electronBin,
    ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DATA}`, '--no-sandbox'],
    { cwd: ROOT, env, stdio: 'ignore' }
  );

  let page = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      page = list.find((t) => t.type === 'page' && t.url.includes('index.html') && t.webSocketDebuggerUrl);
      if (page) break;
    } catch {}
    await sleep(400);
  }
  if (!page) throw new Error('页面未就绪');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  const pending = new Map();
  let id = 0;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const msgId = ++id;
      pending.set(msgId, resolve);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) console.error('eval error', JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.result.data, 'base64'));
    console.log('saved', name);
  };

  await sleep(1800);

  // 造示例数据（独立临时目录，不影响真实数据）
  await evaluate(`(async () => {
    const mk = (t, p, c, hours, note) => window.api.createTask({
      title: t, priority: p, category: c,
      dueAt: new Date(Date.now() + hours * 3600000).toISOString(),
      note: note || '', priorityReason: p === 'high' ? '24 小时内到期，时间压力大' : '',
    });
    await mk('把 Q3 周报发给老板', 'high', '工作', 20, '数据部分等财务确认后补充');
    await mk('准备周三项目方案评审', 'medium', '工作', 72);
    await mk('周末给妈妈打电话', 'low', '社交', 96);
    await mk('晚上健身 40 分钟', 'medium', '健康', 9);
    await window.api.createTask({ title: '还信用卡账单', priority: 'medium', category: '财务', completed: true });
    return 'ok';
  })()`);
  await sleep(700);
  await evaluate(`window.dispatchEvent(new Event('focus')); 1`);
  await sleep(300);
  await shot('01-main.png');

  // 设置弹窗
  await evaluate(`document.getElementById('btn-settings').click(); 1`);
  await sleep(900);
  await shot('02-settings.png');
  await evaluate(`document.getElementById('btn-close-settings').click(); 1`);
  await sleep(400);

  // 收起助手（动画结束后状态）
  await evaluate(`document.getElementById('btn-close-assistant').click(); 1`);
  await sleep(700);
  await shot('03-collapsed.png');

  console.log('OUT_DIR=' + OUT_DIR);
  child.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
