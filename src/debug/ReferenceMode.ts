// Developer-only visual validation: overlays a reference photo on the render with an opacity slider.
import type { Viewpoint } from './Viewpoints';

export class ReferenceMode {
  layer = document.getElementById('ref-layer')!;
  ctl = document.getElementById('ref-ctl')!;
  slider = document.getElementById('ref-opacity') as HTMLInputElement;
  label = document.getElementById('ref-label')!;
  next = document.getElementById('ref-next')!;
  enabled = false;
  current: Viewpoint | null = null;
  onNext?: () => void;
  constructor() {
    this.slider.addEventListener('input', () => this.setOpacity(Number(this.slider.value) / 100));
    this.next.addEventListener('click', () => this.onNext?.());
  }
  setOpacity(o: number) { this.layer.style.opacity = String(o); this.label.textContent = `${Math.round(o * 100)}%`; }
  setEnabled(v: boolean) {
    this.enabled = v;
    this.layer.style.display = v && this.current?.photo?.file ? 'block' : 'none';
    this.ctl.style.display = v ? 'flex' : 'none';
    if (v) this.setOpacity(Number(this.slider.value) / 100);
  }
  setViewpoint(v: Viewpoint | null) {
    this.current = v;
    const file = v?.photo?.file;
    this.layer.style.backgroundImage = file ? `url(/${file})` : 'none';
    this.layer.style.display = this.enabled && file ? 'block' : 'none';
  }
}
