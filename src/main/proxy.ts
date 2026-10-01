/**
 * 代理解析（仅主进程使用，依赖 Electron）
 * - none：直连
 * - system：通过 Chromium 的代理解析（读取系统/环境代理设置）
 * - custom：用户填写的 HTTP 代理地址
 *
 * 说明：本应用只支持 HTTP(S) 代理（undici ProxyAgent 的能力边界）；
 * 若系统代理为 SOCKS，会退化为直连并在测试连接时给出提示。
 */
import { session } from 'electron';
import { ProxyAgent } from 'undici';
import type { AppSettings } from '../shared/types';

export interface ProxyResolution {
  /** 实际生效的代理地址（null = 直连） */
  url: string | null;
  /** 解析说明，用于界面提示 */
  note: string;
}

function normalizeProxyUrl(raw: string): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  return `http://${s}`;
}

/** 解析系统代理（Chromium 视角）：返回形如 "http://127.0.0.1:7890" */
async function resolveSystemProxy(targetUrl: string): Promise<ProxyResolution> {
  try {
    const raw = await session.defaultSession.resolveProxy(targetUrl);
    // 形如 "PROXY 127.0.0.1:7890;DIRECT" 或 "DIRECT" 或 "SOCKS5 127.0.0.1:1080"
    const first = String(raw || '')
      .split(';')
      .map((x) => x.trim())
      .filter(Boolean)[0];
    if (!first || /^DIRECT$/i.test(first)) return { url: null, note: 'direct' };
    const [kind, hostport] = first.split(/\s+/);
    if (/^PROXY$/i.test(kind) && hostport) return { url: `http://${hostport}`, note: 'system-http' };
    if (/^HTTPS$/i.test(kind) && hostport) return { url: `http://${hostport}`, note: 'system-http' };
    return { url: null, note: `unsupported:${kind}` };
  } catch {
    return { url: null, note: 'system-error' };
  }
}

/** 按设置解析出最终代理地址 */
export async function resolveProxy(
  settings: Pick<AppSettings, 'proxyMode' | 'proxyUrl'>,
  targetUrl: string
): Promise<ProxyResolution> {
  const mode = settings?.proxyMode || 'none';
  if (mode === 'custom') {
    const url = normalizeProxyUrl(settings.proxyUrl);
    return url ? { url, note: 'custom' } : { url: null, note: 'custom-empty' };
  }
  if (mode === 'system') return resolveSystemProxy(targetUrl);
  return { url: null, note: 'off' };
}

const agents = new Map<string, ProxyAgent>();

/** 取得（并缓存）代理 dispatcher；无代理时返回 undefined，由调用方直连 */
export function getDispatcher(proxyUrl: string | null): ProxyAgent | undefined {
  if (!proxyUrl) return undefined;
  let agent = agents.get(proxyUrl);
  if (!agent) {
    agent = new ProxyAgent(proxyUrl);
    agents.set(proxyUrl, agent);
  }
  return agent;
}
