<script lang="ts">
  import { api } from '#lib/api.js';
  import { loadTurnstile, type TurnstileAPI } from '#lib/turnstile.js';
  import { Button } from '#lib/components/ui/button/index.js';

  let {
    action,
    onverify,
    error = '',
  }: {
    action: 'register' | 'login';
    onverify: (token: string) => void;
    error?: string;
  } = $props();
  let attempt = $state(0);
  let message = $state('');
  let loading = $state(true);
  let verified = $state(false);

  function mount(container: HTMLElement) {
    const challengeAction = action;
    let disposed = false;
    let widget: string | undefined;
    let turnstile: TurnstileAPI | undefined;
    message = '';
    loading = true;
    verified = false;
    onverify('');

    function invalidate(reason: string) {
      if (disposed) return;
      onverify('');
      message = reason;
      verified = false;
    }

    async function start() {
      try {
        const config = await api<{ siteKey: string }>('/turnstile');
        if (disposed) return;
        if (!config?.siteKey)
          throw new Error('La verificación de seguridad no está disponible en este momento.');
        turnstile = await loadTurnstile();
        if (disposed) return;
        widget = turnstile.render(container, {
          sitekey: config.siteKey,
          action: challengeAction,
          theme: 'dark',
          language: 'es',
          size: container.clientWidth < 300 ? 'compact' : 'flexible',
          'response-field': false,
          callback: (token) => {
            if (disposed) return;
            message = '';
            verified = true;
            onverify(token);
          },
          'expired-callback': () => invalidate('La verificación venció. Complétala de nuevo.'),
          'timeout-callback': () =>
            invalidate('La verificación agotó el tiempo. Inténtalo de nuevo.'),
          'error-callback': () =>
            invalidate('No se pudo completar la verificación. Inténtalo de nuevo.'),
        });
      } catch (cause) {
        if (!disposed) {
          message = cause instanceof Error ? cause.message : 'No se pudo cargar la verificación.';
        }
      } finally {
        if (!disposed) loading = false;
      }
    }
    void start();
    return () => {
      disposed = true;
      if (widget !== undefined) turnstile?.remove(widget);
      onverify('');
    };
  }
</script>

<div id="auth-check" class="auth-check" tabindex="-1">
  <p class="check-label">Verificación de seguridad</p>
  {#key attempt}
    <div class="widget" {@attach mount}></div>
  {/key}
  {#if loading}<p class="muted text-sm" role="status">Cargando verificación…</p>{/if}
  {#if verified}<p class="muted text-sm" role="status">Verificación completada.</p>{/if}
  {#if message || error}
    <p class="field-error" role="alert">{message || error}</p>
  {/if}
  {#if message}
    <Button variant="outline" type="button" onclick={() => attempt++}>
      Reintentar verificación
    </Button>
  {/if}
</div>

<style>
  .auth-check {
    min-width: 0;
    display: grid;
    gap: 8px;
  }
  .auth-check:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 4px;
  }
  .check-label {
    font-size: 0.85rem;
    font-weight: 650;
  }
  .widget {
    min-width: 0;
  }
</style>
