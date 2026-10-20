// window.__twin — automation surface for tools/qa/*.mjs (Playwright).
export interface TwinApi {
  ready: boolean;
  setView(id: string): boolean;
  setCamera(x: number, y: number, z: number, headingDeg: number, pitchDeg: number, fov?: number): void;
  setTime(p: 'day' | 'sunset' | 'night'): void;
  setMode(m: 'walk' | 'orbit' | 'tour'): void;
  freeze(v: boolean): void;
  stats(): any;
  viewpoints(): string[];
  renderOnce(): void;
  interact(): void;
  teleport(x: number, z: number, headingDeg?: number): void;
  move(dx: number, dz: number, seconds: number): Promise<void>;
  look(headingDeg: number, pitchDeg: number): void;
  nearby(): any[];
  pos(): { x: number; y: number; z: number; heading: number };
  lifeStats(): any;
  storefronts(): any[];
  enter(id: string): boolean;
  quests(): Array<{ id: string; title: string; status: string; progress: number; total: number }>;
  activateQuest(id: string): boolean;
  setQuestProgress(id: string, progress: number): boolean;
  completeQuest(id: string): boolean;
  log: string[];
}
export function installQa(api: TwinApi) { (window as any).__twin = api; }
