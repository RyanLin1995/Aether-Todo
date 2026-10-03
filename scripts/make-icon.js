'use strict';
/**
 * Aether Todo 应用图标生成器 · 扁平化待办图标（靛蓝底板版）
 *
 * 设计定稿（1.1.4）：
 *   造型  —— 对勾 + 三条清单线；首行高亮（"已划掉"）、后两行次级（"待办"）
 *   配色  —— 底板 = 界面 daisyUI light 主题 primary oklch(45% 0.24 277.023) ≈ #4F46E5
 *            靛蓝对角渐变 #4F46E5 → #3730C4；glyph 用白色，靠不透明度分层级
 *   形制  —— 圆角底板，外边距 132/1024（≈13%，留出任务栏/开始菜单安全区），圆角 22.3%
 *
 * 为什么底板上不用深灰清单线：深灰压在深底上会直接消失。层级改由「白 100% / 白 58%」承担，
 * 语义反而更顺 —— 亮 = 已完成，淡 = 待办。
 *
 * 铁律：每个尺寸原生矢量绘制 + 4× 超采样后一次性缩放。
 *       绝不用「大位图逐级降采样」——256 缩到 16 是缩小 16 倍，细节必被平均掉。
 *       小尺寸按倍率加粗线宽（optical sizing），保证各尺寸视觉重量一致。
 *
 * 用法：
 *   node scripts/make-icon.js            仅生成预览 → build/icon-preview.png
 *   node scripts/make-icon.js --apply    写入 build/ 与 src 各 assets
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
let PORT = 0;
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aitodo-icon-'));
const PAGE = path.join(USER_DATA, 'icon.html');

const APPLY = process.argv.includes('--apply');

fs.writeFileSync(PAGE, '<!doctype html><meta charset="utf-8"><body style="margin:0"></body>');

/* ------------------------------------------------------------------ *
 * 浏览器内绘制代码（注入 Electron 渲染进程执行）
 * 逻辑栅格 1024×1024，按目标尺寸等比缩放。
 * ------------------------------------------------------------------ */
