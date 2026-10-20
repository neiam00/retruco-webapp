<script lang="ts">
  import { Button } from '#lib/components/ui/button/index.js';
</script>

<svelte:head><title>Créditos — Retruco</title></svelte:head>

<main class="page-shell credits">
  <span class="eyebrow">Hecho con buenas cartas</span>
  <h1>Créditos y licencias</h1>
  <p>
    El arte de la baraja española pertenece a <a
      href="https://commons.wikimedia.org/wiki/User:Basquetteur"
    >
      Basquetteur
    </a>
    , disponible en Wikimedia Commons. Utilizamos la
    <a href="https://github.com/gjenkins20/spanish-playing-cards-svg">
      colección SVG de gjenkins20
    </a>
    , bajo licencia
    <a href="https://creativecommons.org/licenses/by-sa/3.0/">
      Creative Commons Atribución-CompartirIgual 3.0
    </a>
    .
  </p>
  <p>
    La baraja conserva su formato SVG. Retruco usa las 40 cartas del juego venezolano, sin ochos ni
    nueves.
  </p>
  <p>
    Los controles utilizan shadcn-svelte, los iconos Lucide y los avatares DiceBear Bottts. Los
    avatares se generan en tu dispositivo a partir del nombre mostrado.
  </p>
  <Button href="/" variant="outline">Volver a las mesas</Button>
</main>

<style>
  .credits {
    max-width: 760px;
    padding: 70px 0;
  }
  h1 {
    font-size: 2.8rem;
    margin: 20px 0 30px;
  }
  p {
    margin-bottom: 24px;
    line-height: 1.9;
    color: #52654f;
  }
  a {
    text-decoration: underline;
  }
</style>
