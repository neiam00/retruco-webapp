<script lang="ts">
  import { Shirt } from '@lucide/svelte';
  import { api, ApiError } from '#lib/api.js';
  import { appearanceFields, defaultAppearance, type Appearance } from '#lib/appearance.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Dialog from '#lib/components/ui/dialog/index.js';
  import type { WardrobePreview } from '#lib/table3d/wardrobe-preview.js';

  let {
    roomCode,
    initialAppearance,
    beforeOpen,
    inline = false,
    onopenchange = () => {},
    disabled = false,
  }: {
    roomCode?: string;
    initialAppearance?: Appearance;
    beforeOpen?: () => Promise<boolean>;
    inline?: boolean;
    onopenchange?: (open: boolean) => void;
    disabled?: boolean;
  } = $props();

  const endpoint = '/profile/appearance';
  const id = $props.id();
  let open = $state(false);
  let opening = $state(false);
  let loading = $state(false);
  let loaded = $state(false);
  let saving = $state(false);
  let error = $state('');
  let status = $state('');
  let draft = $state<Appearance>(defaultAppearance());
  let previewStatus = $state<'loading' | 'ready' | 'unavailable'>('loading');
  let preview: WardrobePreview | undefined;
  let loadRevision = 0;

  function attachPreview(canvas: HTMLCanvasElement) {
    let active = true;
    previewStatus = 'loading';
    void import('#lib/table3d/wardrobe-preview.js')
      .then(({ WardrobePreview }) => {
        if (active)
          preview = new WardrobePreview(canvas, { ...draft }, (state) => {
            if (active) previewStatus = state;
          });
      })
      .catch(() => {
        if (active) previewStatus = 'unavailable';
      });
    return () => {
      active = false;
      preview?.dispose();
      preview = undefined;
    };
  }

  async function load() {
    const revision = ++loadRevision;
    error = '';
    loading = true;
    loaded = false;
    try {
      const value =
        initialAppearance ?? (await api<{ appearance: Appearance | null }>(endpoint)).appearance;
      if (revision !== loadRevision) return;
      draft = value ? { ...value } : defaultAppearance();
      preview?.setAppearance({ ...draft });
      loaded = true;
    } catch (cause) {
      if (revision === loadRevision)
        error =
          cause instanceof ApiError
            ? cause.message
            : 'No pudimos cargar tu personaje. Inténtalo de nuevo.';
    } finally {
      if (revision === loadRevision) loading = false;
    }
  }

  async function show() {
    if (opening || disabled) return;
    opening = true;
    status = '';
    try {
      if (beforeOpen && !(await beforeOpen())) return;
      changeOpen(true);
      await load();
    } catch {
      status = 'No pudimos abrir el vestuario. Inténtalo de nuevo.';
    } finally {
      opening = false;
    }
  }

  function close() {
    if (saving) return;
    loadRevision++;
    changeOpen(false);
  }

  function changeOpen(next: boolean) {
    open = next;
    onopenchange(next);
  }

  function choose(key: keyof Appearance, value: number) {
    draft[key] = value;
    preview?.setAppearance({ ...draft });
    error = '';
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (saving || !loaded) return;
    saving = true;
    error = '';
    try {
      await api(endpoint, { appearance: { ...draft }, code: roomCode });
      status = 'Personaje guardado.';
      changeOpen(false);
    } catch (cause) {
      error =
        cause instanceof ApiError
          ? cause.message
          : 'No pudimos guardar tu personaje. Inténtalo de nuevo.';
    } finally {
      saving = false;
    }
  }
</script>