const DRAW = `
(() => {
  const G = 1024, C = G / 2;

  // 底板：界面 primary 本尊（oklch 45% 0.24 277.023）→ 同色系压深
  const BOARD = ['#4F46E5', '#3730C4'];

  // 底板几何：外边距 13%（任务栏安全区）+ 圆角 22.3%（对齐主流应用图标）
  const M = 132;
  const SIDE = G - M * 2;
  const R = SIDE * 0.223;

  // glyph 层级：亮白 = 已完成 / 淡白 = 待办
  const INK = '#FFFFFF';
  const RULE = 'rgba(255,255,255,0.58)';

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function stroke(ctx, drawPath, w, style) {
    ctx.save();
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawPath(ctx);
    ctx.stroke();
    ctx.restore();
  }

  /* 光学补偿（optical sizing）
   * 线宽 46 在 1024 栅格上缩到 16px 只剩 0.72px，必糊。
   * 按尺寸加粗，让 16px 和 256px 看起来一样重。 */
  function boost(S) {
    if (S <= 24) return 1.50;
    if (S <= 32) return 1.34;
    if (S <= 48) return 1.18;
    if (S <= 64) return 1.09;
    return 1.0;
  }

  function line(ctx, x1, y, x2, w, style) {
    stroke(ctx, (c) => { c.beginPath(); c.moveTo(x1, y); c.lineTo(x2, y); }, w, style);
  }

  // 折线对勾：短臂陡、长臂缓（等宽线稿的标准勾形）
  function tick(ctx, cx, cy, s, w, style) {
    stroke(ctx, (c) => {
      c.beginPath();
      c.moveTo(cx - 300 * s, cy + 10 * s);
      c.lineTo(cx - 110 * s, cy + 190 * s);
      c.lineTo(cx + 300 * s, cy - 190 * s);
    }, w, style);
  }

  function draw(ctx, S) {
    const k = S / G;
    ctx.save();
    ctx.scale(k, k);
    ctx.clearRect(0, 0, G, G);

    const W = 46 * boost(S);

    // ---- 底板：靛蓝对角渐变 ----
    const bg = ctx.createLinearGradient(0, 0, G, G);
    bg.addColorStop(0, BOARD[0]);
    bg.addColorStop(1, BOARD[1]);
    ctx.fillStyle = bg;
    rr(ctx, M, M, SIDE, SIDE, R);
    ctx.fill();

    // ---- glyph：勾 + 三条清单线（首行高亮 = 已划掉） ----
    const SP = 116;                 // 行距
    tick(ctx, C - 210, C, 0.355, W, INK);
    line(ctx, C + 26, C - SP, C + 300, W, INK);
    line(ctx, C + 26, C, C + 300, W, RULE);
    line(ctx, C + 26, C + SP, C + 300, W, RULE);

    ctx.restore();
  }

  // 小尺寸 4× 超采样，边缘数学精确；大尺寸 1~2× 即可
  const ssOf = (S) => (S <= 64 ? 4 : S <= 128 ? 2 : 1);

  function render(S) {
    const ss = ssOf(S);
    const big = document.createElement('canvas');
    big.width = big.height = S * ss;
    draw(big.getContext('2d'), S * ss);

    const out = document.createElement('canvas');
    out.width = out.height = S;
    const c = out.getContext('2d');
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(big, 0, 0, S * ss, S * ss, 0, 0, S, S);
    return out;
  }

  const SIZES = [16, 20, 24, 32, 48, 64, 96, 128, 256];
  const out = { sizes: SIZES };
  for (const S of SIZES) {
    out['i' + S] = render(S).toDataURL('image/png').split(',')[1];
  }

  /* ---------------- 预览板 ---------------- */
  (() => {
    const CELL = 150, PAD = 36, GAP = 16, SCALE = 2, TARGET = 124;
    const COLS = [
      { S: 16, bg: '#F2F3F6', tag: '16px' },
      { S: 20, bg: '#F2F3F6', tag: '20px' },
      { S: 24, bg: '#F2F3F6', tag: '24px' },
      { S: 32, bg: '#F2F3F6', tag: '32px' },
      { S: 48, bg: '#F2F3F6', tag: '48px' },
      { S: 64, bg: '#F2F3F6', tag: '64px' },
      { S: 128, bg: '#F2F3F6', tag: '128px' },
      { S: 256, bg: '#F2F3F6', tag: '256px' },
      { S: 32, bg: '#EDEEF2', tag: '桌面·浅' },
      { S: 32, bg: '#0F1117', tag: '任务栏·深' },
      { S: 64, bg: '#0F1117', tag: '桌面·深' },
    ];
    const d = CELL * SCALE;
    const W = PAD * 2 + COLS.length * (d + GAP) - GAP;
    const HEAD = 54;
    const H = PAD * 2 + HEAD + d + 62;

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.fillStyle = '#FFFFFF';
    c.fillRect(0, 0, W, H);
    c.textBaseline = 'middle';

    c.textAlign = 'left';
    c.fillStyle = '#14161F';
    c.font = '600 24px sans-serif';
    c.fillText('Aether Todo · 扁平化待办图标', PAD, PAD + 10);

    c.textAlign = 'right';
    c.fillStyle = '#8A8F9C';
    c.font = '500 17px sans-serif';
    c.fillText('底板 #4F46E5 → #3730C4（= 界面 primary） · glyph 白 100% / 58%', W - PAD, PAD + 10);

    COLS.forEach((col, ci) => {
      const gx = PAD + ci * (d + GAP);
      const gy = PAD + HEAD;

      c.textAlign = 'center';
      c.fillStyle = col.bg === '#F2F3F6' ? '#6B7280' : '#3F6FE0';
      c.font = '600 17px sans-serif';
      c.fillText(col.tag, gx + d / 2, gy - 20);

      c.save();
      c.translate(gx, gy);
      c.fillStyle = col.bg;
      c.fillRect(0, 0, d, d);
      c.strokeStyle = '#D8DBE2';
      c.lineWidth = 1;
      c.strokeRect(0.5, 0.5, d - 1, d - 1);

      const dw = TARGET * SCALE;
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      c.drawImage(render(col.S), (d - dw) / 2, (d - dw) / 2, dw, dw);
      c.restore();
    });

    const fy = PAD + HEAD + d + 30;
    c.textAlign = 'left';
    c.fillStyle = '#6B7280';
    c.font = '500 17px sans-serif';
    c.fillText('外边距 13%（任务栏安全区） · 圆角 22.3%（对齐主流应用图标比例） · 每尺寸原生矢量绘制 + 光学补偿', PAD, fy);

    out.preview = cv.toDataURL('image/png').split(',')[1];
  })();

  return out;
})()
`;

