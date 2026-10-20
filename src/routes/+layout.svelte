<script lang="ts">
  import '../app.css';
  import { afterNavigate } from '$app/navigation';
  import { trackPage } from '#lib/analytics.js';
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();

  afterNavigate(({ to }) => {
    if (to) trackPage(to.url.pathname);
  });
</script>

<svelte:head>
  <meta
    name="description"
    content="Juega truco venezolano con tus amigos. Mesas de 2 o 4 jugadores, señas, envido y flor. Entra gratis, sin descargar nada."
  />
  <meta property="og:site_name" content="Retruco" />
  <meta property="og:type" content="website" />
  <meta property="og:locale" content="es_VE" />
</svelte:head>
{@render children()}
