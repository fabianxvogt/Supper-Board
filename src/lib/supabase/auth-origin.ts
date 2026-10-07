import 'server-only';

type RequestHeaders = { get(name: string): string | null };

function parseTrustedOrigin(value: string): URL | null {
  try {
    const url = new URL(value);
    const localHttp = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password || url.hostname.includes('*')) return null;
    if (url.protocol !== 'https:' && !localHttp) return null;
    return url;
  } catch {
    return null;
  }
}

export function trustedRequestOrigin(requestHeaders: RequestHeaders): string | null {
  const configuredValue = process.env.AUTH_TRUSTED_ORIGIN;
  if (process.env.NODE_ENV === 'production' && !configuredValue) return null;
  const configuredOrigin = configuredValue ? parseTrustedOrigin(configuredValue) : null;
  if (configuredValue && !configuredOrigin) return null;

  const forwardedHost = requestHeaders.get('x-forwarded-host')?.split(',')[0]?.trim();
  const requestHost = forwardedHost || requestHeaders.get('host')?.trim();
  if (!requestHost || requestHost.includes(',')) return null;

  const forwardedProtocol = requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  let protocol = forwardedProtocol;
  if (!protocol && configuredOrigin) protocol = configuredOrigin.protocol.slice(0, -1);
  if (!protocol) {
    try {
      const localHost = new URL(`http://${requestHost}`);
      if (localHost.hostname !== 'localhost' && localHost.hostname !== '127.0.0.1') return null;
      protocol = 'http';
    } catch {
      return null;
    }
  }
  if (protocol !== 'http' && protocol !== 'https') return null;

  const requestOrigin = parseTrustedOrigin(`${protocol}://${requestHost}`);
  if (!requestOrigin || (configuredOrigin && requestOrigin.origin !== configuredOrigin.origin)) return null;
  return requestOrigin.origin;
}

export function trustedBrowserOrigin(requestHeaders: RequestHeaders): string | null {
  const browserOriginHeader = requestHeaders.get('origin');
  if (!browserOriginHeader) return null;

  const browserOrigin = parseTrustedOrigin(browserOriginHeader);
  const requestOrigin = trustedRequestOrigin(requestHeaders);
  if (!browserOrigin || !requestOrigin || browserOrigin.origin !== requestOrigin) return null;
  return requestOrigin;
}
