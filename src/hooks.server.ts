import type { Handle } from '@sveltejs/kit/hooks';
import { API_PROXY_SECRET, BACKEND_ORIGIN } from '$app/env/private';
import { proxyAPI } from '#lib/server/api-proxy.js';

export const handle: Handle = async ({ event, resolve }) => {
  if (event.url.pathname.startsWith('/api/')) {
    return proxyAPI(event.request, BACKEND_ORIGIN, API_PROXY_SECRET);
  }
  const response = await resolve(event);
  // Some browsers require an explicit WebSocket source in addition to 'self'.
  // Dynamic deployments use the request origin; prerendered pages use SITE_ORIGIN.
  const socketOrigin = event.url.origin.replace(/^http/, 'ws');
  const policy = response.headers.get('Content-Security-Policy');
  if (policy && response.headers.get('Content-Type')?.startsWith('text/html')) {
    response.headers.set(
      'Content-Security-Policy',
      policy.replace(/connect-src([^;]*)/, (directive) => `${directive} ${socketOrigin}`),
    );
  }
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'same-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
  return response;
};
