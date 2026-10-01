'use strict';
/**
 * 开发启动器
 * 某些宿主环境（如集成终端）会注入 ELECTRON_RUN_AS_NODE=1，
 * 这会让 electron.exe 退化成普通 node 进程，导致 app 未定义而崩溃。
 * 这里统一清理该变量后再启动。
 */
const { spawn } = require('node:child_process');

const electronBin = require('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = ['.'].concat(process.argv.slice(2));
const child = spawn(electronBin, args, { stdio: 'inherit', env, cwd: process.cwd() });
child.on('exit', (code) => process.exit(code === null ? 0 : code));
