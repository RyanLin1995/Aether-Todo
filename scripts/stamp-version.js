'use strict';
/**
 * 给渲染层静态资源加版本号查询串（缓存 busting）
 *
 * 背景：页面走 file:// 加载 src/renderer-dist 下的 css/js，Chromium 会缓存这些子资源，
 * 升级安装后可能命中旧副本，表现为「装了新版但样式没变」。
 * 这里在构建后把资源引用改写为 `styles.css?v=<package.version>`，配合主进程版本变化时
 * 的 clearCache，双保险。
 *
 * 幂等：重复执行不会叠加多个 ?v=。
 *
 * 用法：node scripts/stamp-version.js
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;

const TARGETS = ['src/renderer/index.html', 'src/renderer/float.html', 'src/renderer/notify.html'];
// 只处理指向 renderer-dist 构建产物的 css/js 引用
const REF_RE = /((?:href|src)=")(\.\.\/renderer-dist\/[^"#?]+\.(?:css|js))(?:[?#][^"]*)?(")/g;

function main() {
  console.log(`[stamp] package version = ${VERSION}`);
  for (const rel of TARGETS) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) {
      console.warn(`[stamp] 跳过（文件不存在）：${rel}`);
      continue;
    }
    const before = fs.readFileSync(file, 'utf8');
    const after = before.replace(REF_RE, (_m, head, url, tail) => `${head}${url}?v=${VERSION}${tail}`);
    if (before === after) {
      console.log(`[stamp] ${rel} 无需变更`);
      continue;
    }
    fs.writeFileSync(file, after);
    const n = (after.match(REF_RE) || []).length;
    console.log(`[stamp] ${rel} 已写入 ${n} 处 ?v=${VERSION}`);
  }
}

main();
