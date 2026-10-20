import * as THREE from 'three';
import type { App } from './App';
import { localToGeo } from '../geo/geo';
import type { InspectionData } from '../inspection/InspectionData';

interface InspectionRange {
  startFace: number;
  endFace: number;
  data: InspectionData;
}

const GITHUB_NEW_ISSUE = 'https://github.com/bnovc/san-francisco/issues/new';

export class ObjectInspector {
  active = false;
  private readonly raycaster = new THREE.Raycaster();
  private readonly panel = document.getElementById('object-panel')!;
  private readonly title = document.getElementById('object-title')!;
  private readonly kind = document.getElementById('object-kind')!;
  private readonly details = document.getElementById('object-details')!;
  private readonly source = document.getElementById('object-source') as HTMLAnchorElement;
  private readonly report = document.getElementById('object-report') as HTMLAnchorElement;
  private readonly toggle = document.getElementById('object-toggle')!;

  constructor(private readonly app: App, private readonly onOpen: () => void) {
    this.toggle.addEventListener('click', () => this.setActive(!this.active));
    document.getElementById('object-close')!.addEventListener('click', () => this.close());
  }

  setActive(active: boolean) {
    this.active = active;
    this.toggle.classList.toggle('active', active);
    this.toggle.setAttribute('aria-pressed', String(active));
    if (active && document.pointerLockElement === this.app.renderer.domElement) document.exitPointerLock();
    if (!active) this.close();
  }

  get isOpen() { return this.panel.classList.contains('open'); }

  close() {
    this.panel.classList.remove('open');
    this.panel.setAttribute('aria-hidden', 'true');
    if (this.panel.contains(document.activeElement)) this.toggle.focus();
  }

  inspectAt(clientX: number, clientY: number, mode: string, pointerLocked = false): boolean {
    const rect = this.app.renderer.domElement.getBoundingClientRect();
    const x = pointerLocked ? rect.left + rect.width / 2 : clientX;
    const y = pointerLocked ? rect.top + rect.height / 2 : clientY;
    const ndc = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.app.camera);
    this.raycaster.far = this.app.camera.far;
    const hit = this.raycaster.intersectObject(this.app.scene, true).find((candidate) => this.isVisible(candidate.object));
    if (!hit) return false;

