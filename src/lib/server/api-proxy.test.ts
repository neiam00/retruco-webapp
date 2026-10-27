import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyAPI } from './api-proxy.js';

afterEach(() => vi.unstubAllGlobals());

describe('same-origin API forwarding', () => {
  it('preserves cookies, request body and Origin while replacing spoofed proxy headers', async () => {
    const upstream = new Response('ok', {
      headers: { 'Set-Cookie': 'session=opaque; HttpOnly; Secure; Path=/' },
    });
    const fetchMock = vi.fn().mockResolvedValue(upstream);
    vi.stubGlobal('fetch', fetchMock);
    const request = new Request('https://cards.example.test/api/guest', {
      method: 'POST',
      headers: {
        Origin: 'https://cards.example.test',
        Cookie: 'session=existing',
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '192.0.2.1',
        'X-Retruco-Proxy-Secret': 'forged',
        'X-Retruco-Client-IP': '192.0.2.200',
        'X-Forwarded-For': '192.0.2.200',
      },
      body: JSON.stringify({ name: 'Ana' }),
    });
    const response = await proxyAPI(request, 'https://origin.example.com', 'edge-secret');
    expect(response).toBe(upstream);
    const [forwarded, options] = fetchMock.mock.calls[0] as [Request, RequestInit];
    expect(forwarded.url).toBe('https://origin.example.com/api/guest');
    expect(forwarded.headers.get('Origin')).toBe('https://cards.example.test');
    expect(forwarded.headers.get('Cookie')).toBe('session=existing');
    expect(forwarded.headers.get('X-Retruco-Proxy-Secret')).toBe('edge-secret');
    expect(forwarded.headers.get('X-Retruco-Client-IP')).toBe('192.0.2.1');
    expect(forwarded.headers.has('X-Forwarded-For')).toBe(false);
    expect(await forwarded.json()).toEqual({ name: 'Ana' });
    expect(options.redirect).toBe('manual');
  });

  it('does not reconstruct the WebSocket response or strip the upgrade header', async () => {
    const upstream = new Response(null);
    const fetchMock = vi.fn().mockResolvedValue(upstream);
    vi.stubGlobal('fetch', fetchMock);
    const request = new Request('https://cards.example.test/api/matches/ABCD-1234/ws', {
      headers: { Upgrade: 'websocket', Origin: 'https://cards.example.test' },
    });
    expect(await proxyAPI(request, 'https://origin.example.com', 'edge-secret')).toBe(upstream);
    expect(fetchMock.mock.calls[0][0].headers.get('Upgrade')).toBe('websocket');
  });

  it.each([
    '',
    'https://cards.example.test',
    'http://origin.example.com',
    'https://origin.example.com/api',
  ])('fails closed for an absent, recursive or invalid backend: %s', async (origin) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await proxyAPI(
      new Request('https://cards.example.test/api/session'),
      origin,
      'secret',
    );
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
