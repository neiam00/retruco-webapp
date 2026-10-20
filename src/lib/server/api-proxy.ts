export async function proxyAPI(
  request: Request,
  backendOrigin: string,
  proxySecret: string,
): Promise<Response> {
  if (!backendOrigin || !proxySecret) {
    return unavailable();
  }

  try {
    const incoming = new URL(request.url);
    const backend = new URL(backendOrigin);
    const local = backend.hostname === 'localhost' || backend.hostname === '127.0.0.1';
    if (
      (backend.protocol !== 'https:' && !(local && backend.protocol === 'http:')) ||
      backend.origin === incoming.origin ||
      backend.username ||
      backend.password ||
      backend.pathname !== '/'
    ) {
      return unavailable();
    }

    backend.pathname = incoming.pathname;
    backend.search = incoming.search;
    const forwarded = new Request(backend, request);
    forwarded.headers.set('X-Retruco-Proxy-Secret', proxySecret);
    // Cloudflare supplies this header. Never trust a caller's forwarded-IP chain.
    forwarded.headers.set('X-Retruco-Client-IP', request.headers.get('CF-Connecting-IP') ?? '');
    forwarded.headers.delete('X-Forwarded-For');
    forwarded.headers.delete('X-Real-IP');

    // Preserve Origin for backend CSRF checks. Return the original response so
    // Cloudflare retains its WebSocket upgrade and Set-Cookie headers.
    return await fetch(forwarded, { redirect: 'manual' });
  } catch {
    return unavailable();
  }
}

function unavailable() {
  return Response.json(
    { error: 'No pudimos conectar con la mesa. Inténtalo de nuevo.' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
