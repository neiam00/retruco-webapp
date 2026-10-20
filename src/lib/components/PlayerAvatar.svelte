<script lang="ts">
  import { createAvatar } from '@dicebear/core';
  import * as bottts from '@dicebear/bottts';
  let { name, size = 40 }: { name: string; size?: number } = $props();
  let src = $derived(createAvatar(bottts, { seed: name, size: 80 }).toDataUri());
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
