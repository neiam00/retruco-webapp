<script lang="ts">
  import { onMount } from 'svelte';
  import {
    autoFocusCantosEvent,
    autoFocusCantosKey,
    readAutoFocusCantos,
    saveAutoFocusCantos,
    type QualitySetting,
    type TableMode,
  } from '#lib/table3d/preferences.js';
  let {
    mode,
    quality,
    failed,
    compact = false,
    onmode,
    onquality,
  }: {
    mode: TableMode;
    quality: QualitySetting;
    failed: boolean;
    compact?: boolean;
    onmode: (mode: TableMode) => void;
    onquality: (quality: QualitySetting) => void;
  } = $props();

  let focusCantos = $state(true);

  onMount(() => {
    focusCantos = readAutoFocusCantos();
    const sync = (event: Event) => {
      const enabled = (event as CustomEvent<boolean>).detail;
      if (typeof enabled === 'boolean') focusCantos = enabled;
    };
    window.addEventListener(autoFocusCantosEvent, sync);
    return () => window.removeEventListener(autoFocusCantosEvent, sync);
  });
</script>

<svelte:window
  onstorage={(event) => {
    if (event.key === autoFocusCantosKey || event.key === null) focusCantos = readAutoFocusCantos();
  }}
/>

<div class={['table-render-settings', { compact }]}>
  {#if mode === '3d' && !failed}
    <label class="focus-setting">
      <input
        type="checkbox"
        role="switch"
        checked={focusCantos}
        onchange={(event) => {
          focusCantos = event.currentTarget.checked;
          saveAutoFocusCantos(focusCantos);
        }}
      />
      <span>Enfocar al jugador que canta</span>
      <span class="switch-track" aria-hidden="true"></span>
    </label>
  {/if}
  <label>
    Vista de la mesa
    <select value={mode} onchange={(event) => onmode(event.currentTarget.value as TableMode)}>
      <option value="classic">Clásica</option>
      <option value="3d">Primera persona (3D)</option>
    </select>
  </label>
  {#if mode === '3d' && !failed}
    <label>
      Calidad 3D
      <select
        value={quality}
        onchange={(event) => onquality(event.currentTarget.value as QualitySetting)}
      >
        <option value="auto">Automática</option>
        <option value="desktop">Escritorio</option>
        <option value="mobile">Móvil</option>
        <option value="mobile-low">Móvil ligera</option>
      </select>
    </label>
    <p class="touch-help">
      Toca una carta para elegirla. Mantén presionada la mesa y arrastra para mirar.
    </p>
  {/if}
  {#if failed}
    <p role="status">La vista 3D no está disponible. Puedes seguir en la mesa clásica.</p>
    <button type="button" onclick={() => onmode('3d')}>Reintentar 3D</button>
  {/if}
</div>

<style>
  .table-render-settings {
    display: grid;
    gap: 6px;
    font-size: 0.84rem;
  }

  label {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
  }

  .compact label:not(.focus-setting) {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
  }

  .focus-setting {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    min-height: 46px;
    padding: 4px 8px;
    border: 1px solid #b4c8ad35;
    border-radius: 8px;
    background: #233c31;
    color: #f4efd9;
    font-weight: 750;
    cursor: pointer;
  }

  .focus-setting input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  .switch-track {
    display: flex;
    align-items: center;
    width: 31px;
    height: 18px;
    padding: 2px;
    border-radius: 99px;
    background: #536d5d;
  }

  .switch-track::after {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #f5f0dc;
    content: '';
  }

  .focus-setting input:checked ~ .switch-track {
    justify-content: flex-end;
    background: #dfd1a0;
  }

  .focus-setting input:checked ~ .switch-track::after {
    background: #1b3428;
  }

  .focus-setting input:focus-visible ~ .switch-track {
    outline: 2px solid #fff3cc;
    outline-offset: 2px;
  }

  select {
    min-width: 0;
    min-height: 44px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--surface);
    color: var(--foreground);
  }

  p {
    margin: 0;
    color: var(--muted-foreground);
  }

  .touch-help {
    display: none;
  }

  @media (any-pointer: coarse) {
    .touch-help {
      display: block;
    }
  }
</style>