<div class={['wardrobe-entry', { 'wardrobe-inline': inline }]}>
  <Dialog.Root
    {open}
    onOpenChange={(next) => {
      if (!next) close();
    }}
  >
    <Dialog.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant={inline ? 'ghost' : 'outline'}
          class="wardrobe-trigger min-h-11"
          disabled={opening || disabled}
          onclick={() => void show()}
          onkeydown={undefined}
        >
          <Shirt aria-hidden="true" />Mi personaje
        </Button>
      {/snippet}
    </Dialog.Trigger>
    <Dialog.Content
      class="wardrobe-dialog"
      showCloseButton={false}
      onEscapeKeydown={(event) => {
        if (saving) event.preventDefault();
      }}
      onInteractOutside={(event) => {
        if (saving) event.preventDefault();
      }}
    >
      <Dialog.Header>
        <Dialog.Title>Mi personaje</Dialog.Title>
        <Dialog.Description>
          {roomCode
            ? 'Guarda el personaje para esta mesa y las siguientes.'
            : 'Elige el personaje que usarás en tus próximas mesas.'}
        </Dialog.Description>
      </Dialog.Header>
      <form onsubmit={save}>
        <div class="wardrobe-layout">
          <div class="preview-panel">
            <canvas
              class={{ ready: previewStatus === 'ready' }}
              aria-hidden="true"
              {@attach attachPreview}
            ></canvas>
            {#if previewStatus !== 'ready'}
              <p role="status">
                {previewStatus === 'loading'
                  ? 'Cargando vista 3D…'
                  : 'La vista 3D no está disponible.'}
              </p>
            {/if}
          </div>
          <fieldset disabled={!loaded || saving}>
            <legend class="sr-only">Apariencia</legend>
            {#each appearanceFields as field (field.key)}
              <div class="wardrobe-field">
                <label for={`${id}-${field.key}`}>{field.label}</label>
                <select
                  id={`${id}-${field.key}`}
                  value={draft[field.key]}
                  onchange={(event) => choose(field.key, Number(event.currentTarget.value))}
                >
                  {#each field.options as label, index (label)}
                    <option value={index}>{label}</option>
                  {/each}
                </select>
              </div>
            {/each}
          </fieldset>
        </div>
        {#if loading}<p class="wardrobe-message" role="status">Cargando tu personaje…</p>{/if}
        {#if error}
          <p class="error wardrobe-message" role="alert">{error}</p>
          {#if !loaded}<Button variant="outline" class="min-h-11" onclick={() => void load()}>
              Cargar de nuevo
            </Button>{/if}
        {/if}
        <Dialog.Footer>
          <Button variant="outline" class="min-h-11" disabled={saving} onclick={close}>
            Cancelar
          </Button>
          <Button type="submit" class="min-h-11" disabled={!loaded || saving}>
            {saving ? 'Guardando…' : 'Guardar personaje'}
          </Button>
        </Dialog.Footer>
      </form>
    </Dialog.Content>
  </Dialog.Root>
  <p class={['wardrobe-status muted text-sm', { 'sr-only': !status }]} role="status">{status}</p>
</div>

<style>
  .wardrobe-inline {
    display: contents;
  }
  :global(.wardrobe-dialog) {
    max-width: min(720px, calc(100vw - 28px));
  }
  .wardrobe-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
    gap: 1.2rem;
    align-items: start;
  }
  .preview-panel {
    position: relative;
    overflow: hidden;
    border-radius: 0.8rem;
    border: 1px solid var(--border);
    background: #232a22;
    color: #f0e2c7;
  }
  canvas {
    display: block;
    width: 100%;
    height: clamp(180px, 37dvh, 340px);
    visibility: hidden;
  }
  canvas.ready {
    visibility: visible;
  }
  .preview-panel > p {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 1rem;
    text-align: center;
  }
  fieldset {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.8rem;
    min-width: 0;
    padding: 0;
    border: 0;
  }
  .wardrobe-field {
    display: grid;
    gap: 0.32rem;
  }
  label {
    font-size: 0.9rem;
    font-weight: 750;
  }
  select {
    min-width: 0;
    width: 100%;
    min-height: 44px;
    padding: 0.45rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--background);
    color: var(--foreground);
    font-size: 1rem;
    font-weight: 600;
  }
  select:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .wardrobe-message {
    margin-block: 0.75rem;
  }
  @media (max-width: 600px) {
    .wardrobe-layout {
      grid-template-columns: 1fr;
    }
  }
</style>
