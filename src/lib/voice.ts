import { socketURL } from '#lib/api.js';
import type { VoiceMode } from '#lib/voice-settings.js';

export interface VoicePeer {
  id: string;
  name: string;
  canSpeak: boolean;
}

export interface VoiceState {
  connected: boolean;
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
  candidate?: RTCIceCandidateInit;
}

interface PeerConnection {
  peer: VoicePeer;
  connection: RTCPeerConnection;
  audio: HTMLAudioElement;
  makingOffer: boolean;
  ignoreOffer: boolean;
  settingAnswer: boolean;
  candidates: RTCIceCandidateInit[];
}

// One session belongs to one mounted match. Closing it releases the microphone,
// audio elements, signaling socket, peer connections, and refresh timer.
export class VoiceSession {
  private socket?: WebSocket;
  private self?: VoicePeer;
  private peers = new Map<string, PeerConnection>();
  private servers: RTCIceServer[] = [];
  private stream?: MediaStream;
  private refresh?: ReturnType<typeof setInterval>;
  private disposed = false;
  private microphoneRequest = 0;
  private mode: VoiceMode = 'listen';
  private muted = false;
  private state: VoiceState = {
    connected: false,
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
    this.socket = new WebSocket(url);
    let messages = Promise.resolve();
    this.socket.onmessage = (event) => {
      messages = messages
        .then(() => this.receive(JSON.parse(event.data) as Signal))
        .catch(() => {
          if (!this.disposed) {
            this.update({
              error: 'No pudimos conectar el audio. Sal del audio y vuelve a entrar.',
            });
          }
        });
    };
    this.socket.onclose = () => {
      if (!this.disposed) {
        this.close();
        this.update({ error: 'Se perdió la conexión de voz. Vuelve a entrar al audio.' });
      }
    };
    this.refresh = setInterval(() => this.send({ type: 'refresh' }), 30 * 60 * 1000);
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
    this.setTalking(false);
    if (mode === 'listen' || !this.self?.canSpeak) {
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
        this.stopMicrophone();
        this.update({ error: 'El micrófono se desconectó. Actívalo de nuevo para continuar.' });
      };
      await Promise.all([...this.peers.values()].map((peer) => this.attachMicrophone(peer)));
      if (this.disposed || request !== this.microphoneRequest) return;
      this.update({ microphone: true, error: '' });
      this.setTalking(this.mode === 'live');
    } catch {
      if (this.disposed || request !== this.microphoneRequest) return;
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
      for (const sender of peer.connection.getSenders()) {
        if (sender.track) void sender.replaceTrack(null).catch(() => {});
      }
    }
    this.update({ microphone: false, talking: false });
  }

  private async attachMicrophone(peer: PeerConnection) {
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
    };
    this.peers.set(peer.id, entry);
    connection.ontrack = ({ track, streams }) => {
      // Permissions come from the server roster, never from the sender's SDP.
      if (!entry.peer.canSpeak || track.kind !== 'audio') return;
      audio.srcObject = streams[0] ?? new MediaStream([track]);
      void audio.play().catch(() => this.update({ playbackBlocked: true }));
    };
    connection.onicecandidate = ({ candidate }) => {
      if (candidate) this.send({ type: 'signal', to: peer.id, candidate: candidate.toJSON() });
    };
    connection.onconnectionstatechange = () => {
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
        this.send({ type: 'signal', to: peer.id, description: connection.localDescription });
      } catch {
        if (!this.disposed) this.update({ error: `No pudimos negociar el audio de ${peer.name}.` });
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
    for (const [id, entry] of this.peers) {
      if (!peers.some((peer) => peer.id === id)) {
        this.closePeer(entry);
        this.peers.delete(id);
      }
    }
    for (const peer of peers) {
      if (peer.id !== this.self?.id && !this.peers.has(peer.id)) this.createPeer(peer);
    }
    this.update({ peers: peers.filter((peer) => peer.id !== this.self?.id) });
  }

  private async receive(message: Signal) {
    if (this.disposed) return;
    if (message.type === 'welcome' && message.self) {
      this.self = message.self;
      this.servers = message.iceServers ?? [];
      this.update({ connected: true, canSpeak: message.self.canSpeak, error: '' });
      this.syncPeers(message.peers ?? []);
    } else if (message.type === 'peers') {
      this.syncPeers(message.peers ?? []);
    } else if (message.type === 'ice') {
      this.servers = message.iceServers ?? [];
      for (const entry of this.peers.values()) {
        entry.connection.setConfiguration({ iceServers: this.servers });
        // Allocate with the renewed credentials before the previous ones expire.
        entry.connection.restartIce();
      }
    } else if (message.type === 'signal' && message.from) {
      const entry = this.peers.get(message.from);
      if (!entry || !this.self) return;
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
          this.send({ type: 'signal', to: message.from, description: pc.localDescription });
        }
      } else if (message.candidate && !entry.ignoreOffer) {
        if (pc.remoteDescription) await pc.addIceCandidate(message.candidate);
        else entry.candidates.push(message.candidate);
      }
    }
  }

  private closePeer(entry: PeerConnection) {
    entry.connection.close();
    entry.audio.pause();
    entry.audio.srcObject = null;
  }

  close() {
    this.disposed = true;
    clearInterval(this.refresh);
    this.socket?.close();
    this.stopMicrophone();
    for (const peer of this.peers.values()) this.closePeer(peer);
    this.peers.clear();
    this.update({ connected: false, peers: [] });
  }
}
