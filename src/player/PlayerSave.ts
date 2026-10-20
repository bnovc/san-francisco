export interface SavedPlayerPosition {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

const STORAGE_KEY = 'sf-streets.player-position.v1';

export function loadPlayerPosition(): SavedPlayerPosition | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    const saved = JSON.parse(value) as Partial<SavedPlayerPosition>;
    if (![saved.x, saved.y, saved.z, saved.yaw, saved.pitch].every(Number.isFinite)) return null;
    if (Math.abs(saved.x!) > 100_000 || Math.abs(saved.z!) > 100_000 || Math.abs(saved.y!) > 10_000) return null;
    return saved as SavedPlayerPosition;
  } catch {
    return null;
  }
}

export function savePlayerPosition(position: SavedPlayerPosition) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
  } catch {
    // Keep the current session usable when browser storage is unavailable.
  }
}
