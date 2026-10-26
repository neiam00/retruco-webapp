<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  function fitTable(viewport: HTMLElement) {
    const stage = viewport.firstElementChild as HTMLElement;
    let frame = 0;
    let previousScale = 0;
    const minimumWidth = Number.parseFloat(getComputedStyle(stage).minWidth);
    const fit = () => {
      // The stage keeps its natural layout. Only the table artwork scales;
      // hand controls and reply buttons remain full-size outside this viewport.
      // Its width compensates for vertical scaling, so fitting against that
      // width would lock in the old scale after a viewport resize.
      const scale = Math.min(
        1,
        viewport.clientWidth / Math.max(1, minimumWidth),
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
    min-width: 0;
    min-height: 0;
    height: 100%;
    overflow: clip;
    container-type: size;
  }
  .table-stage {
    position: absolute;
    min-width: 400px;
    width: calc(100% / var(--table-scale, 1));
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(var(--table-scale, 1));
  }
</style>
