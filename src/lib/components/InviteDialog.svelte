<script lang="ts">
  import { onMount } from 'svelte';
  import { Share2, Copy } from '@lucide/svelte';
  import { resolve } from '$app/paths';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import * as Dialog from '#lib/components/ui/dialog/index.js';

  let { code, onclose }: { code: string; onclose: () => void } = $props();
  let url = $state('');
  let qr = $state('');
  let qrError = $state(false);
  let canShare = $state(false);
  let message = $state('');
  let sharing = $state(false);

  onMount(() => {
    url = new URL(resolve('/mesa/[code]', { code }), window.location.origin).href;
    canShare = typeof navigator.share === 'function';
    void import('qrcode')
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(url, {
          width: 256,
          margin: 4,
          errorCorrectionLevel: 'M',
        }),
      )
      .then((value) => (qr = value))
      .catch(() => (qrError = true));
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      message = 'Invitación copiada.';
    } catch {
      message = 'Selecciona el enlace para copiarlo o comparte el código de la mesa.';
    }
  }

  async function share() {
    sharing = true;
    message = '';
    try {
      await navigator.share({
        title: 'Una partida de Retruco',
        text: `Te espero en la mesa ${code}.`,
        url,
      });
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        message = 'No pudimos abrir el menú para compartir. Puedes copiar el enlace.';
      }
    } finally {
      sharing = false;
    }
  }
</script>

<Dialog.Root
  open={true}
  onOpenChange={(open) => {
    if (!open) onclose();
  }}
>
  <Dialog.Content onCloseAutoFocus={(event) => event.preventDefault()}>
    <Dialog.Header>
      <Dialog.Title>Invitar a mis amigos</Dialog.Title>
      <Dialog.Description>
        Comparte el enlace o escanea el QR para entrar a la misma mesa.
      </Dialog.Description>
    </Dialog.Header>
    <div class="invitation-qr">
      {#if qr}<img
          src={qr}
          width="256"
          height="256"
          alt={`Código QR para entrar a la mesa ${code}`}
        />
      {:else if qrError}<p>No pudimos preparar el QR. Usa el enlace de abajo.</p>
      {:else}<p role="status">Preparando QR…</p>{/if}
    </div>
    <p class="invitation-code">{code}</p>
    <div>
      <Label for="invitation-link">Enlace de la mesa</Label>
      <Input
        id="invitation-link"
        value={url}
        readonly
        onclick={(event) => event.currentTarget.select()}
      />
    </div>
    <div class="invitation-actions">
      {#if canShare}<Button disabled={sharing || !url} onclick={share}>
          <Share2 />Compartir invitación
        </Button>{/if}
      <Button variant="outline" disabled={!url} onclick={copy}><Copy />Copiar enlace</Button>
    </div>
    {#if message}<p role="status">{message}</p>{/if}
  </Dialog.Content>
</Dialog.Root>

<style>
  .invitation-qr {
    display: grid;
    place-items: center;
    min-height: 200px;
  }
  .invitation-qr img {
    width: min(256px, 100%);
    height: auto;
    border-radius: 8px;
  }
  .invitation-code {
    text-align: center;
    font-size: 22px;
    letter-spacing: 0.12em;
    font-weight: 750;
  }
  .invitation-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
