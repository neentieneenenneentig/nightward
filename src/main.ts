// Boot + the game loop. Fixed-timestep simulation (30 Hz) decoupled from
// rendering: the sim stays deterministic and cheap, the renderer interpolates
// between sim steps so motion is smooth at any refresh rate.
import { Graphics } from 'pixi.js';
import { createRenderer } from './engine/renderer';
import { initCore, Core } from './wasm/core';
import { createInput } from './engine/input';
import { CFG } from './game/data/config';
import { newState, type GameState } from './game/state';
import { GameLog } from './game/systems/log';
import { WorldGen, TILE } from './game/world/worldgen';
import { WorldArt } from './game/world/art';
import { World } from './game/world/world';
import { WorldCore } from './game/world/core';
import { M, MATERIALS, packMaterials, STRIDE } from './game/data/materials';
import { ChunkMap, CHUNK } from './game/world/chunkmap';
import { Views } from './game/world/views';
import { Player } from './game/world/player';
import { Camera } from './game/world/camera';
import { UI, NET_LOG_LABELS, styleNetworkMsg } from './game/ui/ui';
import { GatherSystem, VERB } from './game/systems/gather';
import { EconomySystem } from './game/systems/economy';
import { BuildSystem } from './game/systems/build';
import { HordeSystem } from './game/systems/hordes';
import { CombatSystem } from './game/systems/combat';
import { WorldBossSystem } from './game/systems/worldbosses';
import { FireSystem } from './game/systems/fire';
import { EchoSystem } from './game/systems/echoes';
import { NetworkSystem } from './game/systems/network';
import { VitalsSystem } from './game/systems/vitals';
import { LoomSystem } from './game/systems/loom';
import { ScoreboardSystem } from './game/systems/scoreboard';
import { SoulFeedSystem } from './game/systems/soulfeed';
import { craft } from './game/systems/crafting';
import { activeEffects } from './game/systems/effects';
import { toggleEquip, invAdd } from './game/rules';
import { BUILDINGS } from './game/data/buildings';
import { NET_GAME_MAP, NET_METRICS, BEACON_INSPECT, LENS_SECTION_INSPECT, allBeacons, type NetInspect } from './game/data/network';
import { phase, tintAt } from './game/systems/daynight';
import { Fog } from './game/world/fog';
import { domainAt, regionOf, regionKey } from './game/world/domains';
import { Sound } from './engine/audio';
import { FloaterSystem } from './game/ui/floaters';
import { ParticleSystem } from './engine/particles';
import { PostProcess, type PostProcessConfig } from './engine/postprocess';
import { initScale } from './game/ui/scale';
import * as regression from './game/systems/regression';

const STEP = 1000 / 30;

/** `?seed=<int>` (query) overrides the random seed and makes acceptance scripts
 * deterministic; `#s=<int>` (hash) is the legacy "new world" link. */
function seedFromUrl(): number | null {
  const q = new URLSearchParams(location.search).get('seed');
  if (q !== null && /^-?\d+$/.test(q.trim())) return parseInt(q, 10) | 0;
  const m = location.hash.match(/s=(-?\d+)/);
  return m ? parseInt(m[1], 10) | 0 : null;
}

