/**
 * 密码哈希与 ID 工具
 * scrypt 口令派生（当前应用免登录，仅保留工具能力），node:crypto 生成随机 ID。
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;

/** 生成密码哈希串，格式：scrypt$N$r$p$saltHex$hashHex */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(String(password), salt, KEY_LEN, {
    N,
    r: R,
    p: P,
    maxmem: 128 * N * R * 2,
  });
  return ['scrypt', N, R, P, salt.toString('hex'), key.toString('hex')].join('$');
}

/** 校验密码是否正确 */
export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltHex, keyHex] = parts;
    const expected = Buffer.from(keyHex, 'hex');
    const actual = scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 128 * Number(n) * Number(r) * 2,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** 生成随机会话令牌 */
export function createToken(): string {
  return randomBytes(32).toString('hex');
}

/** 生成唯一 ID */
export function createId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`;
}
