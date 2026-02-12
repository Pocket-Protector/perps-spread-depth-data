import type { ExchangeKey } from '../types.js';

const PROXIED_EXCHANGES = new Set<ExchangeKey>(['binance', 'bybit']);

/**
 * Returns proxy prefix from environment, if configured.
 * Priority: HTTP_PROXY_PREFIX -> NEXT_PUBLIC_HTTP_PROXY_PREFIX.
 */
export function getHttpProxyPrefix(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.HTTP_PROXY_PREFIX ?? env.NEXT_PUBLIC_HTTP_PROXY_PREFIX;
  if (!raw) return null;

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Build exchange request URL with optional proxy wrapping.
 * Supports either:
 *   - prefix style: "https://proxy/?url=" + encodeURIComponent(target)
 *   - template style: "https://proxy/?target={url}"
 */
export function buildExchangeRequestUrl(
  exchange: ExchangeKey,
  targetUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const prefix = getHttpProxyPrefix(env);
  if (!prefix || !PROXIED_EXCHANGES.has(exchange)) {
    return targetUrl;
  }

  const encodedTarget = encodeURIComponent(targetUrl);
  if (prefix.includes('{url}')) {
    return prefix.replace('{url}', encodedTarget);
  }

  return `${prefix}${encodedTarget}`;
}
