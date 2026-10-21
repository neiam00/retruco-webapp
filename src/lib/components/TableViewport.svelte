<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  function fitTable(viewport: HTMLElement) {
    const stage = viewport.firstElementChild as HTMLElement;
    let frame = 0;
    let previousScale = 0;
    const fit = () => {
      // The stage keeps its natural layout. Only the table artwork scales;
      // hand controls and reply buttons remain full-size outside this viewport.
      const scale = Math.min(
        1,
        viewport.clientWidth / Math.max(1, stage.offsetWidth),
        viewport.clientHeight / Math.max(1, stage.offsetHeight),
      );
      if (Math.abs(scale - previousScale) > 0.001) {
        previousScale = scale;
        stage.style.setProperty('--table-scale', String(scale));
      }
    };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    observer.observe(viewport);
    observer.observe(stage);
    fit();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }
</script>

<div class="table-viewport" {@attach fitTable}>
  <div class="table-stage">{@render children()}</div>
</div>

<style>
  .table-viewport {
    position: relative;
    min-height: 0;
    height: 100%;
    container-type: inline-size;
  }
  .table-stage {
    position: absolute;
    width: max(400px, 100%);
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(var(--table-scale, 1));
  }
</style>
