<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { API_ORIGIN } from '$app/env/public';
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
    Pause,
    Play,
    ChevronDown,
  } from '@lucide/svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import * as Dialog from '#lib/components/ui/dialog/index.js';
  import LobbyBackdrop from '#lib/components/LobbyBackdrop.svelte';
  import RegistrationCheck from '#lib/components/RegistrationCheck.svelte';
  import Card from '#lib/components/Card.svelte';
  import PlayerAvatar from '#lib/components/PlayerAvatar.svelte';
  import { api, ApiError } from '#lib/api.js';
  import {
    displayNameError,
    usernameError,
    passwordError,
    FieldError,
    focusField,
    focusAlert,
  } from '#lib/form-validation.js';
  import { formatRoomCode, formatRoomCodeInput } from '#lib/room-code.js';
  import { teamLabel } from '#lib/team-labels.js';
  import type { User, Listing, HistoryEntry } from '#lib/protocol.js';

  let motionPaused = $state(false);
  let user = $state<User | null>(null);
  let name = $state('');
  let code = $state('');
  let players = $state(4);
  let target = $state(24);
  let florRequired = $state(true);
  let privateMatch = $state(false);
  let spectatorsCanSpeak = $state(false);
  let cpuSeats = $state<number[]>([]);
  let openHumanSeats = $derived(players - cpuSeats.length - 1);
  let tables = $state.raw<Listing[]>([]);
  let tableSearch = $state('');
  let hideFullTables = $state(false);
  let hideCPUTables = $state(false);
  let tableSort = $state('default');
  let visibleTables = $derived.by(() => {
    const search = normalizeName(tableSearch.trim());
    const matches = tables.filter(
      (table) =>
        normalizeName(table.host).includes(search) &&
        (!hideFullTables || table.players < table.capacity) &&
        (!hideCPUTables || (table.cpuPlayers ?? 0) === 0),
    );
    if (tableSort === 'default') return matches;
    return matches.toSorted((first, second) => {
      const difference = first.players - second.players;
      return (
        (tableSort === 'players-asc' ? difference : -difference) ||
        first.host.localeCompare(second.host, 'es') ||
        first.code.localeCompare(second.code)
      );
    });
  });

  function normalizeName(value: string) {
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('es');
  }

  function resetTableFilters() {
    tableSearch = '';
    hideFullTables = false;
    hideCPUTables = false;
    tableSort = 'default';
  }
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  let fieldErrors = $state<Record<string, string>>({});
  let authError = $state('');
  let credentialsError = $state('');
  let formRevision = 0;
  let listError = $state('');
  let authOpen = $state(false);
  let register = $state(false);
  let username = $state('');
  let password = $state('');
  let turnstileToken = $state('');
  let turnstileError = $state('');
  let turnstileAttempt = $state(0);
  let historyOpen = $state(false);
  let history = $state<HistoryEntry[]>([]);
  let listingRevision = 0;

  async function refresh(focusOnError = false) {
    const revision = ++listingRevision;
    try {
      const latest = await api<Listing[]>('/matches');
      if (revision === listingRevision) {
        tables = latest;
        listError = '';
      }
    } catch (e) {
      if (revision === listingRevision) {
        listError = e instanceof Error ? e.message : 'No pudimos cargar las mesas.';
        loading = false;
        if (focusOnError) await focusField('table-list-error');
      }
    } finally {
      if (revision === listingRevision) loading = false;
    }
  }
  function openListingStream() {
    const updates = new EventSource(`${API_ORIGIN}/api/matches/events`, { withCredentials: true });
    updates.onmessage = (event) => {
      try {
        const latest = JSON.parse(event.data) as Listing[];
        // A slower HTTP refresh must not restore a room removed by the stream.
        listingRevision++;
        tables = latest;
        loading = false;
        listError = '';
      } catch {
        void refresh();
      }
    };
    return updates;
  }
  onMount(() => {
    void api<User | null>('/session')
      .then((value) => (user = value))
      .catch(() => {});
    void refresh(true);
    let updates = openListingStream();
    // Ordinary disconnects reconnect automatically; HTTP errors such as a
    // deployment-time 404 can close EventSource permanently, so reopen it.
    const timer = setInterval(() => {
      if (updates.readyState !== EventSource.OPEN) void refresh();
      if (updates.readyState === EventSource.CLOSED) updates = openListingStream();
    }, 10000);
    return () => {
      updates.close();
      clearInterval(timer);
    };
  });
  function clearFieldError(field: string) {
    fieldErrors[field] = '';
    error = '';
    authError = '';
    if (field === 'username' || field === 'password') credentialsError = '';
    formRevision++;
  }

  function validateFields(errors: Record<string, string>) {
    Object.assign(fieldErrors, errors);
    const firstInvalid = Object.keys(errors).find((field) => errors[field]);
    if (firstInvalid) void focusField(firstInvalid);
    return !firstInvalid;
  }

  function resetAuthErrors() {
    fieldErrors.username = '';
    fieldErrors.password = '';
    authError = '';
    credentialsError = '';
    turnstileError = '';
    formRevision++;
  }

  async function act(work: () => Promise<void>, context: 'page' | 'auth' = 'page') {
    busy = true;
    error = '';
    authError = '';
    const revision = formRevision;
    try {
      await work();
    } catch (e) {
      // A response for an older value must not put an error back after editing.
      if (revision !== formRevision) return;
      if (e instanceof FieldError) {
        fieldErrors[e.field] = e.message;
        await focusField(e.field);
      } else if (context === 'auth' && e instanceof ApiError && e.status === 409) {
        fieldErrors.username = e.message;
        await focusField('username');
      } else if (context === 'auth' && e instanceof ApiError && e.status === 401) {
        credentialsError = e.message;
        await focusField('username');
      } else if (context === 'auth' && e instanceof ApiError && e.status === 403) {
        turnstileError = e.message;
        await focusField('registration-check');
      } else {
        const message = e instanceof Error ? e.message : 'No se pudo completar la acción.';
        if (context === 'auth') authError = message;
        else error = message;
      }
    } finally {
      busy = false;
    }
  }
  async function identify() {
    if (user) return;
    try {
      user = await api<User>('/guest', { name });
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 400)
        throw new FieldError('guest-name', cause.message);
      throw cause;
    }
  }
  function create() {
    if (!validateFields({ 'guest-name': user ? '' : displayNameError(name) })) return;
    void act(async () => {
      await identify();
      const match = await api<{ code: string }>('/matches', {
        private: privateMatch,
        config: { players, target, florRequired },
        options: { spectatorsCanSpeak, cpuSeats: cpuSeats.length ? cpuSeats : undefined },
      });
      await goto(resolve('/mesa/[code]', { code: match.code }));
    });
  }
  function join(matchCode?: string) {
    const normalized = formatRoomCode(matchCode ?? code);
    const codeError = /^[A-Z]{4}-[0-9]{4}$/.test(normalized)
      ? ''
      : 'El código tiene el formato ABCD-1234.';
    if (
      !validateFields({
        'guest-name': user ? '' : displayNameError(name),
        ...(matchCode === undefined ? { 'room-code': codeError } : {}),
      })
    )
      return;
    void act(async () => {
      await identify();
      try {
        await api(`/matches/${normalized}`);
      } catch (cause) {
        if (matchCode === undefined && cause instanceof ApiError && cause.status === 404) {
          throw new FieldError('room-code', 'No encontramos una mesa con ese código.');
        }
        throw cause;
      }
      await goto(resolve('/mesa/[code]', { code: normalized }));
    });
  }
  function authenticate() {
    credentialsError = '';
    if (
      !validateFields({
        username: usernameError(username),
        password: passwordError(password, register),
      })
    )
      return;
    if (register && !turnstileToken) {
      turnstileError = 'Completa la verificación para crear tu cuenta.';
      void focusField('registration-check');
      return;
    }
    const registering = register;
    const verification = turnstileToken;
    void act(async () => {
      try {
        user = await api<User>(registering ? '/register' : '/login', {
          username,
          password,
          ...(registering ? { turnstileToken: verification } : {}),
        });
        password = '';
        authOpen = false;
      } finally {
        // Siteverify tokens are single-use, even when creating the account fails.
        if (registering) {
          turnstileToken = '';
          turnstileAttempt++;
        }
      }
    }, 'auth');
  }
  function showHistory() {
    void act(async () => {
      history = await api<HistoryEntry[]>('/history');
      historyOpen = true;
    });
  }
