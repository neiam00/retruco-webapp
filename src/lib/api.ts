import { API_ORIGIN } from '$app/env/public';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_ORIGIN}/api${path}`, {
    credentials: 'include',
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) {
    throw new ApiError(value.error ?? 'No se pudo conectar. Inténtalo de nuevo.', response.status);
  }
  return value as T;
}

export function socketURL(code: string) {
  const url = new URL(
    `${API_ORIGIN}/api/matches/${encodeURIComponent(code)}/ws`,
    window.location.origin,
  );
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
