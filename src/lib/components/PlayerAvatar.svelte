<script module lang="ts">
  import { Style } from '@dicebear/core';
  import definition from '@dicebear/styles/bottts.json' with { type: 'json' };

  // Validate the shared, immutable style once rather than for every player.
  const bottts = new Style(definition);
</script>

<script lang="ts">
  import { Avatar } from '@dicebear/core';
  let { name, size = 40 }: { name: string; size?: number } = $props();
  let src = $derived(new Avatar(bottts, { seed: name, size: 80 }).toDataUri());
</script>

<img {src} alt="" width={size} height={size} class="avatar" />

<style>
  .avatar {
    border-radius: 50%;
    background: #eee9d8;
    padding: 3px;
    flex-shrink: 0;
  }
</style>
