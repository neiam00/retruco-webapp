export type VoiceMode = 'listen' | 'live' | 'push-to-talk';

const storageKey = 'retruco.voice.mode';

export function loadVoiceMode(): VoiceMode {
  try {
    const value = localStorage.getItem(storageKey);
    if (value === 'live' || value === 'push-to-talk') return value;
  } catch {
    // Private browsing can deny storage. Listening is still available.
  }
  return 'listen';
}

export function saveVoiceMode(mode: VoiceMode): boolean {
  try {
    localStorage.setItem(storageKey, mode);
    return true;
  } catch {
    return false;
  }
}
