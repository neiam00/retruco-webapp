<script lang="ts">
  import '@fontsource-variable/nunito/wght.css';
  import '@fontsource-variable/nunito/wght-italic.css';
  import nunitoFont from '@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2?url';
  import '../app.css';
  import { afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import { trackPage } from '#lib/analytics.js';
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();

  const siteOrigin = 'https://retru.co.ve';
  const socialTitle = 'Retruco | Truco venezolano con amigos';
  const description =
    'Juega truco venezolano con tus amigos. Mesas de 2 o 4 jugadores, señas, envido y flor. Entra gratis, sin descargar nada.';
  const socialImage = `${siteOrigin}/og-image.png`;
  const socialImageAlt =
    'Retruco: ¿Sale un truco? Crea una mesa. Comparte el enlace. Tres cartas de la baraja española sobre un fondo verde oscuro.';
  // Use the public origin even when prerendering or visiting a preview deployment.
  const socialURL = $derived(`${siteOrigin}${page.url.pathname}`);

  afterNavigate(({ to }) => {
    if (to) trackPage(to.url.pathname);
  });
</script>

<svelte:head>
  <title>Retruco | Truco venezolano online</title>
  <link rel="preload" href={nunitoFont} as="font" type="font/woff2" crossorigin="anonymous" />
  <meta name="description" content={description} />
  <meta property="og:site_name" content="Retruco" />
  <meta property="og:type" content="website" />
  <meta property="og:locale" content="es_VE" />
  <meta property="og:title" content={socialTitle} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={socialURL} />
  <meta property="og:image" content={socialImage} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content={socialImageAlt} />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={socialTitle} />
  <meta name="twitter:description" content={description} />
  <meta name="twitter:image" content={socialImage} />
  <meta name="twitter:image:alt" content={socialImageAlt} />
  <meta name="apple-mobile-web-app-title" content="Retruco" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black" />
</svelte:head>
{@render children()}
