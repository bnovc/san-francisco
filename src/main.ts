import * as THREE from 'three';
import { App } from './app/App';
import { Config } from './app/Config';
import { Settings } from './app/Settings';
import { World } from './world/World';
import { CityBase } from './world/CityBase';
import { geoToLocal } from './geo/geo';
import { WalkControls } from './player/WalkControls';
import { loadPlayerPosition, savePlayerPosition } from './player/PlayerSave';
import { PlayerAvatar } from './player/PlayerAvatar';
import { OrbitMode } from './player/OrbitMode';
import { Tour, TourStop } from './player/Tour';
import { Hud } from './debug/Hud';
import { Viewpoints, compassToYaw, yawToCompass } from './debug/Viewpoints';
import { ReferenceMode } from './debug/ReferenceMode';
import { installQa } from './debug/Qa';
import { Assets, BASE } from './assets/Assets';
import { Interaction } from './systems/Interaction';
import { Life } from './life/Life';
import { CityLife } from './life/CityLife';
import { Props } from './world/Props';
import { Hero, heroExcludeIds } from './world/Hero';
import { Vegetation } from './world/Vegetation';
import { NightLights } from './systems/NightLights';
import { QuestSystem } from './systems/QuestSystem';
import { ObjectInspector } from './app/ObjectInspector';

const loadingEl = document.getElementById('loading')!, bar = document.getElementById('loading-bar')!, msg = document.getElementById('loading-msg')!;
const progress = (m: string, f: number) => { msg.textContent = m; bar.style.width = `${Math.round(f * 100)}%`; };

