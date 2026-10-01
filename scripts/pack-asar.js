'use strict';
/**
 * 重建应用 asar（按 package.json build.files 的清单）
 * 用于 CDN 不可达时跳过 electron 重新下载，直接刷新业务代码：
 *   node scripts/pack-asar.js && electron-builder --win --x64 --prepackaged dist/win-unpacked
 */
const asar = require('@electron/asar');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const target = path.join(ROOT, 'dist', 'win-unpacked', 'resources', 'app.asar');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const patterns = pkg.build.files;

/** 把 glob 清单展开为实际的 源->目标 复制项（支持目录通配与单层通配） */
function collect() {
  const items = [];
  for (const p of patterns) {
    if (p.includes('**')) {
      // 目录递归
      const dir = p.split('/**')[0];
      const abs = path.join(ROOT, dir);
      if (fs.existsSync(abs)) items.push({ from: abs, to: dir });
      continue;
    }
    if (p.includes('*')) {
      // 单层通配（如 src/renderer/*.*）：展开该目录下的文件
      const dir = path.dirname(p);
      const abs = path.join(ROOT, dir);
      if (!fs.existsSync(abs)) continue;
      for (const f of fs.readdirSync(abs)) {
        if (fs.statSync(path.join(abs, f)).isDirectory()) continue;
        items.push({ from: path.join(abs, f), to: path.join(dir, f) });
      }
      continue;
    }
    const abs = path.join(ROOT, p);
    if (fs.existsSync(abs)) items.push({ from: abs, to: p });
  }
  return items;
}

const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'aitodo-asar-'));
const items = collect();
for (const { from, to } of items) {
  fs.cpSync(from, path.join(staging, to), { recursive: true });
}

Promise.resolve(asar.createPackage(staging, target))
  .then(() => {
    const kb = (fs.statSync(target).size / 1024).toFixed(1);
    console.log(`app.asar 重建完成（${items.length} 项，${kb} KB）`);
    console.log(items.map((i) => '  · ' + i.to).join('\n'));
    fs.rmSync(staging, { recursive: true, force: true });
  })
  .catch((e) => {
    console.error('打包失败:', e.message);
    process.exit(1);
  });
