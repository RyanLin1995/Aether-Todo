'use strict';
/**
 * 图标生成（矢量重绘版）：不再依赖 AI 位图 + 逐级降采样。
 *
 * 相比旧 make-icon.js 的关键改进：
 *   旧：256px 位图 → 降采样到 16px（缩小 16 倍，边缘细节必然被平均掉，托盘图标发糊）
 *   新：每个尺寸「原生矢量绘制」+ 4 倍超采样后一次性缩放，边缘数学精确，16px 依然锐利。
 *
 * 风格：扁平线性 —— 无发光、无烟雾、无玻璃高光，仅「渐变圆角方块 + 白色 glyph」。
 * 语义：待办清单（对勾 + 清单线），一眼可辨。
 *
 * 用法：
 *   node scripts/make-icon-v2.js <variant> [--apply]
 *   variant: 1 | 2 | 3      --apply: 写入 build/ 与 src 各 assets 目录（默认只出预览图）
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
// 端口用 0 让系统分配空闲端口，避免与上轮残留实例的固定端口冲突
let PORT = 0;
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aitodo-icon-v2-'));
const PAGE = path.join(USER_DATA, 'icon.html');

const VARIANT = Number(process.argv[2] || 2);
const APPLY = process.argv.includes('--apply');
if (![1, 2, 3, 10, 11, 12, 13].includes(VARIANT)) throw new Error('variant 必须是 1/2/3 或 10/11/12/13');

fs.writeFileSync(PAGE, '<!doctype html><meta charset="utf-8"><body></body>');

/* ------------------------------------------------------------------ *
 * 浏览器内绘制代码（注入到 Electron 渲染进程执行）
 * 设计栅格统一用 1024×1024 逻辑单位，按目标尺寸等比缩放。
 * ------------------------------------------------------------------ */