async function main() {
  const savedPlayerPosition = loadPlayerPosition();
  const restoreSavedPosition = !Config.view && !Config.pos && savedPlayerPosition !== null;
  const app = new App(document.getElementById('app')!);
  const world = new World();
  app.scene.add(world.group);
  await Assets.loadManifests(['arch', 'street', 'retail', 'vehicles', 'veg', 'people']);
  for (const id of heroExcludeIds()) world.heroIds.add(id);
  await world.build(progress);
  progress('San Francisco city base', 0.70);
  const city = new CityBase(world);
  await city.load();
  app.scene.add(city.group);
  await city.ensureAround(restoreSavedPosition ? savedPlayerPosition!.x : 0, restoreSavedPosition ? savedPlayerPosition!.z : 0);
  progress('hero buildings', 0.72);
  const hero = new Hero(world, app);
  await hero.build();
  progress('props', 0.8);
  const props = new Props(world, app);
  await props.build();
  progress('vegetation', 0.85);
  const vegetation = new Vegetation(world, app);
  await vegetation.build();
  await world.plaza.furniture();
  const nightLights = new NightLights(app, Config.quality === 'low' ? 3 : 5);
  nightLights.setPositions([...props.lampPositions, ...props.plazaLampPositions], (x, z) => world.collision.floorAt(x, z, world.terrain.heightAt(x, z) + 0.5, 100));
  app.add(nightLights);
  app.add(vegetation);
  progress('life', 0.9);
  const life = new Life(world, app, props);
  if (!Config.noLife) await life.build();
  app.add(life);
  const cityLife = new CityLife(city, app);
  if (!Config.noLife) { await cityLife.build(); app.add(cityLife); }
  app.time.set(Config.time);
  document.addEventListener('twin:time', (e: any) => world.plaza.setNight(e.detail.night)); world.plaza.setNight(app.time.nightFactor);

  // --- player / modes ---
  const walk = new WalkControls(app.camera, world.collision, app.renderer.domElement);
  if (life.pedestrians) life.pedestrians.player = walk.body;
  walk.resolveDynamic = (pos, radius) => {
    life.pedestrians?.resolvePlayer(pos, radius);
    life.traffic?.resolvePlayer(pos, radius);
    if (!Config.noLife) cityLife.resolvePlayer(pos, radius);
  };
  walk.setThirdPerson(!Config.qa && !Config.view);
  const avatar = new PlayerAvatar(walk, app.scene);
  await avatar.load();
  const orbit = new OrbitMode(app.camera, app.renderer.domElement);
  const tour = new Tour(app.camera);
  app.add(walk); app.add(avatar); app.add(orbit); app.add(tour);
  const interaction = new Interaction(app, world, walk, hero);
  app.add(interaction);
  const hud = new Hud(app);
  const quests = new QuestSystem();
  const settings = new Settings(app, () => { quests.setOpen(false); walk.keys.clear(); }, Config.ui);
  const inspector = new ObjectInspector(app, () => { settings.setOpen(false); quests.setOpen(false); walk.keys.clear(); });
  app.add(settings);
  document.getElementById('quest-toggle')!.addEventListener('click', () => settings.setOpen(false));
  const viewpoints = new Viewpoints();
  await viewpoints.load(`${BASE}data/viewpoints.json`);
  const ref = new ReferenceMode();
  let mode: 'walk' | 'orbit' | 'tour' = Config.mode;
  const crosshair = document.getElementById('crosshair')!;
  const tourTitle = document.getElementById('tour-title')!;

  function setMode(m: 'walk' | 'orbit' | 'tour') {
    mode = m;
    walk.enabled = m === 'walk';
    orbit.setEnabled(m === 'orbit');
    if (m === 'tour') tour.start(tourStops()); else if (tour.enabled) tour.stop();
    if (m === 'orbit') { const t = walk.body.clone(); orbit.frame(t, 260, 200, 42); }
    if (m === 'walk') { if (document.pointerLockElement) document.exitPointerLock(); walk.applyLook(); }
    document.querySelectorAll('#toolbar button[data-mode]').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.mode === m));
    crosshair.style.display = m === 'walk' ? 'block' : 'none';
    tourTitle.style.display = m === 'tour' ? 'block' : 'none';
  }
  tour.onStop = (s) => { tourTitle.innerHTML = `${s.title}<small>${s.subtitle || ''}</small>`; if (s.time) app.time.set(s.time); };
  tour.onEnd = () => setMode('walk');

  function tourStops(): TourStop[] {
    return [
      { title: 'Union Square', subtitle: 'San Francisco · aerial', pos: [40, 140, 260], look: [0, 10, 0], duration: 6, hold: 3, time: 'day' },
      { title: 'Dewey Monument', subtitle: 'Victory, 1903 · centre of the square', pos: [-22, 6, 24], look: [0, 16, 0], duration: 7, hold: 3 },
      { title: 'Powell Street', subtitle: 'cable cars · Westin St. Francis', pos: [-68, 1.7, 110], look: [-73, 12, -60], duration: 7, hold: 3 },
      { title: 'Nintendo SAN FRANCISCO', subtitle: '331 Powell St · Powell & Geary', pos: [-62, -0.5, 58], look: [-84, 3, 44], duration: 6, hold: 4 },
      { title: 'Westin St. Francis', subtitle: '335 Powell St · Bliss & Faville, 1904', pos: [-30, 4, 0], look: [-90, 28, 0], duration: 7, hold: 3 },
      { title: 'Apple Union Square', subtitle: '300 Post St · Foster + Partners, 2016', pos: [44, 0.5, -36], look: [44, 6, -66], duration: 7, hold: 4 },
      { title: 'Chinatown Gate', subtitle: 'Grant Avenue at Bush Street', pos: [226, 5, -244], look: [217, 7, -274], duration: 7, hold: 4 },
      { title: 'Theater District', subtitle: 'Geary Street west of Mason', pos: [-237, 5, 66], look: [-288, 18, 83], duration: 6, hold: 3 },
      { title: 'The plaza', subtitle: 'terraces · palms · people', pos: [-30, 3, 30], look: [20, 2, -10], duration: 8, hold: 3 },
      { title: 'Sunset skyline', subtitle: 'Union Square at golden hour', pos: [120, 90, 180], look: [-20, 30, -40], duration: 9, hold: 5, time: 'sunset' },
    ];
  }

  // --- viewpoints UI ---
  const sel = document.getElementById('view-select') as HTMLSelectElement;
  for (const v of viewpoints.list) { const o = document.createElement('option'); o.value = v.id; o.textContent = `${v.id} · ${v.title}`; sel.appendChild(o); }
  function applyView(id: string): boolean {
    const v = viewpoints.get(id); if (!v) return false;
    setMode('walk');
    walk.setThirdPerson(false);
    const p = viewpoints.place(v, world.collision, world.buildings);
    walk.teleport(p.x, p.z, p.yaw, p.pitch, p.y - 1.7);
    app.camera.fov = Config.fov || p.fov; app.camera.updateProjectionMatrix();
    ref.setViewpoint(v);
    hud.show(`${v.id} · ${v.title}`);
    return true;
  }
  sel.addEventListener('change', () => applyView(sel.value));
  ref.onNext = () => { const i = viewpoints.list.findIndex((v) => v.id === ref.current?.id); const n = viewpoints.list[(i + 1) % viewpoints.list.length]; if (n) { sel.value = n.id; applyView(n.id); } };

  // --- toolbar ---
  document.querySelectorAll('#toolbar button[data-mode]').forEach((b) => b.addEventListener('click', () => setMode((b as HTMLElement).dataset.mode as any)));
  const timeSel = document.getElementById('time-select') as HTMLSelectElement; timeSel.value = Config.time;
  timeSel.addEventListener('change', () => app.time.set(timeSel.value as any));
  const destinationSel = document.getElementById('destination-select') as HTMLSelectElement;
  destinationSel.addEventListener('change', async () => {
    const geo = (lat: number, lon: number, yaw = 0): [number, number, number] => {
      const p = geoToLocal(lat, lon); return [p.x, p.z, yaw];
    };
    const destinations: Record<string, [number, number, number]> = {
      square: [-64, 60, compassToYaw(35)],
      chinatown: [225, -256, 0],
      theater: [-220, 65, Math.PI / 2],
      powell: [-60, 270, Math.PI],
      market15: geo(37.766121, -122.430968),
      mission: geo(37.7602, -122.4192),
      park: geo(37.7694, -122.4862),
      wharf: geo(37.8080, -122.4177),
      // Stand on the waterfront promenade east of the building and face west.
      ferry: geo(37.7956, -122.3924, compassToYaw(270)),
      beach: geo(37.7600, -122.5100),
    };
    const dest = destinations[destinationSel.value];
    if (!dest) return;
    await city.ensureAround(dest[0], dest[1]);
    setMode('walk'); walk.setThirdPerson(true); updateViewToggle();
    walk.teleport(dest[0], dest[1], dest[2], 0);
    destinationSel.value = '';
  });
  document.getElementById('btn-ref')!.addEventListener('click', () => ref.setEnabled(!ref.enabled));
  document.getElementById('btn-debug')!.addEventListener('click', () => hud.setVisible(!hud.visible));
  const viewToggle = document.getElementById('view-toggle')!;
  function updateViewToggle() { viewToggle.textContent = walk.thirdPerson ? 'Third person' : 'First person'; }
  viewToggle.addEventListener('click', () => { walk.setThirdPerson(!walk.thirdPerson); updateViewToggle(); });
  updateViewToggle();
  app.renderer.domElement.addEventListener('click', (event) => {
    if ((mode === 'walk' && inspector.active) || mode === 'orbit') {
      if (inspector.inspectAt(event.clientX, event.clientY, mode, document.pointerLockElement === app.renderer.domElement)) return;
      if (inspector.active || mode === 'orbit') return;
    }
    if (mode === 'walk') walk.requestLock();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && inspector.isOpen) { inspector.close(); return; }
    if (e.code === 'Escape' && settings.isOpen) { settings.setOpen(false); return; }
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.code === 'Digit1') app.time.set('day'); if (e.code === 'Digit2') app.time.set('sunset'); if (e.code === 'Digit3') app.time.set('night');
    if (e.code === 'Tab') { e.preventDefault(); setMode(mode === 'orbit' ? 'walk' : 'orbit'); }
    if (e.code === 'KeyT') setMode(mode === 'tour' ? 'walk' : 'tour');
    if (e.code === 'KeyR') ref.setEnabled(!ref.enabled);
    if (e.code === 'KeyI' && Config.ui) { e.preventDefault(); inspector.setActive(!inspector.active); if (inspector.active) walk.keys.clear(); }
    if (e.code === 'F1') { e.preventDefault(); hud.setVisible(!hud.visible); }
    if (e.code === 'KeyQ') { e.preventDefault(); settings.setOpen(false); quests.toggle(); }
    if (e.code === 'KeyE') interaction.activate();
    if (e.code === 'KeyF') interaction.toggleFlashlightHint();
    if (e.code === 'KeyV') { walk.setThirdPerson(!walk.thirdPerson); updateViewToggle(); }
  });

  // --- start position: Geary & Powell corner looking NE at the square (or a viewpoint / explicit pos) ---
  hud.setVisible((Config.debug || Config.qa) && Config.ui);
  if (!Config.ui) for (const id of ['toolbar', 'help', 'crosshair', 'prompt', 'object-panel']) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
  setMode(mode);
  if (Config.view && applyView(Config.view)) { /* placed */ }
  else if (Config.pos) { const [x, y, z] = Config.pos.split(',').map(Number); const [h, p] = (Config.look || '35,0').split(',').map(Number); await city.ensureAround(x, z); walk.teleport(x, z, compassToYaw(h), THREE.MathUtils.degToRad(p), Number.isFinite(y) ? y : undefined); }
  else if (restoreSavedPosition) { const p = savedPlayerPosition!; walk.teleport(p.x, p.z, p.yaw, p.pitch, p.y); }
  else walk.teleport(-64, 60, compassToYaw(35), -0.03);
  if (mode === 'orbit') setMode('orbit');
  if (Config.ref) ref.setEnabled(true);

  let streamT = 0;
  let playerSaveT = 0;
  const saveCurrentPlayerPosition = () => {
    if (walk.grounded) savePlayerPosition({ x: walk.body.x, y: walk.footY, z: walk.body.z, yaw: walk.yaw, pitch: walk.pitch });
  };
  window.addEventListener('pagehide', saveCurrentPlayerPosition);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveCurrentPlayerPosition(); });
  const exteriorGroups = () => ['world', 'city-base', 'props', 'vegetation'].map((n) => app.scene.getObjectByName(n)).filter(Boolean) as THREE.Object3D[];
  app.add({ update: (dt) => { playerSaveT += dt; if (playerSaveT >= 1) { playerSaveT = 0; saveCurrentPlayerPosition(); } const location = mode === 'orbit' ? orbit.controls.target : mode === 'tour' ? app.camera.position : walk.body; hud.setLocation(location.x, location.z); hud.update(mode); streamT += dt; if (streamT > 0.5) { streamT = 0; world.stream(app.camera.position);
    const c = app.camera.position; city.update(c.x, c.z); const below = c.y < world.collision.terrain(c.x, c.z) - 2.5;   // windowless lower level → skip the city
    const nearCore = Math.abs(c.x) < 650 && Math.abs(c.z) < 650;
    for (const g of exteriorGroups()) g.visible = !below && (g.name === 'city-base' || nearCore); } } });
  hud.extra = () => interaction.hudLine();
  loadingEl.style.display = 'none';
  app.start();
  // warm-up: force shader compilation for visible materials
  app.renderer.compile(app.scene, app.camera);

  installQa({
    ready: true,
    setView: applyView,
    setCamera: (x, y, z, headingDeg, pitchDeg, fov) => { setMode('walk'); walk.teleport(x, z, compassToYaw(headingDeg), THREE.MathUtils.degToRad(pitchDeg), y - 1.7); if (fov) { app.camera.fov = fov; app.camera.updateProjectionMatrix(); } },
    setTime: (p) => app.time.set(p),
    setMode,
    freeze: (v) => { life.frozen = v; cityLife.frozen = v; },
    stats: () => ({ ...app.stats(), ...life.stats(), ...cityLife.stats(), ...city.stats() }),
    viewpoints: () => viewpoints.list.map((v) => v.id),
    renderOnce: () => app.renderOnce(),
    interact: () => interaction.activate(),
    teleport: (x, z, headingDeg) => walk.teleport(x, z, headingDeg !== undefined ? compassToYaw(headingDeg) : undefined),
    move: (dx, dz, seconds) => new Promise((res) => { const start = performance.now(); const key = dz < 0 ? 'KeyW' : dz > 0 ? 'KeyS' : dx > 0 ? 'KeyD' : 'KeyA'; walk.keys.add(key); setTimeout(() => { walk.keys.delete(key); res(); }, seconds * 1000); void start; }),
    look: (h, p) => { walk.yaw = compassToYaw(h); walk.pitch = THREE.MathUtils.degToRad(p); walk.applyLook(); },
    nearby: () => interaction.nearby(),
    pos: () => ({ x: app.camera.position.x, y: app.camera.position.y, z: app.camera.position.z, heading: yawToCompass(walk.yaw) }),
    lifeStats: () => life.stats(),
    storefronts: () => hero.storefrontList(),
    enter: (id) => interaction.enter(id),
    log: [],
    ...({ buildingAt: (x: number, z: number) => { let best: any = null, bd = 1e9; for (const i of world.buildings.infos.values()) { const d = Math.hypot(i.footprint[0][0] - x, i.footprint[0][1] - z); if (d < bd) { bd = d; best = i; } } return best && { id: best.id, name: best.name, address: best.address, height: best.height, floors: best.floors, style: best.style, floorH: best.floorH, baseY: best.baseY, fp: best.footprint }; }, world, city, walk, app, hero, life, props } as any),
    quests: () => quests.snapshot(),
    activateQuest: (id: string) => quests.activate(id),
    setQuestProgress: (id: string, progress: number) => quests.setProgress(id, progress),
    completeQuest: (id: string) => quests.complete(id),
  });
}
main().catch((e) => { console.error(e); msg.textContent = 'Error: ' + (e?.message || e); (window as any).__twinError = String(e?.stack || e); });
