<script lang="ts">
  import { Button } from '#lib/components/ui/button/index.js';
</script>

<svelte:head><title>Créditos — Retruco</title></svelte:head>

<main class="page-shell credits">
  <span class="eyebrow">Hecho con buenas cartas</span>
  <h1>Créditos y licencias</h1>
  <p>
    La baraja de juego, la mesa y los personajes son ilustraciones y modelos originales de Retruco.
  </p>
  <p>
    La imagen para compartir el sitio utiliza cartas de <a
      href="https://commons.wikimedia.org/wiki/User:Basquetteur"
    >
      Basquetteur
    </a>
    , publicadas en Wikimedia Commons y recopiladas en la
    <a href="https://github.com/gjenkins20/spanish-playing-cards-svg">colección de gjenkins20</a>
    . La composición se distribuye bajo la licencia
    <a href="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</a>
    .
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
    color: var(--muted-foreground);
  }
  a {
    text-decoration: underline;
  }
</style>
