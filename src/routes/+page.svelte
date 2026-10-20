<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import {
    ArrowRight,
    Plus,
    Users,
    LockKeyhole,
    Eye,
    RefreshCw,
    BookOpen,
    LogOut,
    History,
    Settings,
  } from '@lucide/svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import * as Dialog from '#lib/components/ui/dialog/index.js';
  import LandingHero from '#lib/components/LandingHero.svelte';
  import PlayerAvatar from '#lib/components/PlayerAvatar.svelte';
  import { api } from '#lib/api.js';
  import type { User, Listing, HistoryEntry } from '#lib/protocol.js';

  let user = $state<User | null>(null);
  let name = $state('');
  let code = $state('');
  let players = $state(4);
  let target = $state(24);
  let florRequired = $state(true);
  let privateMatch = $state(false);
  let spectatorsCanSpeak = $state(false);
  let tables = $state.raw<Listing[]>([]);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  let listError = $state('');
  let authOpen = $state(false);
  let register = $state(false);
  let username = $state('');
  let password = $state('');
  let historyOpen = $state(false);
  let history = $state<HistoryEntry[]>([]);

  async function refresh() {
    try {
      tables = await api<Listing[]>('/matches');
      listError = '';
    } catch (e) {
      listError = e instanceof Error ? e.message : 'No pudimos cargar las mesas.';
    } finally {
      loading = false;
    }
  }
  onMount(() => {
    void api<User | null>('/session')
      .then((value) => (user = value))
      .catch(() => {});
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => clearInterval(timer);
  });
  async function act(work: () => Promise<void>) {
    busy = true;
    error = '';
    try {
      await work();
    } catch (e) {
      error = e instanceof Error ? e.message : 'No se pudo completar la acción.';
    } finally {
      busy = false;
    }
  }
  async function identify() {
    if (!user) user = await api<User>('/guest', { name });
  }
  function create() {
    void act(async () => {
      await identify();
      const match = await api<{ code: string }>('/matches', {
        private: privateMatch,
        config: { players, target, florRequired },
        options: { spectatorsCanSpeak },
      });
      await goto(resolve('/mesa/[code]', { code: match.code }));
    });
  }
  function join(matchCode = code, spectator = false) {
    void act(async () => {
      await identify();
      const normalized = matchCode.trim().toUpperCase();
      if (!/^[A-Z]{4}-[0-9]{4}$/.test(normalized))
        throw new Error('El código tiene el formato ABCD-1234.');
      if (!spectator) await api(`/matches/${normalized}/join`, {});
      await goto(resolve('/mesa/[code]', { code: normalized }));
    });
  }
  function authenticate() {
    void act(async () => {
      user = await api<User>(register ? '/register' : '/login', { username, password });
      password = '';
      authOpen = false;
    });
  }
  function showHistory() {
    void act(async () => {
      history = await api<HistoryEntry[]>('/history');
      historyOpen = true;
    });
  }
</script>

<svelte:head>
  <title>Retruco — El truco de aquí, donde estés</title>
  <meta property="og:title" content="Retruco — Truco venezolano con amigos" />
</svelte:head>

