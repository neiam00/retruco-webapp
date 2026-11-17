import { socketURL } from '#lib/api.js';
import { ReconnectBackoff } from '#lib/reconnect.js';
import type { VoiceMode } from '#lib/voice-settings.js';

export interface VoicePeer {
  id: string;
  name: string;
  canSpeak: boolean;
}

export interface VoiceState {
  connected: boolean;
  reconnecting: boolean;
  canSpeak: boolean;
  microphone: boolean;
  talking: boolean;
  playbackBlocked: boolean;
  peers: VoicePeer[];
  error: string;
}

interface Signal {
  type: string;
  from?: string;
  self?: VoicePeer;
  peers?: VoicePeer[];
  iceServers?: RTCIceServer[];
  description?: RTCSessionDescriptionInit;
  candidate?: unknown;
}

interface PeerConnection {
  peer: VoicePeer;
  connection: RTCPeerConnection;
  audio: HTMLAudioElement;
  makingOffer: boolean;
  ignoreOffer: boolean;
  settingAnswer: boolean;
  candidates: RTCIceCandidateInit[];
  closed: boolean;
}

// Bound both the count and size of peer-controlled data retained before SDP.
// Normalizing also prevents unknown JSON fields from occupying the queue.
const maxPendingCandidates = 64;
function normalizeCandidate(value: unknown): RTCIceCandidateInit | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const input = value as Record<string, unknown>;
  if (input.candidate !== undefined && typeof input.candidate !== 'string') return;
  const candidate = (input.candidate ?? '') as string;
  if (candidate.length > 4096) return;
  const result: RTCIceCandidateInit = { candidate };
  for (const key of ['sdpMid', 'usernameFragment'] as const) {
    const field = input[key];
    if (field === undefined) continue;
    if (field !== null && (typeof field !== 'string' || field.length > 256)) return;
    result[key] = field;
  }
  const index = input.sdpMLineIndex;
  if (index !== undefined) {
    if (
      index !== null &&
      (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 65535)
    )
      return;
    result.sdpMLineIndex = index;
  }
  return result;
}

// One session belongs to one mounted match. Closing it releases the microphone,
// audio elements, signaling socket, peer connections, and refresh timer.
export class VoiceSession {
  private socket?: WebSocket;
  private self?: VoicePeer;
  private peers = new Map<string, PeerConnection>();
  private servers: RTCIceServer[] = [];
  private stream?: MediaStream;
  private refresh?: ReturnType<typeof setTimeout>;
  private backoff = new ReconnectBackoff();
  private failedJoins = 0;
  private microphoneWanted = false;
  private disposed = false;
  private microphoneRequest = 0;
  private mode: VoiceMode = 'listen';
  private muted = false;
  private state: VoiceState = {
    connected: false,
    reconnecting: false,
    canSpeak: false,
    microphone: false,
    talking: false,
    playbackBlocked: false,
    peers: [],
    error: '',
  };

  constructor(private readonly changed: (state: VoiceState) => void) {}

  connect(code: string) {
    const url = new URL(socketURL(code));
    url.pathname = url.pathname.replace(/\/ws$/, '/voice');
    if (this.disposed || this.socket) return;
    const socket = new WebSocket(url);
    this.socket = socket;
    let messages = Promise.resolve();
    socket.onmessage = (event) => {
      messages = messages
        .then(() => {
          if (this.socket === socket) return this.receive(JSON.parse(event.data) as Signal);
        })
        .catch(() => {
          if (this.socket === socket) {
            this.update({
              error: 'No pudimos conectar el audio. Sal del audio y vuelve a entrar.',
            });
          }
        });
    };
    socket.onclose = ({ code: status, reason }) => {
      if (this.socket !== socket) return;
      const recovering = this.state.connected || this.state.reconnecting;
      if (status === 4001 || status === 1008 || !recovering || ++this.failedJoins > 5) {
        this.close();
        const error =
          status === 4001
            ? 'El audio se abrió en otra pestaña.'
            : status === 1008
              ? reason || 'La sesión de voz finalizó. Revisa tu acceso a la mesa.'
              : 'No pudimos conectar la voz. Vuelve a entrar al audio.';
        this.update({ error });
        return;
      }
      this.disconnect();
      this.update({ reconnecting: true, error: '' });
      // Failed upgrades hide the HTTP status, including the TURN issuance limit.
      this.backoff.schedule(() => this.connect(code), this.failedJoins > 1 ? 16_000 : 0);
    };
  }

  private scheduleRefresh(delay: number) {
    clearTimeout(this.refresh);
    this.refresh = setTimeout(() => this.send({ type: 'refresh' }), delay);
  }

  private update(change: Partial<VoiceState>) {
    this.state = { ...this.state, ...change };
    this.changed(this.state);
  }

