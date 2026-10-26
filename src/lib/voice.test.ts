import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { VoiceSession } from './voice.js';

vi.mock('#lib/api.js', () => ({ socketURL: () => 'wss://example.test/api/matches/ABC/ws' }));

class TestSocket {
  static OPEN = 1;
  static instance: TestSocket;
  readyState = 1;
  onmessage?: (event: { data: string }) => void;
  send = vi.fn();
  close = vi.fn();
  constructor() {
    TestSocket.instance = this;
  }
  async receive(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
    // Let the session's serialized signaling work finish without a test-only API.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

class TestConnection {
  static instances: TestConnection[] = [];
  remoteDescription: RTCSessionDescriptionInit | null = null;
  signalingState = 'stable';
  closed = false;
  close = vi.fn(() => {
    this.closed = true;
  });
  setConfiguration = vi.fn(() => {
    if (this.closed) throw new Error('Cannot configure a closed connection');
  });
  restartIce = vi.fn();
  addIceCandidate = vi.fn<(candidate: RTCIceCandidateInit) => Promise<void>>(async () => {});
  getTransceivers = () => [];
  getSenders = () => [];
  addTransceiver = vi.fn();
  setRemoteDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.remoteDescription = description;
  });
  constructor() {
    TestConnection.instances.push(this);
  }
}

let session: VoiceSession;
const peer = { id: 'a', name: 'Peer', canSpeak: true };
const otherPeer = { id: 'b', name: 'Other', canSpeak: true };
const candidate = { candidate: 'candidate:1 1 UDP 1 192.0.2.1 12345 typ host', sdpMid: '0' };

beforeEach(async () => {
  TestConnection.instances = [];
  vi.stubGlobal('WebSocket', TestSocket);
  vi.stubGlobal('RTCPeerConnection', TestConnection);
  vi.stubGlobal(
    'Audio',
    class {
      pause = vi.fn();
    },
  );
  session = new VoiceSession(vi.fn());
  session.connect('ABC');
  await TestSocket.instance.receive({
    type: 'welcome',
    self: { id: 'z', name: 'Self', canSpeak: false },
    peers: [peer, otherPeer],
  });
});

afterEach(() => {
  session.close();
  vi.unstubAllGlobals();
});

test('isolates a peer flooding candidates before SDP, even after roster updates', async () => {
  const [attacker, other] = TestConnection.instances;
  for (let index = 0; index < 100; index++) {
    await TestSocket.instance.receive({ type: 'signal', from: peer.id, candidate });
  }
  expect(attacker.close).toHaveBeenCalledOnce();
  await TestSocket.instance.receive({ type: 'peers', peers: [peer, otherPeer] });
  await TestSocket.instance.receive({
    type: 'signal',
    from: peer.id,
    description: { type: 'answer', sdp: 'attacker' },
  });
  expect(attacker.setRemoteDescription).not.toHaveBeenCalled();
  expect(attacker.addIceCandidate).not.toHaveBeenCalled();
  expect(TestConnection.instances).toHaveLength(2);
  await TestSocket.instance.receive({ type: 'signal', from: otherPeer.id, candidate });
  await TestSocket.instance.receive({
    type: 'signal',
    from: otherPeer.id,
    description: { type: 'answer', sdp: 'legitimate' },
  });
  expect(other.close).not.toHaveBeenCalled();
  expect(other.addIceCandidate).toHaveBeenCalledWith(candidate);
  await TestSocket.instance.receive({ type: 'ice', iceServers: [] });
  expect(attacker.setConfiguration).not.toHaveBeenCalled();
  expect(other.restartIce).toHaveBeenCalledOnce();
});

test('drains valid early candidates and end markers, and accepts established trickle ICE', async () => {
  const connection = TestConnection.instances[0];
  const end = { candidate: '', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: null };
  await TestSocket.instance.receive({ type: 'signal', from: peer.id, candidate });
  await TestSocket.instance.receive({ type: 'signal', from: peer.id, candidate: end });
  expect(connection.addIceCandidate).not.toHaveBeenCalled();
  await TestSocket.instance.receive({
    type: 'signal',
    from: peer.id,
    description: { type: 'answer', sdp: 'legitimate' },
  });
  expect(connection.addIceCandidate).toHaveBeenNthCalledWith(1, candidate);
  expect(connection.addIceCandidate).toHaveBeenNthCalledWith(2, end);
  for (let index = 0; index < 100; index++) {
    await TestSocket.instance.receive({ type: 'signal', from: peer.id, candidate });
  }
  expect(connection.addIceCandidate).toHaveBeenCalledTimes(102);
  expect(connection.close).not.toHaveBeenCalled();
});

test.each([
  { name: 'array', value: [] },
  { name: 'non-string candidate', value: { candidate: 42 } },
  { name: 'oversized candidate', value: { candidate: 'x'.repeat(4097) } },
  { name: 'oversized mid', value: { candidate: '', sdpMid: 'x'.repeat(257) } },
  { name: 'invalid media index', value: { candidate: '', sdpMLineIndex: -1 } },
  {
    name: 'oversized username fragment',
    value: { candidate: '', usernameFragment: 'x'.repeat(257) },
  },
])('rejects $name before retaining signaling', async ({ value }) => {
  const connection = TestConnection.instances[0];
  await TestSocket.instance.receive({ type: 'signal', from: peer.id, candidate: value });
  expect(connection.close).toHaveBeenCalledOnce();
  expect(connection.addIceCandidate).not.toHaveBeenCalled();
});

test('normalizes candidate fields instead of retaining extra peer data', async () => {
  const connection = TestConnection.instances[0];
  await TestSocket.instance.receive({
    type: 'signal',
    from: peer.id,
    candidate: { ...candidate, unexpected: 'x'.repeat(20000) },
  });
  await TestSocket.instance.receive({
    type: 'signal',
    from: peer.id,
    description: { type: 'answer', sdp: 'legitimate' },
  });
  expect(connection.addIceCandidate).toHaveBeenCalledExactlyOnceWith(candidate);
});

test('keeps listeners in the roster without allocating silent peer pairs', async () => {
  session.close();
  TestConnection.instances = [];
  const changed = vi.fn();
  session = new VoiceSession(changed);
  session.connect('ABC');
  const listener = { id: 'listener', name: 'Listener', canSpeak: false };
  await TestSocket.instance.receive({
    type: 'welcome',
    self: { id: 'self', name: 'Self', canSpeak: false },
    peers: [listener, peer],
  });
  expect(TestConnection.instances).toHaveLength(1);
  expect(changed.mock.lastCall?.[0].peers).toEqual([listener, peer]);

  // A server-authorized speaker must become audible, even with the same ID.
  await TestSocket.instance.receive({
    type: 'peers',
    peers: [{ ...listener, canSpeak: true }, peer],
  });
  expect(TestConnection.instances).toHaveLength(2);
  const formerListener = TestConnection.instances[1];
  await TestSocket.instance.receive({ type: 'peers', peers: [listener, peer] });
  expect(formerListener.close).toHaveBeenCalledOnce();
  expect(TestConnection.instances[0].close).not.toHaveBeenCalled();
});

test('speakers still connect to listeners so spectators can hear them', async () => {
  session.close();
  TestConnection.instances = [];
  session = new VoiceSession(vi.fn());
  session.connect('ABC');
  await TestSocket.instance.receive({
    type: 'welcome',
    self: { id: 'self', name: 'Self', canSpeak: true },
    peers: [{ id: 'listener', name: 'Listener', canSpeak: false }, peer],
  });
  expect(TestConnection.instances).toHaveLength(2);
});
