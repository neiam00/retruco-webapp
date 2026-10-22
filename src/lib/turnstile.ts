export interface TurnstileAPI {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      theme: 'dark';
      language: 'es';
      size: 'flexible' | 'compact';
      'response-field': false;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
      'timeout-callback': () => void;
    },
  ): string;
  remove(widget: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileAPI;
  }
}

let loading: Promise<TurnstileAPI> | undefined;

/** Load only when an authentication dialog opens, and share one script across dialog visits. */
export function loadTurnstile(): Promise<TurnstileAPI> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise<TurnstileAPI>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    const timeout = window.setTimeout(fail, 15000);

    function fail() {
      window.clearTimeout(timeout);
      script.remove();
      reject(new Error('No se pudo cargar la verificación de seguridad.'));
    }
    script.onerror = fail;
    script.onload = () => {
      window.clearTimeout(timeout);
      if (window.turnstile) resolve(window.turnstile);
      else fail();
    };
    document.head.append(script);
  }).catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}
