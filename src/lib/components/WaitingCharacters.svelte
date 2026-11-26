<script lang="ts">
  import { appearanceFields, defaultAppearance } from '#lib/appearance.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import type { Snapshot } from '#lib/protocol.js';
  import type { WardrobePreview } from '#lib/table3d/wardrobe-preview.js';

  let {
    snapshot,
    showPreview,
    onselect,
  }: {
    snapshot: Snapshot;
    showPreview: boolean;
    onselect?: (seat: number) => void;
  } = $props();

  let selectedID = $state<string>();
  let status = $state<'loading' | 'ready' | 'unavailable'>('loading');
  let renderer = $state.raw<WardrobePreview>();
  let seats = $derived(
    snapshot.seats.flatMap((player, index) =>
      player.id
        ? [{ ...player, index, outfit: player.appearance ?? defaultAppearance(index) }]
        : [],
    ),
  );
  let selected = $derived(
    seats.find((seat) => seat.id === selectedID) ??
      seats.find(
        ({ index }) => index === (snapshot.seat >= 0 ? snapshot.seat : snapshot.perspective),
      ) ??
      seats[0],
  );
  const shirts = appearanceFields.find(({ key }) => key === 'shirt')!.options;
  const heading = $props.id();

  function select(id: string, index: number) {
    selectedID = id;
    onselect?.(index);
  }

  function mountPreview(canvas: HTMLCanvasElement) {
    let active = true;
    let instance: WardrobePreview | undefined;
    status = 'loading';
    void import('#lib/table3d/wardrobe-preview.js')
      .then(({ WardrobePreview }) => {
        if (!active || !selected) return;
        instance = new WardrobePreview(canvas, selected.outfit, (next) => {
          if (active) status = next;
        });
        renderer = instance;
      })
      .catch(() => {
        if (active) status = 'unavailable';
      });
    return () => {
      active = false;
      instance?.dispose();
      if (renderer === instance) renderer = undefined;
    };
  }

  $effect(() => {
    if (renderer && selected) renderer.setAppearance(selected.outfit);
  });
</script>

{#if selected}
  <section class="waiting-characters" aria-labelledby={heading}>
    <h2 id={heading}>Personajes de la mesa</h2>
    <div class={['character-layout', { preview: showPreview }]}>
      {#if showPreview}
        <div class="character-preview">
          <div
            class={['preview-image', { ready: status === 'ready' }]}
            aria-label={`Vista 3D de ${selected.name}`}
            role="img"
          >
            <canvas aria-hidden="true" {@attach mountPreview}></canvas>
          </div>
          {#if status !== 'ready'}
            <p role="status">
              {status === 'loading' ? 'Cargando vista 3D…' : 'Vista 3D no disponible.'}
            </p>
          {/if}
        </div>
      {/if}
      <div class="character-list">
        <div class="character-options" role="group" aria-label="Personajes por puesto">
          {#each seats as seat (seat.id)}
            <Button
              variant={selected.id === seat.id ? 'secondary' : 'outline'}
              aria-label={`Ver personaje de ${seat.name}, puesto ${seat.index + 1}`}
              aria-pressed={selected.id === seat.id}
              onclick={() => select(seat.id, seat.index)}
            >
              <strong>{seat.name}</strong>
              <span>{shirts[seat.outfit.shirt]}{seat.cpu ? ' · CPU' : ''}</span>
            </Button>
          {/each}
        </div>
        <dl
          class="appearance-details"
          aria-label={`Apariencia de ${selected.name}`}
          aria-live="polite"
        >
          {#each appearanceFields as field (field.key)}
            <div>
              <dt>{field.label}</dt>
              <dd>{field.options[selected.outfit[field.key]]}</dd>
            </div>
          {/each}
        </dl>
      </div>
    </div>
  </section>
{/if}

<style>
  .waiting-characters {
    padding: 11px 14px;
    border: 1px solid #8db5a14d;
    border-radius: 15px;
    color: #f4efe3;
    background: #16362c;
  }

  h2 {
    margin: 0 0 8px;
    font-size: 0.97rem;
  }

  .character-layout {
    display: grid;
    gap: 12px;
  }

  .character-layout.preview {
    grid-template-columns: minmax(104px, 160px) minmax(0, 1fr);
    align-items: start;
  }

  .character-preview {
    position: relative;
    overflow: hidden;
    border: 1px solid #8db5a13d;
    border-radius: 9px;
    background: #232a22;
  }

  canvas {
    display: block;
    width: 100%;
    height: 132px;
  }

  .preview-image {
    visibility: hidden;
  }

  .preview-image.ready {
    visibility: visible;
  }

  .character-preview p {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 6px;
    text-align: center;
    font-size: 0.75rem;
  }

  .character-list {
    min-width: 0;
  }

  .character-options {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .character-options :global(button) {
    min-width: 0;
    min-height: 44px;
    height: auto;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    padding: 4px 8px;
    line-height: 1.15;
    white-space: normal;
    overflow-wrap: anywhere;
    text-align: left;
  }

  .character-options strong {
    font-size: 0.8rem;
  }

  .character-options span {
    font-size: 0.68rem;
  }

  .appearance-details {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(84px, 100%), 1fr));
    gap: 4px 8px;
    margin: 6px 0 0;
    font-size: 0.69rem;
    line-height: 1.25;
  }

  dt {
    color: #c4d2c2;
  }

  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }

  @media (max-width: 460px) {
    .character-layout {
      gap: 7px;
    }

    .character-layout.preview {
      grid-template-columns: minmax(76px, 35%) minmax(0, 1fr);
    }

    .waiting-characters {
      padding: 9px;
    }
  }
</style>
