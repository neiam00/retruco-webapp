<script lang="ts">
  import { Button } from '#lib/components/ui/button/index.js';
  import Hierarchy from '#lib/components/Hierarchy.svelte';
  import { rulebook } from '#lib/rulebook.js';
</script>

<svelte:head>
  <title>Cómo jugar truco venezolano — Retruco</title>
  <meta
    name="description"
    content="Las reglas de Retruco: cartas, vira, perico, perica, envido, flor, receta, empardes, pegado y tiempos de juego."
  />
</svelte:head>

<main class="page-shell rulebook">
  <header class="masthead">
    <span class="brand">
      <span class="brand-mark">r.</span>
      retruco
    </span>
    <Button href="/" variant="outline">Volver a las mesas</Button>
  </header>
  <div class="introduction">
    <span class="eyebrow">Para aprender y para resolver la discusión</span>
    <h1>Así se juega en esta mesa.</h1>
    <p class="muted">
      Truco venezolano, con las reglas de Retruco. Tenlas a mano; la picardía viene con la práctica.
    </p>
  </div>
  <section class="hierarchy-section">
    <h2>La jerarquía de las cartas</h2>
    <Hierarchy />
  </section>
  {#each rulebook as section (section.title)}
    <section>
      <h2>{section.title}</h2>
      {#each section.paragraphs as paragraph (paragraph)}
        <p>{paragraph}</p>
      {/each}
    </section>
  {/each}

  <footer class="footer">
    <span>¿Listo para cantar truco?</span>
    <Button href="/">Buscar una mesa</Button>
  </footer>
</main>

<style>
  .rulebook {
    max-width: 850px;
  }
  .introduction {
    padding: 60px 0 30px;
  }
  h1 {
    font-size: clamp(2.4rem, 5vw, 3.5rem);
    margin: 18px 0;
  }
  h2 {
    font-size: 1.8rem;
    margin-bottom: 18px;
  }
  section {
    padding: 30px 0;
    border-bottom: 1px solid var(--border);
  }
  p {
    line-height: 1.85;
    margin: 14px 0;
    color: #52654f;
  }
  .hierarchy-section {
    padding: 28px;
    background: #fffaf0;
    border: 1px solid var(--border);
    border-radius: 12px;
  }
</style>