  private send(message: object) {
    if (!this.disposed && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  async setMode(mode: VoiceMode) {
    if (this.disposed) return;
    this.mode = mode;
    this.muted = false;
    this.microphoneWanted = mode !== 'listen';
    await this.applyMode();
  }

  private async applyMode() {
    const mode = this.mode;
    this.setTalking(false);
    if (mode === 'listen' || !this.self?.canSpeak) {
      this.microphoneWanted = false;
      this.stopMicrophone();
      return;
    }
    if (this.stream) {
      this.setTalking(mode === 'live');
      return;
    }
    const request = ++this.microphoneRequest;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      if (this.disposed || request !== this.microphoneRequest) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      const track = stream.getAudioTracks()[0];
      track.enabled = false;
      track.onended = () => {
        this.microphoneWanted = false;
        this.stopMicrophone();
        this.update({ error: 'El micrófono se desconectó. Actívalo de nuevo para continuar.' });
      };
      await Promise.all([...this.peers.values()].map((peer) => this.attachMicrophone(peer)));
      if (this.disposed || request !== this.microphoneRequest) return;
      this.update({ microphone: true, error: '' });
      this.setTalking(this.mode === 'live');
    } catch {
      if (this.disposed || request !== this.microphoneRequest) return;
      this.microphoneWanted = false;
      this.stopMicrophone();
      this.update({
        error:
          'No pudimos abrir el micrófono. Revisa el permiso del navegador; puedes seguir escuchando.',
      });
    }
  }

  setTalking(pressed: boolean) {
    const talking = !!this.stream && !this.muted && this.mode !== 'listen' && pressed;
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = talking;
    });
    this.update({ talking });
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.setTalking(!muted && this.mode === 'live');
  }

  async resumePlayback() {
    const results = await Promise.allSettled(
      [...this.peers.values()]
        .filter((peer) => peer.audio.srcObject)
        .map((peer) => peer.audio.play()),
    );
    this.update({ playbackBlocked: results.some((result) => result.status === 'rejected') });
  }

  private stopMicrophone() {
    this.microphoneRequest++;
    this.stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    this.stream = undefined;
    for (const peer of this.peers.values()) {
      if (peer.closed) continue;
      for (const sender of peer.connection.getSenders()) {
        if (sender.track) void sender.replaceTrack(null).catch(() => {});
      }
    }
    this.update({ microphone: false, talking: false });
  }

  private async attachMicrophone(peer: PeerConnection) {
    if (peer.closed) return;
    const transceiver = peer.connection
      .getTransceivers()
      .find((item) => item.receiver.track.kind === 'audio');
    if (!transceiver) return;
    transceiver.direction = this.self?.canSpeak ? 'sendrecv' : 'recvonly';
    const codecs =
      RTCRtpReceiver.getCapabilities('audio')?.codecs.filter(
        (codec) => codec.mimeType.toLowerCase() === 'audio/opus',
      ) ?? [];
    if (!codecs.length || !transceiver.setCodecPreferences) {
      throw new Error('Opus is unavailable in this browser');
    }
    transceiver.setCodecPreferences(codecs);
    await transceiver.sender.replaceTrack(
      this.self?.canSpeak ? (this.stream?.getAudioTracks()[0] ?? null) : null,
    );
  }

  private createPeer(peer: VoicePeer) {
    const connection = new RTCPeerConnection({ iceServers: this.servers });
    const audio = new Audio();
    audio.autoplay = true;
    const entry: PeerConnection = {
      peer,
      connection,
      audio,
      makingOffer: false,
      ignoreOffer: false,
      settingAnswer: false,
      candidates: [],
      closed: false,
    };
    this.peers.set(peer.id, entry);
    connection.ontrack = ({ track, streams }) => {
      // Permissions come from the server roster, never from the sender's SDP.
      if (entry.closed || !entry.peer.canSpeak || track.kind !== 'audio') return;
      audio.srcObject = streams[0] ?? new MediaStream([track]);
      void audio.play().catch(() => this.update({ playbackBlocked: true }));
    };
    connection.onicecandidate = ({ candidate }) => {
      if (!entry.closed && candidate)
        this.send({ type: 'signal', to: peer.id, candidate: candidate.toJSON() });
    };
    connection.onconnectionstatechange = () => {
      if (entry.closed) return;
      if (connection.connectionState === 'failed') {
        connection.restartIce();
        this.update({ error: `Reconectando el audio de ${peer.name}…` });
      } else if (connection.connectionState === 'connected') {
        this.update({ error: '' });
      }
    };
    connection.onnegotiationneeded = async () => {
      try {
        entry.makingOffer = true;
        await this.attachMicrophone(entry);
        await connection.setLocalDescription();
        if (!entry.closed)
          this.send({ type: 'signal', to: peer.id, description: connection.localDescription });
      } catch {
        if (!entry.closed) this.update({ error: `No pudimos negociar el audio de ${peer.name}.` });
      } finally {
        entry.makingOffer = false;
      }
    };
    // Exactly one initial audio transceiver. The other peer creates its matching
    // transceiver when receiving the offer, avoiding duplicate audio tracks.
    if (this.self!.id < peer.id) {
      connection.addTransceiver('audio', {
        direction: this.self!.canSpeak ? 'sendrecv' : 'recvonly',
      });
    }
    return entry;
  }

  private syncPeers(peers: VoicePeer[]) {
    // Two listeners cannot send audio to each other. Keep them in the roster,
    // but avoid allocating a WebRTC connection (and potentially a TURN relay).
    const audible = new Map(
      peers
        .filter((peer) => peer.id !== this.self?.id && (this.self?.canSpeak || peer.canSpeak))
        .map((peer) => [peer.id, peer]),
    );
    for (const [id, entry] of this.peers) {
      const current = audible.get(id);
      if (!current || current.canSpeak !== entry.peer.canSpeak) {
        this.closePeer(entry);
        this.peers.delete(id);
      } else {
        entry.peer = current;
      }
    }
    for (const peer of audible.values()) {
      if (!this.peers.has(peer.id)) this.createPeer(peer);
    }
    this.update({ peers: peers.filter((peer) => peer.id !== this.self?.id) });
  }

  private async receive(message: Signal) {
    if (this.disposed) return;
    if (message.type === 'welcome' && message.self) {
      if (!message.self.canSpeak) this.microphoneWanted = false;
      const restoreMic = this.state.reconnecting && this.microphoneWanted && message.self.canSpeak;
      this.failedJoins = 0;
      this.backoff.connected();
      this.self = message.self;
      this.servers = message.iceServers ?? [];
      if (this.servers.length) this.scheduleRefresh(30 * 60_000);
      this.update({
        connected: true,
        reconnecting: false,
        canSpeak: message.self.canSpeak,
        error: '',
      });
      this.syncPeers(message.peers ?? []);
      if (restoreMic) void this.applyMode();
    } else if (message.type === 'heartbeat') {
      this.send({ type: 'heartbeat' });
    } else if (message.type === 'refresh_retry') {
      this.scheduleRefresh(60_000);
    } else if (message.type === 'peers') {
      this.syncPeers(message.peers ?? []);
    } else if (message.type === 'ice') {
      this.scheduleRefresh(30 * 60_000);
      this.servers = message.iceServers ?? [];
      for (const entry of this.peers.values()) {
        if (entry.closed) continue;
        entry.connection.setConfiguration({ iceServers: this.servers });
        // Allocate with the renewed credentials before the previous ones expire.
        entry.connection.restartIce();
      }
    } else if (message.type === 'signal' && message.from) {
      const entry = this.peers.get(message.from);
      if (!entry || entry.closed || !this.self) return;
      const pc = entry.connection;
      if (message.description) {
        const readyForOffer =
          !entry.makingOffer && (pc.signalingState === 'stable' || entry.settingAnswer);
        const collision = message.description.type === 'offer' && !readyForOffer;
        entry.ignoreOffer = this.self.id < message.from && collision;
        if (entry.ignoreOffer) return;
        entry.settingAnswer = message.description.type === 'answer';
        try {
          await pc.setRemoteDescription(message.description);
        } finally {
          entry.settingAnswer = false;
        }
        await this.attachMicrophone(entry);
        for (const candidate of entry.candidates.splice(0)) await pc.addIceCandidate(candidate);
        if (message.description.type === 'offer') {
          await pc.setLocalDescription();
          if (!entry.closed)
            this.send({ type: 'signal', to: message.from, description: pc.localDescription });
        }
      } else if (message.candidate !== undefined && !entry.ignoreOffer) {
        const candidate = normalizeCandidate(message.candidate);
        if (
          !candidate ||
          (!pc.remoteDescription && entry.candidates.length >= maxPendingCandidates)
        ) {
          this.closePeer(entry);
          this.update({
            error: `Se interrumpió el audio de ${entry.peer.name}. Vuelve a entrar al audio.`,
          });
          return;
        }
        if (pc.remoteDescription) await pc.addIceCandidate(candidate);
        else entry.candidates.push(candidate);
      }
    }
  }

  private closePeer(entry: PeerConnection) {
    if (entry.closed) return;
    entry.closed = true;
    entry.candidates.length = 0;
    entry.connection.close();
    entry.audio.pause();
    entry.audio.srcObject = null;
  }

  private disconnect() {
    clearTimeout(this.refresh);
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
    this.self = undefined;
    for (const peer of this.peers.values()) this.closePeer(peer);
    this.peers.clear();
    this.stopMicrophone();
    this.update({ connected: false, canSpeak: false, peers: [], playbackBlocked: false });
  }

  close() {
    this.disposed = true;
    this.backoff.cancel();
    this.disconnect();
    this.update({ reconnecting: false, error: '' });
  }
}