async function boot() {
  // M1: dynamic UI scaling — must run before any DOM measurements
  initScale();

  let seed = seedFromUrl();
  if (seed === null) {
    seed = (Math.random() * 2 ** 31) | 0;
    history.replaceState(null, '', '#s=' + seed);
  }

  // the Rust/wasm core comes online before anything reads it — R1 stores the
  // writable world in its linear memory. Boot order: init → new Core →
  // set_materials → (worldgen) → WorldCore → newState → World → systems.
  await initCore();
  const core = new Core(seed >>> 0, 4096);
  core.set_materials(packMaterials(), STRIDE);

  const stage = await createRenderer(document.getElementById('app')!);
  const gen = new WorldGen(seed);
  const art = new WorldArt(seed);
  const worldCore = new WorldCore(core, gen);
  worldCore.pushFireParams();
  const spawn = gen.findSpawn();

  const state: GameState = newState(seed, spawn);
  const world = new World(gen, state, worldCore);
  const chunks = new ChunkMap(world, art, stage.ground);
  const views = new Views(stage.entities, art, world);
  views.reset(state.buildings);

  const player = new Player(seed, state.player.x, state.player.y);
  stage.entities.addChild(player.cont);
  stage.entities.sortableChildren = true;

  const cam = new Camera(stage.app, stage.world);
  const input = createInput(document.getElementById('app')!);

  // day/night tint: a screen-space rectangle, multiply-blended over the world
  const tint = new Graphics();
  tint.blendMode = 'multiply';
  stage.app.stage.addChild(tint);

  // fog of sight sits above the tint — the unknown stays dark
  const fog = new Fog(stage.app, stage.app.stage);

  // combat floaters — WoW-style numbers for combat effects
  const floaters = new FloaterSystem(stage.entities);

  const log = new GameLog();

  // shared context every system reads/writes
  const ctx: any = {
    state, world, worldCore, chunks, views, cam, player, spawnPoint: spawn, log,
    floaters,
    isNight: () => phase(state.clock).isNight,
    nightIndex: () => phase(state.clock).dayIndex,
    toast: (m: string, k?: any) => ui.toast(m, k),
    onGold: () => {},
    damagePlayer: (d: number, src?: string) => combat.damagePlayer(d, src),
    onHallDestroyed: () => triggerGameOver(),
  };

  // G1: particle system — pre-allocated pool for gather poofs, fire embers, slash trails, etc.
  const particles = new ParticleSystem(stage.app.stage, 400);
  ctx.particles = particles;

  // G1: post-processing — bloom, color grading, vignette (between world and UI)
  const post = new PostProcess(stage.app.stage, stage.app.screen.width, stage.app.screen.height);
  ctx.post = post;
  stage.app.renderer.on('resize', () => {
    post.resize(stage.app.screen.width, stage.app.screen.height);
  });

  // G1: oil-painting Kuwahara filter — toggle with K, tweak via NW.painterly
  let painterlyEnabled = new URLSearchParams(location.search).has('painterly');
  let painterlyStrength = 0.85;
  let painterlyRadius = 2;
  (window as any).NW = { ...((window as any).NW ?? {}), painterly: {
    get enabled() { return painterlyEnabled; },
    set enabled(v: boolean) { painterlyEnabled = v; },
    get strength() { return painterlyStrength; },
    set strength(v: number) { painterlyStrength = Math.max(0, Math.min(1, v)); },
    get radius() { return painterlyRadius; },
    set radius(v: number) { painterlyRadius = Math.max(1, Math.min(4, v | 0)); },
  } };

  const gather = new GatherSystem(ctx);
  const economy = new EconomySystem(ctx);
  const build = new BuildSystem(ctx);
  const hordes = new HordeSystem(ctx);
  const combat = new CombatSystem(ctx);
  ctx.hordes = hordes;
  const worldbosses = new WorldBossSystem(ctx);
  ctx.worldbosses = worldbosses;
  const fire = new FireSystem(ctx);
  ctx.fire = fire;
  // C1: Echoes of the Slain — boss-granted auto-abilities (worldbosses.hurt grants)
  const echoes = new EchoSystem(ctx);
  ctx.echoes = echoes;

  // S1: Survival Pressure — vigor & resolve decay, restore via action
  const vitals = new VitalsSystem(ctx);
  ctx.vitals = vitals;

  // C3: The Loom — per-run passive tree, points from nights survived
  const loom = new LoomSystem(ctx);
  ctx.loom = loom;

  // W6: Scoreboards — connection uptime, death scorecard, leaderboard
  const scoreboard = new ScoreboardSystem(ctx);
  ctx.scoreboard = scoreboard;

  // W7: Soul-feeding — consume materials to grant XP to soul-bound gear
  const soulfeed = new SoulFeedSystem();
  ctx.soulfeed = soulfeed;

  // resonance system — polls browser APIs, feeds game systems
  const net = new NetworkSystem();
  ctx.net = net;
  net.onTransitionLog((msg: string) => {
    log.push('network', msg, state.clock);
  });
  net.onNetLog((kind: string, msg: string) => {
    log.push(kind as any, msg, state.clock);
  });
  // rift events — screen flash + toast on realm changes
  net.onRift((from, to) => {
    ctx.toast(`Realm Rift: ${from.name} → ${to.name}`, 'bad');
    const flash = document.createElement('div');
    flash.style.cssText = `position:fixed;inset:0;z-index:25;pointer-events:none;`
      + `background:${to.hex};opacity:0.4;transition:opacity 0.5s;`;
    document.body.appendChild(flash);
    requestAnimationFrame(() => { flash.style.opacity = '0'; });
    setTimeout(() => flash.remove(), 600);
    const px = state.player.x, py = state.player.y;
    particles.spawn('rift', px, py, 80);
    scoreboard.onRift();  // W6: count rifts survived
  });

  // N2a: The Lens — raw observatory panel (O key). 8 sections:
  // 1.Connection 2.Realm 3.Routes 4.Identity 5.Vessel 6.Threads 7.Feed 8.Inspect
  const obsPanel = document.createElement('div');
  obsPanel.id = 'nw-observatory';
  obsPanel.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:35;'
    + 'font-family:ui-monospace,Consolas,monospace;font-size:10px;line-height:1.35;'
    + 'color:#bbb;background:#080810f2;padding:12px 16px;border-radius:8px;'
    + 'border:1px solid #334;display:none;min-width:340px;max-width:420px;max-height:94vh;overflow-y:auto;'
    + 'pointer-events:auto;user-select:none;';
  obsPanel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;border-bottom:1px solid #334;padding-bottom:4px;">
      <span style="color:#aaa;font-weight:bold;font-size:12px;">🔍 The Lens</span>
      <span style="color:#555;font-size:9px;">O to close</span>
    </div>
    <div id="nw-lens-body"></div>
  `;
  document.body.appendChild(obsPanel);

  // N2a: Inspect detail box — appears on hover/tap of any Lens row
  const inspectBox = document.createElement('div');
  inspectBox.id = 'nw-lens-inspect';
  inspectBox.style.cssText = 'position:fixed;z-index:40;'
    + 'font-family:ui-monospace,Consolas,monospace;font-size:9px;line-height:1.4;'
    + 'color:#ccc;background:#0a0a16f8;padding:8px 10px;border-radius:6px;'
    + 'border:1px solid #557;display:none;max-width:320px;'
    + 'pointer-events:none;user-select:none;';
  document.body.appendChild(inspectBox);

  // Attach hover/tap handler to the Lens body (delegated)
  obsPanel.addEventListener('mouseover', (e) => {
    const target = (e.target as HTMLElement).closest('[data-inspect-key]') as HTMLElement | null;
    if (!target) { inspectBox.style.display = 'none'; return; }
    showInspectBox(target, inspectBox, e);
  });
  obsPanel.addEventListener('mouseout', (e) => {
    const target = (e.target as HTMLElement).closest('[data-inspect-key]') as HTMLElement | null;
    if (!target) { inspectBox.style.display = 'none'; return; }
    // Only hide if mouse actually left the Lens
    if (!obsPanel.contains(e.relatedTarget as Node)) {
      inspectBox.style.display = 'none';
    }
  });
  // Tap-to-pin on mobile (click toggles pin)
  obsPanel.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('[data-inspect-key]') as HTMLElement | null;
    if (!target) return;
    if (inspectBox.dataset.pinned === target.dataset.inspectKey) {
      inspectBox.dataset.pinned = '';
      inspectBox.style.display = 'none';
    } else {
      inspectBox.dataset.pinned = target.dataset.inspectKey ?? '';
      showInspectBox(target, inspectBox, e);
    }
  });

  function showInspectBox(target: HTMLElement, box: HTMLElement, e: MouseEvent) {
    const key = target.dataset.inspectKey ?? '';
    const inspectData = getInspectData(key);
    if (!inspectData) { box.style.display = 'none'; return; }
    box.innerHTML = `
      <div style="color:#f96;font-size:10px;font-weight:bold;margin-bottom:4px;">${key}</div>
      <div style="margin-bottom:3px;"><span style="color:#888;">SOURCE</span><br><span style="color:#ccc;">${inspectData.api}</span></div>
      <div style="margin-bottom:3px;"><span style="color:#888;">ACTION</span><br><span style="color:#ccc;">${inspectData.action}</span></div>
      <div><span style="color:#888;">FLOWS INTO</span><br><span style="color:#ccc;">${inspectData.flowsInto}</span></div>
    `;
    // Position beside the target, clamped to the viewport. The box height varies
    // with content (long SOURCE strings wrap), so measure the real size first —
    // the old hardcoded ~100px estimate let tall boxes run off the bottom, and the
    // left-flip could push the box past the left edge on narrow viewports.
    const rect = target.getBoundingClientRect();
    box.style.left = '0px';
    box.style.top = '-9999px';
    box.style.display = '';
    const bw = box.offsetWidth, bh = box.offsetHeight;
    let left = rect.right + 8;
    if (left + bw > window.innerWidth - 4) left = rect.left - bw - 8;
    left = Math.max(4, Math.min(left, window.innerWidth - bw - 4));
    let top = rect.top;
    top = Math.max(4, Math.min(top, window.innerHeight - bh - 4));
    box.style.left = left + 'px';
    box.style.top = top + 'px';
  }

  // O key toggles the Lens
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.key === 'o' || e.key === 'O') {
      e.preventDefault();
      const closing = obsPanel.style.display !== 'none';
      obsPanel.style.display = closing ? 'none' : '';
      // when closing the Lens, dismiss any pinned inspect popup too
      if (closing) {
        inspectBox.style.display = 'none';
        inspectBox.dataset.pinned = '';
      }
    }
    // V toggles the oil-painting Kuwahara filter
    if (e.key === 'v' || e.key === 'V') {
      e.preventDefault();
      painterlyEnabled = !painterlyEnabled;
      ctx.toast(`Oil-paint filter: ${painterlyEnabled ? 'ON' : 'OFF'}`, painterlyEnabled ? 'good' : 'info');
    }
    // M3: G = Scatter Cache — spend gold to reduce horde size
    if (e.key === 'G') {
      e.preventDefault();
      hordes.scatterCache();
    }
  });

  const ui = new UI(state, {
    interact: () => gather.tryStart(),
    attack: () => combat.attack(),
    ignite: () => fire.tryIgnite(),
    enterBuild: (id: string) => (id ? build.enter(id) : build.cancel()),
    startBuild: () => build.start(),
    cycleBuild: (dir: number) => build.cycle(dir),
    craft: (id: string) => { const ok = craft(state, id, ctx.toast, log, net); if (ok) vitals.markAction(); ui.rebuildPanel(); },
    useItem: (id: string) => { useItem(id); ui.rebuildPanel(); },
    equip: (id: string) => { equipItem(id); ui.rebuildPanel(); },
    feedSoul: (itemId: string, count: number, targetSlot: import('./game/data/soulgear').SoulSlot) => {
      const result = soulfeed.feed(state, itemId, count, targetSlot);
      if (result) {
        vitals.markAction();
        log.push('system',
          `Fed ${count}× ${ITEMS[itemId].name} → ${targetSlot} soul +${result.xp} xp` +
          (result.leveled ? ` (lv ${result.newLevel}!)` : ''),
          state.clock);
      }
      return result;
    },
    toggleMute: () => Sound.toggle(),
    newWorld: () => { location.hash = 's=' + ((Math.random() * 2 ** 31) | 0); location.reload(); },
    isPlacing: () => !!build.mode,
    logEntries: () => log.recent(100),
    gatherView: () => {
      if (gather.active) return { label: labelFor(gather.active.def), frac: gather.active.progress / gather.active.need };
      if (gather.target) return { label: labelFor(gather.target.def) + ' (E)', frac: 0 };
      return null;
    },
  });

  // hand the build system a way to drive the placement carousel banner
  ctx.setBuildBanner = (sel: { def: any; afford: number } | null) => ui.setBuildBanner(sel);

  function labelFor(def: any) { return (VERB[def.skill] ?? 'Gather') + ' ' + def.name; }

  function equipItem(id: string) {
    const slot = toggleEquip(state, id);
    if (!slot) return;
    const nowWorn = state.player.equip[slot] === id;
    ui.toast(`${nowWorn ? 'Equipped' : 'Unequipped'} ${ITEMS[id].name}`, nowWorn ? 'good' : 'info');
    log.push('system', `${nowWorn ? 'Equipped' : 'Unequipped'} ${ITEMS[id].name}`, state.clock);
  }

  function useItem(id: string) {
    const heal = ITEMS[id]?.heal;
    if (!heal || (state.player.inv[id] ?? 0) <= 0) return;
    if (state.player.hp >= CFG.player.maxHp) { ui.toast('Already at full health'); return; }
    state.player.inv[id]--;
    if (state.player.inv[id] <= 0) delete state.player.inv[id];
    state.player.hp = Math.min(CFG.player.maxHp, state.player.hp + heal);
    ui.toast(`Used ${ITEMS[id].name} (+${heal} hp)`, 'good');
    log.push('system', `Used ${ITEMS[id].name} (+${heal} hp)`, state.clock);
  }

  function triggerGameOver() {
    if (state.gameOver) return;
    state.gameOver = true;
    hordes.onDawn(); // clear the field
    log.push('death', 'The hall has fallen. The racket is finished.', state.clock);
    // W6: save scorecard and show death screen
    const card = scoreboard.saveToLeaderboard();
    ui.showGameOver(() => { location.reload(); }, card);
  }

  // --- canvas pointer: build placement, and click-to-attack on desktop ---
  // placement is press-to-aim, RELEASE-to-place: the ghost follows while the
  // button is down (dragging paints walls), and the building lands on pointerup
  const canvas = stage.app.canvas;
  canvas.addEventListener('pointermove', (e) => {
    if (!build.mode) return;
    if (e.buttons & 1) build.paint(e.clientX, e.clientY);
    else build.hover(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return; // only the primary button places/attacks
    if (build.mode) { build.hover(e.clientX, e.clientY); return; } // aim; place happens on release
    if (e.pointerType === 'mouse') combat.attack();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.button !== 0 || !build.mode) return;
    build.place(e.clientX, e.clientY);
  });
  // right-click always backs out of placement instead of opening the browser menu
  canvas.addEventListener('contextmenu', (e) => {
    if (build.mode) { e.preventDefault(); build.cancel(); }
  });
  // wheel flips through blueprints while placing (zoom will gate on !build.mode later)
  canvas.addEventListener('wheel', (e) => {
    if (!build.mode) return;
    e.preventDefault();
    build.cycle(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  setupDebug(ctx, hordes, worldbosses);

  // audio must start from a user gesture (browser autoplay policy)
  Sound.enabled = CFG.audio.enabled;
  const startAudio = () => {
    Sound.init();
    window.removeEventListener('pointerdown', startAudio);
    window.removeEventListener('keydown', startAudio);
  };
  window.addEventListener('pointerdown', startAudio);
  window.addEventListener('keydown', startAudio);

  // ---- the loop ----
  let acc = STEP;
  let wasNight = phase(state.clock).isNight;
  let frames = 0;
  (window as any).__nw = {
    get frames() { return frames; }, state, ctx, app: stage.app, ui,
    sys: { gather, economy, build, hordes, combat, worldbosses, fire, echoes, vitals, loom, scoreboard }, world, player, gen, chunks,
    get log() { return log; },  // expose full GameLog (entries + export + download)
    // test hook: advance the simulation deterministically (bypasses rAF)
    step: (n = 1, dt = STEP / 1000) => { for (let i = 0; i < n; i++) sim(dt); },
    craft: (id: string) => craft(state, id, ctx.toast, log, net),
    // R1: the writable-world seam. __nw.core is the WorldCore wrapper (materialAt,
    // setMaterial, overrideAt, pushMaterials, stats, _activate, _deactivate).
    core: worldCore,
    // paint a square of material (radius r) — the console verb behind the god brush
    paint: (matId: number, tx: number, ty: number, r = 0) => {
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++)
          worldCore.setMaterial(tx + dx, ty + dy, matId);
      log.push('world', `Painted ${MATERIALS[matId]?.name ?? matId}${r ? ` r${r}` : ''} at (${tx},${ty})`, state.clock);
    },
    // regression test suite — run via __nw.regression.run() or ?test URL param
    regression: {
      run: () => regression.runAll((window as any).__nw),
      runOne: (name: string) => regression.runOne((window as any).__nw, name),
      list: () => regression.list(),
    },
  };

  // ?test URL param → auto-run the regression suite after a short warm-up
  if (new URLSearchParams(location.search).has('test')) {
    setTimeout(() => regression.runAll((window as any).__nw), 500);
  }

  // D2: set initial clock phase to real time-of-day once; game then runs at
  // its own speed — no per-tick nudge toward wall clock.
  const cy = CFG.time.daySec + CFG.time.nightSec;
  state.clock = net.snap.timeOfDay * cy;

  stage.app.ticker.add((tk) => {
    frames++;
    const frameMs = Math.min(tk.deltaMS, 250); // clamp after tab-sleep
    scoreboard.updateReal(performance.now());  // W6: track connection uptime
    acc = Math.min(acc + tk.deltaMS, 250);
    while (acc >= STEP) {
      sim(STEP / 1000);
      acc -= STEP;
    }
    render(acc / STEP, frameMs);
  });

  function sim(dt: number) {
    if (!state.gameOver) state.clock += dt;

    // sim speed = pulse time → lag compensation (high pulse = slow sim)
    const simMul = net.getGameValue('simSpeed');
    const effectiveDt = dt * simMul;

    const ph = phase(state.clock);
    if (ph.isNight && !wasNight) { hordes.onDusk(ph.dayIndex); Sound.play('nightfall'); net.snapshotDuskRtt(); }
    if (!ph.isNight && wasNight) {
      hordes.onDawn();
      net.computeNightRttStability();
      vitals.onSurviveNight();
      loom.onNightSurvived();  // C3: nights survived = Loom points
      Sound.play('dawn');
      // Action-gated beacon echo — surviving the night pings the southern beacons
      net.probeAction('survive_night');
      // Passive pulse drift — dawn pulse minus dusk pulse, zero HTTP
      net.samplePassive('survive_night');
    }
    wasNight = ph.isNight;
    // S1: collect RTT samples during the night for stability tracking
    if (ph.isNight) net.sampleNightRtt();

    const a = ui.isOpen() ? { x: 0, y: 0 } : input.axis();
    const feetSpeed = world.speedAt(Math.floor(player.x / TILE), Math.floor(player.y / TILE));
    // N2a: move speed modifier from echo jitter — read from mapping (live-tweakable)
    const moveSpeedMul = net.getGameValue('moveSpeed');
    // S1: resolve-zero speed penalty
    const resolveSpeedMul = vitals.getSpeedMult();
    // C3: Loom move speed modifier
    const loomSpeedMul = 1 + (loom.ensureMods().moveSpeedPct / 100);
    const moved = player.update(dt, a.x, a.y, (x, y) => world.canStand(x, y),
      feetSpeed * moveSpeedMul * resolveSpeedMul * loomSpeedMul);
    state.player.x = player.x;
    state.player.y = player.y;

    // crossing into a new network domain: announce it, remember it
    const ptx = Math.floor(player.x / TILE), pty = Math.floor(player.y / TILE);
    const [gx, gy] = regionOf(ptx, pty);
    const rk = regionKey(gx, gy);
    if (rk !== state.region) enterRegion(ptx, pty, rk);

    gather.update(effectiveDt, moved);
    economy.update(effectiveDt);
    combat.update(effectiveDt);
    hordes.update(effectiveDt);
    worldbosses.update(effectiveDt);
    fire.update(effectiveDt);
    echoes.update(effectiveDt);
    vitals.update(effectiveDt);
    build.updateDecay(effectiveDt);  // C2: disconnect decay

    // N3: re-push fire params with network-driven modifiers every 2s
    if (Math.floor(state.clock / 2) !== Math.floor((state.clock - effectiveDt) / 2)) {
      const jitter = net.snap?.echoJitter ?? 5;
      const spreadMul = 1 + jitter / 50;  // high jitter → more spread
      const realmName = net.currentBiome?.name ?? '';
      const windMul = realmName === 'Cellular Chaos' ? 2.0
        : realmName === 'WiFi Wilds' ? 1.2 : 1.0;
      worldCore.pushFireParams({ spreadMul: Math.min(3, spreadMul), windMul });
    }
  }

  function enterRegion(ptx: number, pty: number, rk: string) {
    state.region = rk;
    state.explored[rk] = 1;
    const dom = domainAt(ptx, pty, seed!);
    ui.setDomain(dom.name, dom.danger);
    log.push('region', `Entered ${dom.name}${dom.danger > 0 ? ` (${dom.lord.title})` : ''}`, state.clock);
    // Passive trace chain refresh — re-reads Performance API, zero HTTP
    net.samplePassive('explore');
    // Action-gated beacon echo — new regions ping Far East discovery
    net.probeAction('explore');
    if (CFG.domain.announce) {
      Sound.play('discover');
      ui.toast(
        dom.danger > 0 ? `You enter ${dom.name} — a domain of ${dom.lord.title}` : `You enter ${dom.name}`,
        dom.danger > 2 ? 'bad' : 'info',
      );
    }
  }

  function render(alpha: number, frameMs: number) {
    const [fx, fy] = player.render(alpha);
    player.cont.zIndex = fy;
    cam.follow(fx, fy);

    const w = stage.app.screen.width, h = stage.app.screen.height;
    // world core first — activate/deactivate chunks so the baker below reads the
    // EFFECTIVE (override-aware) materials for anything freshly scrolled in
    worldCore.ensureAround(fx, fy, w / cam.zoom, h / cam.zoom);
    chunks.setPlayerPos(fx, fy);
    chunks.ensureAround(fx, fy, w / cam.zoom, h / cam.zoom);
    chunks.tickFoam(performance.now());
    chunks.tickGlow(performance.now());

    views.syncFoes(hordes.foes, alpha);
    views.syncBosses(state.worldBosses, alpha);
    for (const b of state.buildings) views.syncBuilding(b);

    const ph = phase(state.clock);
    const threat = worldbosses.nearestThreatTiles();
    const bossNear = threat != null && threat < CFG.worldBoss.warnTiles;
    const bossLordId = bossNear ? worldbosses.nearestThreatLordId() : null;

    // Combat mood: enemies nearby but no boss → combat music; boss near → per-boss or generic boss
    const foesNear = !bossNear && hordes.foes.some((f: any) => {
      const d = Math.hypot(f.x - fx, f.y - fy) / TILE;
      return d < 10; // within ~10 tiles
    });

    // ambient tint = day/night light blended toward the current dream's mood
    const base = tintAt(state.clock);
    const mood = domainAt(Math.floor(fx / TILE), Math.floor(fy / TILE), seed!).lord.mood;
    const s = CFG.domain.moodStrength;
    tint.clear();
    tint.rect(0, 0, w, h).fill({
      r: base[0] + (mood[0] - base[0]) * s,
      g: base[1] + (mood[1] - base[1]) * s,
      b: base[2] + (mood[2] - base[2]) * s,
      a: 255,
    });

    // limited sight — darker at night, darker still with a lord near
    let fogI = ph.isNight ? CFG.fog.nightIntensity : CFG.fog.dayIntensity;
    if (bossNear) fogI += CFG.fog.bossExtra;
    // X1: Nightseer Charm — the fog presses less
    if (activeEffects(state).has('night_vision')) fogI *= 0.65;
    fog.update(fogI);

    Sound.setMood(state.gameOver ? 'dead' : bossNear ? 'boss' : foesNear ? 'combat' : ph.isNight ? 'night' : 'day');
    if (bossLordId) Sound.setBossMood(bossLordId);
    else Sound.setBossMood(null);
    ui.refresh();
    floaters.update(performance.now() / 1000, cam);

    // G1: directional drop shadows — light from top-left during day, omnidirectional at night
    {
      if (ph.isNight) {
        views.setLight(0, 0.3, 0.3); // soft shadow directly below
      } else {
        views.setLight(0.7, 0.7, 0.5); // shadow toward bottom-right (light from top-left)
      }
    }

    // G1: particles update + render
    particles.update(frameMs / 1000);

    // G1: fire embers — spawn near burning tiles (periodic, capped)
    {
      const nowSec = performance.now() / 1000;
      if (!(window as any).__lastEmberSpawn) (window as any).__lastEmberSpawn = 0;
      if (nowSec - (window as any).__lastEmberSpawn > 0.15) { // every ~150ms
        (window as any).__lastEmberSpawn = nowSec;
        const burnView = world.core.burnView(
          Math.floor(fx / TILE / CHUNK), Math.floor(fy / TILE / CHUNK)
        );
        if (burnView) {
          let burnCount = 0;
          for (let i = 0; i < burnView.length; i++) {
            if (burnView[i] > 0) burnCount++;
          }
          if (burnCount > 0 && particles.activeCount < 300) {
            // Spawn embers at a few random burning positions in view
            for (let e = 0; e < Math.min(3, burnCount); e++) {
              const ri = (Math.random() * burnView.length) | 0;
              if (burnView[ri] > 0) {
                const etx = (Math.floor(ri / CHUNK) + Math.floor(fx / TILE / CHUNK) * CHUNK) * TILE + TILE / 2;
                const ety = (ri % CHUNK + Math.floor(fy / TILE / CHUNK) * CHUNK) * TILE + TILE / 2;
                particles.spawn('ember', etx, ety - 8, 2);
              }
            }
          }
        }
      }
    }

    // G1: night wisps — ambient floating particles during night near the player
    {
      if (ph.isNight && particles.activeCount < 350) {
        const nowSec = performance.now() / 1000;
        if (!(window as any).__lastWispSpawn) (window as any).__lastWispSpawn = 0;
        if (nowSec - (window as any).__lastWispSpawn > 0.8) { // every ~800ms
          (window as any).__lastWispSpawn = nowSec;
          const wx = fx + (Math.random() - 0.5) * 200;
          const wy = fy + (Math.random() - 0.5) * 150;
          particles.spawn('wisp', wx, wy, 1);
        }
      }
    }

    // G1: heal particles on HP regen (daylight healing)
    {
      const prevHp = (window as any).__prevPlayerHp;
      if (prevHp !== undefined && state.player.hp > prevHp && !ph.isNight) {
        particles.spawn('heal', fx, fy - 16, 3);
      }
      (window as any).__prevPlayerHp = state.player.hp;
    }

    particles.render();

    // G1: post-processing — collect bloom spots, apply color grade & vignette
    {
      const bloomSpots: Array<{ x: number; y: number; radius: number; intensity: number; color: [number, number, number] }> = [];

      // Beacon buildings emit a warm glow
      for (const b of state.buildings) {
        if (b.type === 'campfire') {
          const bx = (b.tx + 0.5) * TILE, by = (b.ty + 0.5) * TILE;
          bloomSpots.push({ x: bx, y: by, radius: 48, intensity: 0.7, color: [255, 160, 40] });
        }
      }

      // Color grade from biome
      const biome = net.getBiome();
      const gradeColors: Record<string, [number, number, number]> = {
        'ethernet': [255, 224, 192],  // warm amber
        'wifi': [192, 208, 255],      // cool blue
        'cellular': [255, 192, 192],  // harsh red
        'unknown': [200, 200, 200],   // neutral
      };
      const gradeTint = gradeColors[biome.id] ?? gradeColors['unknown'];
      const gradeStrength = 0.06; // subtle — per G1 spec (5-10%)

      // Vignette: darker at night, darker when offline
      let vignetteI = ph.isNight ? 0.25 : 0.10;
      if (!net.snap.online) vignetteI += 0.15;

      const ppCfg: PostProcessConfig = {
        bloomSpots,
        grade: { tint: gradeTint, strength: gradeStrength },
        vignetteIntensity: vignetteI,
        painterly: { enabled: painterlyEnabled, strength: painterlyStrength, radius: painterlyRadius },
      };
      post.apply(stage.app.screen.width, stage.app.screen.height, ppCfg, stage.app.canvas);
    }

    // update Resonance panel
    if (obsPanel.style.display !== 'none') {
      updateObservatory();
    }

    // sim tick — R2: this is where the fire CA actually advances. Feed REAL elapsed wall-clock
    // time (frameMs), not the fixed sim step: render() runs once per rendered frame regardless
    // of display refresh rate, so a constant dt here would make the CA's true tick rate scale
    // with fps (2x too fast at 60Hz, ~4.8x at 144Hz) — exactly the coupling the core's own
    // internal accumulator (fire_params[0], paced at 10Hz) is designed to avoid. Then flush
    // world changes: drain the core's changed-tile events (paint AND fire burnout both ride
    // this one channel) and rebake exactly those chunks once.
    core.tick(frameMs / 1000);

    // poll browser metrics & push to Rust core (non-blocking)
    net.update(performance.now());
    net.recordHistory(performance.now());
    worldCore.pushNetworkParams(net.packForCore());
    const changed = worldCore.drainEvents();
    fire.onWorldEvents(changed);
    if (changed.length) worldCore.bumpRebakes(chunks.rebakeTiles(changed));
  }

  // N2a: Lens update — rebuilds all 7 sections with inspect data attributes
  function updateObservatory() {
    const body = document.getElementById('nw-lens-body');
    if (!body) return;
    const s = net.snap;
    const biome = net.getBiome();
    const stability = net.getStability();
    const profile = (net as any).computeRealmProfile?.() ?? { median: s.rtt, variance: s.jitter * s.jitter };

    const attr = (key: string) => `data-inspect-key="${key}"`;

    let html = '';

    // ── 1. Connection ──
    html += '<div style="margin-bottom:6px;border-bottom:1px solid #2a2a3a;padding-bottom:4px;">';
    html += '<div style="color:#888;font-size:9px;margin-bottom:2px;">CONNECTION</div>';
    html += `<div style="display:flex;gap:8px;">`;
    html += `<span ${attr('connection-rtt')} style="color:#f96;cursor:help;">RTT <b>${s.rtt.toFixed(0)}</b>ms</span>`;
    html += `<span ${attr('connection-dl')} style="color:#6cf;cursor:help;">DL <b>${s.downlink.toFixed(1)}</b>Mbps</span>`;
    html += `<span ${attr('connection-jitter')} style="color:#fc6;cursor:help;">Jit <b>${s.jitter.toFixed(1)}</b>ms</span>`;
    html += `</div>`;
    html += `<div style="font-size:8px;color:#556;margin-top:1px;">`;
    html += `RTT quantized to 25 ms by browser · DL capped at 10 Mbps`;
    html += `<br>effectiveType: ${s.effectiveType} · type: ${s.connectionType || '— (desktop browsers hide this)'}`;
    html += ` · saveData: ${(navigator as any).connection?.saveData ? 'yes' : 'no'} · online: ${s.online}`;
    html += `</div></div>`;

    // ── 2. Realm profile ──
    html += '<div style="margin-bottom:6px;border-bottom:1px solid #2a2a3a;padding-bottom:4px;">';
    html += '<div style="color:#888;font-size:9px;margin-bottom:2px;">REALM PROFILE</div>';
    html += `<div ${attr('realm-profile')} style="cursor:help;">echo median ${profile.median.toFixed(0)}ms · variance ${(profile.variance).toFixed(0)} → <b style="color:${biome.hex}">${biome.name}</b></div>`;
    html += `<div style="margin-top:2px;height:3px;background:#222;border-radius:2px;overflow:hidden;">`;
    html += `<div style="height:100%;width:${Math.round(stability*100)}%;background:${biome.hex};transition:width 0.5s;"></div></div>`;
    html += `<div ${attr('realm-stability')} style="font-size:9px;color:#666;cursor:help;">Stability ${Math.round(stability*100)}%</div></div>`;

    // ── 3. Routes ──
    html += '<div style="margin-bottom:6px;border-bottom:1px solid #2a2a3a;padding-bottom:4px;">';
    html += '<div style="color:#888;font-size:9px;margin-bottom:2px;">ROUTES</div>';
    html += `<div ${attr('routes-origin')} style="font-size:9px;cursor:help;"><b>this origin</b> DNS ${s.pageDnsTime.toFixed(0)}ms · TCP — · TLS ${s.pageTlsTime.toFixed(0)}ms · TTFB ${s.pageTtfb.toFixed(0)}ms</div>`;
    const probes = s.endpointProbes ?? [];
    const seen = new Set<string>();
    for (const p of probes) {
      if (seen.has(p.label)) continue; seen.add(p.label);
      const route = (net as any).echoSamples?.get(p.host ?? p.label) as number[] | undefined;
      const last = p.rtt > 0 ? p.rtt : '—';
      const best = route?.length ? Math.min(...route).toFixed(0) : last;
      const med = route?.length ? [...route].sort((a,b)=>a-b)[Math.floor(route.length/2)].toFixed(0) : last;
      const warm = (net as any).warmedRoutes?.has(p.host ?? p.label) ? '🔥' : '';
      html += `<div ${attr(p.label)} style="font-size:9px;cursor:help;">${warm} ${p.label} · ${p.detail ?? ''} · last ${last}ms · best ${best}ms · med ${med}ms · n=${route?.length ?? 0}</div>`;
    }
    if (!probes.length) html += '<div style="font-size:9px;color:#555;">No beacons probed yet — attack to discover routes</div>';
    html += '</div>';

    // ── 4. Identity ──
    html += '<div style="margin-bottom:6px;border-bottom:1px solid #2a2a3a;padding-bottom:4px;">';
    html += '<div style="color:#888;font-size:9px;margin-bottom:2px;">IDENTITY</div>';
    const idRevealed = (net as any).identityFetched;
    html += `<div ${attr('identity-ip')} style="font-size:9px;cursor:help;">IP: ${idRevealed && s.publicIp ? s.publicIp : '— unrevealed (explore to reveal)'}</div>`;
    html += `<div ${attr('identity-isp')} style="font-size:9px;cursor:help;">ISP: ${idRevealed && s.isp ? s.isp : '— unrevealed (explore to reveal)'}</div>`;
    html += `<div style="font-size:9px;">City: ${idRevealed && s.city ? s.city : '— unrevealed (explore to reveal)'} · Country: ${idRevealed && s.country ? s.country : '—'}</div>`;
    html += `<div style="font-size:9px;">ASN: ${idRevealed && s.asn ? s.asn : '— unrevealed (explore to reveal)'}</div>`;
    html += `<div ${attr('identity-colo')} style="font-size:9px;cursor:help;">CF colo: ${s.colo || '—'} · warp: ${s.warp ? 'yes' : 'no'}</div>`;
    html += `<div style="font-size:9px;color:#887;">local gateway — not observable from a browser</div>`;
    html += '</div>';

    // ── 5. Vessel ──
    html += '<div style="margin-bottom:6px;border-bottom:1px solid #2a2a3a;padding-bottom:4px;">';
    html += '<div style="color:#888;font-size:9px;margin-bottom:2px;">VESSEL</div>';
    const ua = navigator.userAgent;
    const brand = /Edge|Chrome|Firefox|Safari/.exec(ua)?.[0] ?? '—';
    html += `<div ${attr('vessel-ua')} style="font-size:9px;cursor:help;">UA: ${brand} · cores: ${s.cpuCores} · RAM: ${s.deviceMemory}GB</div>`;
    html += `<div ${attr('vessel-screen')} style="font-size:9px;cursor:help;">Screen: ${screen.width}×${screen.height} @${devicePixelRatio}x · lang: ${navigator.language} · tz: ${Intl.DateTimeFormat().resolvedOptions().timeZone}</div>`;
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    const gpu = (gl as any)?.getParameter?.(gl?.RENDERER) ?? '—';
    html += `<div ${attr('vessel-gpu')} style="font-size:9px;cursor:help;">GPU: ${gpu}</div>`;
    html += '</div>';

    // ── 6. Threads (decoder ring) ──
    html += '<div style="margin-bottom:6px;border-bottom:1px solid #2a2a3a;padding-bottom:4px;">';
    html += '<div style="color:#888;font-size:9px;margin-bottom:2px;">THREADS</div>';
    const gmCtx = { snap: net.snap, distinctRegionsProbed: (net as any).distinctRegionsProbed ?? 0 };
    for (const gm of NET_GAME_MAP) {
      const raw = net.get(gm.netKey);
      const val = Math.max(gm.min, Math.min(gm.max, gm.transform(raw, gmCtx)));
      // Dormant threads: the mapping computes truthfully but no system consumes it yet.
      const dim = gm.dormant ? 'opacity:0.4;' : '';
      const tag = gm.dormant ? ' <span style="color:#557;">dormant</span>' : '';
      html += `<div ${attr(gm.target)} style="font-size:9px;cursor:help;${dim}">${gm.label} ×${val.toFixed(2)} ← ${gm.netKey} ${raw.toFixed(1)} (clamp ${gm.min}–${gm.max})${tag}</div>`;
    }
    html += `<div style="font-size:9px;">Realm ← ${biome.name} (${biome.id})</div>`;
    html += '</div>';

    // ── 7. Feed (last 30 truth-kind entries) ──
    html += '<div style="margin-bottom:6px;border-bottom:1px solid #2a2a3a;padding-bottom:4px;">';
    html += '<div style="color:#888;font-size:9px;margin-bottom:2px;">FEED</div>';
    const feedEntries = log.recentFeed(30);
    if (!feedEntries.length) {
      html += '<div style="font-size:9px;color:#555;">No truth events yet</div>';
    } else {
      for (const e of feedEntries) {
        const t = Math.floor(e.t);
        const ts = `${String((t/60)|0).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
        const kindLabel = NET_LOG_LABELS[e.kind] ?? e.kind;
        const styledMsg = styleNetworkMsg(e.msg);
        html += `<div ${attr('feed-entry')} style="font-size:8px;color:#888;cursor:help;">[${ts}] <span style="color:#f96;">${kindLabel}</span> ${styledMsg}</div>`;
      }
    }
    html += '</div>';

    body.innerHTML = html;
  }

  /** Draw a sparkline on a canvas element by id. */
  function drawSparkline(canvasId: string, data: number[], color: string, yMin: number, yMax: number) {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
    if (!canvas || data.length < 2) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;
    const w = canvas.width, h = canvas.height;
    ctx2d.clearRect(0, 0, w, h);

    // find actual data range
    let dMin = Infinity, dMax = -Infinity;
    for (const v of data) { if (v < dMin) dMin = v; if (v > dMax) dMax = v; }
    if (dMax === dMin) { dMin -= 1; dMax += 1; }
    // clamp to sensible display range
    const dispMin = yMin > 0 ? Math.min(dMin, yMin) : dMin;
    const dispMax = yMax > 0 ? Math.max(dMax, yMax) : dMax;
    const range = dispMax - dispMin || 1;

    const scaleX = w / Math.max(data.length - 1, 1);
    const scaleY = (h - 4) / range;

    // draw line
    ctx2d.strokeStyle = color;
    ctx2d.lineWidth = 1.5;
    ctx2d.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = i * scaleX;
      const y = h - 2 - (data[i] - dispMin) * scaleY;
      if (i === 0) ctx2d.moveTo(x, y);
      else ctx2d.lineTo(x, y);
    }
    ctx2d.stroke();

    // draw min/max labels
    ctx2d.fillStyle = '#666';
    ctx2d.font = '8px monospace';
    ctx2d.fillText(dispMax.toFixed(0), 2, 8);
    ctx2d.fillText(dispMin.toFixed(0), 2, h - 2);
  }
}

