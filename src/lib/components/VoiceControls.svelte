<script lang="ts">
  import { onMount } from 'svelte';
  import { Headphones, Mic, MicOff, PhoneOff } from '@lucide/svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { VoiceSession, type VoiceState } from '#lib/voice.js';
  import { loadVoiceMode, saveVoiceMode, type VoiceMode } from '#lib/voice-settings.js';

  let { code }: { code: string } = $props();
  let mode = $state<VoiceMode>('listen');
  let joining = $state(false);
  let muted = $state(false);
  let voice = $state<VoiceState>({
    connected: false,
    canSpeak: false,
    microphone: false,
    talking: false,
    playbackBlocked: false,
    peers: [],
    error: '',
  });
  let session: VoiceSession | undefined;

  onMount(() => {
    mode = loadVoiceMode();
    return () => session?.close();
  });

  function join() {
    session?.close();
    joining = true;
    muted = false;
    let initialized = false;
    session = new VoiceSession((next) => {
      voice = next;
      if (next.connected && !initialized) {
        initialized = true;
        joining = false;
        void session?.setMode(mode);
      } else if (next.error) joining = false;
    });
    session.connect(code);
  }

  function leave() {
    session?.close();
    session = undefined;
    joining = false;
  }

  function changeMode(event: Event) {
    mode = (event.target as HTMLSelectElement).value as VoiceMode;
    muted = false;
    saveVoiceMode(mode);
    void session?.setMode(mode);
  }

  function pressKey(event: KeyboardEvent) {
    if (
      event.code !== 'KeyV' ||
      mode !== 'push-to-talk' ||
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    session?.setTalking(true);
  }

  function releaseKey(event: KeyboardEvent) {
    if (event.code === 'KeyV' && mode === 'push-to-talk') session?.setTalking(false);
  }

  function releasePushToTalk() {
    if (mode === 'push-to-talk') session?.setTalking(false);
  }
</script>

<svelte:window onkeydown={pressKey} onkeyup={releaseKey} onblur={releasePushToTalk} />
<svelte:document
  onvisibilitychange={() => {
    if (document.hidden) releasePushToTalk();
  }}
/>

<section class="voice-controls" aria-label="Voz de la mesa">
  {#if !voice.connected}
    <Button variant="outline" disabled={joining} onclick={join}>
      <Headphones size={18} />{joining ? 'Conectando audio…' : 'Entrar al audio'}
    </Button>
  {:else}
    <div class="row voice-row">
      <span class="voice-status"><Headphones size={16} />{voice.peers.length + 1} en audio</span>
      <Button variant="ghost" size="icon" aria-label="Salir del audio" onclick={leave}>
        <PhoneOff size={18} />
      </Button>
    </div>
    {#if voice.canSpeak}
      <label class="mode-label">
        Modo de voz
        <select value={mode} onchange={changeMode}>
          <option value="listen">Solo escuchar</option>
          <option value="live">Micrófono abierto</option>
          <option value="push-to-talk">Pulsar para hablar</option>
        </select>
      </label>
      {#if mode !== 'listen' && !voice.microphone}
        <Button variant="outline" onclick={() => session?.setMode(mode)}>
          <Mic size={18} />Activar micrófono
        </Button>
      {:else if mode === 'live'}
        <Button
          variant={muted ? 'outline' : 'secondary'}
          aria-pressed={!muted}
          onclick={() => {
            muted = !muted;
            session?.setMuted(muted);
          }}
        >
          {#if muted}<MicOff size={18} />Activar micrófono{:else}<Mic size={18} />Silenciar
            micrófono{/if}
        </Button>
      {:else if mode === 'push-to-talk'}
        <Button
          variant={voice.talking ? 'secondary' : 'outline'}
          aria-pressed={voice.talking}
          onpointerdown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            session?.setTalking(true);
          }}
          onpointerup={releasePushToTalk}
          onpointercancel={releasePushToTalk}
          onlostpointercapture={releasePushToTalk}
          onkeydown={(event) => {
            if (event.code === 'Space' || event.code === 'Enter') {
              event.preventDefault();
              session?.setTalking(true);
            }
          }}
          onkeyup={(event) => {
            if (event.code === 'Space' || event.code === 'Enter') releasePushToTalk();
          }}
          onblur={releasePushToTalk}
          style="touch-action: none; user-select: none"
        >
          <Mic size={18} />{voice.talking ? 'Hablando…' : 'Mantén para hablar · V'}
        </Button>
      {/if}
    {:else}
      <p class="muted">Puedes escuchar. Esta mesa reserva el micrófono para los jugadores.</p>
    {/if}
    {#if voice.peers.length}
      <p class="muted participants">{voice.peers.map((peer) => peer.name).join(' · ')}</p>
    {/if}
    {#if voice.playbackBlocked}
      <Button variant="outline" onclick={() => session?.resumePlayback()}>Reproducir audio</Button>
    {/if}
  {/if}
  {#if voice.error}<p class="voice-error" role="alert">{voice.error}</p>{/if}
</section>

<style>
  .voice-controls {
    margin-bottom: 12px;
    display: grid;
    gap: 10px;
    padding: 14px;
    border: 1px solid #e8e4ce24;
    background: #152d26;
    border-radius: 16px;
  }
  .voice-row {
    justify-content: space-between;
  }
  .voice-status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
  }
  .mode-label {
    display: grid;
    gap: 6px;
    font-size: 0.8rem;
  }
  select {
    width: 100%;
    min-height: 40px;
    border: 1px solid #e8e4ce40;
    border-radius: 8px;
    padding: 8px;
    color: #f4f0df;
    background: #192e27;
  }
  p {
    margin: 0;
    font-size: 0.8rem;
  }
  .participants {
    overflow-wrap: anywhere;
  }
  .voice-error {
    color: #ffceae;
  }
</style>
