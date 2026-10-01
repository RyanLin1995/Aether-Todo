'use strict';
/**
 * 写入 exe 资源：应用图标 + 版本信息（纯 JS，无需 rcedit / 网络）
 *
 * 背景：win.signAndEditExecutable=false（规避签名环境问题）且使用 --prepackaged 打包时，
 * electron-builder 不会改写 exe 资源，图标会停留在 Electron 默认图标。
 * 本脚本在 NSIS 打包前直接修改 dist/win-unpacked 中的 exe。
 *
 * 用法：node scripts/pack-exe.js
 */
const fs = require('node:fs');
const path = require('node:path');
const ResEdit = require('resedit');

const ROOT = path.join(__dirname, '..');
const ICO = path.join(ROOT, 'build', 'icon.ico');
const EXE = path.join(ROOT, 'dist', 'win-unpacked', 'Aether Todo.exe');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function main() {
  if (!fs.existsSync(EXE)) throw new Error(`未找到目标 exe：${EXE}（请先解压出 win-unpacked）`);
  if (!fs.existsSync(ICO)) throw new Error(`未找到图标：${ICO}`);

  const exe = ResEdit.NtExecutable.from(fs.readFileSync(EXE));
  const res = ResEdit.NtExecutableResource.from(exe);

  // ---- 图标：替换所有尺寸 ----
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(ICO));
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    1, // Electron 主图标组 ID
    1033,
    iconFile.icons.map((i) => i.data)
  );

  // ---- 版本信息 ----
  const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (viList.length) {
    const vi = viList[0];
    const langs = vi.getAllLanguagesForStringValues();
    const lang = langs.length ? langs[0] : { lang: 1033, codepage: 1200 };
    vi.setStringValues(lang, {
      ProductName: 'Aether Todo',
      FileDescription: 'Aether Todo - Liquid Glass AI Task Assistant',
      CompanyName: 'Aether Todo Contributors',
      LegalCopyright: 'Apache-2.0',
      OriginalFilename: path.basename(EXE),
      InternalName: 'aether-todo',
    });
    vi.setFileVersion(
      Number(pkg.version.split('.')[0] || 1),
      Number(pkg.version.split('.')[1] || 0),
      Number(pkg.version.split('.')[2] || 0),
      0
    );
    vi.setProductVersion(
      Number(pkg.version.split('.')[0] || 1),
      Number(pkg.version.split('.')[1] || 0),
      Number(pkg.version.split('.')[2] || 0),
      0
    );
    vi.outputToResourceEntries(res.entries);
  }

  res.outputResource(exe);
  fs.writeFileSync(EXE, Buffer.from(exe.generate()));
  console.log(`已写入 exe 资源：图标（${iconFile.icons.length} 尺寸）+ 版本信息 -> ${path.relative(ROOT, EXE)}`);
}

main();
