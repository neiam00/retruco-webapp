<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { ArrowLeft, Headphones, Mic, Hand, Volume2 } from '@lucide/svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { loadVoiceMode, saveVoiceMode, type VoiceMode } from '#lib/voice-settings.js';
  import {
    CARD_SOUND_STORAGE_KEY,
    loadCardSoundsMuted,
    saveCardSoundsMuted,
  } from '#lib/sound-settings.js';

  let mode = $state<VoiceMode>('listen');
  let notice = $state('');
  let ready = $state(false);
  let cardsMuted = $state(false);
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
    cardsMuted = loadCardSoundsMuted();
    ready = true;
  });

  function choose(value: VoiceMode) {
    mode = value;
    notice = saveVoiceMode(value)
      ? 'Preferencia guardada en este dispositivo.'
      : 'El navegador no permite guardar la preferencia. Puedes elegirla en la mesa.';
  }

  function toggleCardSounds() {
    cardsMuted = !cardsMuted;
    notice = saveCardSoundsMuted(cardsMuted)
      ? 'Preferencia guardada en este dispositivo.'
      : 'El navegador no permite guardar la preferencia. Puedes elegirla en la mesa.';
  }
</script>

<svelte:window
  onstorage={(event) => {
    if (event.key === CARD_SOUND_STORAGE_KEY || event.key === null)
      cardsMuted = loadCardSoundsMuted();
  }}
/>

<svelte:head>
  <title>Configuración de audio — Retruco</title>
</svelte:head>

<main class="settings-page">
  <Button href={resolve('/')} variant="ghost"><ArrowLeft />Volver a las mesas</Button>
  <span class="eyebrow">A tu manera</span>
  <h1>El sonido de la mesa.</h1>
  <fieldset>
    <legend>Sonidos de cartas</legend>
    <label class={['choice', { selected: !cardsMuted }]}>
      <input type="checkbox" disabled={!ready} checked={!cardsMuted} onchange={toggleCardSounds} />
      <Volume2 size={24} />
      <span>
        <strong>Sonidos al repartir y jugar</strong>
        <span class="muted">
          Activa los sonidos de las cartas. La voz de los jugadores se controla por separado.
        </span>
      </span>
    </label>
  </fieldset>
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
    background: color-mix(in srgb, var(--primary) 10%, transparent);
    border-color: var(--primary);
  }
  .choice > span {
    display: grid;
    gap: 6px;
  }
  .choice :global(svg) {
    flex-shrink: 0;
  }
  input {
    accent-color: var(--primary);
  }
</style>
