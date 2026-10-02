'use strict';
/**
 * 图标生成 · 裸 glyph 极简线稿版（make-icon-v2.js 的姊妹脚本）
 *
 * 设计参考：现代应用图标风格（OpenAI / X / Anthropic / Perplexity 一类）
 *   ① 无底板 —— 透明背景，glyph 直接坐在画布上（不是"方块里放个符号"）
 *   ② 细等宽线条 —— 统一线宽，圆头圆角
 *   ③ 单色或紧双色 —— 不用霓虹、不用发光、不用玻璃高光
 *   ④ 大留白 —— glyph 占画布约 60~66%，四周留足呼吸空间
 *
 * 与 v2 的关键差异：
 *   v2  = 圆角方块底板 + 白色 glyph（App 传统范式，底板承载识别）
 *   本脚本 = 透明底 + 彩色/深色线条 glyph（现代品牌范式，线条本身即识别）
 *
 * 用法：
 *   node scripts/make-icon-minimal.js <variant> [--apply]
 *   variant: 1..6      --apply: 写入 build/ 与 src 各 assets（默认只出预览）
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
let PORT = 0;
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aitodo-icon-min-'));
const PAGE = path.join(USER_DATA, 'icon.html');

const VARIANT = Number(process.argv[2] || 1);
const APPLY = process.argv.includes('--apply');
const VARIANTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
if (!VARIANTS.includes(VARIANT)) throw new Error('variant 必须是 1..9');

fs.writeFileSync(PAGE, '<!doctype html><meta charset="utf-8"><body></body>');

/* ------------------------------------------------------------------ *
 * 浏览器内绘制代码
 * 逻辑栅格 1024×1024。裸 glyph 无底板，故需同时在浅/深背景上验证。
 * ------------------------------------------------------------------ */