    const data = this.dataFor(hit);
    const point = hit.point.clone();
    const geo = localToGeo(point.x, point.z);
    this.onOpen();
    this.title.textContent = data.title;
    this.kind.textContent = data.kind;
    this.details.replaceChildren();
    const facts = [...(data.facts ?? [])];
    if (data.id && !facts.some((fact) => fact.label === 'Feature ID')) facts.push({ label: 'Feature ID', value: data.id });
    if (hit.instanceId !== undefined) facts.push({ label: 'Instance', value: String(hit.instanceId + 1) });
    facts.push({ label: 'Position', value: `${point.x.toFixed(1)}, ${point.y.toFixed(1)}, ${point.z.toFixed(1)} m` });
    facts.push({ label: 'WGS84', value: `${geo.lat.toFixed(6)}, ${geo.lon.toFixed(6)}` });
    for (const fact of facts) {
      const row = document.createElement('div');
      row.className = 'object-fact';
      const label = document.createElement('span'); label.textContent = fact.label;
      const value = document.createElement('strong'); value.textContent = fact.value;
      row.append(label, value);
      this.details.append(row);
    }
    const source = document.createElement('p');
    source.className = 'object-source-note';
    source.textContent = data.source || 'Locally bundled scene object. The displayed position is the selected surface point.';
    this.details.append(source);
    if (data.sourceUrl) {
      this.source.href = data.sourceUrl;
      this.source.hidden = false;
      this.source.textContent = data.source?.startsWith('OpenStreetMap') ? 'View OpenStreetMap feature' : 'View source';
    } else {
      this.source.removeAttribute('href');
      this.source.hidden = true;
    }
    this.report.href = this.issueUrl(data, point, geo, mode);
    this.panel.classList.add('open');
    this.panel.setAttribute('aria-hidden', 'false');
    return true;
  }

  private issueUrl(data: InspectionData, point: THREE.Vector3, geo: { lat: number; lon: number }, mode: string) {
    const params = new URLSearchParams();
    params.set('title', `[Bug] ${data.title}`.slice(0, 180));
    params.set('body', [
      '### What happened?',
      '',
      '<!-- Describe the bug and what you expected to happen. -->',
      '',
      '### Steps to reproduce',
      '',
      '1. Open the game.',
      '2. Select the object shown below.',
      '3. Describe what happened.',
      '',
      '### Selected object',
      '',
      `- Name: ${data.title}`,
      `- Type: ${data.kind}`,
      ...(data.id ? [`- Feature ID: ${data.id}`] : []),
      `- In-game position: ${point.x.toFixed(1)}, ${point.y.toFixed(1)}, ${point.z.toFixed(1)} m`,
      `- WGS84: ${geo.lat.toFixed(6)}, ${geo.lon.toFixed(6)}`,
      `- View mode: ${mode}`,
      `- Game URL: ${window.location.href.split('#')[0]}`,
      '',
      '### Additional context',
      '',
      '<!-- Add a screenshot or other details if helpful. -->',
    ].join('\n'));
    return `${GITHUB_NEW_ISSUE}?${params.toString()}`;
  }

  private dataFor(hit: THREE.Intersection): InspectionData {
    const object = hit.object as THREE.Object3D & { userData: Record<string, any> };
    const instanceRecords = object.userData.inspectionInstances as (InspectionData | undefined)[] | undefined;
    if (hit.instanceId !== undefined && instanceRecords?.[hit.instanceId]) return instanceRecords[hit.instanceId]!;
    const ranges = object.userData.inspectionRanges as InspectionRange[] | undefined;
    if (hit.faceIndex !== undefined && ranges) {
      const match = ranges.find((range) => hit.faceIndex! >= range.startFace && hit.faceIndex! < range.endFace);
      if (match) return match.data;
    }
    for (let current: THREE.Object3D | null = object; current; current = current.parent) {
      const data = current.userData.inspection as InspectionData | undefined;
      if (data) return data;
    }
    return this.fallbackData(object, hit.instanceId);
  }

  private fallbackData(object: THREE.Object3D, instanceId?: number): InspectionData {
    const chain: THREE.Object3D[] = [];
    for (let current: THREE.Object3D | null = object; current; current = current.parent) chain.push(current);
    const names = chain.map((item) => item.name).filter(Boolean);
    const semantic = names.find((name) => /^(landmark:|hero:|traffic_|traffic$|city-life$|pedestrians$)/i.test(name));
    const raw = semantic ?? names.find((name) => !/^(scene|group|object|mesh|node|root|world|props|vegetation|city-base|city:-?\d+,-?\d+)$/i.test(name)) ?? 'Game object';
    const title = this.humanize(raw);
    const lower = names.join(' ').toLowerCase();
    let kind = 'Scene object';
    if (/traffic|vehicle|cable.?car|bus|sedan|taxi/.test(lower)) kind = 'Vehicle';
    else if (/pedestrian|walker|person/.test(lower)) kind = 'Pedestrian';
    else if (/tree|palm|hedge|shrub|vegetation/.test(lower)) kind = 'Vegetation';
    else if (/road|street|walkway|sidewalk|curb|rail|terrain|ground|water|park/.test(lower)) kind = 'Street or environment';
    else if (/building|massing|facade|roof|hero:|nintendo|apple_union/.test(lower)) kind = 'Building';
    else if (/landmark/.test(lower)) kind = 'Landmark';
    else if (/props|hydrant|bench|lamp|light|sign|kiosk|trash|meter/.test(lower)) kind = 'Street object';
    return {
      title,
      kind,
      facts: instanceId === undefined ? [] : [{ label: 'Instance', value: String(instanceId + 1) }],
      source: 'Locally bundled scene object. Its geometry and placement may be approximate.',
    };
  }

  private humanize(name: string) {
    return name.replace(/^(landmark:|hero:|traffic_)/i, '').replace(/^(facade:|massing:)/i, '')
      .replace(/[|:_-]+/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Game object';
  }

  private isVisible(object: THREE.Object3D) {
    for (let current: THREE.Object3D | null = object; current; current = current.parent) if (!current.visible) return false;
    const materials = (object as THREE.Mesh).material;
    if (materials) {
      const list = Array.isArray(materials) ? materials : [materials];
      if (list.every((material) => !material.visible)) return false;
    }
    return true;
  }
}
