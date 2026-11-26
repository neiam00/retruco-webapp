export type TableMode = 'classic' | '3d';
export type Quality = 'desktop' | 'mobile' | 'mobile-low';
export type QualitySetting = 'auto' | Quality;

export const tableModeKey = 'retruco.table.mode';
export const tableQualityKey = 'retruco.table.quality';
export const autoFocusCantosKey = 'retruco.table.autoFocusCantos';
export const autoFocusCantosEvent = 'retruco:table-auto-focus-cantos';

let unsavedAutoFocus: boolean | undefined;

export function readTableMode(): TableMode {
  const mode = readSetting(tableModeKey);
  return mode === 'classic' || mode === '3d'
    ? mode
    : import.meta.env.VITE_TABLE_3D_DEFAULT === 'false'
      ? 'classic'
      : '3d';
}

export function readTableQuality(): QualitySetting {
  const value = readSetting(tableQualityKey);
  return value === 'desktop' || value === 'mobile' || value === 'mobile-low' ? value : 'auto';
}

export function readAutoFocusCantos(): boolean {
  return unsavedAutoFocus ?? readSetting(autoFocusCantosKey) !== 'false';
}

export function saveAutoFocusCantos(enabled: boolean) {
  try {
    localStorage.setItem(autoFocusCantosKey, String(enabled));
    unsavedAutoFocus = undefined;
  } catch {
    unsavedAutoFocus = enabled;
  }
  window.dispatchEvent(new CustomEvent(autoFocusCantosEvent, { detail: enabled }));
}

function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function saveTableSetting(key: string, value: TableMode | QualitySetting) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The current table still uses the chosen setting if storage is unavailable.
  }
}

export function tableQuality(setting: QualitySetting): Quality {
  if (setting !== 'auto') return setting;
  if (!matchMedia('(pointer: coarse)').matches) return 'desktop';
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return (memory && memory < 4) || navigator.hardwareConcurrency < 4 ? 'mobile-low' : 'mobile';
}
