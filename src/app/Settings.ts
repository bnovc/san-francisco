import type { App, Updatable } from './App';

const FPS_KEY = 'sf-streets.show-fps';

export class Settings implements Updatable {
  private readonly panel = document.getElementById('settings-panel')!;
  private readonly toggleButton = document.getElementById('settings-toggle')!;
  private readonly fpsCheckbox = document.getElementById('setting-show-fps') as HTMLInputElement;
  private readonly fpsMeter = document.getElementById('fps-meter')!;
  private shownFps = -1;

  constructor(private readonly app: App, private readonly onOpen: () => void, uiVisible: boolean) {
    let showFps = false;
    try { showFps = localStorage.getItem(FPS_KEY) === 'true'; } catch { /* Storage can be unavailable. */ }
    this.fpsCheckbox.checked = showFps;
    this.fpsMeter.classList.toggle('visible', showFps && uiVisible);

    this.toggleButton.addEventListener('click', () => this.setOpen(!this.isOpen));
    document.getElementById('settings-close')!.addEventListener('click', () => this.setOpen(false));
    this.fpsCheckbox.addEventListener('change', () => {
      this.fpsMeter.classList.toggle('visible', this.fpsCheckbox.checked && uiVisible);
      try { localStorage.setItem(FPS_KEY, String(this.fpsCheckbox.checked)); } catch { /* Keep the current choice for this session. */ }
    });
  }

  get isOpen() { return this.panel.classList.contains('open'); }

  setOpen(open: boolean) {
    if (open) {
      this.onOpen();
      if (document.pointerLockElement) document.exitPointerLock();
    }
    this.panel.classList.toggle('open', open);
    this.toggleButton.setAttribute('aria-expanded', String(open));
    if (open) this.fpsCheckbox.focus();
    else if (this.panel.contains(document.activeElement)) this.toggleButton.focus();
  }

  update() {
    if (!this.fpsMeter.classList.contains('visible')) return;
    const fps = Math.round(this.app.fps);
    if (fps === this.shownFps) return;
    this.shownFps = fps;
    this.fpsMeter.textContent = fps > 0 ? `${fps} FPS` : '— FPS';
  }
}