</script>

<svelte:head>
  <title>Retruco — Truco venezolano online</title>
  <meta property="og:title" content="Retruco — Truco venezolano con amigos" />
</svelte:head>

<LobbyBackdrop paused={motionPaused || authOpen || historyOpen} />
<div class="page-shell lobby-shell">
  <header class="masthead">
    <a href={resolve('/')} class="brand" aria-label="Retruco, inicio">
      <span class="brand-mark">r.</span>
      retruco
    </a>
    <nav class="row" aria-label="Navegación principal">
      <Button
        variant="ghost"
        size="icon"
        aria-label={motionPaused ? 'Reanudar animación' : 'Pausar animación'}
        aria-pressed={motionPaused}
        onclick={() => (motionPaused = !motionPaused)}
      >
        {#if motionPaused}<Play />{:else}<Pause />{/if}
      </Button>
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
            resetAuthErrors();
            authOpen = true;
          }}
        >
          Entrar
        </Button>
      {/if}
    </nav>
  </header>

  {#if error && !authOpen}
    {#key error}
      <div class="error mb-5" role="alert" tabindex="-1" {@attach focusAlert}>
        {error}
      </div>
    {/key}
  {/if}

  <main class="lobby-grid">
    <section class="play-panel" aria-labelledby="play-heading">
      <div class="panel-brand">
        <span class="brand-mark" aria-hidden="true">r.</span>
        <div>
          <h1 id="play-heading">Retruco</h1>
          <p>Truco venezolano, entre amigos.</p>
        </div>
      </div>
      <p class="muted panel-intro">Crea una mesa o entra con un código. Sin cuenta obligatoria.</p>
      {#if !user}
        <div class="field">
          <Label for="guest-name">Tu nombre en la mesa</Label><Input
            id="guest-name"
            bind:value={name}
            oninput={() => clearFieldError('guest-name')}
            aria-invalid={!!fieldErrors['guest-name']}
            aria-describedby={fieldErrors['guest-name'] ? 'guest-name-error' : undefined}
            maxlength={24}
            placeholder="Tu nombre"
            autocomplete="nickname"
          />
          {#if fieldErrors['guest-name']}
            <p id="guest-name-error" class="field-error" role="alert">
              {fieldErrors['guest-name']}
            </p>
          {/if}
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
                onclick={() => {
                  players = count;
                  cpuSeats = [];
                }}
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
      <details class="room-options">
        <summary>Opciones de mesa <ChevronDown size={16} /></summary>
        <fieldset class="cpu-picker">
          <legend>{players === 2 ? 'Tu rival' : 'Quién se sienta a jugar'}</legend>
          <p class="muted text-sm">
            {players === 2
              ? 'Activa la CPU para jugar sin esperar a otra persona.'
              : 'Elige los puestos CPU. Los demás quedan libres para tus amigos.'}
          </p>
          {#each Array.from({ length: players - 1 }, (_, index) => index + 1) as seat (seat)}
            <label class="cpu-choice">
              <span>
                {players === 2
                  ? 'Jugar contra la CPU'
                  : seat === 2
                    ? 'Tu compañero: CPU'
                    : `Oponente ${seat === 1 ? 1 : 2}: CPU`}
              </span>
              <input
                type="checkbox"
                checked={cpuSeats.includes(seat)}
                onchange={(event) => {
                  cpuSeats = event.currentTarget.checked
                    ? [...cpuSeats, seat].sort()
                    : cpuSeats.filter((selected) => selected !== seat);
                }}
              />
            </label>
          {/each}
          {#if cpuSeats.length}
            <p class="muted text-sm">
              {cpuSeats.length} CPU · {openHumanSeats}
              {openHumanSeats === 1 ? 'puesto libre' : 'puestos libres'}
            </p>
          {/if}
        </fieldset>
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
      </details>
      <Button class="w-full" size="lg" disabled={busy} onclick={create}>
        <Plus />Crear una mesa<ArrowRight class="ml-auto" />
      </Button>
      <div class="or-divider"><span>O entra con un código</span></div>
      <form
        class="row join-form"
        novalidate
        onsubmit={(event) => {
          event.preventDefault();
          join();
        }}
      >
        <div class="code-field">
          <Label for="room-code" class="sr-only">Código de la mesa</Label><Input
            id="room-code"
            value={code}
            oninput={(event) => {
              code = formatRoomCodeInput(event.currentTarget);
              clearFieldError('room-code');
            }}
            aria-invalid={!!fieldErrors['room-code']}
            aria-describedby={fieldErrors['room-code'] ? 'room-code-error' : undefined}
            placeholder="ABCD-1234"
            autocomplete="off"
            spellcheck="false"
            class="min-w-0 flex-1 uppercase tracking-widest"
          />
          {#if fieldErrors['room-code']}
            <p id="room-code-error" class="field-error" role="alert">
              {fieldErrors['room-code']}
            </p>
          {/if}
        </div>
        <Button type="submit" variant="outline" disabled={busy}>Entrar <ArrowRight /></Button>
      </form>
      {#if !user?.registered}
        <p class="account-note">
          <Button
            variant="link"
            onclick={() => {
              register = true;
              resetAuthErrors();
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
          <h2 id="tables-heading">
            Mesas abiertas <span class="table-count">{visibleTables.length}</span>
          </h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Actualizar mesas"
          onclick={() => void refresh(true)}
        >
          <RefreshCw />
        </Button>
      </div>
      <p class="muted">Súmate a una partida o entra a mirar cómo se juega.</p>
      <fieldset class="table-filters">
        <legend class="sr-only">Buscar y filtrar mesas</legend>
        <div>
          <Label for="table-search">Buscar por nombre</Label>
          <Input
            id="table-search"
            type="search"
            placeholder="Nombre del anfitrión"
            bind:value={tableSearch}
          />
        </div>
        <div>
          <Label for="table-sort">Ordenar mesas</Label>
          <div class="select-control">
            <select id="table-sort" class="cn-input" bind:value={tableSort}>
              <option value="default">Orden predeterminado</option>
              <option value="players-asc">Jugadores: menos a más</option>
              <option value="players-desc">Jugadores: más a menos</option>
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </div>
        </div>
        <label class="table-filter-toggle">
          <input type="checkbox" bind:checked={hideFullTables} />
          Ocultar mesas llenas
        </label>
        <label class="table-filter-toggle">
          <input type="checkbox" bind:checked={hideCPUTables} />
          Ocultar mesas con CPU
        </label>
      </fieldset>
      {#if !loading && !listError}
        <p class="filter-count" role="status">{visibleTables.length} de {tables.length} mesas</p>
      {/if}
      <div class="table-browser">
        {#if loading}
          <div class="empty-state">
            <p>Cargando mesas…</p>
          </div>
        {:else if listError}
          <div class="empty-state">
            <p id="table-list-error" class="error" role="alert" tabindex="-1">{listError}</p>
            <Button variant="outline" onclick={() => void refresh(true)}>Volver a intentar</Button>
          </div>
        {:else if !tables.length}
          <div class="empty-state">
            <div class="empty-hand" aria-hidden="true">
              <div><Card card={{ suit: 'coins', number: 7 }} width={80} intro={false} /></div>
              <div><Card card={{ suit: 'spades', number: 1 }} width={80} intro={false} /></div>
              <div><Card card={{ suit: 'clubs', number: 11 }} width={80} intro={false} /></div>
            </div>
            <h3>Todavía no hay mesas abiertas</h3>
            <p>Crea una e invita a tus amigos, o juega contra la CPU.</p>
          </div>
        {:else if !visibleTables.length}
          <div class="empty-state">
            <h3>No hay mesas que coincidan.</h3>
            <p>Prueba otro nombre o cambia los filtros.</p>
            <Button variant="outline" onclick={resetTableFilters}>Limpiar filtros</Button>
          </div>
        {:else}
          {#each visibleTables as table (table.code)}
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
                  {#if table.cpuPlayers}
                    <span class="pill">
                      {table.cpuPlayers}
                      {table.cpuPlayers === 1 ? 'jugador CPU' : 'jugadores CPU'}
                    </span>
                  {/if}
                </div>
              </div>
              <div class="row">
                <Button
                  variant="ghost"
                  aria-label={`Mirar mesa de ${table.host}`}
                  disabled={busy}
                  onclick={() => join(table.code)}
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
          <strong>Cómo jugar</strong>
          <p>La vira, los cantos y el valor de cada carta.</p>
        </div>
        <Button href="/reglas" variant="ghost" size="icon" aria-label="Leer las reglas">
          <ArrowRight />
        </Button>
      </div>
    </section>
  </main>
  <footer class="footer lobby-footer">
    <span>
      Desarrollado por <a href="https://github.com/neiam00">neiam00</a>
      @
      <a href="https://hyaxe.com">Hyaxe</a>
      | 2026
    </span>
    <a href={resolve('/creditos')}>Créditos y cartas</a>
  </footer>
</div>

<Dialog.Root bind:open={authOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>
        {register ? 'Crear una cuenta' : 'Iniciar sesión'}
      </Dialog.Title><Dialog.Description>
        {register
          ? 'Crea una cuenta para llevar tu historial a cualquier dispositivo.'
          : 'Entra con tu usuario y contraseña.'}
      </Dialog.Description>
    </Dialog.Header>
    <form
      class="fields"
      novalidate
      onsubmit={(event) => {
        event.preventDefault();
        authenticate();
      }}
    >
      <div>
        <Label for="username">Usuario</Label><Input
          id="username"
          bind:value={username}
          oninput={() => clearFieldError('username')}
          aria-invalid={!!fieldErrors.username || !!credentialsError}
          aria-describedby={fieldErrors.username
            ? 'username-error'
            : credentialsError
              ? 'credentials-error'
              : undefined}
          autocomplete="username"
          minlength={3}
          maxlength={24}
          required
        />
        {#if fieldErrors.username}
          <p id="username-error" class="field-error" role="alert">
            {fieldErrors.username}
          </p>
        {/if}
      </div>
      <div>
        <Label for="password">Contraseña</Label><Input
          id="password"
          type="password"
          bind:value={password}
          oninput={() => clearFieldError('password')}
          aria-invalid={!!fieldErrors.password || !!credentialsError}
          aria-describedby={fieldErrors.password
            ? 'password-error'
            : credentialsError
              ? 'credentials-error'
              : undefined}
          autocomplete={register ? 'new-password' : 'current-password'}
          minlength={register ? 10 : 1}
          required
        />
        {#if fieldErrors.password}
          <p id="password-error" class="field-error" role="alert">
            {fieldErrors.password}
          </p>
        {/if}
        {#if credentialsError}
          <p id="credentials-error" class="field-error" role="alert">
            {credentialsError}
          </p>
        {/if}
      </div>
      {#if register && authOpen}
        {#key turnstileAttempt}
          <RegistrationCheck
            error={turnstileError}
            onverify={(token) => {
              turnstileToken = token;
              if (token) turnstileError = '';
            }}
          />
        {/key}
      {/if}
      {#if authError}
        {#key authError}
          <p class="error" role="alert" tabindex="-1" {@attach focusAlert}>
            {authError}
          </p>
        {/key}
      {/if}
      <Button type="submit" disabled={busy}>
        {register ? 'Crear mi cuenta' : 'Entrar'}
      </Button><Button
        variant="link"
        onclick={() => {
          register = !register;
          error = '';
          resetAuthErrors();
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
      <article class="history-row">
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
        {#if entry.team >= 0}
          <p>Jugaste en el equipo {entry.team + 1} · Nosotros</p>
        {/if}
        {#if entry.finished && entry.winner >= 0}
          <p class="history-result">
            Ganador: {teamLabel(entry.winner, entry.team ?? -1)} · Equipo {entry.winner + 1}
          </p>
        {/if}
        <div class="history-teams">
          {#each [0, 1] as team (team)}
            <div>
              <strong>{teamLabel(team, entry.team ?? -1)} · Equipo {team + 1}</strong>
              <ul>
                {#each (entry.players ?? []).filter((player) => player.team === team) as player (player.seat)}
                  <li>
                    {player.name}
                    <span class="muted">
                      · Puesto {player.seat + 1}{player.cpu ? ' · CPU' : ''}
                    </span>
                  </li>
                {:else}
                  <li class="muted">Sin jugadores registrados</li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
        {#if !entry.finished}
          <Button href={`/mesa/${entry.code}`} variant="outline">Volver</Button>
        {/if}
      </article>
    {/each}
  </Dialog.Content>
</Dialog.Root>

<style>
  .lobby-shell {
    position: relative;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    width: min(1320px, calc(100% - 64px));
  }
  .masthead {
    min-height: 76px;
    border: 0;
  }
  .masthead > .brand {
    font-size: 1.25rem;
    letter-spacing: -0.04em;
  }
  .masthead .brand-mark {
    width: 26px;
    height: 33px;
    font-size: 1.2rem;
  }
  .lobby-grid {
    display: grid;
    grid-template-columns: 360px minmax(0, 1fr);
    gap: 24px;
    align-items: start;
    flex: 1;
    padding: 20px 0;
  }
  .play-panel,
  .browser-panel {
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 26px;
    min-width: 0;
  }
  .play-panel {
    background: var(--surface);
  }
  .panel-brand {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .panel-brand .brand-mark {
    width: 44px;
    height: 57px;
    font-size: 2rem;
    border: 1px solid var(--primary);
    box-shadow: 5px 3px 0 #35463b;
  }
  h1 {
    font-size: 2.15rem;
    letter-spacing: -0.045em;
    line-height: 1.2;
  }
  .panel-brand p {
    margin-top: 4px;
    color: var(--muted-foreground);
    font-size: 0.8rem;
  }
  .panel-intro {
    font-size: 0.85rem;
    line-height: 1.6;
    padding: 18px 0;
    margin-bottom: 20px;
    border-bottom: 1px solid var(--border);
  }
  .identity {
    padding: 8px 0;
  }
  .settings-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin: 20px 0 16px;
  }
  .setting-label {
    display: block;
    font-size: 0.8rem;
    font-weight: 650;
    margin-bottom: 8px;
  }
  .segmented {
    display: flex;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 3px;
  }
  .segmented :global(button) {
    flex: 1;
    padding: 0.5rem;
    min-height: 44px;
  }
  .segmented :global(button[aria-pressed='true']) {
    color: var(--primary);
    background: #304036;
  }
  .room-options {
    margin: 0 0 18px;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  .room-options summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 48px;
    cursor: pointer;
    font-size: 0.85rem;
    list-style: none;
  }
  .room-options summary::-webkit-details-marker {
    display: none;
  }
  .room-options[open] summary :global(svg) {
    transform: rotate(180deg);
  }
  .cpu-picker {
    border: 0;
    padding: 0;
    margin: 12px 0;
    display: grid;
    gap: 10px;
  }
  .cpu-picker legend {
    font-weight: 700;
    margin-bottom: 8px;
    font-size: 0.85rem;
  }
  .cpu-choice {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.85rem;
  }
  .cpu-choice input,
  .table-filter-toggle input {
    width: 18px;
    height: 18px;
    accent-color: var(--primary);
    flex-shrink: 0;
  }
  .option-row {
    font-size: 0.8rem;
    margin: 4px 0;
  }
  .option-row:last-of-type {
    margin-bottom: 12px;
  }
  .or-divider {
    display: flex;
    align-items: center;
    gap: 12px;
    text-align: center;
    font-size: 0.75rem;
    color: var(--muted-foreground);
    margin: 22px 0 14px;
  }
  .or-divider::before,
  .or-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }
  .join-form {
    align-items: flex-start;
  }
  .code-field {
    flex: 1;
    min-width: 0;
  }
  .account-note {
    text-align: center;
    font-size: 0.75rem;
    color: var(--muted-foreground);
    margin-top: 12px;
  }
  .account-note :global(button) {
    font-size: inherit;
    padding: 0;
    min-height: 44px;
  }
  .browser-panel {
    background: #141817ed;
    display: flex;
    flex-direction: column;
    align-self: stretch;
  }
  .browser-heading h2 {
    font-size: 1.6rem;
    letter-spacing: -0.025em;
  }
  .table-count {
    font-size: 0.8rem;
    font-weight: 650;
    background: var(--secondary);
    color: var(--primary);
    border-radius: 6px;
    display: inline-grid;
    place-items: center;
    vertical-align: middle;
    min-width: 28px;
    height: 28px;
    padding: 0 6px;
    margin-left: 6px;
  }
  .browser-panel > p {
    font-size: 0.85rem;
    margin-top: 4px;
  }
  .table-filters {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 16px;
    margin: 24px 0 4px;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  .table-filters :global(input[type='search']),
  .table-filters select {
    width: 100%;
    min-width: 0;
  }
  .table-filter-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    font-size: 0.8rem;
    color: var(--muted-foreground);
    cursor: pointer;
  }
  .select-control {
    position: relative;
  }
  .select-control select {
    appearance: none;
    height: 48px;
    padding-right: 36px;
  }
  .select-control :global(svg) {
    position: absolute;
    right: 12px;
    top: 16px;
    pointer-events: none;
    color: var(--muted-foreground);
  }
  .browser-panel .filter-count {
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .table-browser {
    margin-top: 16px;
    border-top: 1px solid var(--border);
    flex: 1;
  }
  .empty-state {
    min-height: 310px;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 28px 12px;
    gap: 10px;
  }
  .empty-state h3 {
    font-size: 1.15rem;
    font-weight: 700;
  }
  .empty-state p {
    font-size: 0.85rem;
    color: var(--muted-foreground);
    line-height: 1.6;
    max-width: 320px;
  }
  .empty-hand {
    position: relative;
    width: 180px;
    height: 145px;
    margin-bottom: 12px;
  }
  .empty-hand > div {
    position: absolute;
    left: 50px;
    top: 12px;
  }
  .empty-hand > div:first-child {
    transform: translate(-38px, 10px) rotate(-22deg);
  }
  .empty-hand > div:nth-child(2) {
    z-index: 1;
    transform: translateY(-4px) rotate(-3deg);
  }
  .empty-hand > div:last-child {
    transform: translate(38px, 10px) rotate(20deg);
  }
  .table-row {
    padding: 18px 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border-bottom: 1px solid var(--border);
  }
  .table-row > .row:first-child {
    flex: 1;
    flex-wrap: nowrap;
    min-width: 0;
  }
  .table-row strong {
    overflow-wrap: anywhere;
  }
  .rule-teaser {
    display: flex;
    align-items: center;
    gap: 14px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
    color: var(--muted-foreground);
  }
  .rule-teaser strong {
    font-size: 0.85rem;
    color: var(--foreground);
  }
  .rule-teaser p {
    font-size: 0.75rem;
    line-height: 1.5;
    margin-top: 3px;
  }
  .rule-teaser > :global(svg),
  .rule-teaser :global(a) {
    flex-shrink: 0;
  }
  .rule-teaser :global(a) {
    margin-left: auto;
  }
  .lobby-footer {
    justify-content: center;
    align-items: center;
    padding: 24px 0;
    text-align: center;
    gap: 8px 24px;
    line-height: 1.8;
  }
  .lobby-footer a {
    text-underline-offset: 3px;
  }
  .lobby-footer span a {
    text-decoration: underline;
  }
  .history-row {
    padding: 15px 0;
    border-bottom: 1px solid var(--border);
  }
  .history-result {
    font-weight: 800;
    margin-top: 8px;
  }
  .history-teams {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    margin: 16px 0;
  }
  .history-teams ul {
    list-style: none;
    padding: 0;
    margin: 8px 0 0;
  }
  .history-teams li {
    margin: 4px 0;
    overflow-wrap: anywhere;
  }
  @media (max-width: 1000px) {
    .lobby-shell {
      width: calc(100% - 40px);
    }
    .lobby-grid {
      grid-template-columns: 330px minmax(0, 1fr);
      gap: 18px;
    }
    .play-panel,
    .browser-panel {
      padding: 22px;
    }
    .table-row {
      flex-wrap: wrap;
    }
  }
  @media (max-width: 760px) {
    .lobby-shell {
      width: calc(100% - 28px);
    }
    .lobby-grid {
      grid-template-columns: minmax(0, 1fr);
      gap: 20px;
      padding: 8px 0;
    }
    .masthead {
      min-height: 68px;
    }
    .nav-label,
    .username {
      display: none;
    }
    .masthead nav {
      gap: 2px;
    }
    .masthead > .brand {
      font-size: 0;
      gap: 0;
    }
  }
  @media (max-width: 480px) {
    .history-teams,
    .table-filters {
      grid-template-columns: 1fr;
    }
    .table-filters {
      gap: 6px;
    }
    .play-panel,
    .browser-panel {
      padding: 20px;
    }
  }
</style>