const DRAW = `
(() => {
  const G = 1024;
  const C = G / 2;

  // 品牌色（沿用软件内青绿→蓝紫）
  const TEAL   = '#12B5A0';
  const BLUE   = '#3B7BF0';
  const VIOLET = '#7B5CF0';

  function duo(ctx, a, b, ang) {
    const r = Math.SQRT2 * G / 2;
    const g = ctx.createLinearGradient(
      C - Math.cos(ang) * r, C - Math.sin(ang) * r,
      C + Math.cos(ang) * r, C + Math.sin(ang) * r
    );
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    return g;
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

  // 折线对勾（几何化：短臂陡、长臂缓，接近等宽线稿的标准勾）
  function tickPath(ctx, cx, cy, s) {
    ctx.beginPath();
    ctx.moveTo(cx - 300 * s, cy + 10 * s);
    ctx.lineTo(cx - 110 * s, cy + 190 * s);
    ctx.lineTo(cx + 300 * s, cy - 190 * s);
  }

  /* 光学补偿（optical sizing）：
   * 细线风格在 16px 会塌掉 —— 线宽 46 在 1024 栅格上缩到 16px 仅剩 0.72px。
   * 业界通法：小尺寸按倍率加粗，同时略微收紧留白，让小图标"看起来"一样重。
   * 这不是简单缩放，是让各尺寸的视觉重量一致。 */
  function weightBoost(S) {
    if (S <= 24) return 1.52;
    if (S <= 32) return 1.36;
    if (S <= 48) return 1.18;
    if (S <= 64) return 1.08;
    return 1.0;
  }

  function line(ctx, x1, y, x2, w, style) {
    stroke(ctx, (c) => {
      c.beginPath();
      c.moveTo(x1, y);
      c.lineTo(x2, y);
    }, w, style);
  }

  /* ---------------- 六个变体 ---------------- *
   * 全部无底板；差异在「线条粗细 × 配色 × 语义符号」
   */
  function draw(ctx, S, v, dark, mode) {
    const k = S / G;
    ctx.save();
    ctx.scale(k, k);
    ctx.clearRect(0, 0, G, G);

    // 次级信息线：浅底用深墨，深底用浅灰，保证两种桌面背景下都可见
    // tray 模式：Windows 托盘图标不随系统反色，必须用不透明色，否则深色任务栏上消失
    const MUTED = mode === 'tray' ? '#79808F' : dark ? 'rgba(233,236,244,0.44)' : 'rgba(20,22,30,0.30)';
    const ink = duo(ctx, TEAL, VIOLET, Math.PI / 4);
    const W = 48 * weightBoost(S);      // 光学补偿后的线宽

    switch (v) {
      // 4 对勾 + 三条清单线（原版，保留作对照基准）
      case 4: {
        stroke(ctx, (c) => tickPath(c, C - 178, C, 0.32), W, ink);
        line(ctx, C - 8, C - 168, C + 268, W, ink);
        line(ctx, C - 8, C, C + 268, W, MUTED);
        line(ctx, C - 8, C + 168, C + 268, W, MUTED);
        break;
      }

      // 7 优化：勾放大与三行等高、行距收紧、末行短一截形成节奏
      case 7: {
        const SP = 132;
        stroke(ctx, (c) => tickPath(c, C - 196, C, 0.40), W, ink);
        line(ctx, C - 12, C - SP, C + 276, W, ink);
        line(ctx, C - 12, C, C + 276, W, MUTED);
        line(ctx, C - 12, C + SP, C + 186, W, MUTED);
        break;
      }

      // 8 优化：三行严格等宽等距，勾垂直居中对齐中行（最规整）
      case 8: {
        const SP = 128;
        line(ctx, C + 4, C - SP, C + 292, W, ink);
        line(ctx, C + 4, C, C + 292, W, MUTED);
        line(ctx, C + 4, C + SP, C + 292, W, MUTED);
        stroke(ctx, (c) => tickPath(c, C - 214, C, 0.385), W, ink);
        break;
      }

      // 9 优化：整体收窄，接近正方，紧凑不失呼吸（最接近参考图比例）
      case 9: {
        const SP = 122;
        line(ctx, C + 24, C - SP, C + 272, W, ink);
        line(ctx, C + 24, C, C + 272, W, MUTED);
        line(ctx, C + 24, C + SP, C + 272, W, MUTED);
        stroke(ctx, (c) => tickPath(c, C - 186, C, 0.365), W, ink);
        break;
      }

      // 1 单色对勾 · 细线（最简）
      case 1:
        stroke(ctx, (c) => tickPath(c, C, C, 0.62), 68 * weightBoost(S), ink);
        break;

      // 2 单色对勾 · 极细（大留白）
      case 2:
        stroke(ctx, (c) => tickPath(c, C, C, 0.56), 54 * weightBoost(S), ink);
        break;

      // 3 对勾 + 两条清单线（待办语义，线条统一等宽）
      case 3: {
        const w3 = 52 * weightBoost(S);
        stroke(ctx, (c) => tickPath(c, C - 158, C - 6, 0.36), w3, ink);
        line(ctx, C + 10, C - 108, C + 268, w3, ink);
        line(ctx, C + 10, C + 84, C + 268, w3, MUTED);
        break;
      }

      // 5 双色对勾（青→紫，笔画本身带渐变，最有品牌感）
      case 5:
        stroke(ctx, (c) => tickPath(c, C, C, 0.66), 76 * weightBoost(S), ink);
        break;

      // 6 对勾 + 圆点清单（另一种待办语汇：点代替横线）
      case 6: {
        const w6 = 52 * weightBoost(S);
        stroke(ctx, (c) => tickPath(c, C - 158, C, 0.36), w6, ink);
        for (const y of [C - 168, C, C + 168]) {
          ctx.beginPath();
          ctx.arc(C + 168, y, 38 * weightBoost(S), 0, Math.PI * 2);
          ctx.fillStyle = y === C - 168 ? ink : MUTED;
          ctx.fill();
        }
        break;
      }
    }
    ctx.restore();
  }

  const ssOf = (S) => (S <= 64 ? 4 : S <= 128 ? 2 : 1);

  function render(v, S, dark, mode) {
    const ss = ssOf(S);
    const big = document.createElement('canvas');
    big.width = big.height = S * ss;
    draw(big.getContext('2d'), S * ss, v, dark, mode);

    const out = document.createElement('canvas');
    out.width = out.height = S;
    const c = out.getContext('2d');
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(big, 0, 0, S * ss, S * ss, 0, 0, S, S);
    return out;
  }

  const SIZES = [16, 24, 32, 48, 64, 128, 256];
  const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const out = { sizes: SIZES };
  for (const v of ALL) {
    for (const S of SIZES) {
      out['v' + v + '_i' + S] = render(v, S, false).toDataURL('image/png').split(',')[1];
      // 托盘专用高对比版（不透明次级线，深色任务栏可见）
      out['tray' + v + '_i' + S] = render(v, S, true, 'tray').toDataURL('image/png').split(',')[1];
    }
  }

  // ---------- 预览：聚焦 4/7/8/9（原版 + 三个优化版） ----------
  (() => {
    const ROWS = [
      { v: 4, name: '4 原版（勾偏小 / 行距松 / 16px 偏弱）' },
      { v: 7, name: '7 优化 · 勾放大 + 行距收紧 + 末行短一截' },
      { v: 8, name: '8 优化 · 三行等宽等距 + 勾居中对齐' },
      { v: 9, name: '9 优化 · 整体收窄，最接近参考图比例' },
    ];
    const COLS = [
      { label: '16px 托盘', S: 16, bg: '#F2F3F6' },
      { label: '32px 任务栏', S: 32, bg: '#F2F3F6' },
      { label: '64px 顶栏', S: 64, bg: '#F2F3F6' },
      { label: '256px 主图标', S: 256, bg: '#F2F3F6' },
      { label: '16px 深底', S: 16, bg: '#1B1E28', dark: true },
      { label: '32px 深底', S: 32, bg: '#1B1E28', dark: true },
      { label: '64px 深底', S: 64, bg: '#1B1E28', dark: true },
      { label: '256px 深底', S: 256, bg: '#1B1E28', dark: true },
    ];
    const CELL = 190, PAD = 30, GAP = 16, HEAD = 50, SCALE = 2;
    // 统一把所有尺寸放大到同一视觉大小（约 150px），公平判断小尺寸是否还认得出
    const TARGET = 150;
    const W = PAD * 2 + COLS.length * (CELL * SCALE + GAP) - GAP;
    const rowH = HEAD + CELL * SCALE;
    const H = PAD * 2 + ROWS.length * (rowH + GAP) - GAP;

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.fillStyle = '#EDEEF2';
    c.fillRect(0, 0, W, H);
    c.textBaseline = 'middle';

    ROWS.forEach((row, ri) => {
      const y0 = PAD + ri * (rowH + GAP);
      c.textAlign = 'left';
      c.fillStyle = ri === 0 ? '#8A8F9C' : '#15171F';
      c.font = '600 19px sans-serif';
      c.fillText(row.name, PAD, y0 + 15);

      COLS.forEach((col, ci) => {
        const gx = PAD + ci * (CELL * SCALE + GAP);
        const d = CELL * SCALE;
        c.textAlign = 'center';
        c.fillStyle = '#5A5F6E';
        c.font = '500 14px sans-serif';
        c.fillText(col.label + ' →' + TARGET + 'px', gx + d / 2, y0 + HEAD - 15);

        c.save();
        c.translate(gx, y0 + HEAD);
        c.fillStyle = col.bg;
        c.fillRect(0, 0, d, d);
        c.strokeStyle = '#C9CDD6';
        c.lineWidth = 1;
        c.strokeRect(0.5, 0.5, d - 1, d - 1);

        const dw = TARGET * SCALE;
        c.imageSmoothingEnabled = true;
        c.imageSmoothingQuality = 'high';
        c.drawImage(render(row.v, col.S, !!col.dark), (d - dw) / 2, (d - dw) / 2, dw, dw);
        c.restore();
      });
    });
    out.preview = cv.toDataURL('image/png').split(',')[1];
  })();

  return out;
})()
`;