/* ------------------------------------------------------------------ *
 * ICO 打包（PNG 内嵌，Windows Vista+ 支持）
 * ------------------------------------------------------------------ */
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
    [PAGE, '--remote-debugging-port=0', '--user-data-dir=' + USER_DATA, '--no-sandbox', '--disable-gpu'],
    { cwd: ROOT, env, stdio: 'ignore' }
  );
  const kill = () => {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch { /* ignore */ }
  };

  let page = null;
  for (let i = 0; i < 80; i++) {
    if (!PORT) {
      const pf = path.join(USER_DATA, 'DevToolsActivePort');
      if (fs.existsSync(pf)) {
        const raw = fs.readFileSync(pf, 'utf8').split(/\r?\n/);
        if (raw[0] && raw[0].trim()) PORT = Number(raw[0].trim());
      }
    }
    if (PORT) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) break;
      } catch { /* ignore */ }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  if (!page) throw new Error('Electron 页面未就绪（PORT=' + PORT + '）');
  console.log('[icon] CDP 就绪 PORT=' + PORT);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const pending = new Map();
  let id = 0;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  };
  const send = (method, params = {}) => {
    const msgId = ++id;
    ws.send(JSON.stringify({ id: msgId, method, params }));
    return new Promise((res) => pending.set(msgId, res));
  };
  const evalWithTimeout = (expression, ms) => Promise.race([
    send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('渲染超时（' + ms + 'ms）')), ms)),
  ]);

  await send('Runtime.enable');
  await new Promise((r) => setTimeout(r, 600));
  const res = await evalWithTimeout(DRAW, 90000);
  if (res?.exceptionDetails) throw new Error('绘制失败: ' + (res.exceptionDetails.text || ''));
  const out = res?.result?.value;
  if (!out) throw new Error('绘制失败');

  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
  const png = (S) => Buffer.from(out['i' + S], 'base64');

  fs.writeFileSync(path.join(ROOT, 'build', 'icon-preview.png'), Buffer.from(out.preview, 'base64'));
  console.log('[icon] 已生成预览 build/icon-preview.png');

  if (!APPLY) {
    console.log('[icon] （未加 --apply，仅出预览）');
    ws.close();
    kill();
    process.exit(0);
  }

  // ---- Windows 图标：多尺寸 ICO ----
  const ICO_SIZES = [16, 20, 24, 32, 48, 64, 128, 256];
  fs.writeFileSync(
    path.join(ROOT, 'build', 'icon.ico'),
    buildIco(ICO_SIZES.map((size) => ({ size, png: png(size) })))
  );
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.png'), png(256));
  fs.writeFileSync(path.join(ROOT, 'build', 'icon-256.png'), png(256));

  // ---- 清理历史产物（裸 glyph 时代的预览图 / AI 源图，已无参考价值） ----
  for (const stale of [
    'icon-minimal-preview.png', 'icon-explore.png', 'icon-explore2.png',
    'icon-compare.png', 'icon-zoom.png', 'icon-tray-zoom.png',
  ]) {
    try { fs.rmSync(path.join(ROOT, 'build', stale), { force: true }); } catch { /* ignore */ }
  }
  try { fs.rmSync(path.join(ROOT, 'build', 'icon-src'), { recursive: true, force: true }); } catch { /* ignore */ }

  // ---- 运行时资产 ----
  const mainAssets = path.join(ROOT, 'src', 'main', 'assets');
  const rendAssets = path.join(ROOT, 'src', 'renderer', 'assets');
  fs.mkdirSync(mainAssets, { recursive: true });
  fs.mkdirSync(rendAssets, { recursive: true });

  // 主进程：窗口图标用 256，托盘用 32（main.ts 会再 resize 到 16）
  fs.writeFileSync(path.join(mainAssets, 'icon.png'), png(256));
  fs.writeFileSync(path.join(mainAssets, 'tray.png'), png(32));
  // 渲染层顶栏 logo：显示尺寸 32px → 1x / 2x / 3x
  fs.writeFileSync(path.join(rendAssets, 'logo.png'), png(32));
  fs.writeFileSync(path.join(rendAssets, 'logo@2x.png'), png(64));
  fs.writeFileSync(path.join(rendAssets, 'logo@3x.png'), png(96));

  console.log('[icon] 已应用：build/icon.ico(16~256) / icon.png / icon-256.png / icon-preview.png');
  console.log('[icon] 已同步：src/main/assets/{icon,tray}.png、src/renderer/assets/logo{,@2x,@3x}.png');

  ws.close();
  kill();
  process.exit(0);
}

main().catch((e) => {
  console.error('图标生成失败:', e.message);
  process.exit(1);
});