<div class="page-shell">
  <header class="masthead">
    <a href={resolve('/')} class="brand" aria-label="Retruco, inicio">
      <span class="brand-mark">r.</span>
      retruco
      <span class="brand-dot">•</span>
    </a>
    <nav class="row" aria-label="Navegación principal">
      <Button
        href={resolve('/configuracion')}
        variant="ghost"
        size="icon"
        aria-label="Configuración de voz"
      >
        <Settings />
      </Button>
      <Button href="/reglas" variant="ghost">
        <BookOpen />
        <span class="nav-label">Cómo se juega</span>
      </Button>
      {#if user}
        <PlayerAvatar name={user.name} size={32} />
        <span class="username">{user.name}</span>
        {#if user.registered}
          <Button variant="ghost" size="icon" aria-label="Mi historial" onclick={showHistory}>
            <History />
          </Button>
        {/if}

        <Button
          variant="ghost"
          size="icon"
          aria-label="Cerrar sesión"
          onclick={() =>
            act(async () => {
              await api('/logout', {});
              user = null;
            })}
        >
          <LogOut />
        </Button>
      {:else}
        <Button
          variant="outline"
          onclick={() => {
            register = false;
            authOpen = true;
          }}
        >
          Entrar
        </Button>
      {/if}
    </nav>
  </header>

  <LandingHero />
  {#if error}
    <div class="error mb-5" role="alert">{error}</div>
  {/if}

  <div class="lobby-grid">
    <section class="play-panel" aria-labelledby="play-heading">
      <div class="row spread">
        <span class="eyebrow">Tu próxima partida</span>
        <span class="pill">100% venezolano</span>
      </div>
      <h2 id="play-heading">Hay puesto para ti.</h2>
      <p class="muted panel-intro">Entra con tu nombre. Lo demás se juega en la mesa.</p>
      {#if !user}
        <div class="field">
          <Label for="guest-name">Tu nombre en la mesa</Label><Input
            id="guest-name"
            bind:value={name}
            maxlength={24}
            placeholder="¿Cómo te dicen?"
            autocomplete="nickname"
          />
        </div>
      {:else}
        <div class="row identity">
          <PlayerAvatar name={user.name} />
          <div>
            <strong>{user.name}</strong>
            <p class="muted text-sm">
              {user.registered ? 'Tu historial está activado' : 'Jugando como invitado'}
            </p>
          </div>
        </div>
      {/if}

      <div class="settings-grid">
        <div>
          <span class="setting-label">Jugadores</span>
          <div class="segmented">
            {#each [2, 4] as count (count)}
              <Button
                variant={players === count ? 'secondary' : 'ghost'}
                aria-pressed={players === count}
                onclick={() => (players = count)}
              >
                {count === 2 ? '1 vs 1' : '2 vs 2'}
              </Button>
            {/each}
          </div>
        </div>
        <div>
          <span class="setting-label">Piedras para ganar</span>
          <div class="segmented">
            {#each [12, 24] as score (score)}
              <Button
                variant={target === score ? 'secondary' : 'ghost'}
                aria-pressed={target === score}
                onclick={() => (target = score)}
              >
                {score}
              </Button>
            {/each}
          </div>
        </div>
      </div>
      <div class="row spread option-row">
        <span>Flor por derecho</span>
        <Button
          variant="outline"
          aria-pressed={florRequired}
          onclick={() => (florRequired = !florRequired)}
        >
          {florRequired ? 'Sí, se canta' : 'No, siempre vale'}
        </Button>
      </div>
      <div class="row spread option-row">
        <span>Espectadores pueden hablar</span>
        <Button
          variant="outline"
          aria-pressed={spectatorsCanSpeak}
          onclick={() => (spectatorsCanSpeak = !spectatorsCanSpeak)}
        >
          {spectatorsCanSpeak ? 'Sí' : 'Solo escuchan'}
        </Button>
      </div>
      <div class="row spread option-row">
        <span class="row">
          {#if privateMatch}
            <LockKeyhole size={16} />
          {:else}
            <Users size={16} />
          {/if}
          Mesa {privateMatch ? 'privada' : 'pública'}
        </span>
        <Button variant="ghost" onclick={() => (privateMatch = !privateMatch)}>Cambiar</Button>
      </div>
      <Button class="w-full" size="lg" disabled={busy} onclick={create}>
        <Plus />Crear una mesa<ArrowRight class="ml-auto" />
      </Button>
      <div class="or-divider"><span>O entra con un código</span></div>
      <form
        class="row join-form"
        onsubmit={(event) => {
          event.preventDefault();
          join();
        }}
      >
        <Label for="room-code" class="sr-only">Código de la mesa</Label><Input
          id="room-code"
          bind:value={code}
          placeholder="ABCD-1234"
          maxlength={9}
          class="min-w-0 flex-1 uppercase tracking-widest"
        /><Button type="submit" variant="outline" disabled={busy}>Entrar <ArrowRight /></Button>
      </form>
      {#if !user?.registered}
        <p class="account-note">
          <Button
            variant="link"
            onclick={() => {
              register = true;
              authOpen = true;
            }}
          >
            Crea una cuenta
          </Button> para guardar tus partidas.
        </p>
      {/if}
    </section>

    <section class="browser-panel" aria-labelledby="tables-heading">
      <div class="row spread browser-heading">
        <div>
          <span class="eyebrow">La comunidad está en la mesa</span>
          <h2 id="tables-heading">
            Mesas abiertas <span class="table-count">{tables.length}</span>
          </h2>
        </div>
        <Button variant="ghost" size="icon" aria-label="Actualizar mesas" onclick={refresh}>
          <RefreshCw />
        </Button>
      </div>
      <p class="muted">Súmate a una partida o entra a mirar cómo se juega.</p>
      <div class="table-browser">
        {#if loading}
          <div class="empty-state">
            <span class="eyebrow">Buscando una buena mano…</span>
          </div>
        {:else if listError}
          <div class="empty-state">
            <p class="error" role="alert">{listError}</p>
            <Button variant="outline" onclick={refresh}>Volver a intentar</Button>
          </div>
        {:else if !tables.length}
          <div class="empty-state">
            <div class="empty-cards">♧</div>
            <h3>La primera mesa puede ser tuya.</h3>
            <p>
              Prepara el café, crea una partida
              <br />
              y pásales el código a tus amigos.
            </p>
            <span class="empty-caption">AQUÍ SIEMPRE CABE UNA MÁS</span>
          </div>
        {:else}
          {#each tables as table (table.code)}
            <article class="table-row">
              <div class="row">
                <PlayerAvatar name={table.host} />
                <div>
                  <strong>Mesa de {table.host}</strong>
                  <p class="muted text-sm">
                    {table.players}/{table.capacity} jugadores · {table.target} piedras · {table.florRequired
                      ? 'Flor por derecho'
                      : 'Flor libre'}
                  </p>
                </div>
              </div>
              <div class="row">
                <Button
                  variant="ghost"
                  aria-label={`Mirar mesa de ${table.host}`}
                  disabled={busy}
                  onclick={() => join(table.code, true)}
                >
                  <Eye />
                </Button><Button
                  variant="outline"
                  disabled={busy || table.started}
                  onclick={() => join(table.code)}
                >
                  {table.started ? 'En juego' : 'Sentarme'}
                </Button>
              </div>
            </article>
          {/each}
        {/if}
      </div>
      <div class="rule-teaser">
        <BookOpen size={22} />
        <div>
          <strong>¿Primera vez con la vira?</strong>
          <p>No pasa nada. Las reglas y la jerarquía están a una mano de distancia.</p>
        </div>
        <Button href="/reglas" variant="ghost" size="icon" aria-label="Leer las reglas">
          <ArrowRight />
        </Button>
      </div>
    </section>
  </div>
  <footer class="footer">
    <span>
      De Venezuela, para donde estés. <strong>retru.co.ve</strong>
    </span>
    <a href={resolve('/creditos')}>Créditos y cartas</a>
  </footer>
</div>

<Dialog.Root bind:open={authOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>
        {register ? 'Tu nombre, tus partidas.' : 'Qué bueno verte de nuevo.'}
      </Dialog.Title><Dialog.Description>
        {register
          ? 'Crea una cuenta para llevar tu historial a cualquier dispositivo.'
          : 'Entra con tu usuario y contraseña.'}
      </Dialog.Description>
    </Dialog.Header>
    <form
      class="fields"
      onsubmit={(event) => {
        event.preventDefault();
        authenticate();
      }}
    >
      <div>
        <Label for="username">Usuario</Label><Input
          id="username"
          bind:value={username}
          autocomplete="username"
          minlength={3}
          maxlength={24}
          required
        />
      </div>
      <div>
        <Label for="password">Contraseña</Label><Input
          id="password"
          type="password"
          bind:value={password}
          autocomplete={register ? 'new-password' : 'current-password'}
          minlength={register ? 10 : 1}
          required
        />
      </div>
      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}
      <Button type="submit" disabled={busy}>
        {register ? 'Crear mi cuenta' : 'Entrar'}
      </Button><Button
        variant="link"
        onclick={() => {
          register = !register;
          error = '';
        }}
      >
        {register ? 'Ya tengo una cuenta' : 'Quiero crear una cuenta'}
      </Button>
    </form>
  </Dialog.Content>
</Dialog.Root>
<Dialog.Root bind:open={historyOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Tus partidas</Dialog.Title><Dialog.Description>
        Las últimas 50 mesas en las que has jugado.
      </Dialog.Description>
    </Dialog.Header>
    {#if !history.length}
      <p>Todavía no hay partidas. La primera te espera.</p>
    {/if}

    {#each history as entry (entry.code)}
      <div class="row spread history-row">
        <div>
          <strong>{entry.code}</strong>
          <p class="muted">
            {#if entry.expired}
              Sin jugar · Mesa expirada
            {:else}
              {entry.scores[0]} — {entry.scores[1]} · {entry.finished ? 'Terminada' : 'En curso'}
            {/if}
          </p>
        </div>
        {#if !entry.finished}
          <Button href={`/mesa/${entry.code}`} variant="outline">Volver</Button>
        {/if}
      </div>
    {/each}
  </Dialog.Content>
</Dialog.Root>

<style>
  .brand-dot {
    font-size: 1rem;
    color: #ad5533;
    letter-spacing: 0;
  }
  .lobby-grid {
    display: grid;
    grid-template-columns: 400px 1fr;
    gap: 36px;
    align-items: start;
  }
  .play-panel {
    background: #fffcf5;
    border: 1px solid #d7d7c6;
    padding: 28px;
    border-radius: 14px;
    box-shadow: 0 5px 0 #e9e5d6;
  }
  .play-panel h2 {
    font-size: 1.9rem;
    margin-top: 20px;
    letter-spacing: -0.035em;
  }
  .panel-intro {
    font-size: 0.85rem;
    line-height: 1.65;
    margin: 8px 0 24px;
  }
  .identity {
    padding: 8px 0;
  }
  .settings-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin: 22px 0 14px;
  }
  .setting-label {
    display: block;
    font-size: 0.76rem;
    font-weight: 650;
    margin-bottom: 9px;
  }
  .segmented {
    display: flex;
    background: #f2f1e8;
    border-radius: 7px;
    padding: 3px;
  }
  .segmented :global(button) {
    flex: 1;
    padding: 0.5rem;
    min-height: 40px;
  }
  .option-row {
    font-size: 0.8rem;
    margin: 4px 0;
  }
  .option-row:last-of-type {
    margin-bottom: 17px;
  }
  .or-divider {
    position: relative;
    text-align: center;
    font-size: 0.7rem;
    color: #78816f;
    margin: 26px 0 15px;
  }
  .or-divider:before {
    content: '';
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    height: 1px;
    background: #e2e2d4;
  }
  .or-divider span {
    position: relative;
    background: #fffcf5;
    padding: 0 12px;
  }
  .account-note {
    text-align: center;
    font-size: 0.7rem;
    color: #78816f;
    margin-top: 16px;
  }
  .account-note :global(button) {
    font-size: 0.7rem;
    padding: 0;
    min-height: 32px;
  }
  .browser-panel {
    padding-top: 10px;
  }
  .browser-heading h2 {
    font-size: 1.9rem;
    margin: 12px 0;
    letter-spacing: -0.04em;
  }
  .table-count {
    font:
      600 0.75rem ui-sans-serif,
      system-ui;
    background: #e4e7d7;
    border-radius: 50%;
    display: inline-grid;
    place-items: center;
    vertical-align: middle;
    width: 24px;
    height: 24px;
    margin-left: 8px;
  }
  .browser-panel > p {
    font-size: 0.85rem;
  }
  .table-browser {
    margin-top: 24px;
    border: 1px dashed #cbd0bc;
    border-radius: 12px;
    min-height: 360px;
    background: #eeeede70;
  }
  .empty-state {
    min-height: 360px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 30px;
    gap: 16px;
  }
  .empty-state h3 {
    font-size: 1.5rem;
  }
  .empty-state p {
    font-size: 0.85rem;
    color: #747c68;
    line-height: 1.7;
  }
  .empty-cards {
    display: grid;
    place-items: center;
    border: 1px solid #b5c1a6;
    color: #698163;
    border-radius: 6px;
    transform: rotate(-8deg);
    width: 52px;
    height: 70px;
    font: 2.5rem Georgia;
    background: #f6f5e9;
    box-shadow: 5px 4px 0 #e1e5d4;
  }
  .empty-caption {
    font-size: 0.55rem;
    letter-spacing: 0.16em;
    color: #89917d;
    margin-top: 12px;
  }
  .table-row {
    padding: 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    border-bottom: 1px solid #d9ddcb;
  }
  .rule-teaser {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 24px 0;
    color: #5a7054;
  }
  .rule-teaser strong {
    font-size: 0.85rem;
  }
  .rule-teaser p {
    font-size: 0.75rem;
    line-height: 1.6;
    margin-top: 5px;
  }
  .rule-teaser > :global(svg) {
    flex-shrink: 0;
  }
  .rule-teaser :global(a) {
    margin-left: auto;
    flex-shrink: 0;
  }
  .history-row {
    padding: 15px 0;
    border-bottom: 1px solid var(--border);
  }
  @media (max-width: 1000px) {
    .lobby-grid {
      grid-template-columns: 360px 1fr;
      gap: 24px;
    }
    .table-row {
      flex-wrap: wrap;
    }
    .play-panel {
      padding: 23px;
    }
  }
  @media (max-width: 760px) {
    .lobby-grid {
      grid-template-columns: 1fr;
      gap: 35px;
    }
    .play-panel {
      padding: 24px;
    }
    .nav-label,
    .username {
      display: none;
    }
    .browser-panel {
      padding: 0;
    }
    .masthead nav {
      gap: 3px;
    }
  }
</style>