// ---- helpers ----

/** Resolve inspect metadata for a Lens row key: metric key, beacon label, or section id. */
function getInspectData(key: string): NetInspect | null {
  // 1. Check NET_METRICS rows (by key or label)
  const metric = NET_METRICS.find(m => m.key === key || m.label === key);
  if (metric?.inspect) return metric.inspect;
  // 2. Check beacon targets (by label)
  if (BEACON_INSPECT[key]) return BEACON_INSPECT[key];
  // 3. Check static section table
  if (LENS_SECTION_INSPECT[key]) return LENS_SECTION_INSPECT[key];
  // 4. Check NET_GAME_MAP rows (by target)
  const gm = NET_GAME_MAP.find(m => m.target === key);
  if (gm) {
    const srcMetric = NET_METRICS.find(m => m.key === gm.netKey);
    return {
      api: srcMetric?.inspect?.api ?? `Game mapping: ${gm.netKey} → ${gm.label}`,
      action: `always active — applies ${gm.label.toLowerCase()} modifier`,
      flowsInto: `${gm.target} (clamp ${gm.min}–${gm.max})`,
    };
  }
  return null;
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

// ---- debug hotkeys (config.debug.enabled) ----
function setupDebug(ctx: any, hordes: HordeSystem, worldbosses: WorldBossSystem) {
  if (!CFG.debug.enabled) return;
  const { state } = ctx;
  let brush = M.DIRT; // god-brush material, cycled with Shift+P
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    switch (e.key) {
      case 'p': { // god brush: paint the current material at the player's feet tile
        if (!state.god) break;
        const tx = Math.floor(state.player.x / TILE), ty = Math.floor(state.player.y / TILE);
        ctx.worldCore.setMaterial(tx, ty, brush);
        ctx.toast(`Painted ${MATERIALS[brush].name}`, 'info');
        ctx.log?.push('world', `Painted ${MATERIALS[brush].name} at (${tx},${ty})`, state.clock);
        break;
      }
      case 'P': { // Shift+P: cycle the brush material
        if (!state.god) break;
        brush = (brush + 1) % MATERIALS.length;
        ctx.toast(`Brush: ${MATERIALS[brush].name}`, 'info');
        break;
      }
      case 'x': { // deconstruct building at player's feet (refunds half cost)
        const tx = Math.floor(state.player.x / TILE), ty = Math.floor(state.player.y / TILE);
        const b = ctx.world.buildingAt(tx, ty);
        if (!b) { ctx.toast('No building here', 'info'); break; }
        if (b.type === 'hall') { ctx.toast("Can't deconstruct the Hall — it anchors the racket", 'bad'); break; }
        const def = BUILDINGS.find((d: any) => d.id === b.type);
        if (def) {
          for (const s of def.cost) invAdd(state, s.id, Math.ceil(s.n / 2));
        }
        state.buildings = state.buildings.filter((x: any) => x.uid !== b.uid);
        ctx.world.reindexBuildings();
        ctx.chunks.rebakeTile(tx, ty);
        ctx.toast(`Deconstructed ${def?.name ?? b.type}`, 'good');
        ctx.log?.push('world', `Deconstructed ${def?.name ?? b.type} at (${tx},${ty})`, state.clock);
        break;
      }
      case '.': state.clock += 30; ctx.toast('debug: +30s'); break;
      case 'y': { // summon the nearest world boss right on top of you
        const b = state.worldBosses.find((x: any) => x.reviveAt === 0);
        if (b) { b.x = b.px = state.player.x + 90; b.y = b.py = state.player.y; b.hunting = true; ctx.toast(`debug: ${b.name} summoned`, 'bad'); }
        void worldbosses; break;
      }
      case 'n': { // jump to next dusk
        const ph = phase(state.clock);
        const cy = CFG.time.daySec + CFG.time.nightSec;
        state.clock = Math.floor(state.clock / cy) * cy + CFG.time.daySec + 0.1;
        ctx.toast('debug: night falls'); void ph; break;
      }
      case 'g': state.player.gold += 50; break;
      case 'm':
        for (const id of ['log', 'plank', 'stone', 'copper_bar', 'fine_log'])
          state.player.inv[id] = (state.player.inv[id] ?? 0) + 10;
        ctx.toast('debug: +materials'); break;
      case 'h': state.player.hp = CFG.player.maxHp; break;
      case 'j': hordes.onDusk(phase(state.clock).dayIndex); break; // force a wave
      case 'u': { // god/test mode: immortal + effectively infinite everything
        state.god = !state.god;
        if (state.god) {
          state.player.gold += 99999;
          for (const id of Object.keys(ITEMS)) state.player.inv[id] = 9999;
          for (const s of SKILLS) state.player.xp[s.id] = Math.max(state.player.xp[s.id] ?? 0, 1e7);
          state.player.hp = CFG.player.maxHp;
        }
        ctx.toast(`debug: god mode ${state.god ? 'ON — immortal, everything unlocked' : 'OFF'}`, state.god ? 'good' : 'info');
        ctx.log?.push('system', `God mode ${state.god ? 'enabled' : 'disabled'}`, state.clock);
        break;
      }
    }
  });
  // expose the live config + materials table + network for runtime tuning from the console
  (window as any).NW = { ...((window as any).NW ?? {}), CFG, state, MATS: MATERIALS, ENEMIES, NET: ctx.net };
}

import { ITEMS } from './game/data/items';
import { SKILLS } from './game/data/skills';
import { ENEMIES } from './game/data/enemies';
boot();
