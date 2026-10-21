import { tick } from 'svelte';

export function displayNameError(name: string): string {
  const length = Array.from(name.trim()).length;
  if (!length) return 'Escribe tu nombre para continuar.';
  return length < 2 || length > 24 ? 'Usa un nombre de 2 a 24 caracteres.' : '';
}

export function usernameError(username: string): string {
  if (!username.trim()) return 'Escribe tu usuario.';
  return /^[a-z0-9_]{3,24}$/.test(username.trim().toLowerCase())
    ? ''
    : 'Usa de 3 a 24 letras, números o guiones bajos.';
}

export function passwordError(password: string, registering: boolean): string {
  if (!password) return 'Escribe tu contraseña.';
  const length = new TextEncoder().encode(password).length;
  if (registering && length < 10) return 'La contraseña es demasiado corta.';
  if (length > 72) return 'La contraseña es demasiado larga.';
  return '';
}

export class FieldError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'FieldError';
  }
}

export async function focusField(id: string) {
  await tick();
  const field = document.getElementById(id);
  field?.focus({ preventScroll: true });
  field?.scrollIntoView({ block: 'center' });
}

/** Attachment for newly displayed, non-field errors. */
export function focusAlert(element: HTMLElement) {
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: 'nearest' });
}
