// Boot + the game loop. Fixed-timestep simulation (30 Hz) decoupled from
// rendering: the sim stays deterministic and cheap, the renderer interpolates
// between sim steps so motion is smooth at any refresh rate.
import { Graphics } from 'pixi.js';
import { createRenderer } from './engine/renderer';
import { createInput } from './engine/input';
import { CFG } from './game/data/config';
import { newState, type GameState } from './game/state';
import { GameLog } from './game/systems/log';
import { WorldGen, TILE } from './game/world/worldgen';
import { WorldArt } from './game/world/art';
import { World } from './game/world/world';
import { ChunkMap } from './game/world/chunkmap';
import { Views } from './game/world/views';
import { Player } from './game/world/player';
import { Camera } from './game/world/camera';
import { UI } from './game/ui/ui';
import { GatherSystem, VERB } from './game/systems/gather';
import { EconomySystem } from './game/systems/economy';
import { BuildSystem } from './game/systems/build';
import { HordeSystem } from './game/systems/hordes';
import { CombatSystem } from './game/systems/combat';
import { WorldBossSystem } from './game/systems/worldbosses';
import { craft } from './game/systems/crafting';
import { toggleEquip } from './game/rules';
import { phase, tintAt } from './game/systems/daynight';
import { Fog } from './game/world/fog';
import { domainAt, regionOf, regionKey } from './game/world/domains';
import { Sound } from './engine/audio';

const STEP = 1000 / 30;

function seedFromHash(): number | null {
  const m = location.hash.match(/s=(-?\d+)/);
  return m ? parseInt(m[1], 10) | 0 : null;
}

