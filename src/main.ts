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
import { Lens } from './game/ui/lens';
import { ChronicleStore, CHRONICLE_SERIES, exportChronicle, sampleChronicle } from './game/systems/chronicle';
import { OmenSystem } from './game/systems/omens';
import { DropSystem } from './game/systems/drops';
import { GatherSystem, verbFor } from './game/systems/gather';
import { EconomySystem } from './game/systems/economy';
import { BuildSystem } from './game/systems/build';
import { HordeSystem } from './game/systems/hordes';
import { CombatSystem } from './game/systems/combat';
import { WorldBossSystem } from './game/systems/worldbosses';
import { FireSystem } from './game/systems/fire';
import { EchoSystem } from './game/systems/echoes';
import { AbilitySystem } from './game/systems/abilities';
import { NetworkSystem } from './game/systems/network';
import { VitalsSystem } from './game/systems/vitals';
import { LifespanSystem } from './game/systems/lifespan';
import { LoomSystem } from './game/systems/loom';
import { WeaveSystem } from './game/systems/weaves';
import { HubSystem } from './game/systems/hub';
import { SoundingSystem, soundingReward } from './game/systems/sounding';
import { ScoreboardSystem } from './game/systems/scoreboard';
import { SoulFeedSystem } from './game/systems/soulfeed';
import { MaterialEffectSystem } from './game/systems/materialEffects';
import { craft } from './game/systems/crafting';
import { activeBoons, activeEffects, grantBoon, moveBurstMul, tickBoons, venomStacks } from './game/systems/effects';
import { toggleEquip, invAdd, gearMod, playerMaxHp } from './game/rules';
import { BUILDINGS } from './game/data/buildings';
import { canSwear, covenantDef } from './game/data/covenants';
import { NET_GAME_MAP, NET_METRICS, BEACON_INSPECT, LENS_SECTION_INSPECT, allBeacons, type NetInspect } from './game/data/network';
import { Minimap } from './game/ui/minimap';
// A1/A4 test seam. The Gauntlet can only observe the roll through the same
// pure functions the game calls — asserting that rollItem() returned an object
// would pass with the whole merge deleted. Namespace imports so a new export is
// automatically reachable from a test without another edit here.
import * as rulesMod from './game/rules';
import * as lootMod from './game/systems/loot';
import * as itemsMod from './game/data/items';
import * as effectsMod from './game/systems/effects';
import { nightFrac, phase, phaseRemaining, tintAt, startClock } from './game/systems/daynight';
import { Fog } from './game/world/fog';
import { domainAt, regionOf, regionKey } from './game/world/domains';
import { Sound } from './engine/audio';
import { gfxTier, vesselLine } from './game/systems/vessel';
import { FloaterSystem } from './game/ui/floaters';
import { ParticleSystem } from './engine/particles';
import { PostProcess, type PostProcessConfig, type GlowSpot } from './engine/postprocess';
import { DecalLayer } from './engine/decals';
import { actFor, ACT_LABEL } from './game/systems/acts';
import { lookFor } from './engine/shaders/look';
import { BUILDING_LIGHT } from './game/data/lights';
import { isBeamworthy, rarityTint } from './game/ui/rarity';
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
  // G1: relief lighting on by default; ?norelief boots without it and R toggles
  // it live, so the two looks can be compared on the same seed and camera.
  const chunks = new ChunkMap(world, art, stage.ground, {
    relief: !new URLSearchParams(location.search).has('norelief'),
    seed,
  });
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
    // B5 Q2 test seam: the icon atlas, so the suite can prove a coin is drawn
    // as coins rather than as art.itemIcon()'s grey-pebble fallback for unknown ids.
    art,
    floaters,
    isNight: () => phase(state.clock).isNight,
    nightIndex: () => phase(state.clock).dayIndex,
    toast: (m: string, k?: any) => ui.toast(m, k),
    onGold: () => {},
    damagePlayer: (d: number, src?: string, foe?: any) => combat.damagePlayer(d, src, foe),
    onHallDestroyed: () => triggerGameOver('hall_fallen'),
    // SR7: hit-stop request — the caller doesn't own the timer, it just names
    // how much weight it wants; concurrent requests take the longer one.
    // CFG.gfx.feel is the real revert: false means every SR7 juice call in
    // this codebase becomes a no-op at its own single choke point.
    requestHitstop: (ms: number) => {
      if (CFG.gfx.feel === false) return;
      hitstopMs = Math.max(hitstopMs, ms);
    },
    // SR1: see simTicks above.
    elapsedRealSec: () => simTicks * (STEP / 1000),
  };

  // G1: particle system — pre-allocated pool for gather poofs, fire embers, slash trails, etc.
  //
  // Parented to stage.world, NOT to app.stage. Every call site passes WORLD
  // pixels (the module's own doc comment says so, and the wisp/ember/heal sites
  // all derive their coordinates from the player's world position), but
  // app.stage is screen space — the camera only ever transforms stage.world.
  // So every particle in the game was being drawn at its world coordinate as
  // though that were a screen coordinate, which is correct only while the
  // player is near the origin. That is where a run starts, which is why this
  // survived since G1: walk a few hundred tiles and the effects silently leave
  // the viewport. Found while capturing B6 gate shots — the level-up burst drew
  // its rings (views.fx, world-space) and none of its motes.
  const particles = new ParticleSystem(stage.world, 400);
  ctx.particles = particles;

  // SR7: ground decals — blood pools under entities, gone by the dawn that
  // outlives them. Separate ring buffer from particles; see decals.ts for why.
  const decals = new DecalLayer(stage.world, stage.entities);
  ctx.decals = decals;

  // SR4: post-processing. The glow layer goes inside `stage.world` — the camera
  // container — which is what makes world-space light sources land on the thing
  // that emits them without a single coordinate conversion. The grade goes on
  // the stage, above everything Pixi draws and below the HUD, which is DOM.
  const post = new PostProcess(stage.app, stage.world, stage.app.screen.width, stage.app.screen.height, {
    lightBufferScale: CFG.gfx.lightBufferScale,
  });
  ctx.post = post;
  // 'auto' waits for the vessel to describe itself (see below); an explicit tier
  // is honoured immediately and never overridden, because a person who set it
  // meant it.
  if (CFG.gfx.tier !== 'auto') post.applyTier(CFG.gfx.tier);
  post.setGraded(CFG.gfx.palette !== false);
  // SR5: the ambient-darkening half of "darkness with pools of light" is a real
  // revert too — see PostProcess.apply and look.ts's `lights` gate.
  post.lightsEnabled = CFG.gfx.lights !== false;
  post.bloomEnabled = CFG.gfx.bloom !== false;
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

  // B5: Ground Drops — loot lands on the floor. Constructed BEFORE the three
  // loot systems because each of them calls ctx.drops.spawn() the first time
  // anything is gathered or killed.
  const drops = new DropSystem(ctx);
  ctx.drops = drops;

  // A4: the corner radar. Entity-only, 10 Hz, no terrain sampling — see the
  // header of ui/minimap.ts for why it is a local radar and not a world map.
  const minimap = new Minimap(document.getElementById('hud')!);

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
  // A3: The Bar - the same echoes, pressed for and paid for in Resolve.
  // Constructed AFTER EchoSystem because it casts through it; before VitalsSystem
  // only because that is where it reads best.
  const abilities = new AbilitySystem(ctx);
  ctx.abilities = abilities;

  const vitals = new VitalsSystem(ctx);
  ctx.vitals = vitals;

  // L1: The Lifespan — hard run-length clock; ages via real time, ends the
  // run in death of natural causes independent of combat/hall state
  const lifespan = new LifespanSystem(ctx);
  ctx.lifespan = lifespan;
  ctx.onOldAgeDeath = () => triggerGameOver('old_age');

  // C3: The Loom — per-run passive tree, points from nights survived
  const loom = new LoomSystem(ctx);
  ctx.loom = loom;

  // A5: Sockets & Weaves — threads socket into rolled gear, in order, and a
  // recognised sequence completes a weave. Pure passive reads (no per-frame
  // update); combat/vitals/worldbosses consult its typed bonus getters.
  const weaves = new WeaveSystem(ctx);
  ctx.weaves = weaves;

  // A6: the hub. Constructed after WeaveSystem because a reworked item keeps
  // its uid and therefore its sockets, and after loot because both counters
  // are thin wrappers over rollItem()/reforgeAffix(). No update() — a shop
  // ticks when the player presses a button and at no other time.
  const hub = new HubSystem(ctx);
  ctx.hub = hub;

  // W6: Scoreboards — connection uptime, death scorecard, leaderboard
  const scoreboard = new ScoreboardSystem(ctx);
  ctx.scoreboard = scoreboard;

  // W7: Soul-feeding — consume materials to grant XP to soul-bound gear
  const soulfeed = new SoulFeedSystem();
  ctx.soulfeed = soulfeed;

  // N2b: Material effect hooks — per-tile gameplay effects from materials
  const matFx = new MaterialEffectSystem(ctx);
  ctx.matFx = matFx;

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

  // N4.5: the Sounding Stone and the Covenant it reads. Instantiated after the
  // NetworkSystem because a sounding's resolver race reads net.resolverStats;
  // no update() — the stone ticks only when the player presses it.
  const sounding = new SoundingSystem(ctx);
  ctx.sounding = sounding;

  // N4.2: The Lens is now a right-edge side cart (src/game/ui/lens/). It used
  // to be a centred modal that covered the game, which is exactly the wrong
  // shape for a panel whose whole premise is that these numbers are driving the
  // world in front of you. The 115 lines of string concatenation that used to
  // live here are five tab modules now.
  const chronicle = new ChronicleStore();
  for (const m of CHRONICLE_SERIES) chronicle.define(m);
  net.chronicle = chronicle;

  // N4.3: Omens — the Chronicle's detected step changes stop being Feed lines
  // and become world states with real multipliers. This is the half of N4 that
  // makes the network the world rather than a readout beside it.
  const omens = new OmenSystem({
    clock: () => state.clock,
    chronicle,
    toast: (m, k) => ui.toast(m, (k ?? 'bad') as any),
    log,
    rift: (reason) => net.riftFromWire(reason),
    fx: (o) => {
      // Good omens rise off the player as wisps; bad ones tear like a rift. The
      // rift kind spawns nothing here because net.onRift() already does the
      // full-screen flash — doubling it would just be loud.
      if (o.kind === 'rift') return;
      particles.spawn(o.def.good ? 'wisp' : 'rift', player.x, player.y - 8, o.def.good ? 14 : 22);
    },
  });
  ctx.omens = omens;

  let lastChronicleT = -1;

  const lens = new Lens(
    { net, chronicle, log, omens, sounding, inspectFor: getInspectData },
    () => exportChronicle(chronicle, net, state, omens),
  );

  // O key toggles the Lens
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.key === 'o' || e.key === 'O') {
      e.preventDefault();
      lens.toggle();
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
    // G1: R toggles height-field relief lighting
    if (e.key === 'R') {
      e.preventDefault();
      const on = !chunks.reliefEnabled;
      chunks.setRelief(on);
      ctx.toast(`Relief lighting: ${on ? 'ON' : 'OFF'}`, on ? 'good' : 'info');
    }
  });

  const ui = new UI(state, {
    // A6: one key, two meanings. The hub wins when one is in reach because
    // CFG.a6.reachTiles (1.5) is tighter than CFG.gather.reachTiles (1.6) —
    // so a node and a counter can only both be live when you are practically
    // inside the counter, and that is the thing you walked up to. A gather
    // already in progress is never interrupted: tryStart() is what stops it
    // being re-entered, and the hub check runs before it precisely so the
    // panel cannot open on top of a swing you are mid-way through.
    interact: () => {
      if (!gather.active) {
        const h = hub.near();
        if (h) { ui.open(h.kind); return; }
      }
      gather.tryStart();
    },
    hubView: () => {
      const h = hub.near();
      return h ? { kind: h.kind, name: h.def.name } : null;
    },
    hubOffers: (slot: any) => hub.offers(slot),
    hubBuy: (slot: any, sealId: string) => { const r = hub.buy(slot, sealId); if (r.ok) ui.rebuildPanel(); return r; },
    hubBench: () => hub.bench(),
    hubReforge: (uid: string, index: number) => { const r = hub.reforge(uid, index); if (r.ok) ui.rebuildPanel(); return r; },
    // N4.5: the Sounding Stone's panel. Reads the live system; the run verb
    // below fires the sounding and pays out the reward on completion.
    soundingView: () => {
      const cov = sounding.pact();
      return {
        pactName: cov.name,
        budgetLabel: cov.budgetLabel,
        budgetMB: cov.budgetMB,
        spentMB: sounding.spent / 1e6,
        leftMB: sounding.budgetLeft() / 1e6,
        busy: sounding.busy,
        count: sounding.count,
        cooldownSec: Math.max(0, Math.ceil(sounding.readyAt - state.clock)),
        blocked: sounding.blocked(),
        last: sounding.last,
      };
    },
    runSounding: () => {
      if (sounding.busy) return;
      sounding.sound().then((r) => {
        const reward = soundingReward(r);
        if (reward.gold) { state.player.gold += reward.gold; ctx.onGold?.(); }
        if (reward.boon) grantBoon(state, reward.boon);
        if (reward.line) log.push('system', reward.line, state.clock);
        if (reward.boon) ctx.toast(`${reward.boon.name} — +${reward.gold} gold`, 'good');
        else if (reward.gold) ctx.toast(`+${reward.gold} gold`, 'good');
        else ctx.toast('The stone heard nothing back.', 'info');
        ui.rebuildPanel();
      });
    },
    // N4.5/A7: the covenant picker. The UI forwards the verb; the raise-only
    // rule and the price both live in data/covenants.ts, so a panel can never
    // disagree with the system about what may be sworn.
    swearCovenant: (id: string) => {
      if (!canSwear(state.covenant, id)) {
        return { ok: false, why: 'A pact can only be sworn deeper, never renounced.' };
      }
      state.covenant = id;
      const cov = covenantDef(id);
      log.push('system', `You swear ${cov.name} — ${cov.cost}`, state.clock);
      ctx.toast(`You swear ${cov.name}`, 'good');
      ui.rebuildPanel();
      return { ok: true };
    },
    attack: () => combat.attack(),
    ignite: () => fire.tryIgnite(),
    enterBuild: (id: string) => (id ? build.enter(id) : build.cancel()),
    startBuild: () => build.start(),
    cycleBuild: (dir: number) => build.cycle(dir),
    craft: (id: string) => { const ok = craft(state, id, ctx.toast, log, net, loom, ctx); if (ok) vitals.markAction(); ui.rebuildPanel(); },
    // B3.b: the Loom's first production caller. Until this line existed the tree
    // was unreachable — points accrued and could never be spent.
    allocateLoom: (id: string) => loom.allocate(id),
    loomView: () => ({
      points: loom.points,
      allocated: loom.allocated,
      canAllocate: (id: string) => loom.canAllocate(id),
    }),
    // SR2: the draft.
    draftView: () => loom.pendingDraft,
    rerollDraft: () => loom.rerollDraft(),
    useItem: (id: string) => { useItem(id); ui.rebuildPanel(); },
    equip: (id: string) => { equipItem(id); ui.rebuildPanel(); },
    feedSoul: (itemId: string, count: number, targetSlot: import('./game/data/soulgear').SoulSlot) => {
      const result = soulfeed.feed(state, itemId, count, targetSlot);
      if (result) {
        vitals.markAction();
        log.push('system',
          `Fed ${count}× ${itemName(itemId)} → ${targetSlot} soul +${result.xp} xp` +
          (result.leveled ? ` (lv ${result.newLevel}!)` : ''),
          state.clock);
      }
      return result;
    },
    // A3: the bar. The UI forwards two verbs and reads one view model; every
    // rule about cost, cooldown and slotting lives in AbilitySystem, so a socket
    // literally cannot disagree with the system about whether it is ready.
    abilityView: () => abilities.view(),
    castAbility: (slot: number) => abilities.cast(slot),
    swapAbility: (slot: number) => abilities.swap(slot),
    abilityTip: (slot: number) => abilities.describe(slot),
    toggleMute: () => Sound.toggle(),
    newWorld: () => { location.hash = 's=' + ((Math.random() * 2 ** 31) | 0); location.reload(); },
    isPlacing: () => !!build.mode,
    logEntries: () => log.recent(100),
    lifespanView: () => ({
      age: Math.floor(state.player.age),
      frac: lifespan.fracRemaining(),
      minutesRemaining: lifespan.minutesRemaining(),
      warning: lifespan.isWarning(),
      critical: lifespan.isCritical(),
    }),
    // SR1: named in the HUD, off CFG.sr.enabled's neutral row when disabled —
    // same source hordes.ts reads (elapsedRealSec, not connectionUptime), so
    // the HUD can never claim an act the spawn system isn't actually running.
    actView: () => ({
      label: ACT_LABEL[(CFG.sr.enabled ? actFor(simTicks * (STEP / 1000)) : 'gathering')],
    }),
    gatherView: () => {
      if (gather.active) return { label: labelFor(gather.active.def), frac: gather.active.progress / gather.active.need };
      if (gather.target) return { label: labelFor(gather.target.def) + ' (E)', frac: 0 };
      return null;
    },
    // N4.3 + A8: everything temporarily true, in one list, each row stamped with
    // its `kind`. The HUD splits that list into two badge rows on `kind` alone —
    // an Omen is something happening to the WORLD, a Boon is something true of
    // YOU, and one row meant neither read under pressure (verdict, 2026-08-22).
    // The split lives in the view layer, not here: this is the source of truth
    // for what is active, and it should not also own how it is arranged.
    // Omens first because they are the ones the player did not choose.
    worldStateView: () => [
      ...omens.active.map((o) => ({
        name: o.def.name,
        good: o.def.good,
        secs: Math.max(0, Math.ceil(o.until - state.clock)),
        blurb: o.def.blurb,
        kind: 'omen' as const,
      })),
      ...activeBoons(state).map((b) => ({
        name: b.name,
        good: true,
        secs: Math.max(0, Math.ceil(b.until - state.clock)),
        blurb: b.blurb,
        kind: 'boon' as const,
        color: b.color,
      })),
      // A2: venom rides the SECOND row, beside the boons, because that row's
      // question is "what is true of me right now" and venom is the loudest
      // possible answer to it. It is not a boon and it is not pretending to be
      // one — it is red, it says how many stacks, and the row's tooltip names
      // both halves. A stacking DoT with no HUD presence is a health bar that
      // empties for no visible reason, which is the one thing a survival meter
      // must never do.
      ...(venomStacks(state) > 0 ? [{
        name: `Venom ×${venomStacks(state)}`,
        good: false,
        secs: Math.max(0, Math.ceil((state as any)._venomUntil - state.clock)),
        blurb: 'what it opened has not closed',
        kind: 'boon' as const,
        color: '#8fd05a',
      }] : []),
    ],
  });

  // SR2: the draft calls back into the UI from the point-grant moment
  // (loom.ts), which is deep inside the system graph and has no other route
  // to a DOM overlay.
  ctx.ui = ui;

  // hand the build system a way to drive the placement carousel banner
  ctx.setBuildBanner = (sel: { def: any; afford: number } | null) => ui.setBuildBanner(sel);

  function labelFor(def: any) { return verbFor(def) + ' ' + def.name; }

  function equipItem(id: string) {
    const slot = toggleEquip(state, id);
    if (!slot) return;
    const nowWorn = state.player.equip[slot] === id;
    ui.toast(`${nowWorn ? 'Equipped' : 'Unequipped'} ${itemName(id)}`, nowWorn ? 'good' : 'info');
    log.push('system', `${nowWorn ? 'Equipped' : 'Unequipped'} ${itemName(id)}`, state.clock);
  }

  function useItem(id: string) {
    const heal = itemDef(id)?.heal;
    if (!heal || (state.player.inv[id] ?? 0) <= 0) return;
    if (state.player.hp >= playerMaxHp(state)) { ui.toast('Already at full health'); return; }
    state.player.inv[id]--;
    if (state.player.inv[id] <= 0) delete state.player.inv[id];
    state.player.hp = Math.min(playerMaxHp(state), state.player.hp + heal);
    ui.toast(`Used ${itemName(id)} (+${heal} hp)`, 'good');
    log.push('system', `Used ${itemName(id)} (+${heal} hp)`, state.clock);
  }

  function triggerGameOver(cause: 'hall_fallen' | 'old_age') {
    if (state.gameOver) return;
    state.gameOver = true;
    state.gameOverCause = cause;
    hordes.clearField(); // B2: clear the field WITHOUT crediting a night survived
    if (cause === 'old_age') {
      log.push('death', `The years catch up at last. Age ${Math.floor(state.player.age)}, the dream lets go gently.`, state.clock);
    } else {
      log.push('death', 'The hall has fallen. The racket is finished.', state.clock);
    }
    // W6/L1: save scorecard and show death screen
    const card = scoreboard.saveToLeaderboard();
    ui.showGameOver(() => { location.reload(); }, card);
  }

  // --- canvas pointer ---
  // SR0: the mouse has exactly one gameplay job left, and it is to stop the game.
  //
  // Everything it used to do is now a key, and none of it was a loss: the ghost
  // follows `aimAngle`, which was always movement-derived, so aiming with the
  // mouse was aiming with a second, worse device that disagreed with the one the
  // attack already used. Click-to-attack was a redundant Space. What is gone is
  // the disagreement, not a verb.
  //
  // The touch path keeps its pixel-space entries (build.hover/place/paint are
  // still exported) — a phone has no keyboard and no Escape key.
  const canvas = stage.app.canvas;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.pointerType !== 'mouse') return;
    if (!CFG.sr.keyboardOnly) return;
    if (state.gameOver || ui.isOpen()) return;
    ui.togglePause();
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

  // B2.1: every run starts at dawn — see daynight.startClock() for why this
  // overturns D2. The real clock still colours the run through the witching-hours
  // resolveNightMult; it no longer decides how much of the run is night.
  //
  // B2.2: this MUST stay above the `wasNight` seed below. It used to run ~35 lines
  // later, so wasNight was read off the un-initialised clock (0 = day) and the first
  // sim tick of any run that booted into the night saw a day→night edge that had not
  // happened. That synthetic dusk called hordes.onDusk() — spawning a full night's
  // wave on top of a player with a flint axe and no walls (§4) — and armed the
  // free-night credit that survived even the gate below, because a dusk edge
  // genuinely had fired (§5). Starting at dawn makes that unreachable in practice;
  // the ordering stays correct on purpose rather than by luck.
  state.clock = startClock(net.snap.timeOfDay);
  state.bootClock = state.clock;

  // ---- the loop ----
  let acc = STEP;
  let wasNight = phase(state.clock).isNight;
  let frames = 0;
  // SR7: hit-stop. Remaining REAL milliseconds to run the sim in slow motion.
  // Decremented by STEP (not by effectiveDt) because it is a real-time freeze
  // — simSpeed and hitstop both scale the same effectiveDt but must not scale
  // EACH OTHER, or a laggy connection's already-slow sim would make every hit
  // stop feel like a full pause.
  let hitstopMs = 0;
  // SR1: elapsed real seconds for the act curve — every sim() CALL counts as
  // one fixed STEP of real time, whether that call came from the live ticker
  // or from a Gauntlet __nw.step() loop. This is deliberately NOT wall-clock
  // performance.now() (which a step() loop barely advances, freezing every
  // run in the Gathering act forever and non-deterministically depending on
  // how long the test suite had already been running) and NOT state.clock
  // (which simSpeed and hit-stop both stretch). A step count times a fixed
  // step size is real-time-shaped during live play and exactly reproducible
  // under a seeded test.
  let simTicks = 0;
  (window as any).__nw = {
    get frames() { return frames; }, state, ctx, app: stage.app, ui,
    // B3.a test seam: movement is composed inside sim(), so the Gauntlet can only
    // observe it by driving the axis. Exposed for that; nothing in the game reads it.
    input,
    sys: { gather, economy, build, hordes, combat, worldbosses, fire, echoes, abilities, vitals, lifespan, loom, scoreboard, net, drops, weaves, hub, sounding }, world, player, gen, chunks,
    lens, chronicle, omens,   // N4.2/N4.3 test seam: drawer, series store, omens
    // N4.6 test seam: the Deep Vessel's live reading. Exposed because every
    // field on it is browser-conditional — a suite has to be able to force a
    // pressure state or a jank peak and watch the mapping move, and the real
    // observers cannot be made to fire on demand.
    vessel: net.vessel,
    minimap,                  // A4 test seam
    mods: { rules: rulesMod, loot: lootMod, items: itemsMod, effects: effectsMod },  // A1 test seam
    get log() { return log; },  // expose full GameLog (entries + export + download)
    // test hook: advance the simulation deterministically (bypasses rAF)
    step: (n = 1, dt = STEP / 1000) => { for (let i = 0; i < n; i++) sim(dt); },
    craft: (id: string) => craft(state, id, ctx.toast, log, net, loom, ctx),
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

  // N4.6: name the vessel in the Chronicle, once, after the async half has had
  // a moment to resolve. Deferred rather than awaited because nothing in the
  // boot path may block on a promise — the game is already playable, and this
  // is a line of flavour, not a dependency. If the reads never resolve the line
  // says so ("a vessel that does not name itself") rather than not appearing,
  // because a missing log line teaches nothing and an honest absence does.
  setTimeout(() => {
    net.vessel.start(Sound.context);
    log.push('system', `The vessel: ${vesselLine(net.vessel.reading)}`, state.clock);
    // SR4: the graphics tier falls out of a measurement N4.6 already takes for
    // `mercy`. No benchmark frame, no settings screen, no guess — and the one
    // input that outranks every performance signal is the browser having said
    // it wants less motion.
    if (CFG.gfx.tier === 'auto') {
      const t = gfxTier(net.vessel.reading);
      post.applyTier(t);
      log.push('system', `The eye opens at the ${t} degree.`, state.clock);
    }
    if (net.vessel.reading.reducedMotion) {
      log.push('system', 'Reduced motion is set — the camera will hold still', state.clock);
    }
  }, 1200);

  // ?test URL param → auto-run the regression suite after a short warm-up
  if (new URLSearchParams(location.search).has('test')) {
    setTimeout(() => regression.runAll((window as any).__nw), 500);
  }

  stage.app.ticker.add((tk) => {
    frames++;
    const frameMs = Math.min(tk.deltaMS, 250); // clamp after tab-sleep
    scoreboard.updateReal(performance.now());  // W6: track connection uptime
    lifespan.updateReal(performance.now());    // L1: age the character, hard run-length cap
    acc = Math.min(acc + tk.deltaMS, 250);
    // SR0: pause stops the fixed step and nothing else. Rendering continues, so
    // the world is still visible behind the menu, and the accumulator is DROPPED
    // rather than banked — otherwise a two-minute pause would spend itself as a
    // burst of catch-up steps the moment you resumed.
    if (ui.isPaused()) acc = 0;
    while (acc >= STEP) {
      sim(STEP / 1000);
      acc -= STEP;
    }
    render(acc / STEP, frameMs);
  });

  function sim(dt: number) {
    simTicks++;
    if (!state.gameOver) state.clock += dt;

    // sim speed = pulse time → lag compensation (high pulse = slow sim)
    const simMul = net.getGameValue('simSpeed');
    let effectiveDt = dt * simMul;
    // SR7: hit-stop rides the SAME product rather than adding a second dt path
    // — one multiplier, two callers. Decrements in real ms regardless of how
    // slow simSpeed already made this tick, so the freeze always reads as the
    // same ~45-80ms no matter the connection.
    if (hitstopMs > 0) {
      effectiveDt *= 0.05;
      hitstopMs = Math.max(0, hitstopMs - STEP);
    }

    const ph = phase(state.clock);
    if (ph.isNight && !wasNight) { hordes.onDusk(ph.dayIndex); Sound.play('nightfall'); net.snapshotDuskRtt(); }
    if (!ph.isNight && wasNight) {
      // B2: you can only survive a night you were here for. A run that boots
      // mid-night (D2 starts the clock at real time-of-day, and 29% of the real
      // day lands inside one) never saw the dusk transition, so this dawn is
      // not a survival — no night, no Loom point, and no RTT stability window
      // computed against a dusk snapshot that was never taken.
      const fought = state.nightEntered;
      state.nightEntered = false;
      hordes.onDawn(fought);
      decals.clear();  // SR7: the night's blood pools go with the night
      Sound.play('dawn');
      if (fought) {
        net.computeNightRttStability();
        vitals.onSurviveNight();
        loom.onNightSurvived();  // C3: nights survived = Loom points
        // Action-gated beacon echo — surviving the night pings the southern beacons
        net.probeAction('survive_night');
        // Passive pulse drift — dawn pulse minus dusk pulse, zero HTTP
        net.samplePassive('survive_night');
      }
    }
    wasNight = ph.isNight;
    // S1: collect RTT samples during the night for stability tracking
    if (ph.isNight) net.sampleNightRtt();

    // SR0: build mode is driven from the fixed step, not from DOM events, so
    // placement obeys the same clock the world does. Arrows change meaning here
    // and the banner announces it — see BuildSystem.aimFromPlayer.
    input.setArrowsAsNudge(!!build.mode && !ui.isOpen());
    if (build.mode && !ui.isOpen()) {
      if (input.pressed('arrowleft')) build.nudge(-1, 0);
      if (input.pressed('arrowright')) build.nudge(1, 0);
      if (input.pressed('arrowup')) build.nudge(0, -1);
      if (input.pressed('arrowdown')) build.nudge(0, 1);
      if (input.pressed('[')) build.cycle(-1);
      if (input.pressed(']')) build.cycle(1);
      build.aimFromPlayer();
      // Enter is press-to-place and hold-to-paint. The edge fires first so a
      // single tap always places exactly once; the held branch only ever commits
      // on a tile CHANGE, so the two can never double-place the same tile.
      if (input.pressed('enter')) build.placeTile();
      else if (input.held('enter')) build.paintTile();
    }

    const a = (ui.isOpen() || matFx.isStunned) ? { x: 0, y: 0 } : input.axis();
    const feetSpeed = world.speedAt(Math.floor(player.x / TILE), Math.floor(player.y / TILE));
    // N2a: move speed modifier from echo jitter — read from mapping (live-tweakable)
    const moveSpeedMul = net.getGameValue('moveSpeed');
    // N4.1: Silt — the world thickens as the path's buffers fill. Neutral 1.0
    // whenever the deep wire has no reading, which is most networks.
    const siltMul = net.getGameValue('siltDrag');
    // S1: resolve-zero speed penalty
    const resolveSpeedMul = vitals.getSpeedMult();
    // C3: Loom move speed modifier. B3.a: this also carries Deep Roots' "you move
    // 12% slower", which was advertised and never implemented.
    const loomSpeedMul = loom.getMoveSpeedMul();
    // N2b: material speed burst (e.g. Flux Crystal exit)
    const matSpeedMul = matFx.speedBurst;
    // N4.3: Quickening speeds the world up, Miring thickens it. They share this
    // target deliberately, so a link that is both fast and bloated cancels out.
    const omenSpeedMul = omens.mul('moveSpeed');
    // A1: 'Swift' speeds you up, 'of Weight' (a Riftborn curse) drags.
    const gearSpeedMul = gearMod(state, 'moveSpeed');
    // C4: 'move_burst_on_kill' — hordes.hurt arms a window on a kill; this is
    // the half that was missing. 1.0 when the window is shut, so it costs a
    // multiply and no branch.
    const burstMul = moveBurstMul(state);
    const moved = player.update(dt, a.x, a.y, (x, y) => world.canStand(x, y),
      feetSpeed * moveSpeedMul * resolveSpeedMul * loomSpeedMul * matSpeedMul * siltMul * omenSpeedMul * gearSpeedMul * burstMul);
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
    drops.update(effectiveDt);   // B5: after every loot producer, so a kill's drop integrates the same tick
    fire.update(effectiveDt);
    echoes.update(effectiveDt);
    abilities.update(effectiveDt);   // A3: reconciles the bar with what is held
    vitals.update(effectiveDt);
    matFx.update(effectiveDt);  // N2b: material tile effects
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

    // SR0: edges live for exactly one fixed step. Cleared here, at the END of
    // sim(), rather than per render frame — a machine drawing at 30 fps runs two
    // sim steps per frame, and clearing on the frame would eat one of them.
    input.endTick();
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
    // N4.6: honour prefers-reduced-motion. Re-read every frame rather than
    // latched at boot, because the setting can be toggled mid-session and the
    // person toggling it is doing so precisely because something on screen is
    // making them ill right now — a value that only takes effect on the next
    // page load is not an accessibility setting, it is a promise of one.
    cam.motionScale = net.vessel.reading.reducedMotion ? 0 : 1;
    cam.follow(fx, fy);

    const w = stage.app.screen.width, h = stage.app.screen.height;
    // world core first — activate/deactivate chunks so the baker below reads the
    // EFFECTIVE (override-aware) materials for anything freshly scrolled in
    worldCore.ensureAround(fx, fy, w / cam.zoom, h / cam.zoom);

    chunks.ensureAround(fx, fy, w / cam.zoom, h / cam.zoom);
    chunks.tickFoam(performance.now());
    chunks.tickGlow(performance.now());
    chunks.tickRelief(state.clock);

    views.syncFoes(hordes.foes, alpha, activeEffects(state).has('see_foe_hp'), state.player.x, state.player.y);
    views.syncBosses(state.worldBosses, alpha);
    views.syncDrops(state.drops, state.clock, net.getGameValue('dropMemory'));   // B5 + N4.6
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
    // X1: Nightseer Charm — the fog presses less
    if (activeEffects(state).has('night_vision')) fogI *= 0.65;
    fog.update(fogI);

    // A4: drawn after the fog so the radar is never dimmed by it — the point of
    // a radar is that it works when sight does not.
    minimap.setVisible(CFG.loot.minimap !== false && !ui.isOpen());
    if (CFG.loot.minimap !== false) minimap.draw(state, performance.now(), hordes.foes, net.getGameValue('scrying'));

    Sound.setMood(state.gameOver ? 'dead' : bossNear ? 'boss' : ph.isNight ? 'night' : 'day');
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
    decals.render();

    // SR4: post-processing. Light sources are collected in WORLD pixels and the
    // grade is authored in one table — see engine/shaders/look.ts.
    {
      const spots: GlowSpot[] = [];
      const nowS = performance.now() / 1000;

      // Hearths and fires. The pulse is a slow breath rather than a flicker:
      // a flame that strobes at frame rate reads as a rendering fault, and the
      // eye only accepts fire from something that moves slower than it does.
      for (const b of state.buildings) {
        const L = BUILDING_LIGHT[b.type];
        if (!L) continue;
        const pulse = 1 + Math.sin(nowS * L.hz + b.tx * 1.7 + b.ty * 2.3) * L.flicker;
        spots.push({
          x: (b.tx + 0.5) * TILE, y: (b.ty + 0.5) * TILE,
          radius: L.radius * pulse, intensity: L.intensity * pulse, color: L.color,
        });
      }

      // A4 already decided which drops deserve a light shaft and what colour it
      // is. Reusing isBeamworthy/rarityTint here rather than re-deriving rarity
      // means the beam and the glow can never disagree about an item — and a
      // loot glow that says "rare" over something the beam calls common is the
      // single most confusing thing an ARPG can do.
      for (const d of state.drops) {
        if (!d.gear || !isBeamworthy(d.id, 'woven')) continue;
        const t = rarityTint(d.id);
        const breathe = 0.78 + Math.sin(nowS * 2.2 + d.uid) * 0.22;
        spots.push({
          x: d.x, y: d.y - 6, radius: 34 * breathe, intensity: 0.55 * breathe,
          color: [(t >> 16) & 255, (t >> 8) & 255, t & 255],
        });
      }

      const surge = omens.has('surge') ? Math.max(0, Math.min(1, CFG.omens.surgeFxStrength)) : 0;
      const ppCfg: PostProcessConfig = {
        bloomSpots: spots,
        grade: lookFor({
          realm: net.getBiome().id,
          night: nightFrac(state.clock),
          offline: !net.snap.online,
          surge,
          impact: 0,
          tier: post.tier,
          lights: post.lightsEnabled,
          palette: CFG.gfx.palette !== false,
        }),
        painterly: { enabled: painterlyEnabled, strength: painterlyStrength, radius: painterlyRadius },
      };
      post.apply(stage.app.screen.width, stage.app.screen.height, ppCfg, stage.app.canvas);
    }

    // N4.2: self-throttling to 4 Hz and a no-op while the drawer is closed.
    lens.refresh();

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
    // N4.2: one Chronicle sample per second, keyed on the WORLD clock so the
    // series lines up with the run's own events rather than with wall time.
    if (state.clock - lastChronicleT >= 1) {
      lastChronicleT = state.clock;
      sampleChronicle(chronicle, net, state.clock);
      // A detected step is content twice over: a Feed line in the Feed's own
      // voice, and an offer to the Omen system, which may raise a world state
      // with a multiplier behind it. takeEvents() drains only the undelivered
      // queue — `chronicle.events` stays intact for the Lens and the export.
      for (const ev of chronicle.takeEvents()) {
        log.push('resonance', `${ev.label} stepped ${ev.dir === 'up' ? 'up' : 'down'}: `
          + `${ev.from.toFixed(1)} → ${ev.to.toFixed(1)} (${Math.abs(ev.sigma).toFixed(1)}σ)`, state.clock);
        omens.consider(ev);
      }
      omens.tick();
      // A8: sweep expired boons and say what lifted. Cosmetic by design — every
      // reader filters on the clock anyway, so a missed tick costs a Feed line
      // and nothing else. See tickBoons() for why that is the right way round.
      for (const b of tickBoons(state)) {
        log.push('resonance', `${b.name} fades`, state.clock);
      }
    }
    worldCore.pushNetworkParams(net.packForCore());
    const changed = worldCore.drainEvents();
    fire.onWorldEvents(changed);
    if (changed.length) worldCore.bumpRebakes(chunks.rebakeTiles(changed));
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

/** Escape a string sourced from a third-party API before it lands in innerHTML. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
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
  // Review fix: these hotkeys (god mode, +50 gold, +materials, full heal,
  // forced horde/dusk) previously shipped live in every production build —
  // the only gate was CFG.debug.enabled, which nothing ever set to false.
  // Several (g/h/m/.) also had no e.repeat guard, so holding the key down
  // key-repeated the browser's way to unbounded gold/materials. Restrict the
  // KEYBOARD path to dev builds; window.NW/__nw stay exposed in production
  // either way (the documented live-tuning feature, and how the Gauntlet
  // drives state — always by direct object mutation, never a simulated
  // keypress — so this doesn't touch testability).
  if (import.meta.env.DEV) {
  let brush = M.DIRT; // god-brush material, cycled with Shift+P
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.repeat) return; // defense in depth: block OS key-repeat spam on these too
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
      case 'h': state.player.hp = playerMaxHp(state); break;
      case 'j': hordes.onDusk(phase(state.clock).dayIndex); break; // force a wave
      case 'u': { // god/test mode: immortal + effectively infinite everything
        state.god = !state.god;
        // L1: sticky for the whole run — flags this run's scorecard as not
        // eligible for the legit leaderboard ranking, even if god mode gets
        // toggled back off before the run ends.
        if (state.god) state.everGod = true;
        if (state.god) {
          state.player.gold += 99999;
          for (const id of Object.keys(ITEMS)) state.player.inv[id] = 9999;
          for (const s of SKILLS) state.player.xp[s.id] = Math.max(state.player.xp[s.id] ?? 0, 1e7);
          state.player.hp = playerMaxHp(state);
        }
        ctx.toast(`debug: god mode ${state.god ? 'ON — immortal, everything unlocked' : 'OFF'}`, state.god ? 'good' : 'info');
        ctx.log?.push('system', `God mode ${state.god ? 'enabled' : 'disabled'}`, state.clock);
        break;
      }
    }
  });
  } // end import.meta.env.DEV
  // expose the live config + materials table + network for runtime tuning from the console
  (window as any).NW = { ...((window as any).NW ?? {}), CFG, state, MATS: MATERIALS, ENEMIES, NET: ctx.net };
}

import { ITEMS, itemDef, itemName } from './game/data/items';
import { SKILLS } from './game/data/skills';
import { ENEMIES } from './game/data/enemies';
boot();
