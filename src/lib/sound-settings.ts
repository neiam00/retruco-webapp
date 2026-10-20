export const CARD_SOUND_STORAGE_KEY = 'retruco.cards.muted';

export function loadCardSoundsMuted(): boolean {
  try {
    return localStorage.getItem(CARD_SOUND_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveCardSoundsMuted(muted: boolean): boolean {
  try {
    localStorage.setItem(CARD_SOUND_STORAGE_KEY, String(muted));
    return true;
  } catch {
    return false;
  }
}
