<script lang="ts">
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import { Button } from '#lib/components/ui/button/index.js';

  let missing = $derived(page.status === 404);
</script>

<svelte:head>
  <title>{missing ? 'Página no encontrada' : 'No pudimos abrir la página'} — Retruco</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<main class="error-page">
  <span class="eyebrow">Retruco · {page.status}</span>
  <h1>{missing ? 'Por aquí no hay mesa.' : 'Esta mano salió atravesada.'}</h1>
  <p>
    {missing
      ? 'Revisa el enlace o vuelve al inicio para encontrar una partida.'
      : 'No pudimos abrir esta página. Vuelve al inicio e inténtalo de nuevo.'}
  </p>
  <Button href={resolve('/')}>Volver al inicio</Button>
</main>

<style>
  .error-page {
    width: min(520px, calc(100% - 40px));
    margin: 18vh auto;
    display: grid;
    justify-items: start;
    gap: 24px;
  }
  h1 {
    font-size: clamp(32px, 6vw, 48px);
    line-height: 1.1;
  }
  p {
    line-height: 1.7;
    color: var(--muted-foreground);
  }
</style>
