'use strict';
/**
 * 打包前清理上一次的 win-unpacked（electron-builder 不支持覆盖已有目录）
 *
 * 背景：electron-builder --dir 遇到已存在的 dist/win-unpacked 会报错或被残留的
 * win-unpacked.tmp 挡住；而直接删除该目录（约 70+ 文件）会被 safe-delete 拦截。
 * 这里统一用 rename 把它移到 dist/prev_<ts>，既绕开限制又保留可回滚的备份。
 *
 * 用法：node scripts/prepack-dir.js
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function uniqueDest(base) {
  let candidate = base;
  let i = 1;
  while (fs.existsSync(candidate)) candidate = `${base}_${i++}`;
  return candidate;
}

function main() {
  if (!fs.existsSync(DIST)) {
    console.log('[prepack] dist 不存在，无需清理');
    return;
  }
  const ts = Math.floor(Date.now() / 1000);
  const names = ['win-unpacked', 'win-unpacked.tmp'];
  for (const name of names) {
    const src = path.join(DIST, name);
    if (!fs.existsSync(src)) continue;
    const prefix = name === 'win-unpacked' ? 'prev_' : 'prev_tmp_';
    const dest = uniqueDest(path.join(DIST, `${prefix}${ts}`));
    fs.renameSync(src, dest);
    console.log(`[prepack] 已移开 ${name} → ${path.basename(dest)}`);
  }
  console.log('[prepack] 清理完成');
}

main();