/* ------------------------------------------------------------------ */

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
  const log = (...a) => console.log('[icon-min]', ...a);

  const child = spawn(
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    [PAGE, '--remote-debugging-port=0', '--user-data-dir=' + USER_DATA, '--no-sandbox', '--disable-gpu'],
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
      } catch {
        /* ignore */
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  if (!page) throw new Error('Electron 页面未就绪（PORT=' + PORT + '）');
  log('CDP 就绪，PORT=' + PORT);

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
  const evaluateWithTimeout = (expression, ms) =>
    Promise.race([
      send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('渲染超时（' + ms + 'ms）')), ms)),
    ]);

  await send('Runtime.enable');
  await new Promise((r) => setTimeout(r, 600));
  const res = await evaluateWithTimeout(DRAW, 60000);
  if (res?.exceptionDetails) throw new Error('绘制失败: ' + (res.exceptionDetails.text || ''));
  const out = res?.result?.value;
  if (!out) throw new Error('绘制失败');

  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
  const png = (k) => Buffer.from(out[k], 'base64');

  fs.writeFileSync(path.join(ROOT, 'build', 'icon-minimal-preview.png'), png('preview'));
  log('已生成预览：build/icon-minimal-preview.png');

  if (!APPLY) {
    log('（未加 --apply，仅出预览）');
    ws.close();
    kill();
    process.exit(0);
  }

  const v = VARIANT;
  const get = (S) => png(`v${v}_i${S}`);
  // 托盘专用：高对比不透明次级线（Windows 托盘不随系统反色）
  const getTray = (S) => png(`tray${v}_i${S}`);

  const entries = [16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: get(size) }));
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), buildIco(entries));
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.png'), get(256));
  fs.writeFileSync(path.join(ROOT, 'build', 'icon-256.png'), get(256));
  fs.writeFileSync(path.join(ROOT, 'build', 'tray.png'), getTray(32));

  const mainAssets = path.join(ROOT, 'src', 'main', 'assets');
  const rendAssets = path.join(ROOT, 'src', 'renderer', 'assets');
  fs.mkdirSync(mainAssets, { recursive: true });
  fs.mkdirSync(rendAssets, { recursive: true });
  fs.writeFileSync(path.join(mainAssets, 'icon.png'), get(256));
  fs.writeFileSync(path.join(mainAssets, 'tray.png'), getTray(32));
  fs.writeFileSync(path.join(rendAssets, 'logo.png'), get(64));
  fs.writeFileSync(path.join(rendAssets, 'logo@2x.png'), get(128));

  log(`已应用变体 ${v}：build/icon.ico(16~256) / icon.png / icon-256.png / tray.png`);
  log('已同步 src/main/assets/{icon,tray}.png、src/renderer/assets/logo{,\u00402x}.png');

  ws.close();
  kill();
  process.exit(0);
}

main().catch((e) => {
  console.error('图标生成失败:', e.message);
  process.exit(1);
});
