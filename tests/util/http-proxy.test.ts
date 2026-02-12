import { describe, it, expect } from 'vitest';
import { getHttpProxyPrefix, buildExchangeRequestUrl } from '../../src/util/http-proxy.js';

describe('getHttpProxyPrefix', () => {
  it('prefers HTTP_PROXY_PREFIX over NEXT_PUBLIC_HTTP_PROXY_PREFIX', () => {
    const prefix = getHttpProxyPrefix({
      HTTP_PROXY_PREFIX: 'https://proxy-a.example/?url=',
      NEXT_PUBLIC_HTTP_PROXY_PREFIX: 'https://proxy-b.example/?url=',
    });

    expect(prefix).toBe('https://proxy-a.example/?url=');
  });

  it('returns null when prefix is empty or missing', () => {
    expect(getHttpProxyPrefix({ HTTP_PROXY_PREFIX: '   ' })).toBeNull();
    expect(getHttpProxyPrefix({})).toBeNull();
  });
});

describe('buildExchangeRequestUrl', () => {
  const target = 'https://api.bybit.com/v5/market/orderbook?category=linear&symbol=BTCUSDT&limit=1000';
  const encoded = encodeURIComponent(target);

  it('wraps Binance and Bybit requests when prefix exists', () => {
    const env = { HTTP_PROXY_PREFIX: 'https://proxy.example/?url=' };

    expect(buildExchangeRequestUrl('binance', target, env)).toBe(`https://proxy.example/?url=${encoded}`);
    expect(buildExchangeRequestUrl('bybit', target, env)).toBe(`https://proxy.example/?url=${encoded}`);
  });

  it('does not wrap non-target exchanges', () => {
    const env = { HTTP_PROXY_PREFIX: 'https://proxy.example/?url=' };

    expect(buildExchangeRequestUrl('hyperliquid', target, env)).toBe(target);
    expect(buildExchangeRequestUrl('asterdex', target, env)).toBe(target);
  });

  it('supports template-style proxy prefixes', () => {
    const env = { HTTP_PROXY_PREFIX: 'https://proxy.example/?target={url}' };

    expect(buildExchangeRequestUrl('bybit', target, env)).toBe(`https://proxy.example/?target=${encoded}`);
  });
});
