<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { ArrowLeft, Headphones, Mic, Hand } from '@lucide/svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { loadVoiceMode, saveVoiceMode, type VoiceMode } from '#lib/voice-settings.js';

  let mode = $state<VoiceMode>('listen');
  let notice = $state('');
  let ready = $state(false);
  const choices = [
    {
      value: 'listen',
      title: 'Solo escuchar',
      text: 'Escucha la mesa sin abrir tu micrófono.',
      icon: Headphones,
    },
    {
      value: 'live',
      title: 'Micrófono abierto',
      text: 'Habla libremente mientras tengas el micrófono activado.',
      icon: Mic,
    },
    {
      value: 'push-to-talk',
      title: 'Pulsar para hablar',
      text: 'Mantén pulsado el botón de la mesa o la tecla V para hablar.',
      icon: Hand,
    },
  ] as const;

  onMount(() => {
    mode = loadVoiceMode();
    ready = true;
  });

  function choose(value: VoiceMode) {
    mode = value;
    notice = saveVoiceMode(value)
      ? 'Preferencia guardada en este dispositivo.'
      : 'El navegador no permite guardar la preferencia. Puedes elegirla en la mesa.';
  }
</script>

<svelte:head>
  <title>Configuración de voz — Retruco</title>
</svelte:head>

<main class="settings-page">
  <Button href={resolve('/')} variant="ghost"><ArrowLeft />Volver a las mesas</Button>
  <span class="eyebrow">A tu manera</span>
  <h1>La voz de la mesa.</h1>
  <p class="muted">
    Elige cómo quieres conversar. En cada mesa decides cuándo entrar al audio y activar el
    micrófono.
  </p>
  <fieldset>
    <legend>Modo de voz</legend>
    {#each choices as choice (choice.value)}
      <label class={['choice', { selected: mode === choice.value }]}>
        <input
          type="radio"
          disabled={!ready}
          name="voice-mode"
          value={choice.value}
          checked={mode === choice.value}
          onchange={() => choose(choice.value)}
        />
        <choice.icon size={24} />
        <span>
          <strong>{choice.title}</strong>
          <span class="muted">{choice.text}</span>
        </span>
      </label>
    {/each}
  </fieldset>
  <p class="muted">
    Todos pueden escuchar. La persona que crea la mesa decide si los espectadores también pueden
    hablar. Usa auriculares para evitar eco.
  </p>
  <p role="status">{notice}</p>
</main>

<style>
  .settings-page {
    width: min(640px, calc(100% - 32px));
    margin: 32px auto;
  }
  .eyebrow {
    display: block;
    margin-top: 40px;
  }
  h1 {
    font-size: clamp(2rem, 6vw, 3.5rem);
    margin: 12px 0;
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 32px 0;
    display: grid;
    gap: 12px;
  }
  legend {
    font-weight: 700;
    margin-bottom: 16px;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: 16px;
    cursor: pointer;
  }
  .choice.selected {
    background: #dbcfa01a;
    border-color: #dbcfa0;
  }
  .choice > span {
    display: grid;
    gap: 6px;
  }
  .choice :global(svg) {
    flex-shrink: 0;
  }
  input {
    accent-color: #dbcfa0;
  }
</style>
