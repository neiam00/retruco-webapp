export const CARD_LABEL_STORAGE_KEY = 'retruco.cards.labels';

export function loadCardLabels(): boolean {
  try {
    return localStorage.getItem(CARD_LABEL_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function saveCardLabels(enabled: boolean): void {
  try {
    localStorage.setItem(CARD_LABEL_STORAGE_KEY, String(enabled));
  } catch {
    // The preference still works for this match when storage is unavailable.
  }
}
