<script lang="ts">
  import { page } from '$app/state';
  import MatchRoom from '#lib/components/MatchRoom.svelte';

  let code = $derived((page.params.code ?? '').toUpperCase());
</script>

{#key code}
  <MatchRoom {code} />
{/key}