const DRAW = `
(() => {
  const G = 1024;
  const R = 228;                       // 圆角 = 22.3%（对齐主流应用图标比例）

  const BRAND = [[0.00, '#2DD4BF'], [0.50, '#4E8CF5'], [1.00, '#7C5CFF']]; // 青 → 蓝 → 紫
  const DARKBG = ['#12141C', '#1A1D2B'];

  /* 变体 1 的细度梯度：勾线越细、勾越小 → 越透气、越"简" */
  const V1 = [
    { key: '1a', w: 132, s: 1.00, label: '1a 粗 · 当前' },
    { key: '1b', w: 104, s: 0.86, label: '1b 中 · 收小' },
    { key: '1c', w: 88, s: 0.74, label: '1c 细 · 呼吸感' },
    { key: '1d', w: 76, s: 0.64, label: '1d 极细 · 极简' },
  ];

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }


  function brand(ctx) {
    const g = ctx.createLinearGradient(0, 0, G, G);
    for (const [p, c] of BRAND) g.addColorStop(p, c);
    return g;
  }

  // 描一条对勾：pts = [x1,y1, x2,y2, x3,y3]，w = 线宽
  function tick(ctx, pts, w, style) {
    ctx.save();
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    ctx.lineTo(pts[2], pts[3]);
    ctx.lineTo(pts[4], pts[5]);
    ctx.stroke();
    ctx.restore();
  }

  // 描一条清单横线
  function rule(ctx, x1, y, x2, w, style) {
    ctx.save();
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();
    ctx.restore();
  }

  // 变体 1 的对勾：以画布中心为锚点，按 s 缩放 + 以 w 为线宽
  function tickOnly(ctx, w, s) {
    const cx = G / 2, cy = G / 2;
    // 基准勾形（占位 1.0 时）
    const P = [292, 525, 447, 680, 732, 345];
    const pts = [];
    for (let i = 0; i < 6; i += 2) {
      pts.push(cx + (P[i] - cx) * s, cy + (P[i + 1] - cy) * s);
    }
    tick(ctx, pts, w, '#FFFFFF');
  }

  function drawIcon(ctx, S, variant) {
    const k = S / G;
    ctx.save();
    ctx.scale(k, k);
    ctx.clearRect(0, 0, G, G);

    // ---- 底板 ----
    if (variant === 3) {
      const g = ctx.createLinearGradient(0, 0, G * 0.6, G);
      g.addColorStop(0, DARKBG[0]);
      g.addColorStop(1, DARKBG[1]);
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = brand(ctx);
    }
    rr(ctx, 0, 0, G, G, R);
    ctx.fill();

    // ---- glyph ----
    if (variant >= 10) {
      // 变体 1 细度梯度：10=1a, 11=1b, 12=1c, 13=1d
      const cfg = V1[variant - 10];
      tickOnly(ctx, cfg.w, cfg.s);

    } else if (variant === 1) {
      tickOnly(ctx, 132, 1.0);

    } else if (variant === 2) {
      // 清单语义：左侧一个对勾（已完成项）+ 右侧三条等长清单线
      tick(ctx, [248, 512, 352, 616, 528, 384], 100, '#FFFFFF');
      rule(ctx, 596, 384, 800, 84, 'rgba(255,255,255,0.95)');
      rule(ctx, 596, 512, 800, 84, 'rgba(255,255,255,0.72)');
      rule(ctx, 596, 640, 800, 84, 'rgba(255,255,255,0.72)');

    } else {
      // 暗色版：深底 + 渐变 glyph（与软件暗色主题呼应）
      const fg = brand(ctx);
      tick(ctx, [248, 512, 352, 616, 528, 384], 100, fg);
      rule(ctx, 596, 384, 800, 84, fg);
      const fg2 = ctx.createLinearGradient(596, 0, 800, 0);
      fg2.addColorStop(0, '#8B7BFF');
      fg2.addColorStop(1, '#3FD8C4');
      rule(ctx, 596, 512, 800, 84, fg2);
      const fg3 = ctx.createLinearGradient(596, 0, 800, 0);
      fg3.addColorStop(0, '#6E86F0');
      fg3.addColorStop(1, '#2BB9C8');
      rule(ctx, 596, 640, 800, 84, fg3);
    }

    ctx.restore();
  }

  // 超采样系数：小尺寸多采几倍，保证缩放后边缘干净
  const ssOf = (S) => (S <= 64 ? 4 : S <= 128 ? 2 : 1);

  function render(variant, S) {
    const ss = ssOf(S);
    const big = document.createElement('canvas');
    big.width = big.height = S * ss;
    drawIcon(big.getContext('2d'), S * ss, variant);

    const out = document.createElement('canvas');
    out.width = out.height = S;
    const c = out.getContext('2d');
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(big, 0, 0, S * ss, S * ss, 0, 0, S, S);
    return out;
  }

  // ---------- 导出全部变体 × 多尺寸 ----------
  // 关键：全部同步渲染 + 56 次 toDataURL 会让 CDP 的 Runtime.evaluate 阻塞到超时。
  // 所以这里只导出「落盘真正需要的尺寸」，512/48/24 跳过（应用侧不引用）。
  const SIZES = [16, 32, 64, 128, 256];
  const VARIANTS = [1, 2, 3, 10, 11, 12, 13];
  const out = { sizes: SIZES };
  for (const v of VARIANTS) {
    for (const S of SIZES) out['v' + v + '_i' + S] = render(v, S).toDataURL('image/png').split(',')[1];
  }

  // ---------- 预览对比图（复用已渲染结果，避免重复计算） ----------
  (() => {
    const ROWS = [
      { v: 10, name: '1a 粗 132 · 占位 100%' },
      { v: 11, name: '1b 中 104 · 占位 86%' },
      { v: 12, name: '1c 细 88 · 占位 74%' },
      { v: 13, name: '1d 极细 76 · 占位 64%' },
    ];
    const CELL = 250;
    const PAD = 30, GAP = 20, HEAD = 52;
    const SCALE = 2;
    const SHOW = { 16: 4, 32: 3, 64: 2, 256: 1 };
    const COLS = [
      { label: '16px 托盘 ×4', S: 16 },
      { label: '32px 任务栏 ×3', S: 32 },
      { label: '64px 顶栏 ×2', S: 64 },
      { label: '256px 主图标', S: 256 },
    ];
    const W = PAD * 2 + COLS.length * (CELL * SCALE + GAP) - GAP;
    const rowH = HEAD + CELL * SCALE;
    const H = PAD * 2 + ROWS.length * (rowH + GAP) - GAP;

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.fillStyle = '#EDEEF2';
    c.fillRect(0, 0, W, H);
    c.textBaseline = 'middle';

    // 预览直接复用已渲染的 canvas（render 带缓存），避免重复计算与异步解码
    const cache = {};
    const cvOf = (v, S) => (cache[v + '_' + S] ||= render(v, S));

    ROWS.forEach((row, r) => {
      const y0 = PAD + r * (rowH + GAP);

      c.textAlign = 'left';
      c.fillStyle = '#15171F';
      c.font = '600 20px sans-serif';
      c.fillText(row.name, PAD, y0 + 16);

      COLS.forEach((col, ci) => {
        const gx = PAD + ci * (CELL * SCALE + GAP);
        const d = CELL * SCALE;

        c.textAlign = 'center';
        c.fillStyle = '#5A5F6E';
        c.font = '500 15px sans-serif';
        c.fillText(col.label, gx + d / 2, y0 + HEAD - 16);

        c.save();
        c.translate(gx, y0 + HEAD);
        c.fillStyle = '#FFFFFF';
        c.fillRect(0, 0, d, d);
        c.strokeStyle = '#D6D9E0';
        c.lineWidth = 1;
        c.strokeRect(0.5, 0.5, d - 1, d - 1);

        const k = SHOW[col.S] * SCALE;
        const dw = col.S * k;
        c.imageSmoothingEnabled = true;
        c.imageSmoothingQuality = 'high';
        c.drawImage(cvOf(row.v, col.S), (d - dw) / 2, (d - dw) / 2, dw, dw);
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
  const log = (...a) => console.log('[icon-v2]', ...a);
  log('启动 Electron，user-data-dir=' + USER_DATA);

  const child = spawn(
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    [PAGE, '--remote-debugging-port=' + PORT, '--user-data-dir=' + USER_DATA, '--no-sandbox', '--disable-gpu'],
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
    // 端口为 0 时由系统分配，从 DevToolsActivePort 文件读回实际值
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
    } else if (i % 10 === 0) {
      log('等待 DevToolsActivePort …（第 ' + i + ' 次轮询）');
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

  // 带超时的 evaluate：渲染是同步重活，缺兜底会无限挂起
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

  // 预览对比图（始终产出，供肉眼选型）
  fs.writeFileSync(path.join(ROOT, 'build', 'icon-preview.png'), png('preview'));
  console.log('已生成预览：build/icon-preview.png');

  if (!APPLY) {
    console.log('（未加 --apply，仅出预览，未覆盖现有图标）');
    ws.close();
    kill();
    process.exit(0);
  }

  const v = VARIANT;
  const get = (S) => png(`v${v}_i${S}`);

  const entries = [16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: get(size) }));
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), buildIco(entries));
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.png'), get(256));
  fs.writeFileSync(path.join(ROOT, 'build', 'icon-256.png'), get(256));
  fs.writeFileSync(path.join(ROOT, 'build', 'tray.png'), get(32));

  const mainAssets = path.join(ROOT, 'src', 'main', 'assets');
  const rendAssets = path.join(ROOT, 'src', 'renderer', 'assets');
  fs.mkdirSync(mainAssets, { recursive: true });
  fs.mkdirSync(rendAssets, { recursive: true });
  fs.writeFileSync(path.join(mainAssets, 'icon.png'), get(256));
  fs.writeFileSync(path.join(mainAssets, 'tray.png'), get(32));
  fs.writeFileSync(path.join(rendAssets, 'logo.png'), get(64));
  fs.writeFileSync(path.join(rendAssets, 'logo@2x.png'), get(128));

  console.log(`已应用变体 ${v}：build/icon.ico(16~256) / icon.png / icon-256.png / tray.png`);
  console.log('已同步 src/main/assets/{icon,tray}.png、src/renderer/assets/logo{,\u00402x}.png');

  ws.close();
  kill();
  process.exit(0);
}

main().catch((e) => {
  console.error('图标生成失败:', e.message);
  process.exit(1);
});
