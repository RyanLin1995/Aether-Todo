'use strict';
/**
 * 图标生成：以「液态玻璃方块 + 内嵌发光勾号」高清源图为基础，
 * 自动裁掉画面边角（平台 AI 标识所在区域）后逐级降采样，
 * 输出多尺寸 ICO（16/24/32/48/64/128/256）+ PNG（exe 图标 / 窗口图标 / 托盘 / 顶栏 logo）。
 *
 * 运行：node scripts/make-icon.js [源图路径]
 * 默认源图：build/icon-src/icon-source.png
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const PORT = 9431;
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aitodo-icon-'));

const SRC = process.argv[2] || path.join(ROOT, 'build', 'icon-src', 'icon-source.png');
if (!fs.existsSync(SRC)) throw new Error('找不到源图: ' + SRC);
const DATA_URL = 'data:image/png;base64,' + fs.readFileSync(SRC).toString('base64');

// 在渲染进程里用 canvas 裁切 + 逐级降采样（小尺寸也干净）
const DRAW = `
(async () => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('源图解码失败')); img.src = "${DATA_URL}"; });
  const W = img.naturalWidth, H = img.naturalHeight;

  const probe = document.createElement('canvas');
  probe.width = W; probe.height = H;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  pctx.drawImage(img, 0, 0);

  // 亮像素检测（画面边角的 AI 标识是浅色文字，主体是深色底 + 局部高光）
  const brightIn = (x0, y0, w, h) => {
    const d = pctx.getImageData(x0, y0, w, h).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 170 && d[i + 1] > 170 && d[i + 2] > 170) n++;
    }
    return n;
  };

  // 居中方形裁切：逐步内缩，直到裁切区底部不再残留浅色文字
  let S = Math.round(Math.min(W, H) * 0.90);
  let guard = 0;
  while (guard++ < 12) {
    const x0 = Math.round((W - S) / 2), y0 = Math.round((H - S) / 2);
    const strip = Math.max(4, Math.round(S * 0.05));
    if (brightIn(x0, y0 + S - strip, S, strip) === 0) break;
    S = Math.round(S * 0.94);
  }
  const CX = Math.round((W - S) / 2), CY = Math.round((H - S) / 2);

  const src = document.createElement('canvas');
  src.width = S; src.height = S;
  src.getContext('2d').drawImage(img, CX, CY, S, S, 0, 0, S, S);

  const step = (canvas, from, to) => {
    const n = document.createElement('canvas');
    n.width = to; n.height = to;
    const c = n.getContext('2d');
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(canvas, 0, 0, from, from, 0, 0, to, to);
    return n;
  };
  const make = (target) => {
    let c = src, sz = S;
    while (sz > target * 2) {
      const next = Math.max(target, Math.round(sz / 2));
      c = step(c, sz, next);
      sz = next;
    }
    if (sz !== target) c = step(c, sz, target);
    return c.toDataURL('image/png').split(',')[1];
  };

  const out = { meta: { W, H, S, CX, CY } };
  for (const n of [16, 24, 32, 48, 64, 128, 256, 512]) out['i' + n] = make(n);
  return out;
})()
`;

/** 把多张 PNG 打成多尺寸 ICO（Vista+ 支持 PNG 压缩的 ICO） */
function buildIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const blobs = [];
  entries.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
    blobs.push(png);
  });
  return Buffer.concat([header, dir, ...blobs]);
}

async function main() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    ['.', '--remote-debugging-port=' + PORT, '--user-data-dir=' + USER_DATA, '--no-sandbox', '--disable-gpu'],
    { cwd: ROOT, env, stdio: 'ignore' }
  );
  const kill = () => {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* ignore */
    }
  };

  let page = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) break;
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  if (!page) throw new Error('Electron 页面未就绪');

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
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    }
  };
  const send = (method, params = {}) => {
    const msgId = ++id;
    ws.send(JSON.stringify({ id: msgId, method, params }));
    return new Promise((res) => pending.set(msgId, res));
  };

  await send('Runtime.enable');
  await new Promise((r) => setTimeout(r, 800));
  const res = await send('Runtime.evaluate', { expression: DRAW, returnByValue: true, awaitPromise: true });
  if (res?.exceptionDetails) throw new Error('绘制失败: ' + (res.exceptionDetails.text || ''));
  const out = res?.result?.value;
  if (!out) throw new Error('绘制失败');

  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'src', 'main', 'assets'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'src', 'renderer', 'assets'), { recursive: true });

  const png = (key) => Buffer.from(out[key], 'base64');

  const entries = [16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: png('i' + size) }));
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), buildIco(entries));
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.png'), png('i256'));
  fs.writeFileSync(path.join(ROOT, 'build', 'icon-256.png'), png('i256'));
  fs.writeFileSync(path.join(ROOT, 'build', 'tray.png'), png('i32'));

  fs.writeFileSync(path.join(ROOT, 'src', 'main', 'assets', 'icon.png'), png('i256'));
  fs.writeFileSync(path.join(ROOT, 'src', 'main', 'assets', 'tray.png'), png('i32'));
  fs.writeFileSync(path.join(ROOT, 'src', 'renderer', 'assets', 'logo.png'), png('i64'));
  fs.writeFileSync(path.join(ROOT, 'src', 'renderer', 'assets', 'logo@2x.png'), png('i128'));

  console.log('源图 %dx%d → 裁切 %d（偏移 %d,%d）', out.meta.W, out.meta.H, out.meta.S, out.meta.CX, out.meta.CY);
  console.log('生成 build/icon.ico（16~256 七种尺寸）');
  console.log('生成 build/icon.png、build/icon-256.png、build/tray.png');
  console.log('生成 src/main/assets/icon.png、tray.png');
  console.log('生成 src/renderer/assets/logo.png、logo@2x.png（顶栏）');

  ws.close();
  kill();
  process.exit(0);
}

main().catch((e) => {
  console.error('图标生成失败:', e.message);
  process.exit(1);
});
