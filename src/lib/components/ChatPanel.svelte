<script lang="ts">
  import { Send } from '@lucide/svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { signals } from '#lib/signal-options.js';
  import type { Snapshot } from '#lib/protocol.js';

  let {
    snapshot,
    connected,
    onmessage,
  }: {
    snapshot: Snapshot;
    connected: boolean;
    onmessage: (message: string) => void;
  } = $props();

  let message = $state('');

  function seatName(seat: number) {
    return snapshot.seats[seat]?.name ?? 'Esperando…';
  }

  function sendChat(event: SubmitEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    onmessage(message);
    message = '';
  }
</script>

<aside class="chat-panel">
  <div class="chat-heading">
    <h2>Entre panas</h2>
    <span class="muted text-sm">Lo que se dice en la mesa.</span>
  </div>
  <div class="chat-messages" role="log" aria-label="Chat de la mesa" aria-live="polite">
    {#if !snapshot.chat.length}
      <p class="chat-empty">
        Rompe el hielo.
        <br />
        Un «¿quién reparte?» nunca falla.
      </p>
    {/if}

    {#each snapshot.chat as chat (chat.id)}
      <div class="chat-message">
        <strong>{chat.name}{chat.spectator ? ' · mirando' : ''}</strong>
        <p>{chat.text}</p>
      </div>
    {/each}
  </div>
  {#if snapshot.signals.length}
    <div class="signal-log" aria-live="polite">
      {#each snapshot.signals.slice(-3) as item (item.id)}
        <p>
          {seatName(item.seat)}: {signals.find((s) => s.kind === item.kind)?.label}
        </p>
      {/each}
    </div>
  {/if}

  <form class="chat-form" onsubmit={sendChat}>
    <Label for="chat-message" class="sr-only">Mensaje</Label><Input
      id="chat-message"
      bind:value={message}
      maxlength={500}
      placeholder="Di algo…"
      disabled={!connected}
    /><Button
      type="submit"
      size="icon"
      aria-label="Enviar mensaje"
      disabled={!connected || !message.trim()}
    >
      <Send />
    </Button>
  </form>
</aside>

<style>
  .chat-panel {
    align-self: start;
    background: #172e27;
    color: #eff1e2;
    border: 1px solid var(--border);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    height: 390px;
    overflow: hidden;
  }
  .chat-heading {
    padding: 18px 20px;
    border-bottom: 1px solid var(--border);
  }
  .chat-heading h2 {
    font-size: 1.25rem;
    margin-bottom: 5px;
  }
  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 17px;
  }
  .chat-empty {
    color: #929782;
    text-align: center;
    font-size: 0.8rem;
    line-height: 1.8;
    margin-top: 35px;
  }
  .chat-message strong {
    font-size: 0.7rem;
  }
  .chat-message p {
    font-size: 0.82rem;
    line-height: 1.6;
    overflow-wrap: anywhere;
    margin-top: 4px;
    color: #bbcbb8;
  }
  .chat-form {
    display: flex;
    gap: 8px;
    padding: 12px;
    border-top: 1px solid var(--border);
  }
  .chat-form :global(input) {
    min-width: 0;
    font-size: 0.8rem;
  }
  .signal-log {
    padding: 12px;
    font-size: 0.7rem;
    color: #bbcbb8;
    background: #233e30;
  }
  @media (max-width: 760px) {
    .chat-panel {
      height: 330px;
    }
  }
</style>