async function boot() {
  let seed = seedFromHash();
  if (seed === null) {
    seed = (Math.random() * 2 ** 31) | 0;
    history.replaceState(null, '', '#s=' + seed);
  }

  const stage = await createRenderer(document.getElementById('app')!);
  const gen = new WorldGen(seed);
  const art = new WorldArt(seed);
  const spawn = gen.findSpawn();

  const state: GameState = newState(seed, spawn);
  const world = new World(gen, state);
  const chunks = new ChunkMap(world, art, stage.ground);
  const views = new Views(stage.entities, art, world);
  views.reset(state.buildings);

  const player = new Player(seed, state.player.x, state.player.y);
  stage.entities.addChild(player.sprite);
  stage.entities.sortableChildren = true;

  const cam = new Camera(stage.app, stage.world);
  const input = createInput(document.getElementById('app')!);

  // day/night tint: a screen-space rectangle, multiply-blended over the world
  const tint = new Graphics();
  tint.blendMode = 'multiply';
  stage.app.stage.addChild(tint);

  // fog of sight sits above the tint — the unknown stays dark
  const fog = new Fog(stage.app, stage.app.stage);

  const log = new GameLog();

  // shared context every system reads/writes
  const ctx: any = {
    state, world, chunks, views, cam, player, spawnPoint: spawn, log,
    isNight: () => phase(state.clock).isNight,
    nightIndex: () => phase(state.clock).dayIndex,
    toast: (m: string, k?: any) => ui.toast(m, k),
    onGold: () => {},
    damagePlayer: (d: number) => combat.damagePlayer(d),
    onHallDestroyed: () => triggerGameOver(),
  };

  const gather = new GatherSystem(ctx);
  const economy = new EconomySystem(ctx);
  const build = new BuildSystem(ctx);
  const hordes = new HordeSystem(ctx);
  const combat = new CombatSystem(ctx);
  ctx.hordes = hordes;
  const worldbosses = new WorldBossSystem(ctx);
  ctx.worldbosses = worldbosses;

  const ui = new UI(state, {
    interact: () => gather.tryStart(),
    attack: () => combat.attack(),
    enterBuild: (id: string) => (id ? build.enter(id) : build.cancel()),
    craft: (id: string) => craft(state, id, ctx.toast, log),
    useItem: (id: string) => useItem(id),
    equip: (id: string) => equipItem(id),
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

  // hand the build system a way to drive the placement banner
  ctx.setBuildBanner = (n: string | null) => ui.setBuildBanner(n);

  function labelFor(def: any) { return (VERB[def.skill] ?? 'Gather') + ' ' + def.name; }

  function equipItem(id: string) {
    const slot = toggleEquip(state, id);
    if (!slot) return;
    const nowWorn = state.player.equip[slot] === id;
    ui.toast(`${nowWorn ? 'Equipped' : 'Unequipped'} ${ITEMS[id].name}`, nowWorn ? 'good' : 'info');
  }

  function useItem(id: string) {
    const heal = ITEMS[id]?.heal;
    if (!heal || (state.player.inv[id] ?? 0) <= 0) return;
    if (state.player.hp >= CFG.player.maxHp) { ui.toast('Already at full health'); return; }
    state.player.inv[id]--;
    if (state.player.inv[id] <= 0) delete state.player.inv[id];
    state.player.hp = Math.min(CFG.player.maxHp, state.player.hp + heal);
    ui.toast(`Used ${ITEMS[id].name} (+${heal} hp)`, 'good');
  }

  function triggerGameOver() {
    if (state.gameOver) return;
    state.gameOver = true;
    hordes.onDawn(); // clear the field
    log.push('death', 'The hall has fallen. The racket is finished.', state.clock);
    ui.showGameOver(() => { location.reload(); });
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
    sys: { gather, economy, build, hordes, combat, worldbosses }, world, player,
    get log() { return log.entries; },
    // test hook: advance the simulation deterministically (bypasses rAF)
    step: (n = 1, dt = STEP / 1000) => { for (let i = 0; i < n; i++) sim(dt); },
    craft: (id: string) => craft(state, id, ctx.toast, log),
  };

  stage.app.ticker.add((tk) => {
    frames++;
    acc = Math.min(acc + tk.deltaMS, 250); // clamp after tab-sleep
    while (acc >= STEP) {
      sim(STEP / 1000);
      acc -= STEP;
    }
    render(acc / STEP);
  });

  function sim(dt: number) {
    if (!state.gameOver) state.clock += dt;

    const ph = phase(state.clock);
    if (ph.isNight && !wasNight) { hordes.onDusk(ph.dayIndex); Sound.play('nightfall'); }
    if (!ph.isNight && wasNight) { hordes.onDawn(); Sound.play('dawn'); }
    wasNight = ph.isNight;

    const a = ui.isOpen() ? { x: 0, y: 0 } : input.axis();
    const moved = player.update(dt, a.x, a.y, (x, y) => world.canStand(x, y));
    state.player.x = player.x;
    state.player.y = player.y;

    // crossing into a new dream-domain: announce it, remember it
    const ptx = Math.floor(player.x / TILE), pty = Math.floor(player.y / TILE);
    const [gx, gy] = regionOf(ptx, pty);
    const rk = regionKey(gx, gy);
    if (rk !== state.region) enterRegion(ptx, pty, rk);

    gather.update(dt, moved);
    economy.update(dt);
    combat.update(dt);
    hordes.update(dt);
    worldbosses.update(dt);
  }

  function enterRegion(ptx: number, pty: number, rk: string) {
    state.region = rk;
    state.explored[rk] = 1;
    const dom = domainAt(ptx, pty, seed!);
    ui.setDomain(dom.name, dom.danger);
    log.push('region', `Entered ${dom.name}${dom.danger > 0 ? ` (${dom.lord.title})` : ''}`, state.clock);
    if (CFG.domain.announce) {
      Sound.play('discover');
      ui.toast(
        dom.danger > 0 ? `You enter ${dom.name} — a domain of ${dom.lord.title}` : `You enter ${dom.name}`,
        dom.danger > 2 ? 'bad' : 'info',
      );
    }
  }

  function render(alpha: number) {
    const [fx, fy] = player.render(alpha);
    player.sprite.zIndex = fy;
    cam.follow(fx, fy);

    const w = stage.app.screen.width, h = stage.app.screen.height;
    chunks.ensureAround(fx, fy, w / cam.zoom, h / cam.zoom);

    views.syncFoes(hordes.foes, alpha);
    views.syncBosses(state.worldBosses, alpha);
    for (const b of state.buildings) views.syncBuilding(b);

    const ph = phase(state.clock);
    const threat = worldbosses.nearestThreatTiles();
    const bossNear = threat != null && threat < CFG.worldBoss.warnTiles;

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
    fog.update(fogI);

    Sound.setMood(state.gameOver ? 'dead' : bossNear ? 'boss' : ph.isNight ? 'night' : 'day');
    ui.refresh();
  }
}

// ---- debug hotkeys (config.debug.enabled) ----
function setupDebug(ctx: any, hordes: HordeSystem, worldbosses: WorldBossSystem) {
  if (!CFG.debug.enabled) return;
  const { state } = ctx;
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    switch (e.key) {
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
    }
  });
  // expose the live config for runtime tuning from the console
  (window as any).NW = { CFG, state };
}

import { ITEMS } from './game/data/items';
boot();
