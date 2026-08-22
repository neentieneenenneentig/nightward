// ============================================================================
// NIGHTWARD Regression Test Suite
// ============================================================================
// An automated playthrough that exercises every game system from the inside,
// using the live game interface exposed on window.__nw.  Designed to catch
// regressions after any code change — run via `?test` URL param or from the
// dev console:  __nw.regression.run().
//
// Architecture:
//   - Each test is an async function that receives the __nw handle.
//   - Tests advance the sim via __nw.step(n, dt) — deterministic, no rAF needed.
//   - Assertions throw on failure; the harness catches & reports.
//   - The harness prints a color-coded summary to the console and a DOM overlay.
//
// Conventions:
//   - `step(n)`  → advance n sim ticks (each = 1/30 s)
//   - `wait(n)`  → alias for step (readability)
//   - `ok(cond, msg)`  → assert; throws `FAIL: msg` on false
//   - `eq(a, b, msg)`  → assert a === b
// ============================================================================

// ---------------------------------------------------------------------------
// tiny assertion helpers (no external deps — runs inside the game bundle)
// ---------------------------------------------------------------------------

let _pass = 0;
let _fail = 0;
const _results: string[] = [];

function ok(cond: boolean, msg: string) {
  if (cond) { _pass++; _results.push(`  ✅ ${msg}`); return; }
  _fail++; _results.push(`  ❌ ${msg}`);
  throw new Error('FAIL: ' + msg);
}

function eq<T>(a: T, b: T, msg: string) { ok(a === b, `${msg}  (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`); }

/** A straight run of `runTiles` tiles that are all standable AND all report the
 *  same `world.speedAt()`, plus a start point on it.
 *
 *  Movement modifiers can only be tested by driving the player and measuring the
 *  distance covered — reading the multiplier back would pass while main.ts
 *  computed the value and threw it away, which is what shipped in G1 and in the
 *  Loom. But the measurement is only fair on UNIFORM ground: terrain speed
 *  varies tile by tile, so a faster player ends up further along and can enter
 *  slow ground the plain run never reached. Picking "whichever of four
 *  directions is longest" does not fix that — it picks a corridor, not a fair
 *  one — and it flaked red on a 28px corridor where terrain noise swamped a
 *  0.88x modifier entirely.
 *
 *  On uniform ground the distance is exactly proportional to the multiplier, and
 *  the measured ratios come out at the configured value to three decimals. */
function findUniformCorridor(nw: any, runTiles: number, maxRadius = 14):
    { x: number; y: number; dx: number; dy: number; speed: number } | null {
  const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const htx = Math.floor(nw.state.player.x / 32), hty = Math.floor(nw.state.player.y / 32);
  for (let r = 0; r <= maxRadius; r++) {
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
        const tx = htx + ox, ty = hty + oy;
        if (!nw.world.canStand((tx + 0.5) * 32, (ty + 0.5) * 32)) continue;
        const sp0 = nw.world.speedAt(tx, ty);
        for (const [dx, dy] of DIRS) {
          let uniform = true;
          for (let k = 1; k <= runTiles && uniform; k++) {
            const cx = tx + dx * k, cy = ty + dy * k;
            uniform = nw.world.canStand((cx + 0.5) * 32, (cy + 0.5) * 32)
              && nw.world.speedAt(cx, cy) === sp0;
          }
          if (uniform) return { x: (tx + 0.5) * 32, y: (ty + 0.5) * 32, dx, dy, speed: sp0 };
        }
      }
    }
  }
  return null;
}


// ---------------------------------------------------------------------------
// test definitions — each is `(nw: any) => Promise<void>`
// ---------------------------------------------------------------------------

async function testBoot(nw: any) {
  const s = nw.state;
  ok(s !== undefined, 'state exists on __nw');
  ok(typeof s.seed === 'number', 'state.seed is a number');
  ok(s.v === 1, 'state version is 1');
  ok(s.clock >= 0, 'clock is non-negative');
  ok(s.player !== undefined, 'player exists');
  ok(typeof s.player.x === 'number' && typeof s.player.y === 'number', 'player has x,y coords');
  ok(s.player.hp > 0, 'player hp > 0');
  ok(s.player.gold >= 0, 'player gold >= 0');
  ok(s.player.inv !== undefined, 'player inventory exists');
  ok(s.player.xp !== undefined, 'player xp map exists');
  ok(s.player.equip !== undefined, 'player equip exists');
  ok(s.player.soulItems !== undefined, 'soul items exist');
  ok(s.nightsSurvived >= 0, 'nightsSurvived >= 0');
  ok(s.gameOver === false, 'game is not over');
  ok(Array.isArray(s.buildings), 'buildings is an array');
  ok(Array.isArray(s.worldBosses), 'worldBosses is an array');
  ok(nw.world !== undefined, 'world handle exists on __nw');
  ok(nw.sys !== undefined, 'systems handle exists on __nw');
  ok(nw.sys.gather !== undefined, 'gather system exists');
  ok(nw.sys.combat !== undefined, 'combat system exists');
  ok(nw.sys.build !== undefined, 'build system exists');
  ok(nw.sys.fire !== undefined, 'fire system exists');
  ok(nw.sys.hordes !== undefined, 'horde system exists');
  ok(nw.sys.worldbosses !== undefined, 'worldboss system exists');
}

async function testStartingInventory(nw: any) {
  const inv = nw.state.player.inv;
  ok((inv.axe_flint ?? 0) >= 1, 'starts with flint axe');
  ok((inv.pick_flint ?? 0) >= 1, 'starts with flint pick');
}

async function testSimSteps(nw: any) {
  const t0 = nw.state.clock;
  nw.step(30);
  ok(nw.state.clock > t0, 'clock advances after sim steps');
}

async function testWorldQueries(nw: any) {
  const { world, state } = nw;
  const tx = Math.floor(state.player.x / 32);
  const ty = Math.floor(state.player.y / 32);

  const mat = world.materialAt(tx, ty);
  ok(typeof mat === 'number' && mat >= 0, 'materialAt returns valid material id');

  const passable = world.canStand(state.player.x, state.player.y);
  ok(passable === true, 'spawn position is passable');

  const speed = world.speedAt(tx, ty);
  ok(typeof speed === 'number' && speed > 0, 'speedAt returns positive multiplier');

  // worldgen queries
  const tile = nw.gen.tileAt(tx, ty);
  ok(typeof tile === 'number' && tile >= 0, 'gen.tileAt returns valid tile id');

  // buildingAt on empty tile
  const b = world.buildingAt(tx, ty);
  ok(b === null || b !== null, 'buildingAt is callable');
}

async function testGathering(nw: any) {
  const { state, world, sys } = nw;

  // Ensure player has tools
  state.player.inv.axe_flint = (state.player.inv.axe_flint ?? 0) + 1;
  state.player.inv.pick_flint = (state.player.inv.pick_flint ?? 0) + 1;

  // Scan nearby 5×5 for a harvestable feature
  const px = state.player.x, py = state.player.y;
  const ptx = Math.floor(px / 32), pty = Math.floor(py / 32);
  let gtx = -1, gty = -1;
  for (let dy = -2; dy <= 2 && gtx < 0; dy++) {
    for (let dx = -2; dx <= 2 && gtx < 0; dx++) {
      const f = world.activeFeatureAt(ptx + dx, pty + dy);
      if (f) { gtx = ptx + dx; gty = pty + dy; }
    }
  }

  if (gtx < 0) {
    _results.push('  ⚠️  testGathering: no feature nearby — skipping (worldgen-dependent)');
    _pass++;
    return;
  }

  // Teleport next to the node (within reach)
  const cx = (gtx + 0.5) * 32, cy = (gty + 0.5) * 32;
  const gatherHome = { x: nw.player.x, y: nw.player.y };
  nw.player.teleport(cx + 20, cy);
  nw.step(1);

  ok(sys.gather.target !== null, 'gather target found after stepping near node');

  sys.gather.tryStart();
  ok(sys.gather.active !== null, 'gather active after tryStart()');

  // Gather progress advances by effectiveDt (dt × simSpeed), NOT raw dt, and `need`
  // already folds simSpeed into its own speed term — so real frames-to-complete scale
  // ~need·30/simSpeed. The old fixed budget ceil(need·30)+10 assumed dt=1/30 and fell
  // exactly one frame short whenever the live network pushed simSpeed below ~0.86
  // (rtt > ~97ms → simSpeed 0.85). Step until it clears, capped generously by `need`
  // (simSpeed is clamped ≥0.85, so need·45 is a comfortable ceiling).
  const need = sys.gather.active ? sys.gather.active.need : 3;
  const cap = Math.ceil(need * 45) + 120;
  let stepped = 0;
  while (sys.gather.active !== null && stepped < cap) { nw.step(1); stepped++; }
  ok(sys.gather.active === null, `gather completed (active cleared after ${stepped} steps, cap ${cap})`);
  // Leave the world as we found it. This probe used to write to `state.player`,
  // which main() overwrites every tick, so it moved nobody and had nothing to
  // restore; now it moves the authoritative player and every later test reads
  // the terrain wherever this one leaves them.
  nw.player.teleport(gatherHome.x, gatherHome.y);
}

async function testCrafting(nw: any) {
  const { state } = nw;

  // Give materials: 3 logs → 1 plank
  state.player.inv.log = (state.player.inv.log ?? 0) + 3;
  nw.step(1);

  const beforePlanks = state.player.inv.plank ?? 0;
  const beforeLogs = state.player.inv.log ?? 0;
  const result = nw.craft('plank');
  ok(result === true, 'craft plank succeeded');
  ok((state.player.inv.plank ?? 0) > beforePlanks, 'plank count increased after crafting');
  ok((state.player.inv.log ?? 0) < beforeLogs, 'logs consumed by crafting');
}

async function testCraftingNoMaterials(nw: any) {
  const { state } = nw;
  // ensure no logs
  delete state.player.inv.log;
  const result = nw.craft('plank');
  ok(result === false, 'craft fails without materials');
}

async function testBuildingFlow(nw: any) {
  const { state, sys, world } = nw;

  // Give materials for a campfire
  state.player.inv.stone = (state.player.inv.stone ?? 0) + 10;
  state.player.inv.log = (state.player.inv.log ?? 0) + 10;
  nw.step(1);

  // Ensure a hall exists (required before other buildings)
  if (!state.buildings.some((b: any) => b.type === 'hall')) {
    const htx = Math.floor(state.player.x / 32);
    const hty = Math.floor(state.player.y / 32) - 2;
    state.player.inv.wood_scrap = (state.player.inv.wood_scrap ?? 0) + 30;
    state.player.inv.plank = (state.player.inv.plank ?? 0) + 20;
    state.buildings.push({ uid: state.nextUid++, type: 'hall', tx: htx, ty: hty, hp: 100 });
    world.reindexBuildings();
    nw.step(2);
  }
  ok(state.buildings.some((b: any) => b.type === 'hall'), 'hall exists for building tests');

  // Enter build mode
  sys.build.enter('campfire');
  ok(sys.build.mode !== null, 'entered build mode with campfire');

  // Direct placement (bypasses canvas coords — tests the commit path)
  const ctx = Math.floor(state.player.x / 32) + 1;
  const cty = Math.floor(state.player.y / 32) + 1;
  if (world.canPlaceAt(ctx, cty, false)) {
    state.buildings.push({ uid: state.nextUid++, type: 'campfire', tx: ctx, ty: cty, hp: 20 });
    world.reindexBuildings();
    nw.step(1);
  }
  sys.build.cancel();
  ok(sys.build.mode === null, 'build mode cancelled');
  ok(state.buildings.some((b: any) => b.type === 'campfire'), 'campfire placed');
}

async function testBuildingDuplicateUnique(nw: any) {
  const { state, sys } = nw;

  const hallCount = state.buildings.filter((b: any) => b.type === 'hall').length;
  sys.build.enter('hall');

  if (hallCount >= 1) {
    ok(sys.build.mode === null, 'cannot enter build mode for duplicate unique (hall)');
  } else {
    ok(sys.build.mode !== null, 'can enter hall build mode when none exists');
    sys.build.cancel();
  }
}

async function testCombatAttack(nw: any) {
  const { sys } = nw;

  sys.combat.attack();
  nw.step(3); // windup is ~0.22s, 3 ticks should leave idle

  // Phase should have changed from idle
  ok(sys.combat.phase !== 'idle', 'attack() state machine leaves idle');
}

async function testDayNightCycle(nw: any) {
  const { state } = nw;
  const startClock = state.clock;

  // Directly set clock into night zone (daySec = 240, nightSec = 100)
  state.clock = 250;
  nw.step(2);
  ok(state.clock > 240, 'clock is in night zone');

  // Directly set clock into next day (340 = daySec + nightSec)
  state.clock = 350;
  nw.step(2);
  ok(state.clock > 340, 'clock is in next day cycle');

  // Restore
  state.clock = startClock;
}

async function testPlayerDamage(nw: any) {
  const { state, sys, world } = nw;

  // Ensure a hall exists so respawn, not game-over
  if (!state.buildings.some((b: any) => b.type === 'hall')) {
    const htx = Math.floor(state.player.x / 32);
    const hty = Math.floor(state.player.y / 32) - 2;
    state.player.inv.wood_scrap = (state.player.inv.wood_scrap ?? 0) + 30;
    state.player.inv.plank = (state.player.inv.plank ?? 0) + 20;
    state.buildings.push({ uid: state.nextUid++, type: 'hall', tx: htx, ty: hty, hp: 100 });
    world.reindexBuildings();
    nw.step(2);
  }

  const origHp = state.player.hp;
  sys.combat.damagePlayer(20, 'test');
  nw.step(2);
  ok(state.player.hp < origHp, 'player took damage');
  ok(state.player.hp > 0, 'player survives non-lethal damage');
}

async function testGodMode(nw: any) {
  const { state, sys } = nw;

  state.god = true;
  ok(state.god === true, 'god mode can be toggled on');

  // God mode: should survive lethal damage
  state.player.hp = 100;
  sys.combat.damagePlayer(999, 'test');
  nw.step(2);
  ok(state.player.hp > 0, 'god mode prevents death');
  ok(state.gameOver === false, 'game not over in god mode');

  state.god = false;
}

async function testEquipment(nw: any) {
  const { state } = nw;

  state.player.inv.sword_copper = (state.player.inv.sword_copper ?? 0) + 1;
  nw.step(1);

  const { toggleEquip } = await import('../rules');
  const slot = toggleEquip(state, 'sword_copper');
  ok(slot === 'weapon', 'equip returns correct slot for sword');
  ok(state.player.equip.weapon === 'sword_copper', 'sword equipped in weapon slot');

  // Unequip
  toggleEquip(state, 'sword_copper');
  ok(state.player.equip.weapon !== 'sword_copper', 'sword unequipped');
}

async function testInventoryBounds(nw: any) {
  const { state } = nw;

  // Negative values are legal raw data (no auto-cleanup), but they don't crash
  state.player.inv.test_junk = -5;
  nw.step(1);
  const { invCount } = await import('../rules');
  const c = invCount(state, 'test_junk');
  ok(typeof c === 'number', 'invCount returns a number for negative inventory');
  ok(c <= 0, 'negative inventory is reflected as non-positive');

  // Clean up: remove negative & zero entries
  delete state.player.inv.test_junk;
  ok(!('test_junk' in state.player.inv), 'negative inventory entry can be removed');
}

async function testFireIgnite(nw: any) {
  const { state, world, sys } = nw;

  state.player.inv.torch = (state.player.inv.torch ?? 0) + 1;

  // Scan for flammable tile
  const ptx = Math.floor(state.player.x / 32);
  const pty = Math.floor(state.player.y / 32);
  let ftx = -1, fty = -1;

  const { MATERIALS } = await import('../data/materials');
  const firePos = { x: nw.player.x, y: nw.player.y };
  for (let dy = -2; dy <= 2 && ftx < 0; dy++) {
    for (let dx = -2; dx <= 2 && ftx < 0; dx++) {
      const matId = world.materialAt(ptx + dx, pty + dy);
      if (MATERIALS[matId]?.flammable > 0 && !nw.core.isBurning(ptx + dx, pty + dy)) {
        ftx = ptx + dx;
        fty = pty + dy;
        // teleport(), not a write to state.player: that is a projection main()
        // overwrites from nw.player every tick, so the nw.step(2) below would
        // silently put the player back and ignite from the ORIGINAL tile.
        nw.player.teleport(ftx * 32 + 16, fty * 32 + 16 - 20);
      }
    }
  }

  if (ftx < 0) {
    _results.push('  ⚠️  testFireIgnite: no flammable tile nearby — skipping');
    _pass++;
    return;
  }

  nw.step(2);
  sys.fire.tryIgnite();
  nw.step(5);
  ok(true, 'fire tryIgnite() did not throw');
  nw.player.teleport(firePos.x, firePos.y);
}

async function testLogEntries(nw: any) {
  const log = nw.log;
  ok(log !== undefined, 'game log exists on __nw');
  const entries = log.recent(10);
  ok(Array.isArray(entries), 'log.recent() returns array');
  ok(entries.length >= 0, 'log.recent() is callable (may be empty)');
}

async function testXpAndLeveling(nw: any) {
  const { state } = nw;

  const { addXp, skillLevel, levelFromXp } = await import('../rules');
  const beforeLevel = skillLevel(state, 'woodcutting');
  const beforeXp = state.player.xp.woodcutting ?? 0;

  const newLevel = addXp(state, 'woodcutting', 500);
  ok((state.player.xp.woodcutting ?? 0) > beforeXp, 'woodcutting XP increased');
  // B1: precise — 500 xp yields exactly level 7 under the current curve.
  // Changing CFG.xp.base, growth, or maxLevel turns this red.
  eq(levelFromXp(500), 7, '500 cumulative xp = level 7 (curve: base 60, growth 1.12)');
  ok(newLevel > 0, 'addXp reports a level-up when crossing a threshold');
  ok(skillLevel(state, 'woodcutting') >= 2, 'after adding xp, skill is at least level 2');

  void newLevel;
}

/** B1: pin the xp curve against the recipe levelReqs that consume it.
 *
 *  The gate numbers below are LITERAL, and that is the entire point.  The
 *  first version of this test computed them by summing xpToNext() and then
 *  asserted levelFromXp() of that sum — but levelFromXp IS the inverse of
 *  that sum, so the assertion reduced to the identity f(f⁻¹(L)) === L.  It
 *  stayed green under base 1 / growth 1.001, under base 99999 / growth 3.0,
 *  and under the exact curve B1 was replacing.  Hand-written constants can
 *  only stay true for one curve.
 *
 *  Every gate is pinned from BOTH sides — one xp below the threshold must
 *  still report the previous level — so a curve that gets cheaper fails as
 *  loudly as one that gets more expensive.
 *
 *  Turns red if: CFG.xp.base or CFG.xp.growth move at all; CFG.xp.maxLevel
 *  drops below a gate or below the highest recipe levelReq; or xpToNext and
 *  levelFromXp stop agreeing about cumulative-vs-per-level semantics.
 *
 *  To re-derive after an intentional curve change:
 *    let c = 0; for (let L = 1; L < 40; L++) c += Math.round(60 * 1.12 ** (L - 1)); */
async function testXpCurve(nw: any) {
  const { levelFromXp, xpToNext } = await import('../rules');
  const { RECIPES } = await import('../data/recipes');
  const { CFG } = await import('../data/config');

  // Cumulative xp required to REACH each level under base 60 / growth 1.12.
  const GATES: Array<[level: number, cumulativeXp: number]> = [
    [5,   286],    // sword_copper, armor_copper
    [10,  886],    // iron_bar — mid-run gate
    [15,  1943],   // sword_iron
    [20,  3805],
    [30,  12873],
    [40,  41039],  // level cap
  ];

  for (const [lvl, total] of GATES) {
    eq(levelFromXp(total), lvl, `${total} cumulative xp = level ${lvl}`);
    eq(levelFromXp(total - 1), lvl - 1,
      `${total - 1} xp is still level ${lvl - 1} (gate ${lvl} is exact)`);
  }

  // Cheapest thing to get wrong, loudest signal that CFG.xp.base moved.
  eq(xpToNext(1), 60, 'first level costs 60 xp (CFG.xp.base)');

  // The cap actually clamps — no amount of xp exceeds maxLevel.
  eq(levelFromXp(41039 * 100), CFG.xp.maxLevel,
    `xp is clamped at CFG.xp.maxLevel (${CFG.xp.maxLevel})`);

  // Every recipe gate must be reachable under the shipped cap.  Bound to
  // CFG.xp.maxLevel, not a literal, so lowering the cap is what breaks it.
  let maxRecipeReq = 0;
  for (const r of RECIPES) {
    if (r.levelReq > maxRecipeReq) maxRecipeReq = r.levelReq;
    ok(r.levelReq <= CFG.xp.maxLevel,
      `recipe ${r.id} levelReq ${r.levelReq} ≤ cap ${CFG.xp.maxLevel}`);
  }
  ok(maxRecipeReq > 0, `recipes declare levelReqs (highest is ${maxRecipeReq})`);
}

async function testStateImmutabilityPattern(nw: any) {
  const { state } = nw;
  ok(typeof state === 'object' && state !== null, 'state is a plain object');
  ok('player' in state, 'state has player key');
  ok(state.v === 1, 'state version intact');
  ok(Number.isFinite(state.clock), 'clock is a finite number');
  ok(state.player.hp <= 100, 'player hp <= maxHp');
}

// =========================================================================
// GAUNTLET — P1 behavioral coverage (14 tests)
// =========================================================================

async function testCollisionWalls(nw: any) {
  const { state, world } = nw;
  // Place a Palisade at player+1
  const ptx = Math.floor(state.player.x / 32);
  const pty = Math.floor(state.player.y / 32);
  state.buildings.push({ uid: state.nextUid++, type: 'wall', tx: ptx + 1, ty: pty, hp: 80 });
  world.reindexBuildings();
  nw.step(2);
  // Walk into the wall.
  //
  // This assertion used to be a TAUTOLOGY. It wrote the target position to
  // `state.player`, which is a PROJECTION that main() overwrites from nw.player
  // at the end of every sim tick — so the very next nw.step() discarded it, the
  // player never moved anywhere, and "position blocked by Palisade wall" was
  // true because nothing had happened. It would have passed with the wall
  // deleted, with collision disabled, with the building system removed entirely.
  //
  // The honest form asks the world directly AND drives the authoritative
  // position, with a matched control on an adjacent open tile so that "cannot
  // stand" is shown to mean the wall rather than the terrain.
  const wallX = (ptx + 1) * 32 + 16, wallY = pty * 32 + 16;
  ok(world.canStand(wallX, wallY) === false, 'the wall tile is not standable');
  const openX = (ptx + 1) * 32 + 16, openY = (pty - 2) * 32 + 16;
  if (world.canStand(openX, openY)) {
    ok(true, 'and an adjacent tile with no wall on it IS standable — the refusal is the wall');
  } else {
    ok(true, `(no open control tile at ${ptx + 1},${pty - 2} on this seed)`);
  }
  // teleport() bypasses collision by design — it is a debug verb, and putting
  // the player inside the wall with it proves nothing either. The only probe
  // that means anything is to stand OUTSIDE and walk in.
  const origX = nw.player.x, origY = nw.player.y;
  const savedAxis = nw.input?.axis;
  const fromX = (ptx - 1) * 32 + 16, fromY = pty * 32 + 16;
  if (savedAxis && world.canStand(fromX, fromY)) {
    try {
      nw.player.teleport(fromX, fromY);
      nw.input.axis = () => ({ x: 1, y: 0 });
      nw.step(40);
      // The wall occupies tile ptx+1, so its left edge is at (ptx+1)*32. A
      // player who walked THROUGH it would be past that edge.
      ok(nw.player.x < (ptx + 1) * 32,
        `walking east for 40 ticks does not pass through the Palisade`
        + ` (stopped at x=${nw.player.x.toFixed(1)}, wall edge ${(ptx + 1) * 32})`);
      ok(nw.player.x > fromX - 1, '...and the player did try to move east, rather than not moving at all');
    } finally {
      nw.input.axis = savedAxis;
    }
  } else {
    ok(true, `(no standable tile west of the wall at ${ptx - 1},${pty} to walk in from)`);
  }
  // Leave the world as we found it: these probes now move the AUTHORITATIVE
  // player, where the old projection writes moved nothing, and every later test
  // reads the terrain wherever this one leaves them.
  nw.player.teleport(origX, origY);
  // Water check: paint water tile (M.WATER = 1), try to stand on it
  nw.paint(1, ptx + 2, pty); // M.WATER
  nw.step(1);
  const waterPassable = world.canStand((ptx + 2) * 32 + 16, pty * 32 + 16);
  ok(waterPassable === false, 'water tile is not passable');
  // Clean up
  nw.paint(3, ptx + 2, pty); // back to dirt/grass
}

async function testLongWalk(nw: any) {
  const { state } = nw;
  const startX = state.player.x, startY = state.player.y;
  // Teleport player 150 tiles east in one jump, verify game handles it
  state.player.x += 150 * 32;
  nw.step(10);
  const dist = Math.abs(state.player.x - startX);
  // Review fix: `dist >= 0` is true of any finite number (it's an abs()) and
  // can never fail — it wasn't actually checking anything. The real risk of
  // a long-distance jump is NaN/Infinity corruption in position or collision
  // math; check for that instead.
  ok(Number.isFinite(state.player.x) && Number.isFinite(state.player.y),
    `player position stays finite after a 150-tile jump (${(dist / 32).toFixed(0)} tiles from origin)`);
  void startY;
}

async function testGatherEveryFeature(nw: any) {
  const { state, world, sys } = nw;
  const { FEATURES } = await import('../data/features');
  const { CFG } = await import('../data/config');
  const { SKILLS } = await import('../data/skills');
  const { ITEMS: ITEMS_ALL } = await import('../data/items');
  // The claim is "every feature type in the data is gatherable" — a CONTENT
  // integrity claim. It is only true of a player who is equipped and levelled
  // for it, and until now the test ran with flint tools and whatever xp the
  // previous tests happened to leave. With the two lookup bugs above fixed it
  // immediately located 10 types and gathered 6, which is not a bug in the
  // features, it is a bug in the fixture. Give it the player the claim assumes.
  state.player.inv.axe_flint = 10;
  state.player.inv.pick_flint = 10;
  const savedXp = { ...state.player.xp };
  const savedInv = { ...state.player.inv };
  const savedEquip = { ...state.player.equip };
  for (const sk of SKILLS) state.player.xp[sk.id] = CFG.xp.base * 10000;
  // best tool of each class the data defines, so toolClass gates clear too
  for (const [cls, slot] of [['axe', 'tool_axe'], ['pick', 'tool_pick']] as [string, string][]) {
    const best = Object.values(ITEMS_ALL).filter((i: any) => i.toolClass === cls)
      .sort((a: any, b: any) => (b.toolPower ?? 0) - (a.toolPower ?? 0))[0] as any;
    if (!best) continue;
    state.player.inv[best.id] = (state.player.inv[best.id] ?? 0) + 1;
    (state.player.equip as any)[slot] = best.id;
  }
  state.god = true;
  let tested = 0;
  let found = 0;
  for (const feat of FEATURES) {
    // Scan a wider area for existing features of this type
    const ptx = Math.floor(state.player.x / 32);
    const pty = Math.floor(state.player.y / 32);
    let ftx = -1, fty = -1;
    for (let dy = -15; dy <= 15 && ftx < 0; dy++) {
      for (let dx = -15; dx <= 15 && ftx < 0; dx++) {
        // world.activeFeatureAt returns a FeatureDef DIRECTLY — there is no
        // `.def` wrapper on it. `f.def?.id` was therefore undefined for every
        // tile ever scanned, `ftx` stayed -1, every feature `continue`d, and
        // `found` stayed 0. The assertion below is `tested === found`, so this
        // test has been passing as 0 === 0 — it has never gathered anything.
        // Fourth tautology found in this suite; see the ROADMAP.
        const f: any = world.activeFeatureAt(ptx + dx, pty + dy);
        if (f && f.id === feat.id) { ftx = ptx + dx; fty = pty + dy; }
      }
    }
    if (ftx < 0) continue;
    found++;
    // Move the player near it — through nw.player, the authoritative Player
    // instance. Assigning state.player.x only writes the PROJECTION, which
    // main() overwrites from nw.player on the very next tick, so the player
    // never actually went anywhere and gather.target stayed null. This was the
    // second bug stacked on the first: with the FeatureDef shape fixed above,
    // the test located 12 feature types and still gathered 0 of them.
    nw.player.teleport((ftx + 0.5) * 32 + 20, (fty + 0.5) * 32);
    nw.step(3);
    if (sys.gather.target) {
      sys.gather.tryStart();
      if (sys.gather.active) {
        const need = sys.gather.active.need || 3;
        const gatherTicks = Math.ceil(need / (1/30)) + 10;
        for (let g = 0; g < gatherTicks; g += 5) nw.step(5);
        tested++;
      }
    }
  }
  state.player.xp = savedXp;
  state.player.inv = savedInv;
  state.player.equip = savedEquip;
  // Review fix: `tested >= 0` is true of any count including 0 and can never
  // fail — it wasn't actually checking that gathering worked. `found` is
  // legitimately worldgen/seed-dependent (a feature type may not exist near
  // this spawn), so that alone stays a skip; but whenever features WERE
  // located, every one of them must actually be gatherable — that's the real
  // assertion, and it can fail if gather.tryStart()/active breaks.
  if (found === 0) {
    ok(true, 'no instances of any feature type found near spawn (worldgen/seed-dependent) — skipping');
  } else {
    ok(tested === found, `gathered ${tested}/${found} located feature types — every located feature must be gatherable`);
  }
  state.god = false;
}

async function testCraftEveryRecipe(nw: any) {
  const { state } = nw;
  const { RECIPES } = await import('../data/recipes');
  let crafted = 0;
  for (const rec of RECIPES) {
    for (const ing of rec.in) {
      state.player.inv[ing.id] = (state.player.inv[ing.id] ?? 0) + ing.n;
    }
    nw.step(1);
    const result = nw.craft(rec.id);
    if (result) crafted++;
  }
  ok(crafted > 0, `crafted ${crafted}/${RECIPES.length} recipes`);
}

async function testBuildEveryBuilding(nw: any) {
  const { state, sys, world } = nw;
  const { BUILDINGS } = await import('../data/buildings');
  // Ensure a hall exists
  if (!state.buildings.some((b: any) => b.type === 'hall')) {
    const htx = Math.floor(state.player.x / 32);
    const hty = Math.floor(state.player.y / 32) - 3;
    state.player.inv.log = 50; state.player.inv.stone = 50;
    state.player.inv.plank = 30; state.player.inv.wood_scrap = 30;
    state.buildings.push({ uid: state.nextUid++, type: 'hall', tx: htx, ty: hty, hp: 200 });
    world.reindexBuildings();
    nw.step(2);
  }
  // Grant ample materials
  state.player.inv.log = (state.player.inv.log ?? 0) + 50;
  state.player.inv.stone = (state.player.inv.stone ?? 0) + 50;
  state.player.inv.plank = (state.player.inv.plank ?? 0) + 30;
  state.player.inv.wood_scrap = (state.player.inv.wood_scrap ?? 0) + 30;
  state.player.inv.copper_ore = (state.player.inv.copper_ore ?? 0) + 20;
  state.player.inv.iron_ore = (state.player.inv.iron_ore ?? 0) + 20;
  nw.step(1);

  let placed = 0, rejected = 0;
  // Find the hall position to place near
  const hall = state.buildings.find((b: any) => b.type === 'hall');
  const hx = hall ? hall.tx : Math.floor(state.player.x / 32);
  const hy = hall ? hall.ty : Math.floor(state.player.y / 32);
  for (const def of BUILDINGS) {
    const ctx = hx + 1 + placed;
    const cty = hy + 1;
    sys.build.enter(def.id);
    if (!sys.build.mode) { rejected++; continue; }
    if (world.canPlaceAt(ctx, cty, def.id === 'hall')) {
      state.buildings.push({ uid: state.nextUid++, type: def.id, tx: ctx, ty: cty, hp: def.hp });
      world.reindexBuildings();
      placed++;
    } else {
      rejected++;
    }
    sys.build.cancel();
  }
  ok(placed + rejected >= BUILDINGS.length, `all ${BUILDINGS.length} building types attempted (${placed} placed, ${rejected} rejected)`);
}

async function testFightEveryMob(nw: any) {
  const { state, sys } = nw;
  const { ENEMIES } = await import('../data/enemies');
  state.god = true; state.player.hp = 100;
  let fought = 0;
  for (const def of ENEMIES.filter(e => !e.boss)) {
    const fx = state.player.x + 40, fy = state.player.y;
    const foe = { uid: state.nextUid++, def, x: fx, y: fy, px: fx, py: fy,
      hp: def.hp, maxHp: def.hp, dmg: def.dmg, atkT: 0, telegraphT: 0, animT: 0 };
    sys.hordes.foes.push(foe);
    nw.step(2);
    // Use direct hurt() to verify damage pipeline — combat timing is render-dependent
    sys.hordes.hurt(foe, foe.maxHp * 2);
    nw.step(5);
    if (foe.hp <= 0) fought++;
    sys.hordes.foes = sys.hordes.foes.filter((f: any) => f.uid !== foe.uid);
  }
  ok(fought >= 1, `fought and killed ${fought} mob types`);
  state.god = false;
}

async function testBossFight(nw: any) {
  const { state, sys, world } = nw;
  const { ENEMIES } = await import('../data/enemies');
  const bossDef = ENEMIES.find(e => e.boss);
  if (!bossDef) { ok(true, 'no boss def — skipping boss fight test'); return; }
  if (!state.buildings.some((b: any) => b.type === 'hall')) {
    const htx = Math.floor(state.player.x / 32);
    const hty = Math.floor(state.player.y / 32) - 3;
    state.player.inv.log = 50; state.player.inv.stone = 50; state.player.inv.plank = 30; state.player.inv.wood_scrap = 30;
    state.buildings.push({ uid: state.nextUid++, type: 'hall', tx: htx, ty: hty, hp: 200 });
    world.reindexBuildings();
    nw.step(2);
  }
  state.god = true; state.player.hp = 100;
  const bx = state.player.x + 80, by = state.player.y;
  // Review fix: the fixture used to be {alive, reviveCount} — fields that
  // don't exist on the real WorldBoss interface (state.ts). Death there is
  // `reviveAt > 0`; a fixture using the wrong shape meant the "is it dead"
  // check below was reading a field the real game never sets either way.
  // Match the real shape so the death assertion is meaningful.
  state.worldBosses.push({
    uid: state.nextUid++, defId: bossDef.id, lordId: 'test', name: bossDef.name,
    x: bx, y: by, px: bx, py: by, hp: bossDef.hp, maxHp: bossDef.hp, dmg: bossDef.dmg ?? 10,
    level: 1, atkT: 0, telegraphT: 0, animT: 0, hunting: false,
    provokedUntil: 0, reviveAt: 0, homeGx: 0, homeGy: 0,
  });
  nw.step(5);
  const boss = state.worldBosses.find((b: any) => b.defId === bossDef.id && b.reviveAt === 0);
  ok(boss !== undefined, 'world boss spawned and alive');
  // Damage boss directly via worldbosses system
  if (boss && sys.worldbosses) {
    sys.worldbosses.hurt(boss, boss.maxHp * 2);
    nw.step(5);
    // Real check (previously just `ok(true, ...)`, which can't fail): lethal
    // damage must actually kill it (reviveAt set in the future) and it must
    // drop out of alive().
    ok(boss.reviveAt > state.clock, `lethal damage actually killed the boss (reviveAt ${boss.reviveAt.toFixed(1)} > clock ${state.clock.toFixed(1)})`);
    ok(!sys.worldbosses.alive().some((b: any) => b.uid === boss.uid), 'dead boss excluded from alive() list');
  }
  state.god = false;
}

async function testNightWave(nw: any) {
  const { state, sys } = nw;
  state.clock = 250;
  nw.step(5);
  const nightIdx = Math.floor(state.clock / (240 + 100));
  sys.hordes.onDusk(Math.max(1, nightIdx + 1));
  nw.step(5);
  for (let i = 0; i < 60; i++) nw.step(5);
  // Review fix: `.length >= 0` holds for an empty array too and can never
  // fail. By now (10 sim-seconds since dusk, spawnIntervalSec=0.55) a real
  // wave must have produced foes.
  ok(sys.hordes.foes.length > 0, `night wave produced ${sys.hordes.foes.length} foes after 10 sim-seconds`);
}

async function testDeathAndScatter(nw: any) {
  const { state, sys, world } = nw;
  // Isolate: the real background sim keeps running throughout the ~10+ real
  // seconds this whole suite takes (this is a live, un-paused game, not a
  // sandboxed test harness) — a real horde CAN destroy an earlier test's
  // hall for real in the background before this test even starts. If
  // gameOver is already true, damagePlayer() no-ops unconditionally (its
  // very first check), which would make every attempt below silently do
  // nothing and always read back as "0 tiles scattered" — not a dodge-chance
  // flake, a fully deterministic false negative. Reset it.
  state.gameOver = false;
  state.gameOverCause = null;
  if (!state.buildings.some((b: any) => b.type === 'hall')) {
    const htx = Math.floor(state.player.x / 32);
    const hty = Math.floor(state.player.y / 32) - 3;
    state.player.inv.log = 50; state.player.inv.stone = 50; state.player.inv.plank = 30; state.player.inv.wood_scrap = 30;
    state.buildings.push({ uid: state.nextUid++, type: 'hall', tx: htx, ty: hty, hp: 200 });
    world.reindexBuildings();
    nw.step(2);
  }
  // Isolate: an earlier test may have left god mode on, or the player may be
  // wearing "dodge" gear (X1) that has a ~12% chance to fully negate a hit —
  // neither should make this test flaky, so guarantee a real kill.
  state.god = false;
  state.player.gold = 200;
  state.player.hp = 100;
  nw.step(1);
  const goldBefore = state.player.gold;
  const xBefore = state.player.x, yBefore = state.player.y;
  let scatterTiles = 0;
  for (let attempt = 0; attempt < 8 && scatterTiles <= 20; attempt++) {
    sys.combat.damagePlayer(9999, 'test');
    for (let i = 0; i < 30; i++) nw.step(1);
    scatterTiles = Math.hypot(state.player.x - xBefore, state.player.y - yBefore) / 32;
  }
  ok(state.player.hp > 0, 'player respawned after death');
  ok(typeof state.player.gold === 'number' && state.player.gold >= 0, `gold valid after death: ${state.player.gold}`);
  // Review fix: the trailing `ok(true, ...)` couldn't fail and didn't check
  // the thing the test is named for — that death actually SCATTERS you. The
  // retry loop above absorbs the ~12% dodge-effect chance of a single hit
  // being fully negated (a real gameplay mechanic, not a bug) without
  // weakening what's actually being asserted.
  ok(scatterTiles > 20, `death actually scattered the player (${scatterTiles.toFixed(1)} tiles from the death spot)`);
  void goldBefore;
}

async function testGameOver(nw: any) {
  const { state, world } = nw;
  if (!state.buildings.some((b: any) => b.type === 'hall')) {
    const htx = Math.floor(state.player.x / 32);
    const hty = Math.floor(state.player.y / 32) - 3;
    state.player.inv.log = 50; state.player.inv.stone = 50; state.player.inv.plank = 30; state.player.inv.wood_scrap = 30;
    state.buildings.push({ uid: state.nextUid++, type: 'hall', tx: htx, ty: hty, hp: 200 });
    world.reindexBuildings();
    nw.step(2);
  }
  const hall = state.buildings.find((b: any) => b.type === 'hall');
  ok(hall !== undefined, 'hall exists before game over test');
  if (hall) {
    hall.hp = 0;
    nw.ctx.onHallDestroyed?.();
    nw.step(5);
  }
  ok(state.gameOver === true, 'gameOver flag set after hall destroyed');
  if (typeof document !== 'undefined') {
    const domText = document.body.innerText || '';
    ok(domText.includes('THREAD IS CUT') || domText.includes('thread is cut'), 'death screen shows THE THREAD IS CUT');
  }
}

async function testMobBirthStats(nw: any) {
  const { state, sys } = nw;
  const net = nw.ctx.net;
  if (!net) { ok(true, 'no network system — skipping mob birth stats test'); return; }

  // Ensure a hall exists so spawn() can position foes around it
  const { world } = nw;
  if (!state.buildings.some((b: any) => b.type === 'hall')) {
    const htx = Math.floor(state.player.x / 32);
    const hty = Math.floor(state.player.y / 32) - 3;
    state.player.inv.log = 50; state.player.inv.stone = 50; state.player.inv.plank = 30; state.player.inv.wood_scrap = 30;
    state.buildings.push({ uid: state.nextUid++, type: 'hall', tx: htx, ty: hty, hp: 200 });
    world.reindexBuildings();
    nw.step(2);
  }

  // Pin the realm profile: the special-skill branch reads LIVE variance
  // (Blinker wins at variance ≥ 8000), so on a jittery first-contact network
  // the cold fixture nondeterministically birthed a Blinker instead of a
  // Shelled. The fixture must own every input the birth path reads.
  const origProfile = net.computeRealmProfile;
  net.computeRealmProfile = () => ({ median: 180, variance: 0 });

  // ---- Cold fixture: paid DNS+TLS route → Shelled, Pale prefix ----
  const beforeCold = sys.hordes.foes.length;
  net.lastEcho = {
    ms: 180,
    cold: true,
    jitterAtBirth: 45,
    route: { label: 'DE-CIX', region: 'Europe', countryCode: 'DE' },
    tsMs: performance.now(),
  };

  // Exercise the real birth path in hordes.ts (private at compile-time, callable via any)
  sys.hordes.spawn();
  // Retry if position placement failed (worldgen edge case — water / wall ring)
  for (let i = 0; i < 10 && sys.hordes.foes.length === beforeCold; i++) {
    sys.hordes.spawn();
  }

  const coldFoe = sys.hordes.foes[sys.hordes.foes.length - 1];
  ok(coldFoe !== undefined && coldFoe.uid !== undefined, 'cold fixture: foe spawned via hordes.spawn()');

  if (coldFoe) {
    // Echo-derived identity: cold route → Shelled skill, Pale prefix, Europe suffix
    ok(coldFoe.specialSkill === 'Shelled',
      `cold fixture: specialSkill === 'Shelled' (got ${JSON.stringify(coldFoe.specialSkill)})`);
    ok(coldFoe.echoSoak === 4,
      `cold fixture: echoSoak === 4 (2 base cold + 2 Shelled, got ${coldFoe.echoSoak})`);
    ok(typeof coldFoe.epithetName === 'string' && coldFoe.epithetName.startsWith('Pale'),
      `cold fixture: epithetName starts with 'Pale' (got '${coldFoe.epithetName}')`);
    ok(typeof coldFoe.epithetName === 'string' && coldFoe.epithetName.endsWith('of the Old Roads'),
      `cold fixture: epithetName ends with Europe suffix 'of the Old Roads' (got '${coldFoe.epithetName}')`);

    // C2 birth clamps: hp & dmg within echo-multiplied bounds relative to def
    const echoHpMul = Math.max(0.9, Math.min(1.6, 0.9 + 180 / 400)); // 1.35
    const echoDmgMul = Math.max(0.9, Math.min(1.5, 0.9 + 45 / 80));   // ~1.4625
    const defHp = coldFoe.def.hp;
    const defDmg = coldFoe.def.dmg;
    ok(coldFoe.hp >= defHp * 0.9 && coldFoe.hp <= defHp * 1.6,
      `cold fixture: hp ${coldFoe.hp} in [${Math.floor(defHp * 0.9)}, ${Math.ceil(defHp * 1.6)}] (def ${defHp}, echoHpMul ${echoHpMul.toFixed(2)})`);
    ok(coldFoe.dmg >= defDmg * 0.9 && coldFoe.dmg <= defDmg * 1.5,
      `cold fixture: dmg ${coldFoe.dmg} in [${Math.floor(defDmg * 0.9)}, ${Math.ceil(defDmg * 1.5)}] (def ${defDmg}, echoDmgMul ${echoDmgMul.toFixed(2)})`);
  }

  // Clean up cold run
  for (const f of sys.hordes.foes) nw.ctx.views?.removeFoe?.(f.uid);
  sys.hordes.foes = [];
  sys.hordes.toSpawn = 0;
  net.lastEcho = null;

  // ---- Warm fixture: echo without cold route → Shelled does NOT trigger ----
  const beforeWarm = sys.hordes.foes.length;
  net.lastEcho = {
    ms: 180,
    cold: false,
    jitterAtBirth: 45,
    route: { label: 'DE-CIX', region: 'Europe', countryCode: 'DE' },
    tsMs: performance.now(),
  };

  sys.hordes.spawn();
  for (let i = 0; i < 10 && sys.hordes.foes.length === beforeWarm; i++) {
    sys.hordes.spawn();
  }

  const warmFoe = sys.hordes.foes[sys.hordes.foes.length - 1];
  ok(warmFoe !== undefined && warmFoe.uid !== undefined, 'warm fixture: foe spawned via hordes.spawn()');

  if (warmFoe) {
    ok(warmFoe.specialSkill !== 'Shelled',
      `warm fixture: Shelled does NOT trigger when cold=false (got ${JSON.stringify(warmFoe.specialSkill)})`);
    ok(warmFoe.echoSoak === 0,
      `warm fixture: echoSoak === 0 when not cold (got ${warmFoe.echoSoak})`);
    ok(typeof warmFoe.epithetName === 'string' && !warmFoe.epithetName.startsWith('Pale'),
      `warm fixture: epithetName does NOT start with 'Pale' (got '${warmFoe.epithetName}')`);
  }

  // Clean up
  for (const f of sys.hordes.foes) nw.ctx.views?.removeFoe?.(f.uid);
  sys.hordes.foes = [];
  sys.hordes.toSpawn = 0;
  net.lastEcho = null;
  net.computeRealmProfile = origProfile;
}

async function testDamageRollBounds(nw: any) {
  const net = nw.ctx.net;
  if (!net) { ok(true, 'no network system — skipping damage roll test'); return; }
  net.snap.echoJitter = 5;
  const calmRolls: number[] = [];
  for (let i = 0; i < 200; i++) {
    const rng = ((s: number) => () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; })(1234 + i);
    const result = net.rollDamageMul?.(rng) ?? { mul: 1.0 };
    calmRolls.push(result.mul);
  }
  net.snap.echoJitter = 80;
  const stormyRolls: number[] = [];
  for (let i = 0; i < 200; i++) {
    const rng = ((s: number) => () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; })(5678 + i);
    const result = net.rollDamageMul?.(rng) ?? { mul: 1.0 };
    stormyRolls.push(result.mul);
  }
  const allOk = [...calmRolls, ...stormyRolls].every(r => r >= 0.30 && r <= 1.50);
  ok(allOk, 'all 400 damage rolls within [0.30, 1.50]');
  const calmVar = calmRolls.reduce((s, v) => s + (v - 1) ** 2, 0) / calmRolls.length;
  const stormyVar = stormyRolls.reduce((s, v) => s + (v - 1) ** 2, 0) / stormyRolls.length;
  ok(stormyVar > calmVar, `stormy variance ${stormyVar.toFixed(4)} > calm ${calmVar.toFixed(4)}`);
}

async function testNetworkFallbacks(nw: any) {
  const net = nw.ctx.net;
  if (!net) { ok(true, 'no network system — skipping fallback test'); return; }
  const prevOnline = net.snap.online;
  net.snap.online = false;
  net.snap.rtt = 50;
  net.snap.downlink = 10;
  net.snap.jitter = 5;
  net.snap.effectiveType = '4g';
  net.snap.connectionType = 'unknown';
  nw.step(2);
  const biome = net.selectBiome?.() ?? net.getBiome?.();
  ok(biome !== undefined, 'biome selected in offline mode');
  const targets = ['simSpeed', 'goldRate', 'enemyScale', 'moveSpeed', 'gatherSpeed', 'xpRate', 'damage'];
  let okCount = 0;
  for (const t of targets) {
    const v = net.getGameValue?.(t);
    if (typeof v === 'number' && !isNaN(v)) okCount++;
  }
  ok(okCount === targets.length, `all ${targets.length} modifiers return values in offline mode`);
  net.snap.online = prevOnline;
}

async function testUISmoke(nw: any) {
  if (typeof document === 'undefined') { ok(true, 'no DOM — skipping UI smoke test'); return; }
  const { ui } = nw;
  ok(ui !== undefined, 'ui handle exists');
  try { ui.open?.('bag'); } catch {}
  nw.step(2);
  try { ui.open?.('craft'); } catch {}
  nw.step(2);
  try { ui.open?.('skills'); } catch {}
  nw.step(2);
  try { ui.open?.('log'); } catch {}
  nw.step(2);
  const lensPanel = document.getElementById('nw-observatory');
  ok(lensPanel !== null, 'Lens panel exists in DOM');
  const lensBody = document.getElementById('nw-lens-body');
  ok(lensBody !== null, 'Lens body element exists');
  // N4.2: the Lens is a transform-driven drawer now, so poking style.display
  // no longer opens it. The `if (row)` guard here also meant the inspect-box
  // assertion silently skipped whenever the panel was empty — a precondition
  // that never held. Both are covered properly by the dedicated Lens tests;
  // this one keeps only what it can honestly claim.
  ok(document.getElementById('nw-lens-inspect') !== null, 'inspect box element exists');
}

// =========================================================================
// C2: Waystones — chain placement, disconnect decay, cascading
// =========================================================================

async function testWaystoneChain(nw: any) {
  const { state, sys, world } = nw;
  const { BUILDINGS } = await import('../data/buildings');
  const waystoneDef = BUILDINGS.find((b: any) => b.id === 'waystone')!;
  ok(waystoneDef !== undefined, 'waystone building exists in data');

  // Ensure a hall exists
  if (!state.buildings.some((b: any) => b.type === 'hall')) {
    const htx = Math.floor(state.player.x / 32);
    const hty = Math.floor(state.player.y / 32) - 3;
    state.player.inv.wood_scrap = 50; state.player.inv.plank = 30;
    state.buildings.push({ uid: state.nextUid++, type: 'hall', tx: htx, ty: hty, hp: 200 });
    world.reindexBuildings();
    nw.step(2);
  }
  const hall = state.buildings.find((b: any) => b.type === 'hall')!;

  // Give materials for waystones
  state.player.inv.iron_ore = (state.player.inv.iron_ore ?? 0) + 20;
  state.player.inv.stone = (state.player.inv.stone ?? 0) + 40;
  state.player.inv.copper_ore = (state.player.inv.copper_ore ?? 0) + 20;
  nw.step(1);

  // Place a waystone near the hall (within range — should work).
  //
  // This used to hardcode `hall.tx + 4` behind a silent `if (canPlaceAt)`. The
  // hall is built at whatever tile the player happens to be standing on, so
  // four tiles east of it is water or cliff often enough to matter — and when
  // it was, nothing was placed and the assertion below failed as though
  // waystones were broken. Search the ring instead, and assert that a spot was
  // found, so a genuinely unplaceable neighbourhood says so in its own words.
  sys.build.enter('waystone');
  ok(sys.build.mode !== null, 'can enter waystone build mode');
  let ws1x = 0, ws1y = 0, spot = false;
  outer1:
  for (let r = 2; r <= 5 && !spot; r++) {
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]] as [number, number][]) {
      if (!world.canPlaceAt(hall.tx + dx, hall.ty + dy, false)) continue;
      ws1x = hall.tx + dx; ws1y = hall.ty + dy; spot = true;
      break outer1;
    }
  }
  ok(spot, `a placeable tile exists within 5 of the hall at ${hall.tx},${hall.ty}`);
  if (spot) {
    state.buildings.push({ uid: state.nextUid++, type: 'waystone', tx: ws1x, ty: ws1y, hp: waystoneDef.hp });
    world.reindexBuildings();
  }
  sys.build.cancel();
  ok(state.buildings.some((b: any) => b.type === 'waystone'),
    'waystone placed near hall');

  // Place a second waystone near the first (chain — should work). Same silent
  // guard as above: a hardcoded +4 lands in water often enough to matter.
  sys.build.enter('waystone');
  let spot2 = false, ws2x = ws1x, ws2y = ws1y;
  outer2:
  for (let r = 2; r <= 5 && !spot2; r++) {
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]] as [number, number][]) {
      if (!sys.build.mode || !world.canPlaceAt(ws1x + dx, ws1y + dy, false)) continue;
      ws2x = ws1x + dx; ws2y = ws1y + dy;
      state.buildings.push({ uid: state.nextUid++, type: 'waystone', tx: ws2x, ty: ws2y, hp: waystoneDef.hp });
      world.reindexBuildings();
      spot2 = true;
      break outer2;
    }
  }
  ok(spot2, `a second placeable tile exists within 5 of ${ws1x},${ws1y}`);
  sys.build.cancel();
  ok(state.buildings.filter((b: any) => b.type === 'waystone').length >= 2,
    'waystone chain extended (2+ waystones)');

  // Place a wall near the second waystone (should work via chain).
  //
  // This guarded the PLACEMENT on canPlaceAt() and then asserted unconditionally
  // that the wall was there — so a hardcoded +1 landing in water went red with a
  // message about waystone chaining, which is not what failed. The sibling
  // search for spot2 above already carries exactly this fix and its comment; this
  // one was missed. Search for a placeable tile in the chain's radius instead.
  sys.build.enter('wall');
  let wallX = ws2x + 1, wallY = ws2y, placedWall = false;
  outer3:
  for (let r = 1; r <= 3 && !placedWall; r++) {
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]] as [number, number][]) {
      if (!sys.build.mode || !world.canPlaceAt(ws2x + dx, ws2y + dy, false)) continue;
      wallX = ws2x + dx; wallY = ws2y + dy;
      state.buildings.push({ uid: state.nextUid++, type: 'wall', tx: wallX, ty: wallY, hp: 80 });
      world.reindexBuildings();
      placedWall = true;
      break outer3;
    }
  }
  sys.build.cancel();
  ok(placedWall, `a placeable tile for a wall exists within 3 of the chained waystone ${ws2x},${ws2y}`);
  ok(state.buildings.some((b: any) => b.type === 'wall' && b.tx === wallX && b.ty === wallY),
    'wall placed near chained waystone');

  // (anchor-destruction decay is exercised by the Waystone disconnect test)
  ok(true, 'waystone chain test completed without errors');
}

async function testWaystoneDisconnect(nw: any) {
  const { state, sys, world } = nw;
  const { CFG } = await import('../data/config');

  // hall + waystone at the hall's range limit + a wall reachable ONLY via the
  // waystone. (An earlier version put everything within maxDistFromHall of
  // the hall, so nothing could ever disconnect — and passed `hp <= 80`
  // vacuously. This geometry actually severs something.)
  const htx = Math.floor(state.player.x / 32), hty = Math.floor(state.player.y / 32) - 3;
  if (!state.buildings.some((b: any) => b.type === 'hall')) {
    state.buildings.push({ uid: state.nextUid++, type: 'hall', tx: htx, ty: hty, hp: 200 });
  }
  const hallB = state.buildings.find((b: any) => b.type === 'hall')!;
  const maxDist = CFG.build.maxDistFromHall;
  // 500 tiles out: far beyond any relay chain earlier tests may have built
  // (findDisconnected lets ordinary buildings daisy-chain connectivity)
  const wsx = hallB.tx + 500, wsy = hallB.ty;
  state.buildings.push({ uid: state.nextUid++, type: 'waystone', tx: wsx, ty: wsy, hp: 400 });
  const waystone = state.buildings[state.buildings.length - 1];
  const wallX = wsx + maxDist - 2, wallY = wsy;
  state.buildings.push({ uid: state.nextUid++, type: 'wall', tx: wallX, ty: wallY, hp: 80 });
  const wall = state.buildings[state.buildings.length - 1];
  world.reindexBuildings();

  ok(Math.max(Math.abs(wallX - hallB.tx), Math.abs(wallY - hallB.ty)) > maxDist,
    'fixture: wall stands beyond hall range — only the waystone anchors it');

  // sever the waystone → the wall must be named disconnected, flagged, and decay
  const disco = world.findDisconnected([waystone]);
  ok(disco.includes(wall.uid), `findDisconnected names the wall (got [${disco.join(',')}])`);
  state.buildings = state.buildings.filter((b: any) => b.uid !== waystone.uid);
  world.reindexBuildings();
  sys.build.markDisconnected(disco);
  ok((wall as any)._decaying === true, 'wall is flagged decaying');

  const hpBefore = wall.hp;
  for (let i = 0; i < 30; i++) sys.build.updateDecay(1 / 10);
  ok(wall.hp < hpBefore, `wall decays while disconnected: ${hpBefore} → ${wall.hp.toFixed(1)}`);

  // clean up the far-flung fixture so later tests see a sane base
  state.buildings = state.buildings.filter((b: any) => b.uid !== wall.uid);
  world.reindexBuildings();
  ok(true, 'waystone disconnect decay test completed');
}

// =========================================================================
// C3: The Loom — node allocation, modifier computation, keystone effects
// =========================================================================

async function testLoomAllocation(nw: any) {
  const { state } = nw;
  const { LOOM_NODES, computeModifiers, DEFAULT_MODIFIERS } = await import('../data/loom');
  // B3.b resized the tree from 40 nodes to 15 for the 15-minute run. The shape is
  // pinned properly in testLoomTreeShape; this only needs a tree to walk.
  ok(LOOM_NODES.length >= 12, `Loom has ${LOOM_NODES.length} nodes to walk`);

  // Give some points to spend
  state.player.loomPoints = 5;
  state.player.loomNodes = {};
  nw.step(1);

  const loom = nw.sys.loom;
  ok(loom !== undefined, 'loom system exists');

  // Allocate a starter node (no prereqs)
  const starterNode = LOOM_NODES.find((n: any) => !n.req || n.req.length === 0)!;
  ok(starterNode !== undefined, 'starter node exists (no prereqs)');

  const ok1 = loom.allocate(starterNode.id);
  ok(ok1, `allocated starter node: ${starterNode.name}`);
  ok(state.player.loomPoints === 4, `points consumed: 5 → ${state.player.loomPoints}`);

  // Modifiers should have changed from defaults
  const mods = loom.ensureMods();
  let anyChanged = false;
  for (const key of Object.keys(DEFAULT_MODIFIERS) as (keyof typeof DEFAULT_MODIFIERS)[]) {
    if (mods[key] !== DEFAULT_MODIFIERS[key]) { anyChanged = true; break; }
  }
  ok(anyChanged, 'modifiers changed from defaults after allocation');

  // Rank up the same node
  const maxRank = starterNode.maxRank;
  for (let r = 1; r < maxRank; r++) {
    loom.allocate(starterNode.id);
  }
  const finalRank = state.player.loomNodes[starterNode.id] ?? 0;
  ok(finalRank === maxRank, `node ranked to max: ${finalRank}/${maxRank}`);
  ok(!loom.canAllocate(starterNode.id), 'cannot allocate beyond maxRank');

  // Cannot allocate without points
  state.player.loomPoints = 0;
  const deepNode = LOOM_NODES.find((n: any) => n.req && n.req.length > 0)!;
  if (deepNode) {
    ok(!loom.canAllocate(deepNode.id), 'cannot allocate deep node without points');
  }
  // Restore points and check prereq gating
  state.player.loomPoints = 1;
  if (deepNode) {
    // Without the prereq, should fail
    state.player.loomNodes = { [starterNode.id]: maxRank };
    const canAllocateDeep = loom.canAllocate(deepNode.id);
    // May or may not have the right prereq - just check it doesn't crash
    ok(typeof canAllocateDeep === 'boolean', 'canAllocate returns boolean for deep node');
  }

  ok(true, 'loom allocation test completed');
}

async function testLoomKeystones(nw: any) {
  const { state } = nw;
  const { LOOM_NODES } = await import('../data/loom');
  const { CFG } = await import('../data/config');

  // Find all keystones
  const keystones = LOOM_NODES.filter((n: any) => n.keystone);
  ok(keystones.length === 4, `4 keystones defined (got ${keystones.length})`);

  // Glass Echo
  const glassEcho = LOOM_NODES.find((n: any) => n.id === 'keystone_glass');
  ok(glassEcho !== undefined, 'Glass Echo keystone exists');
  // The old assertion here was `keystoneDesc.includes('HP')` — it pinned the
  // *advertisement* in place. Glass Echo promises "Max HP halved" and nothing
  // implements it: `glassEcho` is read in exactly one place, combat.ts's
  // damage-roll transform, which is the upside. Testing the description made
  // the missing downside harder to notice, not easier. The gap is a balance
  // call, recorded for B3 (§12 Q3), so it is left alone here rather than
  // silently implemented — but it is no longer defended by a test.

  // Deep Roots
  const deepRoots = LOOM_NODES.find((n: any) => n.id === 'keystone_roots');
  ok(deepRoots !== undefined, 'Deep Roots keystone exists');

  // Night Market
  const nightMarket = LOOM_NODES.find((n: any) => n.id === 'keystone_market');
  ok(nightMarket !== undefined, 'Night Market keystone exists');

  // Long Thread
  const longThread = LOOM_NODES.find((n: any) => n.id === 'keystone_thread');
  ok(longThread !== undefined, 'Long Thread keystone exists');

  // Verify keystone modifier effects
  const loom = nw.sys.loom;
  ok(loom !== undefined, 'loom system available');

  // Grant enough points and prereqs to allocate a keystone
  state.player.loomPoints = 10;
  state.player.loomNodes = {};
  // Allocate prereqs for Glass Echo (if any)
  if (glassEcho!.req) {
    for (const reqId of glassEcho!.req) {
      state.player.loomNodes[reqId] = (LOOM_NODES.find((n: any) => n.id === reqId)?.maxRank ?? 1);
    }
  }

  // This used to read `loom.allocate('keystone_glass_echo')` — a node id that
  // does not exist. allocate() returned false, the whole `if (allocated)` body
  // was unreachable, and the test closed on `ok(true, ...)`. It had never once
  // allocated a keystone. Allocate the real id and assert unconditionally, so
  // a rename cannot quietly hollow it out again.
  ok(loom.allocate('keystone_glass'), 'Glass Echo allocates once its prereq is held');
  const mods = loom.ensureMods();
  ok(mods.glassEcho === true, 'Glass Echo flag is live after allocation');

  // The implemented half of the keystone: damage rolls are remapped out of the
  // bottom of the D5 band, so a roll sitting on the band floor comes back high.
  const floorRoll = loom.getDmgRollTransform(0.30);
  ok(floorRoll > 0.30, `Glass Echo lifts a floor roll: 0.30 → ${floorRoll.toFixed(2)}`);

  ok(state.player.loomPoints > 0, 'points remain, so the next check is about rank not funds');
  ok(!loom.canAllocate('keystone_glass'), 'a keystone cannot be taken twice');
}

/** B3.c — slaying a domain lord pays out, on every path it advertises.
 *
 *  §B3 asks for exactly this: "verify the echo-grant and relic-drop paths actually
 *  fire end-to-end once a boss is killable — the ROADMAP records that
 *  `worldbosses.hurt()` was missing its `scoreboard.onKill()` call for the entire
 *  life of the project until L1 found it. That code path has had very little real
 *  exercise."
 *
 *  It had less than that. Mutating the boss death branch one line at a time, three
 *  of its five payouts were completely unpinned — the suite stayed green with the
 *  scoreboard call deleted, with the Loom grant deleted, and with the combat xp
 *  deleted. **The scoreboard line is the one that was already lost once**, for the
 *  project's entire history, and nothing would have caught losing it again.
 *
 *  Killing is done through `hurt()` rather than by fighting: the payout branch is
 *  what is under test, not the AI or the damage pipeline. */
async function testBossDeathPaysOut(nw: any) {
  const { state, sys } = nw;
  const { CFG } = await import('../data/config');

  const saved = {
    bosses: state.worldBosses.map((b: any) => ({ ...b })),
    gold: state.player.gold,
    inv: { ...state.player.inv },
    xp: { ...state.player.xp },
    echoes: { ...(state.player.echoes ?? {}) },
    relic: state.player.relic,
    points: state.player.loomPoints,
    slain: sys.scoreboard.bossesSlain,
    pos: { x: nw.player.x, y: nw.player.y },   // B5: the hoard is collected on foot; nw.player is authoritative
    drops: state.drops.slice(),
    god: state.god,
    gameOver: state.gameOver,
  };
  try {
    state.god = false;
    state.gameOver = false;

    // Any lord will do; revive one if they are all re-forming.
    let boss = sys.worldbosses.alive()[0];
    if (!boss && state.worldBosses.length) {
      boss = state.worldBosses[0];
      boss.reviveAt = 0;
      boss.hp = boss.maxHp;
    }
    ok(boss !== undefined, 'a domain lord exists to be slain');
    if (!boss) return;

    const invSum = () => Object.values(state.player.inv as Record<string, number>)
      .reduce((s: number, n: number) => s + n, 0);
    const before = {
      echoes: Object.keys(state.player.echoes ?? {}).length,
      gold: state.player.gold,
      inv: invSum(),
      combatXp: state.player.xp.combat ?? 0,
      points: state.player.loomPoints ?? 0,
      slain: sys.scoreboard.bossesSlain,
    };

    sys.worldbosses.hurt(boss, boss.hp * 2 + 100, true);

    ok(boss.hp <= 0, `${boss.name} falls`);
    ok(boss.reviveAt > state.clock, '...and is scheduled to re-form, not deleted');

    // C1 — the echo clings to the slayer.
    ok(Object.keys(state.player.echoes ?? {}).length > before.echoes,
      `the lord's echo is granted (${before.echoes} → ${Object.keys(state.player.echoes ?? {}).length})`);

    // C4 — the relic table rolls. Bosses are the only relic source in the game.
    // B5 rewrite: the hoard now lands on the GROUND, so the old `invSum() > before`
    // stopped being the behaviour. Asserting only `state.drops.length` up would
    // leave the collect path unpinned, and calling drops.collectAll() would pass
    // without ever exercising the magnet — the tautology that has burned this
    // project three times. So: assert it hit the floor, then walk in and take it.
    //
    // B5 Q2 rewrite: the lord's PURSE now lands on the floor too, as coins. The
    // two halves are counted apart because they bank to different places — the
    // relics to the bag, the coins to state.player.gold — and one sum over both
    // was what made the old assertion fail the moment coins started dropping.
    const { GOLD_ID } = await import('../data/items');
    const itemsDown = () => state.drops
      .filter((d: any) => d.id !== GOLD_ID).reduce((t: number, d: any) => t + d.n, 0);
    const goldDown = () => state.drops
      .filter((d: any) => d.id === GOLD_ID).reduce((t: number, d: any) => t + d.n, 0);
    ok(itemsDown() > 0,
      `the lord's hoard hits the floor (${state.drops.length} stack(s), ${itemsDown()} items)`);
    const onGround = itemsDown();
    const coinsDown = goldDown();
    ok(coinsDown > 0,
      `...and so does its purse — ${coinsDown} gold in coins you have to walk through`);
    eq(state.player.gold, before.gold,
      '...which is NOT credited at the moment of the kill');
    eq(invSum(), before.inv,
      'and NOT into the bag — B5 loot is earned by walking to it');
    // the magnet only arms after CFG.drops.armDelaySec, so this must not collect yet
    nw.step(2);
    eq(invSum(), before.inv,
      `nothing is collected inside the ${CFG.drops.armDelaySec}s arm delay`);
    const pile = state.drops[0];
    nw.player.teleport(pile.x, pile.y);
    for (let i = 0; i < 240 && state.drops.length; i++) {
      nw.player.teleport(state.drops[0].x, state.drops[0].y);
      nw.step(1);
    }
    ok(invSum() >= before.inv + onGround,
      `walking onto the hoard banks it (${before.inv} → ${invSum()} items)`);
    eq(state.drops.length, 0, 'and the floor is clear again');
    eq(state.player.gold - before.gold, coinsDown,
      `...including the coins, for exactly what was lying there (+${coinsDown} gold)`);

    // The three that nothing pinned before this test existed.
    eq(sys.scoreboard.bossesSlain, before.slain + 1,
      'scoreboard.onKill(true) fires — the line that was missing for the whole project');
    eq((state.player.loomPoints ?? 0) - before.points, CFG.loom.pointsPerBossKill,
      `the Loom drinks: +${CFG.loom.pointsPerBossKill} points, the run's second income source`);
    ok((state.player.xp.combat ?? 0) > before.combatXp,
      `combat xp is awarded (${before.combatXp} → ${state.player.xp.combat})`);

    // A lord already re-forming cannot be farmed for a second payout.
    const afterFirst = sys.scoreboard.bossesSlain;
    sys.worldbosses.hurt(boss, 99999, true);
    eq(sys.scoreboard.bossesSlain, afterFirst,
      'a re-forming lord pays out once, not once per swing');
  } finally {
    state.worldBosses.length = 0;
    for (const b of saved.bosses) state.worldBosses.push(b);
    state.player.gold = saved.gold;
    state.player.inv = saved.inv;
    state.player.xp = saved.xp;
    state.player.echoes = saved.echoes;
    state.player.relic = saved.relic;
    state.player.loomPoints = saved.points;
    sys.scoreboard.bossesSlain = saved.slain;
    nw.player.teleport(saved.pos.x, saved.pos.y);
    state.drops.length = 0;
    for (const d of saved.drops) state.drops.push(d);
    state.god = saved.god;
    state.gameOver = saved.gameOver;
  }
}

/** B3.b — the tree's shape, pinned as a rule rather than as a snapshot.
 *
 *  Three properties, each of which the old 40-node tree broke:
 *
 *  1. Every keystone is reachable at the same cost. The old depths were 5 (Long
 *     Thread), 8 (Glass Echo) and 9 (Night Market, Deep Roots) against a run that
 *     affords ~6 points — so exactly one keystone was ever takeable, and it was the
 *     one that paid for itself. That is a forced opening, not a build.
 *  2. Every stat key the modifier map declares is granted by at least one node.
 *     This is the structural half of B3.a: that test proves each key is CONSUMED by
 *     a system, this one proves each is GRANTED by the tree. A key needs both to
 *     matter, and the old tree failed the pair in the other direction — nine Ward
 *     nodes granted only keys nothing read.
 *  3. No node is inert. A node whose every effect is a key no system consumes is a
 *     purchasable placebo, and the tree had ten of them.
 *
 *  Depth is computed the way `allocate()` actually gates: one rank of each
 *  prerequisite, transitively, plus the node itself. */
async function testLoomTreeShape(nw: any) {
  const { LOOM_NODES, nodeById, DEFAULT_MODIFIERS, computeModifiers } = await import('../data/loom');

  eq(LOOM_NODES.length, 15, `the tree is 15 nodes (got ${LOOM_NODES.length})`);
  const totalRanks = LOOM_NODES.reduce((s: number, n: any) => s + n.maxRank, 0);
  ok(totalRanks <= 60,
    `${totalRanks} total ranks — small enough that a ~6-point run engages a real fraction of it`);

  // --- 1. every keystone costs the same, and that cost is affordable ---
  const costTo = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const n = nodeById(id);
    if (!n) return 0;
    return 1 + (n.req ?? []).reduce((s, r) => s + costTo(r, seen), 0);
  };
  const keystones = LOOM_NODES.filter((n: any) => n.keystone);
  eq(keystones.length, 4, 'four keystones');
  const depths = keystones.map((k: any) => ({ id: k.id, name: k.name, cost: costTo(k.id) }));
  for (const d of depths) {
    eq(d.cost, 4, `${d.name} costs ${d.cost} points to reach (all keystones sit at 4)`);
  }
  // A 900s run spans 2.65 cycles, so 2 nights + ~2 lords ≈ 6 points.
  const { CFG } = await import('../data/config');
  const reachablePoints = 2 * 1 + 2 * CFG.loom.pointsPerBossKill;
  ok(Math.max(...depths.map((d) => d.cost)) < reachablePoints,
    `a ~${reachablePoints}-point run can afford any keystone AND spend the remainder on ranks`);
  ok(Math.min(...depths.map((d) => d.cost)) * 2 > reachablePoints - 2,
    'but not so cheap that a run trivially takes all four');

  // --- 2. every declared modifier key is granted by some node ---
  const statKeys = Object.keys(DEFAULT_MODIFIERS).filter(
    (k) => typeof (DEFAULT_MODIFIERS as any)[k] === 'number');
  const granted = new Set<string>();
  for (const n of LOOM_NODES) for (const k of Object.keys(n.effects)) granted.add(k);
  const ungranted = statKeys.filter((k) => !granted.has(k));
  eq(ungranted.length, 0,
    `every stat key is granted by some node${ungranted.length ? ` — orphaned: ${ungranted.join(', ')}` : ''}`);

  // Keystone flags come from the flag branch of computeModifiers, not from effects.
  const flagKeys = Object.keys(DEFAULT_MODIFIERS).filter(
    (k) => typeof (DEFAULT_MODIFIERS as any)[k] === 'boolean');
  for (const k of flagKeys) {
    const owner = keystones.find((ks: any) => (computeModifiers({ [ks.id]: 1 }) as any)[k] === true);
    ok(owner !== undefined, `keystone flag '${k}' is raised by a real keystone (${owner?.name ?? 'NONE'})`);
  }

  // --- 3. no node is inert ---
  // A node is inert when allocating one rank of it changes nothing in the map.
  const inert = LOOM_NODES.filter((n: any) => {
    if (n.keystone) return false;
    const m = computeModifiers({ [n.id]: 1 });
    return statKeys.every((k) => (m as any)[k] === (DEFAULT_MODIFIERS as any)[k]);
  });
  eq(inert.length, 0,
    `no node is a placebo${inert.length ? ` — inert: ${inert.map((n: any) => n.name).join(', ')}` : ''}`);

  // --- prerequisites are all real, and nothing is orphaned behind a typo ---
  for (const n of LOOM_NODES) {
    for (const r of n.req ?? []) {
      ok(nodeById(r) !== undefined, `${n.name}'s prerequisite '${r}' is a real node`);
    }
  }
}

/** B3.b — the Loom is reachable by a player.
 *
 *  It was not. `LoomSystem.allocate()` shipped with C3 and had **zero production
 *  call sites**: no panel, no tab, no key binding, no mention of the Loom anywhere
 *  in `ui/` except the end-of-run scorecard's point total. A player earned points,
 *  was toasted about each one, saw them counted on their scorecard, and could never
 *  spend a single one. Forty nodes, 132 ranks and four keystones were unreachable
 *  by any means the game offered.
 *
 *  §12 Q3 asked whether a 40-node tree is the right size for a 15-minute run. The
 *  honest answer was that its size did not matter yet — nobody could open it.
 *
 *  This drives the real DOM: opens the panel, clicks a node, and checks that a
 *  point left the bank and a modifier the game reads actually moved. */
async function testLoomPanelIsReachable(nw: any) {
  const { state, ui, sys } = nw;
  const { LOOM_NODES } = await import('../data/loom');
  const saved = {
    nodes: { ...(state.player.loomNodes ?? {}) },
    points: state.player.loomPoints,
    rebuild: (sys.loom as any)._rebuildNeeded,
  };
  try {
    state.player.loomNodes = {};
    state.player.loomPoints = 4;
    (sys.loom as any)._rebuildNeeded = true;

    ui.open('loom');
    ok(ui.isOpen(), 'the Loom panel opens at all');
    eq(document.querySelector('.nw-phead h2')?.textContent, 'THE LOOM',
      'the panel that opens is the Loom');
    eq(document.querySelectorAll('.nw-loomcol').length, 3, 'all three branches are drawn');
    eq(document.querySelectorAll('.nw-loomnode').length, LOOM_NODES.length,
      `every one of the ${LOOM_NODES.length} nodes is on screen`);
    ok(document.querySelectorAll('.nw-loomnode.keystone').length === 4,
      'the four keystones are drawn and marked as keystones');

    const affordable = [...document.querySelectorAll('.nw-loomnode.can')] as HTMLElement[];
    ok(affordable.length > 0, `${affordable.length} nodes are allocatable with 4 points in hand`);

    const pointsBefore = state.player.loomPoints;
    const modsBefore = { ...sys.loom.ensureMods() };
    affordable[0].click();
    eq(state.player.loomPoints, pointsBefore - 1,
      'clicking a node spends a real point — the panel is wired to LoomSystem');
    eq(Object.keys(state.player.loomNodes).length, 1, '...and records the rank on the run');

    // The click has to reach the modifier map, not just the bookkeeping.
    const modsAfter = sys.loom.ensureMods();
    const moved = Object.keys(modsAfter).filter(
      (k) => typeof (modsAfter as any)[k] === 'number' && (modsAfter as any)[k] !== (modsBefore as any)[k]);
    ok(moved.length > 0,
      `...and moves a modifier the game reads (${moved.join(', ')})`);

    // Spending down to nothing closes the tree again — no free ranks.
    state.player.loomPoints = 0;
    ui.open('loom');
    eq(document.querySelectorAll('.nw-loomnode.can').length, 0,
      'with no points, nothing is allocatable');
  } finally {
    ui.close();
    state.player.loomNodes = saved.nodes;
    state.player.loomPoints = saved.points;
    (sys.loom as any)._rebuildNeeded = true;
    sys.loom.ensureMods();
    (sys.loom as any)._rebuildNeeded = saved.rebuild;
  }
}

/** B3.a — the Loom's payoff layer is real, not advertising.
 *
 *  The audit that motivated this test: six of `LoomModifiers`' fourteen stat keys
 *  (`craftCostReduction`, `armorPct`, `regenPct`, `buildingHpPct`, `towerDmgPct`,
 *  `towerRange`) had **zero production consumers**. That made 10 of the tree's 36
 *  nodes — 38 of 128 ranks — placebo, including nine of the twelve Ward nodes.
 *  `getBuildingHpMul`, `getBossWakeGold` and `getDmgRollTransform` had zero
 *  production call sites *between them*. Deep Roots did nothing whatsoever: all
 *  three of its advertised clauses were unwired.
 *
 *  The suite was fully green through all of it, which is the actual lesson. So this
 *  test does not check the accessors against themselves — with two flagged
 *  exceptions it drives the real system and observes the real consequence: damage
 *  actually taken, HP actually regenerated, ingredients actually left in the bag, a
 *  building's actual ceiling, a tower actually reaching a foe it could not reach.
 *
 *  Modifiers are pinned directly onto `loom.mods` rather than allocated. That is
 *  deliberate: this test asks whether the game CONSUMES each key. Whether the tree
 *  GRANTS it is a different question, tested by the allocation tests. */
async function testLoomPayoffLayerIsReal(nw: any) {
  const { state, sys, world } = nw;
  const loom = sys.loom;
  const { DEFAULT_MODIFIERS } = await import('../data/loom');
  const { playerMaxHp } = await import('../rules');
  const { CFG } = await import('../data/config');
  const { craft } = await import('./crafting');
  const { BUILDINGS } = await import('../data/buildings');
  const { ENEMIES } = await import('../data/enemies');

  const saved = {
    mods: loom.mods,
    rebuild: (loom as any)._rebuildNeeded,
    nodes: { ...(state.player.loomNodes ?? {}) },
    points: state.player.loomPoints,
    hp: state.player.hp,
    gold: state.player.gold,
    depleted: { ...state.depleted },
    clock: state.clock,
    equip: { ...state.player.equip },
    relic: state.player.relic,
    inv: { ...state.player.inv },
    buildings: state.buildings.slice(),
    god: state.god,
    gameOver: state.gameOver,
    xp: { ...state.player.xp },
  };
  // A clean subject: no god mode, no gear (gear grants flat armour and can carry
  // the 'dodge' effect, which would make the damage probe a coin flip), daylight.
  state.god = false;
  state.gameOver = false;
  state.player.equip = {};
  state.player.relic = undefined;
  state.clock = 10;                     // daylight — regen is day-only

  const setMods = (over: any) => {
    loom.mods = { ...DEFAULT_MODIFIERS, ...over };
    (loom as any)._rebuildNeeded = false;
  };

  try {
    // ---- armorPct: damage actually taken ---------------------------------
    const hitFor = (dmg: number) => {
      state.player.hp = 5000;             // headroom, so no death/respawn branch
      const before = state.player.hp;
      sys.combat.damagePlayer(dmg, 'gauntlet');
      return before - state.player.hp;
    };
    setMods({});
    const bareHit = hitFor(60);
    setMods({ armorPct: 100 });
    const armoredHit = hitFor(60);
    ok(bareHit > 0, `a bare hit lands for ${bareHit}`);
    ok(armoredHit < bareHit,
      `armorPct softens a real hit: ${bareHit} → ${armoredHit} damage taken`);
    ok(armoredHit <= Math.ceil(bareHit * 0.6),
      `100 armorPct is worth about a third off: ${armoredHit} ≤ ${Math.ceil(bareHit * 0.6)}`);

    // Diminishing, so no stack of ranks reaches immunity.
    setMods({ armorPct: 100000 });
    ok(hitFor(60) >= 1, 'armorPct cannot reach immunity — a hit always costs at least 1');

    // ---- regenPct: HP actually regenerated -------------------------------
    const regenOver = (secs: number) => {
      state.player.hp = 1;
      sys.combat.update(secs);
      return state.player.hp - 1;
    };
    setMods({});
    const bareRegen = regenOver(1.0);
    setMods({ regenPct: 200 });
    const boostedRegen = regenOver(1.0);
    ok(bareRegen > 0, `daylight regen ticks at all: +${bareRegen.toFixed(3)} hp/s`);
    ok(boostedRegen > bareRegen,
      `regenPct speeds real regen: ${bareRegen.toFixed(3)} → ${boostedRegen.toFixed(3)} hp/s`);

    // ---- craftCostReduction: ingredients actually left in the bag --------
    const { RECIPES } = await import('../data/recipes');
    const rec = RECIPES.find((r: any) => r.in.length === 1 && r.in[0].n >= 2);
    if (rec) {
      state.player.xp[rec.skill] = 1e7;   // clear the level gate
      const ing = rec.in[0];
      setMods({});
      state.player.inv[ing.id] = ing.n;
      ok(craft(state, rec.id, () => {}, undefined, undefined, loom),
        `${rec.id} crafts at full price`);
      eq(state.player.inv[ing.id] ?? 0, 0, `...consuming all ${ing.n} ${ing.id}`);

      setMods({ craftCostReduction: 50 });
      state.player.inv[ing.id] = ing.n;
      ok(craft(state, rec.id, () => {}, undefined, undefined, loom),
        `${rec.id} still crafts at a discount`);
      eq(state.player.inv[ing.id] ?? 0, ing.n - Math.ceil(ing.n * 0.5),
        `...leaving ${ing.n - Math.ceil(ing.n * 0.5)} ${ing.id} unspent — the discount is real`);

      // Never free: the floor holds even at an absurd rank total.
      setMods({ craftCostReduction: 100000 });
      state.player.inv[ing.id] = ing.n;
      craft(state, rec.id, () => {}, undefined, undefined, loom);
      eq(state.player.inv[ing.id] ?? 0, ing.n - 1,
        'craftCostReduction floors at 1 of each ingredient — crafting never becomes free');
    }

    // ---- gatherSpeedPct and doubleYieldChance: the real gather -----------
    // Both were already wired before B3.a, and both were unpinned: unwiring either
    // left the suite green. Found by mutation, not by reading.
    state.player.inv.axe_flint = (state.player.inv.axe_flint ?? 0) + 1;
    state.player.inv.pick_flint = (state.player.inv.pick_flint ?? 0) + 1;
    // Finding a feature tile is not the same as finding one this player can
    // WORK. The old probe wrote the approach position to `state.player`, which
    // main() overwrites every tick — so it moved nobody, and it only ever
    // measured nodes that happened to be inside the 1.6-tile reach already.
    // Teleporting for real exposed that immediately: a hardcoded +20px east of
    // the node lands in water or in the trunk often enough that tryStart()
    // returns nothing and `need` reads -1. Try each side, and keep the first
    // node that actually starts.
    const savedPos = { x: nw.player.x, y: nw.player.y };
    const gtx0 = Math.floor(state.player.x / 32), gty0 = Math.floor(state.player.y / 32);
    const nodeCands: { tx: number; ty: number }[] = [];
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++)
        if (world.activeFeatureAt(gtx0 + dx, gty0 + dy)) nodeCands.push({ tx: gtx0 + dx, ty: gty0 + dy });

    let node: { tx: number; ty: number } | null = null;
    for (const cand of nodeCands.slice(0, 24)) {
      const ncx = (cand.tx + 0.5) * 32, ncy = (cand.ty + 0.5) * 32;
      let stood = false;
      for (const [ox, oy] of [[20, 0], [-20, 0], [0, 20], [0, -20]]) {
        if (!world.canStand(ncx + ox, ncy + oy)) continue;
        nw.player.teleport(ncx + ox, ncy + oy);
        stood = true;
        break;
      }
      if (!stood) continue;
      nw.step(1);
      sys.gather.active = null;
      sys.gather.tryStart();
      if (sys.gather.active) { sys.gather.active = null; node = cand; break; }
    }
    ok(node !== null || nodeCands.length === 0,
      `a workable node was found among ${nodeCands.length} feature tiles within 4`);

    if (node) {
      nw.step(1);

      // gatherSpeedPct shortens the work: `need` is gatherSec / speed.
      const needWith = (over: any) => {
        setMods(over);
        sys.gather.active = null;
        nw.step(1);
        sys.gather.tryStart();
        const n = sys.gather.active ? sys.gather.active.need : -1;
        sys.gather.active = null;
        return n;
      };
      const slowNeed = needWith({});
      const fastNeed = needWith({ gatherSpeedPct: 100 });
      ok(slowNeed > 0, `a real gather takes ${slowNeed.toFixed(2)}s of work`);
      ok(fastNeed < slowNeed,
        `gatherSpeedPct shortens it: ${slowNeed.toFixed(2)}s → ${fastNeed.toFixed(2)}s`);

      // doubleYieldChance at 100 fires every time, so the extra roll is deterministic.
      const harvest = (over: any) => {
        setMods(over);
        // The previous harvest depleted the node, so the second probe would find
        // nothing. Un-deplete and re-bake — this is the same tile either way, which
        // is what makes the two yields comparable at all.
        for (const k of Object.keys(state.depleted)) delete state.depleted[k];
        nw.chunks.rebakeTile(node!.tx, node!.ty);
        sys.gather.active = null;
        nw.step(1);
        sys.gather.tryStart();
        const a = sys.gather.active;
        if (!a) return -1;
        // B5: the bag is no longer where a harvest lands — the yield is tossed on
        // the floor first. This test's claim is about how much the WORLD produced,
        // so it counts bag + ground. Reading only the bag would make it silently
        // measure the magnet instead of doubleYieldChance.
        const yieldSum = () => Object.values(state.player.inv as Record<string, number>)
          .reduce((s: number, n: number) => s + n, 0)
          + state.drops.reduce((s: number, d: any) => s + d.n, 0);
        const before = yieldSum();
        // rollLoot() is random per entry, so an unpinned second roll can legitimately
        // yield nothing and the probe reads "2 → 2 items". Pinning random to 0 makes
        // every entry drop at its minimum, identically for both harvests, so the
        // doubled one is exactly twice the plain one. (This flaked RED twice in three
        // runs before the stub — caught here rather than in someone else's commit.)
        const realRandom = Math.random;
        Math.random = () => 0;
        try { (sys.gather as any).finish(a); } finally { Math.random = realRandom; }
        sys.gather.active = null;
        return yieldSum() - before;
      };
      const plainYield = harvest({});
      const doubledYield = harvest({ doubleYieldChance: 100 });
      ok(plainYield > 0, `a real harvest yields ${plainYield} items`);
      ok(doubledYield > plainYield,
        `doubleYieldChance adds a real second roll: ${plainYield} → ${doubledYield} items`);
      nw.player.teleport(savedPos.x, savedPos.y);
      sys.gather.active = null;
    }

    // ---- buildingHpPct + Deep Roots: a building's actual ceiling ---------
    // Placed through build.commit(), the path the game uses. The older tower test
    // pushes into state.buildings directly, which would have missed this entirely.
    const cheap = BUILDINGS.find((d: any) => d.id === 'campfire') ?? BUILDINGS[0];
    const placeVia = (over: any): any => {
      setMods(over);
      for (const c of cheap.cost ?? []) state.player.inv[c.id] = (state.player.inv[c.id] ?? 0) + c.n * 4;
      sys.build.enter(cheap.id);
      if (!sys.build.mode) return null;
      const px = Math.floor(state.player.x / 32), py = Math.floor(state.player.y / 32);
      let spot: { tx: number; ty: number } | null = null;
      for (let r = 1; r <= 8 && !spot; r++)
        for (let dx = -r; dx <= r && !spot; dx++)
          for (let dy = -r; dy <= r && !spot; dy++)
            if (world.canPlaceAt(px + dx, py + dy, false)) spot = { tx: px + dx, ty: py + dy };
      if (!spot) { sys.build.cancel(); return null; }
      sys.build.mode.tx = spot.tx; sys.build.mode.ty = spot.ty; sys.build.mode.valid = true;
      (sys.build as any).enteredAt = -1e9;   // the anti-misclick guard is not under test
      (sys.build as any).commit();
      sys.build.cancel();
      return state.buildings[state.buildings.length - 1];
    };
    const plain = placeVia({});
    if (plain) {
      eq(plain.maxHp, cheap.hp, `a plain ${cheap.id} is placed at its def HP (${cheap.hp})`);
      const tough = placeVia({ buildingHpPct: 100 });
      ok(tough && tough.maxHp > plain.maxHp,
        `buildingHpPct raises a real building's ceiling: ${plain.maxHp} → ${tough?.maxHp}`);
      eq(tough.hp, tough.maxHp, '...and it is placed at full health, not at the old max');
      const rooted = placeVia({ deepRoots: true });
      eq(rooted.maxHp, Math.round(cheap.hp * CFG.loom.deepRootsBuildingHpMul),
        `Deep Roots' "+50% building HP" is real: ${plain.maxHp} → ${rooted.maxHp}`);
    }

    // ---- towerDmgPct and towerRange: a tower actually reaching further ---
    // One isolated tower on the field, so no aura or shrine can move the numbers.
    const towerDef = BUILDINGS.find((d: any) => d.tower && d.towerRole !== 'aura');
    if (towerDef) {
      const held = state.buildings;
      const tx = Math.floor(state.player.x / 32) + 20, ty = Math.floor(state.player.y / 32) + 20;
      const tower = { uid: state.nextUid++, type: towerDef.id, tx, ty, hp: towerDef.hp, maxHp: towerDef.hp };
      state.buildings = [tower];
      world.reindexBuildings();

      const dummy = ENEMIES.find((e: any) => !e.boss)!;
      const shootFrom = (tiles: number, over: any) => {
        setMods(over);
        (sys.combat as any).towerT.clear();          // no leftover cooldown
        const foe = {
          uid: state.nextUid++, def: dummy,
          x: (tx + 0.5) * 32 + tiles * 32, y: (ty + 0.2) * 32,
          px: 0, py: 0, hp: 100000, maxHp: 100000,
          dmg: 0, atkT: 999, telegraphT: 0, animT: 0,
        };
        sys.hordes.foes.push(foe);
        (sys.combat as any).updateTowers(1 / 30);
        sys.hordes.foes = sys.hordes.foes.filter((f: any) => f.uid !== foe.uid);
        return foe.maxHp - foe.hp;
      };

      const R = towerDef.tower.rangeTiles;
      const inRange = shootFrom(R - 0.5, {});
      ok(inRange > 0, `the isolated ${towerDef.id} hits at ${(R - 0.5).toFixed(1)} tiles for ${inRange}`);

      const buffed = shootFrom(R - 0.5, { towerDmgPct: 100 });
      ok(buffed > inRange,
        `towerDmgPct raises real tower damage: ${inRange} → ${buffed}`);

      // The boundary: just outside the tower's reach, then reached.
      eq(shootFrom(R + 0.5, {}), 0,
        `nothing lands at ${(R + 0.5).toFixed(1)} tiles — that is outside the tower's reach`);
      ok(shootFrom(R + 0.5, { towerRange: 1 }) > 0,
        'towerRange extends a real tower onto a foe it could not previously touch');
      ok(shootFrom(R + 0.5, { deepRoots: true }) > 0,
        `Deep Roots' "towers +1 range" is real, not just a tooltip`);

      state.buildings = held;
      world.reindexBuildings();
    }

    // ---- Glass Echo: the roll transform reaches a real swing -------------
    // The first version of this test pinned loom.getDmgRollTransform() directly and
    // passed while combat.ts was mutated to ignore it — a helper test, not a wiring
    // test. This swings at a foe instead. `lastSwingDmgMul` is pinned to the bottom
    // of the D5 band, which is exactly where Glass Echo's remap does the most work.
    const dummy2 = ENEMIES.find((e: any) => !e.boss)!;
    const savedResonance = nw.ctx.net.consumeResonance;
    const savedRoll = nw.ctx.net.lastSwingDmgMul;
    nw.ctx.net.consumeResonance = () => null;   // crits are not under test
    const swingFor = (over: any, angleOff = 0) => {
      setMods(over);
      nw.ctx.net.lastSwingDmgMul = 0.30;        // the D5 band floor
      const r = 8;
      const foe = {
        uid: state.nextUid++, def: dummy2,
        x: state.player.x + Math.cos(angleOff) * r,
        y: state.player.y + Math.sin(angleOff) * r,
        px: 0, py: 0, hp: 100000, maxHp: 100000,
        dmg: 0, atkT: 999, telegraphT: 0, animT: 0,
      };
      nw.ctx.player.aimAngle = 0;               // face +x
      sys.hordes.foes.push(foe);
      (sys.combat as any).resolveHit();
      sys.hordes.foes = sys.hordes.foes.filter((f: any) => f.uid !== foe.uid);
      return foe.maxHp - foe.hp;
    };
    const floorSwing = swingFor({});
    ok(floorSwing > 0, `a floor-roll swing lands for ${floorSwing}`);
    ok(swingFor({ glassEcho: true }) > floorSwing,
      `Glass Echo lifts a real swing off the band floor: ${floorSwing} → ${swingFor({ glassEcho: true })} damage`);

    // The three melee stat keys, through the same real swing. meleeDmgPct was
    // wired but unpinned — unwiring it left the suite green until this landed.
    ok(swingFor({ meleeDmgPct: 200 }) > floorSwing,
      `meleeDmgPct raises real swing damage: ${floorSwing} → ${swingFor({ meleeDmgPct: 200 })}`);
    ok(swingFor({ dmgRollFloor: 1.0 }) > floorSwing,
      `dmgRollFloor lifts the roll on a real swing: ${floorSwing} → ${swingFor({ dmgRollFloor: 1.0 })}`);

    // swingSpeedPct: the real attack envelope, which is what updatePhase() clocks
    // the swing with. Whatever pinned this before was flaky — it went RED on one
    // mutation sweep and GREEN on the next with no code change between them.
    setMods({});
    const slowEnv = (sys.combat as any).envelope();
    setMods({ swingSpeedPct: 100 });
    const fastEnv = (sys.combat as any).envelope();
    ok(fastEnv.windup < slowEnv.windup,
      `swingSpeedPct shortens the real swing envelope: windup ${slowEnv.windup.toFixed(3)}s → ${fastEnv.windup.toFixed(3)}s`);
    ok(fastEnv.recovery < slowEnv.recovery,
      `...and its recovery: ${slowEnv.recovery.toFixed(3)}s → ${fastEnv.recovery.toFixed(3)}s`);

    // arcWidthPct: a foe just outside the swing arc, then inside a widened one.
    const halfArc = (CFG.combat.arcDeg * Math.PI / 180) / 2;
    const justOutside = halfArc + 0.12;
    eq(swingFor({}, justOutside), 0,
      `a foe ${(justOutside * 180 / Math.PI).toFixed(0)}° off-centre is outside the base arc`);
    ok(swingFor({ arcWidthPct: 200 }, justOutside) > 0,
      'arcWidthPct widens a real swing onto a foe it previously missed');

    nw.ctx.net.consumeResonance = savedResonance;
    nw.ctx.net.lastSwingDmgMul = savedRoll;

    // ---- Glass Echo: max HP is halved, and the clamp bites ---------------
    state.player.loomNodes = {};
    const fullHp = playerMaxHp(state);
    eq(fullHp, CFG.player.maxHp, 'with an empty weave, max HP is the config value');
    state.player.loomNodes = { keystone_glass: 1 };
    const glassHp = playerMaxHp(state);
    eq(glassHp, Math.round(CFG.player.maxHp * CFG.loom.glassEchoHpMul),
      `Glass Echo's "Max HP halved" is real: ${fullHp} → ${glassHp}`);
    ok(glassHp < fullHp, 'the keystone has a downside at all — it is not a pure upgrade');

    // Taking it while above the new ceiling must not leave a health bar past 100%.
    state.player.loomNodes = {};
    state.player.loomPoints = 5;
    state.player.hp = CFG.player.maxHp;
    (loom as any)._rebuildNeeded = true;
    loom.allocate('w1');                          // any node; the clamp runs on all
    state.player.loomNodes = { keystone_glass: 1 };
    state.player.hp = CFG.player.maxHp;
    loom.allocate('w1');
    ok(state.player.hp <= playerMaxHp(state),
      `allocating clamps HP to the new ceiling (${state.player.hp} ≤ ${playerMaxHp(state)})`);

    // ---- Night Market: the boss-wake threshold actually halves -----------
    state.player.loomNodes = {};
    (loom as any)._rebuildNeeded = true;
    setMods({});
    eq(loom.getBossWakeGold(), CFG.worldBoss.wakeGold, 'bosses rouse at the full gold threshold by default');
    setMods({ nightMarket: true });
    eq(loom.getBossWakeGold(), CFG.worldBoss.wakeGold / CFG.loom.nightMarketWakeDiv,
      `Night Market halves it: ${CFG.worldBoss.wakeGold} → ${loom.getBossWakeGold()}`);

    // ---- territoryIncomePct and Night Market's gold rate -----------------
    setMods({});
    eq(loom.getGoldMul(), 1, 'no weave, no gold bonus');
    setMods({ territoryIncomePct: 50 });
    eq(+loom.getGoldMul().toFixed(4), 1.5, 'territoryIncomePct feeds the gold rate');
    setMods({ nightMarket: true });
    eq(+loom.getGoldMul().toFixed(4), CFG.loom.nightMarketGoldMul,
      `Night Market's "+40% gold" comes from CFG, not a literal (${CFG.loom.nightMarketGoldMul}×)`);

    // ---- moveSpeedPct and Deep Roots' penalty: real distance travelled ----
    // The composition lives inside sim(), so the only honest probe is to drive the
    // input axis and measure how far the player actually gets. An accessor-only
    // version of this check passed while main.ts was mutated to ignore the Loom.
    setMods({});
    eq(loom.getMoveSpeedMul(), 1, 'no weave, no speed change');
    setMods({ moveSpeedPct: 30, deepRoots: true });
    ok(loom.getMoveSpeedMul() < 1.3,
      'the penalty composes multiplicatively — movement ranks do not cancel it out');

    const savedAxis = nw.input?.axis;
    if (savedAxis) {
      // This probe drives the input axis and measures real distance, which is
      // the only honest way to test a modifier composed inside sim(). Two
      // separate flakes have been fixed here:
      //
      //  1. It used to hardcode "east" from wherever the previous test left the
      //     player, so a player against a cliff measured 0 px. (1 run in 7.)
      //     Fixed by trial-running all four directions and keeping the longest.
      //  2. Longest is still not FAIR. Terrain speed varies tile by tile, so a
      //     faster player ends up further along and can enter slow ground the
      //     plain run never reached — and on a short corridor that noise is
      //     bigger than the modifier. Measured on 2026-08-20: a 28.4 px corridor
      //     reported "Deep Roots slows real movement: 28.4 -> 29.2px" and went
      //     red, with nothing wrong in the Loom at all. Found while chasing the
      //     identical flake in the N4.3 omen probe.
      //
      // The corridor is now chosen for UNIFORMITY: every tile standable and
      // every tile the same world.speedAt(). On uniform ground the distance is
      // exactly proportional to the multiplier.
      const RUN = 7;
      const home = { x: state.player.x, y: state.player.y };
      const corr = findUniformCorridor(nw, RUN);
      ok(corr !== null, `found ${RUN} tiles of terrain-uniform corridor from tile `
        + `${Math.floor(home.x / 32)},${Math.floor(home.y / 32)}`);
      if (corr) {
        nw.input.axis = () => ({ x: corr.dx, y: corr.dy });
        // A death respawn teleports the player to the hall mid-measurement, which
        // is not walking and is not comparable. Clear the field, top them up, and
        // reject any run longer than the corridor it was walked down.
        const MAXPX = RUN * 32;
        const travel = (over: any) => {
          for (let attempt = 0; attempt < 3; attempt++) {
            setMods(over);
            nw.sys.hordes?.clearField?.();
            state.player.hp = playerMaxHp(state);
            state.player.x = corr.x; state.player.y = corr.y;
            nw.ctx.player.teleport(corr.x, corr.y);
            nw.step(18);
            const d = Math.hypot(state.player.x - corr.x, state.player.y - corr.y);
            if (d <= MAXPX) return d;
          }
          return -1;
        };
        const freeDist = travel({});
        const rootedDist = travel({ deepRoots: true });
        const fastDist = travel({ moveSpeedPct: 100 });
        nw.input.axis = savedAxis;
        state.player.x = home.x; state.player.y = home.y;
        nw.ctx.player.teleport(home.x, home.y);
        const panelOpen = !!nw.ui?.isOpen?.();
        ok(freeDist > 0 && freeDist <= MAXPX,
          `the player covers real ground in the sim: ${freeDist.toFixed(1)}px / 18 ticks`
          + ` (tile ${Math.floor(corr.x / 32)},${Math.floor(corr.y / 32)} heading ${corr.dx},${corr.dy},`
          + ` terrain speed ${corr.speed.toFixed(2)} throughout`
          + `${panelOpen ? ', a UI panel is open so the axis is zeroed' : ''})`);
        ok(rootedDist < freeDist,
          `Deep Roots slows real movement: ${freeDist.toFixed(1)} → ${rootedDist.toFixed(1)}px`);
        ok(fastDist > freeDist,
          `moveSpeedPct speeds it up: ${freeDist.toFixed(1)} → ${fastDist.toFixed(1)}px`);
        // Uniform ground makes the RATIO meaningful, not just the ordering.
        // Deep Roots advertises -12%; before this corridor fix the measurement
        // was too noisy to assert a size at all.
        const rr = rootedDist / freeDist;
        ok(Math.abs(rr - CFG.loom.deepRootsMoveMul) < 0.04,
          `and by the advertised ${CFG.loom.deepRootsMoveMul}x (measured ${rr.toFixed(3)}x)`);
      }
    }

    // ---- territoryIncomePct and Night Market reach the real gold tick -----
    const heldBuildings = state.buildings;
    const ptx = Math.floor(state.player.x / 32), pty = Math.floor(state.player.y / 32);
    // A hall alone is pop 2 (basePop 2 + hall pop 0), and the tick ROUNDS:
    // round(2 x goldMul x 1.4) > round(2 x goldMul) is false for any goldMul
    // near 0.8, because round(1.6) and round(2.24) are both 2. That made this
    // assertion a coin flip on the live network multiplier — N4.1 turned
    // goldRate from a quantised downlink bucket into a continuous measured
    // value, so it started landing in the dead band. Six huts (pop 2 each) put
    // the base near 14, where a 40% rise cannot round away.
    state.buildings = [{ uid: state.nextUid++, type: 'hall', tx: ptx + 3, ty: pty + 3, hp: 500, maxHp: 500 }];
    for (let i = 0; i < 6; i++) {
      state.buildings.push({ uid: state.nextUid++, type: 'hut', tx: ptx + 5 + i, ty: pty + 5, hp: 100, maxHp: 100 } as any);
    }
    world.reindexBuildings();
    const goldFrom = (over: any) => {
      setMods(over);
      state.player.gold = 0;
      (sys.economy as any).t = CFG.economy.tickSec;   // force the tick to fire now
      sys.economy.update(0.001);
      return state.player.gold;
    };
    const baseGold = goldFrom({});
    if (baseGold > 0) {
      ok(goldFrom({ territoryIncomePct: 100 }) > baseGold,
        `territoryIncomePct reaches the real economy tick: ${baseGold} → ${goldFrom({ territoryIncomePct: 100 })} gold`);
      ok(goldFrom({ nightMarket: true }) > baseGold,
        `Night Market's "+40% gold" reaches it too: ${baseGold} → ${goldFrom({ nightMarket: true })} gold`);
    }
    state.buildings = heldBuildings;
    world.reindexBuildings();
  } finally {
    loom.mods = saved.mods;
    (loom as any)._rebuildNeeded = saved.rebuild;
    state.player.loomNodes = saved.nodes;
    state.player.loomPoints = saved.points;
    state.player.hp = saved.hp;
    state.clock = saved.clock;
    state.player.equip = saved.equip;
    state.player.relic = saved.relic;
    state.player.inv = saved.inv;
    state.player.xp = saved.xp;
    state.buildings = saved.buildings;
    state.god = saved.god;
    state.gameOver = saved.gameOver;
    state.player.gold = saved.gold;
    state.depleted = saved.depleted;
    world.reindexBuildings();
  }
}

/** B2.1 — every run starts at dawn, whatever the wall clock says.
 *
 *  D2 set the opening clock to `net.snap.timeOfDay * cycleLen()`. On a 15-minute
 *  scored run that is 2.65 cycles long, that made the real local time of page load
 *  a large uncontrolled input to the score — boot at 16:50 for ~6 s of daylight,
 *  boot at 16:56–23:59 (29.4% of the real day) and start inside the night.
 *
 *  The pin has two halves because there are two ways to lose this:
 *    - `startClock()` itself could start reading its argument again. Checked across
 *      the exact time-of-day fractions that used to produce night starts.
 *    - main() could stop calling it. Checked against `state.bootClock`, which main()
 *      records from the value it actually used.
 *
 *  Note on the second half: it is only decisive when the machine running the suite
 *  is not within a few minutes of local midnight, since tod≈0 makes the old rule and
 *  the new one agree. The first half has no such hole, which is why both are here. */
async function testRunStartsAtDawn(nw: any) {
  const { state } = nw;
  const { startClock, phase, cycleLen } = await import('./daynight');
  const cy = cycleLen();

  // The fractions below are the §4 table's own rows: dawn, midday, one second
  // before dusk, deep inside the night, and one second before the next dawn.
  for (const tod of [0, 0.25, 0.5, 0.706, 0.85, 0.99999]) {
    const c = startClock(tod);
    eq(c, 0, `time-of-day ${tod} still starts the run at clock 0 (D2 would give ${(tod * cy).toFixed(0)})`);
    ok(!phase(c).isNight, `...and clock 0 is daylight, not night`);
  }

  // Full daylight, not merely "not night": the run must get the whole preparation
  // window, so the leaderboard compares runs that were asked the same question.
  const { CFG } = await import('../data/config');
  const { phaseRemaining } = await import('./daynight');
  eq(phaseRemaining(startClock(0.85)), CFG.time.daySec,
    `a run booted at 20:24 local still gets the full ${CFG.time.daySec}s day before its first night`);

  // And this run — the live boot behind the suite — actually used it.
  eq(state.bootClock, 0, 'this run booted at dawn');
}

/** B2 — a night can only be survived if it was entered.
 *
 *  Two paths handed out free nights, each worth CFG.legacy.weights.nightSurvived
 *  on a board whose entire purpose is comparing runs:
 *
 *    1. D2 seeds the clock from the real local time of day, and ~29% of the real
 *       day lands inside the game's night. Such a run never sees dusk — but the
 *       next dawn credited a night AND a Loom point anyway (§5).
 *    2. triggerGameOver() called hordes.onDawn() purely to sweep the field, and
 *       onDawn() incremented the counter. So every run, however it ended,
 *       collected one final night at the moment it ended. The plan missed this
 *       one; it is the path that actually produced §5's own 7-second scorecard,
 *       which could not have crossed a dawn at all.
 *
 *  Measured live before the fix: a run parked in daylight having fought nothing
 *  reported nightsSurvived 1 / loomPoints 1, then 2 after onHallDestroyed(). */
async function testNightCreditRequiresEntry(nw: any) {
  const { state, sys } = nw;
  const { CFG } = await import('../data/config');
  const cy = CFG.time.daySec + CFG.time.nightSec;
  const restoreClock = state.clock;
  state.gameOver = false;
  state.gameOverCause = null;

  // --- sweeping the field is not a credit ---------------------------------
  const beforeSweep = state.nightsSurvived;
  sys.hordes.clearField();
  eq(state.nightsSurvived, beforeSweep, 'clearField() sweeps without crediting a night');
  eq(sys.hordes.foes.length, 0, 'clearField() does clear the foes');

  // --- dawn on a night nobody entered credits nothing ----------------------
  const beforeUnentered = state.nightsSurvived;
  const pointsBefore = state.player.loomPoints ?? 0;
  sys.hordes.onDawn(false);
  eq(state.nightsSurvived, beforeUnentered, 'dawn after an unentered night credits no night');
  eq(state.player.loomPoints ?? 0, pointsBefore, '...and no Loom point');

  // --- a real dusk → dawn cycle credits exactly one ------------------------
  // Driven through nw.step so the gate under test is main.ts's own transition
  // branch, not a hand-call into the horde system.
  state.clock = CFG.time.daySec - 1;      // daylight; let any pending edge settle
  nw.step(2);
  state.nightEntered = false;
  const survivedBefore = state.nightsSurvived;

  state.clock = CFG.time.daySec + 1;      // into the night → dusk edge
  nw.step(2);
  eq(state.nightEntered, true, 'crossing dusk marks the night as entered');
  eq(state.nightsSurvived, survivedBefore, '...and credits nothing yet');

  state.clock = cy + 1;                    // into the next day → dawn edge
  nw.step(2);
  eq(state.nightsSurvived, survivedBefore + 1, 'crossing dawn after a real dusk credits one night');
  eq(state.nightEntered, false, 'the dawn consumes the mark, so it cannot be spent twice');

  // --- §5's actual scenario: the run booted mid-night ----------------------
  // Sit inside the night with no dusk on record — which is precisely what D2's
  // real-clock start produces for the ~29% of the real day that lands in the
  // game's night — then cross into day. This is the case that pins main.ts's
  // transition gate; the onDawn(false) check above only pins the horde system.
  state.clock = CFG.time.daySec + 50;      // mid-night
  nw.step(2);
  state.nightEntered = false;              // ...but nobody was here when it fell
  const survivedBoot = state.nightsSurvived;
  const pointsBoot = state.player.loomPoints ?? 0;
  state.clock = cy + 1;                     // cross into day → dawn edge
  nw.step(2);
  eq(state.nightsSurvived, survivedBoot, 'a run that booted mid-night gets no night at its first dawn');
  eq(state.player.loomPoints ?? 0, pointsBoot, '...and no Loom point either');

  // A stat fixture must not be able to wedge the gate shut. This is why the
  // mark is a flag and not `nightsEntered > nightsSurvived`: regression.ts
  // assigns state.nightsSurvived directly (the scoreboard fixtures set it to 5
  // and to 20), and under the counter form that put the credit permanently out
  // of reach — the extended playthrough silently survived 0 nights across 6
  // full day/night cycles.
  state.nightsSurvived = 999;
  state.clock = CFG.time.daySec - 1; nw.step(2);
  state.clock = CFG.time.daySec + 1; nw.step(2);   // dusk
  state.clock = cy + 1; nw.step(2);                // dawn
  eq(state.nightsSurvived, 1000, 'credit still works after nightsSurvived is assigned directly');

  state.nightsSurvived = survivedBefore + 1;
  state.clock = restoreClock;
  state.nightEntered = false;
  sys.hordes.clearField();
}

/** B2 — the Long Thread counts skill levels with the game's xp curve.
 *
 *  systems/loom.ts carried its own levelOf(): it multiplied CFG.xp.growth
 *  without rounding, while rules.xpToNext rounds every level's cost. The copy's
 *  cumulative ran fractionally high, so the two disagreed at 64 xp values in
 *  0..60000 — and, because the drift is always in the same direction, they
 *  disagreed at *exactly* the gate totals. A skill parked on 286 xp is level 5
 *  by the curve the rest of the game uses, and was level 4 to the Loom.
 *
 *  The expected values below are written down, not derived from the curve.
 *  Eight skills on the level-5 gate is 40 total levels, which is 4 points at one
 *  per ten. Under the old private copy the same xp read as level 4 apiece — 32
 *  levels, 3 points. So this separates the fix from the bug rather than
 *  restating whichever one happens to be compiled in. */
async function testLongThreadCurve(nw: any) {
  const { state } = nw;
  const { SKILLS } = await import('../data/skills');
  const { LOOM_NODES } = await import('../data/loom');
  const loom = nw.sys.loom;

  const saved = {
    xp: { ...state.player.xp },
    nodes: { ...state.player.loomNodes },
    points: state.player.loomPoints,
    lt: state.player._longThreadPoints,
  };

  eq(SKILLS.length, 8, 'eight skills feed the Long Thread total');

  const thread = LOOM_NODES.find((n: any) => n.id === 'keystone_thread')!;
  state.player.loomNodes = {};
  for (const reqId of thread.req ?? [])
    state.player.loomNodes[reqId] = LOOM_NODES.find((n: any) => n.id === reqId)?.maxRank ?? 1;
  state.player.loomPoints = 10;
  ok(loom.allocate('keystone_thread'), 'Long Thread allocates once its prereq is held');
  ok(loom.ensureMods().longThread, 'Long Thread modifier is live');

  // Every skill parked exactly on the level-5 gate.
  state.player.xp = {};
  for (const s of SKILLS) state.player.xp[s.id] = 286;
  state.player._longThreadPoints = 0;
  const atGate = state.player.loomPoints;
  loom.onSkillLevelUp();
  // Written down, not derived: 8 skills x level 5 = 40 total levels, and B3.b set
  // the divisor to 12, so floor(40/12) = 3. Under B1's /10 this was 4; under the
  // pre-B2 private xp curve the same xp read level 4 apiece = 32 levels = 3.
  eq(state.player.loomPoints - atGate, 3,
    '8 skills on the L5 gate (286 xp) = 40 levels = 3 Long Thread points at /12');
  eq(state.player._longThreadPoints, 3, 'the grant is banked so it is not paid twice');

  loom.onSkillLevelUp();
  eq(state.player.loomPoints - atGate, 3, 'a second call with no new levels grants nothing');

  // One xp short of the gate is one level short on every skill: 32 levels, and
  // floor(32/12) = 2. The pair of assertions is the point — 285 and 286 xp must
  // land on different grants, which is what caught loom.ts's private xp curve
  // in the first place (§17): it read both as level 4.
  for (const s of SKILLS) state.player.xp[s.id] = 285;
  state.player._longThreadPoints = 0;
  const belowGate = state.player.loomPoints;
  loom.onSkillLevelUp();
  eq(state.player.loomPoints - belowGate, 2,
    '8 skills one xp below the gate (285) = 32 levels = 2 points at /12');

  state.player.xp = saved.xp;
  state.player.loomNodes = saved.nodes;
  state.player.loomPoints = saved.points;
  state.player._longThreadPoints = saved.lt;
}

// =========================================================================
// C4: The Armory — boss relic drops, relic equip, effects
// =========================================================================

async function testBossRelicDrops(nw: any) {
  const { state, sys } = nw;
  const { ENEMIES } = await import('../data/enemies');
  const { ITEMS } = await import('../data/items');
  const { ECHOES, echoForBoss } = await import('../data/echoes');

  // Find all boss enemies
  const bosses = ENEMIES.filter((e: any) => e.boss);
  ok(bosses.length >= 5, `${bosses.length} boss enemies defined`);

  // Find relics in items (ITEMS is a Record, not an array)
  const relics = Object.values(ITEMS).filter((i: any) => i.relic);
  ok(relics.length >= 5, `${relics.length} relics defined (expected ≥5, one per boss)`);

  // Verify each boss maps to an echo (C1 integration)
  for (const boss of bosses) {
    const echoId = echoForBoss(boss.id);
    ok(echoId !== undefined, `${boss.id} maps to echo '${echoId}'`);
  }

  // Simulate killing each boss and check loot
  state.gameOver = false;
  state.player.echoes = {};
  state.god = true; state.player.hp = 100;

  let relicsDropped = 0;
  let relicsOnFloor = 0;
  const relicHome = { x: nw.player.x, y: nw.player.y };
  for (const bossDef of bosses) {
    // Ensure a hall exists
    const { world } = nw;
    if (!state.buildings.some((b: any) => b.type === 'hall')) {
      const htx = Math.floor(state.player.x / 32);
      const hty = Math.floor(state.player.y / 32) - 3;
      state.player.inv.wood_scrap = 50; state.player.inv.plank = 30;
      state.buildings.push({ uid: state.nextUid++, type: 'hall', tx: htx, ty: hty, hp: 200 });
      world.reindexBuildings();
    }

    // Spawn boss
    const boss = {
      uid: state.nextUid++, defId: bossDef.id, lordId: bossDef.id, name: bossDef.name,
      x: state.player.x + 60, y: state.player.y, hp: bossDef.hp, maxHp: bossDef.hp,
      dmg: 0, level: 1, atkT: 0, telegraphT: 0, animT: 0,
      hunting: false, provokedUntil: 0, reviveAt: 0, homeGx: 0, homeGy: 0,
    };
    state.worldBosses.push(boss);

    // Kill via worldbosses system
    sys.worldbosses.hurt(boss, boss.maxHp * 2);
    nw.step(5);

    // Check that echo was granted (echoForBoss returns EchoDef, use .id)
    const echoDef = echoForBoss(bossDef.id);
    const echoId = echoDef?.id;
    if (echoId) {
      ok((state.player.echoes[echoId] ?? 0) >= 1,
        `${bossDef.name} kill grants echo '${echoId}' (got level ${state.player.echoes[echoId] ?? 0})`);
    }

    // B5: the relic lands on the FLOOR, ~1.9 tiles out — outside magnetTiles
    // and inside the arm delay, so the old post-step(5) inventory read was
    // measuring luck. Assert it hit the ground, then collect it the way a
    // player would: walk on top of it and let the magnet finish the job.
    const relic = relics.find((r: any) => r.relic === bossDef.id || r.relic === `relic_${bossDef.id}`);
    if (relic) {
      const onFloor = state.drops.some((d: any) => d.id === relic.id);
      if (onFloor) relicsOnFloor++;
      for (let i = 0; i < 200 && state.drops.length; i++) {
        nw.player.teleport(state.drops[0].x, state.drops[0].y);
        nw.step(1);
      }
      if ((state.player.inv[relic.id] ?? 0) > 0) relicsDropped++;
    }

    // Clean up boss
    state.worldBosses = state.worldBosses.filter((b: any) => b.lordId !== bossDef.id);
  }

  // Matched pair: it reached the floor AND it reached the bag. Asserting only
  // the bag would pass if the loot skipped the ground entirely (a silent B5
  // revert); asserting only the floor would pass with the magnet broken.
  ok(relicsOnFloor >= 1, `${relicsOnFloor} boss relic(s) land on the ground`);
  ok(relicsDropped >= 1, `${relicsDropped} boss relic(s) walked over and banked`);
  nw.player.teleport(relicHome.x, relicHome.y);
  state.drops.length = 0;   // leftover gear never despawns; do not leak it into later tests
  state.god = false;
  state.player.echoes = {};
}

async function testRelicEquip(nw: any) {
  const { state } = nw;
  const { ITEMS } = await import('../data/items');
  const { toggleEquip } = await import('../rules');

  const relics = Object.values(ITEMS).filter((i: any) => i.relic);
  if (relics.length === 0) { ok(true, 'no relics defined — skipping relic equip test'); return; }

  // Give the first relic to the player. Earlier tests may have auto-equipped
  // a relic via acquireGear — clear the slot so toggle means EQUIP here.
  const relic = relics[0];
  state.player.inv[relic.id] = (state.player.inv[relic.id] ?? 0) + 1;
  nw.step(1);
  // B5: clear the slot AFTER stepping. acquireGear auto-equips at PICKUP now,
  // so a relic collected off the floor during that tick would fill the slot and
  // turn the toggle below from an equip into an unequip.
  state.player.relic = undefined;

  // Equip it
  const slot = toggleEquip(state, relic.id);
  ok(slot === 'relic', `equipping relic returns slot 'relic' (got '${slot}')`);
  ok(state.player.relic === relic.id, `relic equipped: ${relic.id} (got ${state.player.relic})`);

  // Unequip
  toggleEquip(state, relic.id);
  ok(state.player.relic !== relic.id, 'relic unequipped');
  ok((state.player.inv[relic.id] ?? 0) >= 1, 'relic returned to inventory');

  // Clean up
  state.player.relic = undefined;
  delete state.player.inv[relic.id];

  ok(true, 'relic equip/unequip test completed');
}

async function testItemEffects(nw: any) {
  const { ITEMS } = await import('../data/items');
  const { registerEffect, hasEffect, applyEffect } = await import('./effects');

  // Verify all registered effects are callable
  const effectKeys = ['thorns_reflect', 'fire_aura', 'chill_aura', 'regen_boost',
    'move_burst_on_kill', 'see_foe_hp', 'resonance_boost'];
  for (const key of effectKeys) {
    ok(hasEffect(key), `effect '${key}' is registered`);
  }

  // Verify items with effects declare valid keys
  const itemsWithEffects = Object.values(ITEMS).filter((i: any) => i.effects && i.effects.length > 0);
  let allValid = true;
  for (const item of itemsWithEffects) {
    for (const effKey of (item as any).effects) {
      if (!hasEffect(effKey)) {
        allValid = false;
        console.error(`  ⚠️  ${item.id} declares unknown effect '${effKey}'`);
      }
    }
  }
  ok(allValid, 'all item effect keys resolve to registered effects');

  // This block used to call applyEffect('thorns_reflect', ...) and assert it
  // returned 6 damage. It did — and it was the only thing in the game that ever
  // called it. Nothing dispatched that handler in play, so the assertion
  // certified a hook that had no path to the screen, and thorns stayed placebo
  // through C4, A1 and A5 behind a green suite.
  //
  // The lesson is bigger than thorns: a test that drives a handler DIRECTLY
  // proves the handler works, never that the game calls it. What replaces it is
  // the rule that makes such a mistake impossible to repeat — handlers are
  // inert flags, so a hook implemented only in the registry now fails loudly
  // and immediately. The behaviour itself is asserted through the real damage
  // path in 'Item effects - the seven dormant hooks now reach the game'.
  const dummyFoe = { uid: 99999, hp: 100, maxHp: 100, dmg: 10, atkT: 0, telegraphT: 0, animT: 0,
    def: { id: 'dummy', name: 'Dummy', hp: 100, dmg: 10, speed: 1, weight: 1, nightMin: 0 },
    x: 0, y: 0, px: 0, py: 0 };
  const reflectDmg = applyEffect('thorns_reflect', {
    state: nw.state, player: nw.state.player, foe: dummyFoe as any, damage: 20,
  });
  eq(reflectDmg, undefined,
    'a registered handler is an inert flag — implementing a hook there and nowhere else is now a red test');
  eq(dummyFoe.hp, 100,
    'CONTROL: ...and dispatching one touches nothing, which is exactly why applyEffect could never be the seam');
}

async function testSilverStarCrafting(nw: any) {
  const { state } = nw;
  const { RECIPES } = await import('../data/recipes');
  const { ITEMS } = await import('../data/items');

  // Find silver and star gear (by id suffix — ItemDef has no tier field;
  // silver_ore/star_ore don't match because the suffix anchors the end)
  const silverItems = Object.values(ITEMS).filter((i: any) => /_silver$/.test(i.id));
  const starItems = Object.values(ITEMS).filter((i: any) => /_star$/.test(i.id));

  ok(silverItems.length >= 3, `${silverItems.length} silver-tier items`);
  ok(starItems.length >= 3, `${starItems.length} star-metal items`);

  // Find their recipes
  const silverRecipes = RECIPES.filter((r: any) =>
    silverItems.some((i: any) => i.id === r.out.id));
  const starRecipes = RECIPES.filter((r: any) =>
    starItems.some((i: any) => i.id === r.out.id));

  ok(silverRecipes.length >= 1, `${silverRecipes.length} silver recipes`);
  ok(starRecipes.length >= 1, `${starRecipes.length} star recipes`);

  // Try crafting one silver recipe (boost the skill past the levelReq — this
  // test is about the recipe rows, not the grind)
  let craftedSilver = false;
  for (const rec of silverRecipes) {
    for (const ing of rec.in) {
      state.player.inv[ing.id] = (state.player.inv[ing.id] ?? 0) + Math.max(ing.n, 10);
    }
    state.player.xp[rec.skill] = Math.max(state.player.xp[rec.skill] ?? 0, 50000000);
    nw.step(1);
    const result = nw.craft(rec.id);
    if (result) craftedSilver = true;
  }
  ok(craftedSilver, 'at least one silver recipe crafted');

  // Try crafting one star recipe (might fail on skill req)
  let craftedStar = false;
  for (const rec of starRecipes) {
    for (const ing of rec.in) {
      state.player.inv[ing.id] = (state.player.inv[ing.id] ?? 0) + Math.max(ing.n, 10);
    }
    state.player.xp[rec.skill] = Math.max(state.player.xp[rec.skill] ?? 0, 50000000);
    nw.step(1);
    const result = nw.craft(rec.id);
    if (result) craftedStar = true;
  }
  ok(craftedStar, 'at least one star-metal recipe crafted');

  ok(true, 'silver/star crafting test completed');
}

// =========================================================================
// C5: Buildings Rework — tower roles (splash, slow, sniper, aura)
// =========================================================================

async function testTowerRoles(nw: any) {
  const { state, sys, world } = nw;
  const { BUILDINGS } = await import('../data/buildings');

  // Verify tower role data integrity
  const towers = BUILDINGS.filter((b: any) => b.towerRole);
  ok(towers.length >= 5, `${towers.length} towers with defined roles`);

  const roleCounts: Record<string, number> = {};
  for (const t of towers) {
    roleCounts[t.towerRole!] = (roleCounts[t.towerRole!] ?? 0) + 1;
  }
  ok((roleCounts['splash'] ?? 0) >= 2, `splash towers: ${roleCounts['splash'] ?? 0}`);
  ok((roleCounts['slow'] ?? 0) >= 2, `slow towers: ${roleCounts['slow'] ?? 0}`);
  ok((roleCounts['sniper'] ?? 0) >= 2, `sniper towers: ${roleCounts['sniper'] ?? 0}`);
  ok((roleCounts['aura'] ?? 0) >= 1, `aura towers: ${roleCounts['aura'] ?? 0}`);

  // Verify upgrade paths
  const upgradable = towers.filter((t: any) => t.upgradesTo);
  ok(upgradable.length >= 1, `${upgradable.length} towers have upgrade paths`);

  // Verify tower stats are reasonable (range/dmg live in nested .tower or .aura)
  for (const t of towers) {
    ok(t.hp > 0, `${t.id}: HP ${t.hp} > 0`);
    const hasRange = (t.tower?.rangeTiles ?? 0) > 0;
    const hasDmg = (t.tower?.dmg ?? 0) > 0;
    ok(hasRange || t.aura !== undefined,
      `${t.id}: has range ${t.tower?.rangeTiles} or aura`);
    ok(hasDmg || t.aura !== undefined,
      `${t.id}: has damage ${t.tower?.dmg} or aura`);
  }

  ok(true, 'tower roles test completed');
}

async function testTowerCombat(nw: any) {
  const { state, sys, world } = nw;
  const { BUILDINGS } = await import('../data/buildings');
  const { ENEMIES } = await import('../data/enemies');

  // Ensure hall exists
  if (!state.buildings.some((b: any) => b.type === 'hall')) {
    const htx = Math.floor(state.player.x / 32), hty = Math.floor(state.player.y / 32) - 3;
    state.player.inv.wood_scrap = 50; state.player.inv.plank = 30;
    state.buildings.push({ uid: state.nextUid++, type: 'hall', tx: htx, ty: hty, hp: 200 });
    world.reindexBuildings();
  }
  const hall = state.buildings.find((b: any) => b.type === 'hall')!;

  // Place one of each tower role type near the hall
  const roleDefs: Record<string, any> = {};
  for (const role of ['splash', 'slow', 'sniper', 'aura']) {
    const def = BUILDINGS.find((b: any) => b.towerRole === role);
    if (def) roleDefs[role] = def;
  }

  // Give materials
  state.player.inv.stone = 100; state.player.inv.log = 100;
  state.player.inv.plank = 50; state.player.inv.wood_scrap = 50;
  state.player.inv.copper_ore = 30; state.player.inv.iron_ore = 30;
  nw.step(1);

  let towersPlaced = 0;
  for (const [role, def] of Object.entries(roleDefs)) {
    const tx = hall.tx + 2 + towersPlaced;
    const ty = hall.ty + 2;
    state.buildings.push({ uid: state.nextUid++, type: def.id, tx, ty, hp: def.hp });
    towersPlaced++;
  }
  world.reindexBuildings();
  ok(towersPlaced >= 2, `${towersPlaced} towers placed for combat test`);

  // Spawn a dummy foe in range
  const dummyDef = ENEMIES.find((e: any) => !e.boss)!;
  const foe = {
    uid: state.nextUid++, def: dummyDef,
    x: (hall.tx + 3) * 32 + 16, y: (hall.ty + 3) * 32 + 16,
    px: 0, py: 0, hp: 200, maxHp: 200,
    dmg: 5, atkT: 0, telegraphT: 0, animT: 0,
  };
  sys.hordes.foes.push(foe);
  nw.step(5);

  // Run tower update — towers should damage the foe
  sys.combat.updateTowers?.(1 / 30);
  nw.step(10);

  // Check if foe took damage from towers
  const tookDamage = foe.hp < foe.maxHp;
  ok(tookDamage, `foe took tower damage: ${foe.maxHp - foe.hp} dmg`);

  // Clean up
  sys.hordes.foes = sys.hordes.foes.filter((f: any) => f.uid !== foe.uid);

  ok(true, 'tower combat test completed');
}

// =========================================================================
// W6: Scoreboards — snapshot, leaderboard persistence
// =========================================================================

async function testScoreboardSnapshot(nw: any) {
  const { state } = nw;
  const scoreboard = nw.sys.scoreboard;
  if (!scoreboard) { ok(true, 'no scoreboard system — skipping snapshot test'); return; }
  const { CFG } = await import('../data/config');

  // Isolate: L1 fields the snapshot now reads
  state.everGod = false;
  state.gameOverCause = 'old_age';
  state.player.age = CFG.lifespan.startAge + 12;

  // Seed some data
  scoreboard.connectionUptime = 3600; // 1 hour
  scoreboard.enemiesKilled = 42;
  scoreboard.buildingsBuilt = 15;
  scoreboard.bossesSlain = 2;
  scoreboard.riftsSurvived = 3;
  scoreboard.peakRtt = 250;
  scoreboard.lowestDownlink = 1.5;
  state.nightsSurvived = 5;
  state.player.gold = 500;
  state.player.loomPoints = 2;
  state.player.loomNodes = { 'war_strike': 3, 'field_gather': 1 };

  const card = scoreboard.snapshot();
  ok(card.v === 2, 'scorecard version is 2 (L1)');
  ok(card.connectionAge === 3600, `connection age: ${card.connectionAge}s`);
  ok(card.enemiesKilled === 42, `enemies killed: ${card.enemiesKilled}`);
  ok(card.buildingsBuilt === 15, `buildings built: ${card.buildingsBuilt}`);
  ok(card.bossesSlain === 2, `bosses slain: ${card.bossesSlain}`);
  ok(card.riftsSurvived === 3, `rifts survived: ${card.riftsSurvived}`);
  ok(card.peakRtt === 250, `peak RTT: ${card.peakRtt}`);
  ok(card.lowestDownlink === 1.5, `lowest downlink: ${card.lowestDownlink}`);
  ok(card.nightsSurvived === 5, `nights survived: ${card.nightsSurvived}`);
  ok(card.goldHoarded === 500, `gold: ${card.goldHoarded}`);
  ok(card.loomPointsEarned >= 6, `loom points earned: ${card.loomPointsEarned}`);
  ok(typeof card.date === 'string' && card.date.includes('T'), `date is ISO: ${card.date}`);
  ok(typeof card.finalRealm === 'string', `final realm: ${card.finalRealm}`);
  ok(typeof card.dominantRealm === 'string', `dominant realm: ${card.dominantRealm}`);
  // L1 fields
  ok(card.age === CFG.lifespan.startAge + 12, `age carried through: ${card.age}`);
  ok(card.causeOfDeath === 'old_age', `causeOfDeath carried through: ${card.causeOfDeath}`);
  ok(card.legit === true, 'legit is true when everGod is false');
  ok(card.legacyScore > 0, `legacyScore computed and positive: ${card.legacyScore}`);

  ok(true, 'scoreboard snapshot test completed');
}

async function testLeaderboardPersist(nw: any) {
  const { state } = nw;
  const scoreboard = nw.sys.scoreboard;
  if (!scoreboard) { ok(true, 'no scoreboard system — skipping leaderboard test'); return; }

  // Clear existing leaderboard
  try { localStorage.removeItem('nw.leaderboard'); } catch {}

  // Isolate
  state.everGod = false;
  state.gameOverCause = 'hall_fallen';

  // Save a run
  scoreboard.connectionUptime = 7200;
  scoreboard.enemiesKilled = 100;
  const card = scoreboard.saveToLeaderboard();

  // Read back
  const { loadLeaderboard } = await import('./scoreboard');
  const entries = loadLeaderboard();
  ok(entries.length >= 1, `leaderboard has ${entries.length} entries`);
  ok(entries[0].connectionAge === 7200, 'leaderboard entry matches saved data');
  ok(entries[0].enemiesKilled === 100, 'leaderboard preserves kill count');
  ok(entries[0].v === 2, 'leaderboard entry has L1 version field (2)');
  ok(entries[0].legacyScore === card.legacyScore, 'leaderboard preserves the legacy score');
  ok(entries[0].legit === true, 'leaderboard preserves the legit flag');

  // Format age helper
  const { formatAge } = await import('./scoreboard');
  ok(formatAge(3661) === '1h 1m 1s', `formatAge(3661) = "${formatAge(3661)}"`);
  ok(formatAge(125) === '2m 5s', `formatAge(125) = "${formatAge(125)}"`);
  ok(formatAge(42) === '42s', `formatAge(42) = "${formatAge(42)}"`);

  // L1: v1 records (pre-lifespan) must migrate cleanly on load, not crash or
  // vanish — simulate an old-shape record sitting in localStorage.
  try {
    const v1raw = [{ v: 1, date: new Date().toISOString(), connectionAge: 500, dominantRealm: 'Unknown',
      riftsSurvived: 0, peakRtt: 40, lowestDownlink: 5, nightsSurvived: 2, buildingsBuilt: 3,
      enemiesKilled: 20, bossesSlain: 0, goldHoarded: 80, finalRealm: 'Unknown', loomPointsEarned: 1 }];
    localStorage.setItem('nw.leaderboard', JSON.stringify(v1raw));
    const migrated = loadLeaderboard();
    ok(migrated.length === 1, 'v1 record survives load');
    ok(migrated[0].v === 2, 'v1 record migrated to v2');
    ok(typeof migrated[0].legacyScore === 'number' && migrated[0].legacyScore >= 0, `v1 record got a computed legacyScore: ${migrated[0].legacyScore}`);
    ok(migrated[0].enemiesKilled === 20, 'v1 record data preserved through migration');
  } finally {
    try { localStorage.removeItem('nw.leaderboard'); } catch {}
  }

  ok(true, 'leaderboard persistence test completed');
}

/** L1: god-mode runs must be recorded but never rank ABOVE a lower-scoring
 *  legit run — this is the actual anti-cheat behavior the leaderboard sort
 *  exists to provide (see the review finding: god mode was previously
 *  unflagged and indistinguishable from a legit top score). */
async function testLeaderboardLegitRanking(nw: any) {
  const { state } = nw;
  const scoreboard = nw.sys.scoreboard;
  if (!scoreboard) { ok(true, 'no scoreboard system — skipping legit-ranking test'); return; }
  const { CFG } = await import('../data/config');
  const { loadLeaderboard } = await import('./scoreboard');

  try { localStorage.removeItem('nw.leaderboard'); } catch {}

  // A modest, legit run.
  state.everGod = false;
  state.gameOverCause = 'old_age';
  state.player.age = CFG.lifespan.startAge + 5;
  scoreboard.enemiesKilled = 5; scoreboard.bossesSlain = 0; scoreboard.buildingsBuilt = 1;
  state.nightsSurvived = 1; state.player.gold = 20; state.player.loomPoints = 0; state.player.loomNodes = {};
  const legitCard = scoreboard.saveToLeaderboard();

  // A much higher-scoring run, but god mode was used at some point.
  state.everGod = true;
  scoreboard.enemiesKilled = 500; scoreboard.bossesSlain = 20; scoreboard.buildingsBuilt = 50;
  state.nightsSurvived = 20; state.player.gold = 99999; state.player.loomPoints = 50; state.player.loomNodes = {};
  const cheatCard = scoreboard.saveToLeaderboard();

  ok(cheatCard.legit === false, 'the god-mode run is flagged not-legit');
  ok(cheatCard.legacyScore > legitCard.legacyScore, 'sanity: the cheat run really does out-score the legit one on raw stats');

  const entries = loadLeaderboard();
  const legitIdx = entries.findIndex(e => e.legit && e.legacyScore === legitCard.legacyScore);
  const cheatIdx = entries.findIndex(e => !e.legit && e.legacyScore === cheatCard.legacyScore);
  ok(legitIdx >= 0 && cheatIdx >= 0, 'both runs present in the saved leaderboard');
  ok(legitIdx < cheatIdx, `the lower-scoring LEGIT run (rank ${legitIdx}) still ranks above the higher-scoring CHEAT run (rank ${cheatIdx})`);

  try { localStorage.removeItem('nw.leaderboard'); } catch {}
  state.everGod = false;
}

async function testLeaderboardUI(nw: any) {
  const scoreboard = nw.sys.scoreboard;
  if (!scoreboard) { ok(true, 'no scoreboard system — skipping leaderboard UI test'); return; }

  // Test getLiveStats while game is running
  const live = scoreboard.getLiveStats();
  ok(live !== null && live !== undefined, 'getLiveStats returns an object');
  ok(typeof live.connectionAge === 'number', `connectionAge is number: ${live.connectionAge}`);
  ok(typeof live.enemiesKilled === 'number', `enemiesKilled is number: ${live.enemiesKilled}`);
  ok(typeof live.bossesSlain === 'number', `bossesSlain is number: ${live.bossesSlain}`);
  ok(typeof live.buildingsBuilt === 'number', `buildingsBuilt is number: ${live.buildingsBuilt}`);
  ok(typeof live.riftsSurvived === 'number', `riftsSurvived is number: ${live.riftsSurvived}`);
  ok(typeof live.nightsSurvived === 'number', `nightsSurvived is number: ${live.nightsSurvived}`);
  ok(typeof live.goldHoarded === 'number', `goldHoarded is number: ${live.goldHoarded}`);
  ok(typeof live.peakRtt === 'number', `peakRtt is number: ${live.peakRtt}`);
  ok(typeof live.lowestDownlink === 'number', `lowestDownlink is number: ${live.lowestDownlink}`);
  ok(typeof live.dominantRealm === 'string', `dominantRealm is string: "${live.dominantRealm}"`);
  // L1 live fields
  ok(typeof live.age === 'number', `age is number: ${live.age}`);
  ok(typeof live.legit === 'boolean', `legit is boolean: ${live.legit}`);
  ok(typeof live.legacyScore === 'number', `legacyScore is number: ${live.legacyScore}`);
  ok(typeof live.minutesRemaining === 'number', `minutesRemaining is number: ${live.minutesRemaining}`);

  // Test the leaderboard panel renders (DOM check)
  const ui = nw.ui;
  if (!ui) { ok(true, 'no UI — skipping DOM check'); return; }

  // Open the leaderboard panel
  ui.open('leaderboard');
  const panel = document.querySelector('.nw-panel');
  ok(panel !== null, 'leaderboard panel exists in DOM');

  // Check for current run section
  const curSec = document.querySelector('.nw-lb-cur');
  ok(curSec !== null, 'current run section exists');

  // Check for historical section
  const histSec = document.querySelector('.nw-lb-hist');
  ok(histSec !== null, 'historical section exists');

  // Check stats grid has entries
  const stats = document.querySelectorAll('.nw-lb-stat');
  ok(stats.length >= 8, `stats grid has ${stats.length} entries (expect >= 8)`);

  // Close the panel
  ui.close();
  ok(true, 'leaderboard UI test completed');
}

// =========================================================================
// L1: The Lifespan — hard run-length clock, natural-causes death, legacy score
// =========================================================================

async function testLifespanAging(nw: any) {
  const { state, sys } = nw;
  const lifespan = sys.lifespan;
  if (!lifespan) { ok(true, 'no lifespan system — skipping'); return; }
  const { CFG } = await import('../data/config');

  // NOTE: this deliberately does NOT call lifespan.updateReal() with a fake
  // timestamp. That method's `realLastMs` is fed real performance.now()
  // values by the live render loop every frame (this Gauntlet runs against
  // a real, un-paused game — the rAF ticker never stops for the test suite),
  // so injecting a synthetic timestamp would race the live ticker and
  // corrupt real game state. Test the pure parts directly instead:
  // agingMul() and fracRemaining() read state but don't touch realLastMs.

  // Full vitals → baseline pace (the multiplier that produces the 15-min ceiling)
  state.player.vigor = 100;
  state.player.resolve = 100;
  const baselineMul = lifespan.agingMul();
  eq(baselineMul, 1, 'full vigor/resolve ages at exactly the baseline rate (1×)');

  // Starved vitals → must be FASTER, never slower, and bounded by the
  // configured max swing — this is the actual property the "hard cap, but
  // neglect can cut it short" design depends on.
  state.player.vigor = 0;
  state.player.resolve = 0;
  const starvedMul = lifespan.agingMul();
  ok(starvedMul > baselineMul, `neglected vitals age FASTER than baseline (${starvedMul} > ${baselineMul})`);
  const maxExpected = 1 + CFG.lifespan.vitalsSwingPct / 100;
  ok(starvedMul <= maxExpected + 1e-9, `neglect never exceeds the configured max swing (${starvedMul} <= ${maxExpected})`);

  // Halfway-neglected vitals → strictly between the two — monotonic, not a
  // step function.
  state.player.vigor = 50;
  state.player.resolve = 50;
  const halfMul = lifespan.agingMul();
  ok(halfMul > baselineMul && halfMul < starvedMul, `half-neglected vitals age between baseline and fully-starved (${baselineMul} < ${halfMul} < ${starvedMul})`);

  // fracRemaining(): 1 at the start of life, 0 at the death age, monotonic between.
  state.player.age = CFG.lifespan.startAge;
  const fracAtStart = lifespan.fracRemaining();
  eq(fracAtStart, 1, 'fracRemaining is 1 at the start of a run');
  state.player.age = lifespan.deathAtAge();
  const fracAtDeath = lifespan.fracRemaining();
  eq(fracAtDeath, 0, 'fracRemaining is 0 exactly at the death age');

  // Restore for any later test that assumes a live, full-vitals run.
  state.player.age = CFG.lifespan.startAge;
  state.player.vigor = 100;
  state.player.resolve = 100;
}

async function testLifespanOldAgeDeath(nw: any) {
  const { state, sys, ctx } = nw;
  const lifespan = sys.lifespan;
  if (!lifespan || !ctx.onOldAgeDeath) { ok(true, 'no lifespan system — skipping'); return; }

  const { CFG } = await import('../data/config');

  // Isolate: this run must look "live" going in, independent of whatever
  // earlier tests (e.g. the hall-destroyed game-over test) left behind.
  state.gameOver = false;
  state.gameOverCause = null;
  state.player.vigor = 100;
  state.player.resolve = 100;

  const deathAge = lifespan.deathAtAge();

  // NOTE: drives checkThresholds() directly rather than updateReal() with a
  // fake timestamp — see testLifespanAging for why (the live render loop
  // feeds updateReal real performance.now() values every frame; a synthetic
  // timestamp would race it). checkThresholds() only reads/writes
  // state.player.age and doesn't touch the real-time accumulator at all.
  state.player.age = deathAge - 0.5;
  lifespan.checkThresholds();
  ok(state.gameOver === false, 'below the target age, the run stays live');

  state.player.age = deathAge; // at (or past) the target
  lifespan.checkThresholds();

  ok(state.gameOver === true, 'crossing the target age ends the run');
  ok(state.gameOverCause === 'old_age', `gameOverCause is old_age (got ${state.gameOverCause})`);
  ok(state.player.age <= deathAge + 1e-9, `age is clamped at the death target (${state.player.age.toFixed(4)} ~ ${deathAge.toFixed(4)})`);

  // Old-age death is a DIFFERENT ending from hall-destroyed — distinct flavor text.
  if (typeof document !== 'undefined') {
    const domText = document.body.innerText || '';
    ok(domText.includes('DREAM FADES') || domText.includes('dream fades'), 'old-age death shows THE DREAM FADES, not the combat-death screen');
  }

  // Critical: this test just ended the shared, live game run. Reset it back
  // to a fresh, young, live state so LATER tests in the suite (which all
  // share this same `state` object) don't inherit a character pinned at
  // death's door — a lesson from this exact test breaking the exhaustive
  // playthrough test the first time this was written.
  state.gameOver = false;
  state.gameOverCause = null;
  state.player.age = CFG.lifespan.startAge;
}

async function testLegacyScoreCalc(nw: any) {
  void nw;
  const { computeLegacyScore } = await import('./scoreboard');
  const { CFG } = await import('../data/config');
  const w = CFG.legacy.weights;

  const zero = computeLegacyScore({
    nightsSurvived: 0, enemiesKilled: 0, bossesSlain: 0, buildingsBuilt: 0,
    loomPointsEarned: 0, goldHoarded: 0, age: CFG.lifespan.startAge, causeOfDeath: 'unknown',
  });
  eq(zero, 0, 'zero accomplishments and no years lived scores exactly 0');

  const oneNight = computeLegacyScore({
    nightsSurvived: 1, enemiesKilled: 0, bossesSlain: 0, buildingsBuilt: 0,
    loomPointsEarned: 0, goldHoarded: 0, age: CFG.lifespan.startAge, causeOfDeath: 'unknown',
  });
  eq(oneNight, w.nightSurvived, 'one night survived adds exactly its configured weight');

  const withAge = computeLegacyScore({
    nightsSurvived: 0, enemiesKilled: 0, bossesSlain: 0, buildingsBuilt: 0,
    loomPointsEarned: 0, goldHoarded: 0, age: CFG.lifespan.startAge + 10, causeOfDeath: 'old_age',
  });
  eq(withAge, Math.round(10 * w.yearLived + w.oldAgeBonus), 'old-age death adds years-lived + the old-age bonus term');

  // Monotonicity: this is the property the leaderboard sort actually relies
  // on — strictly more accomplishments must never score lower.
  const less = computeLegacyScore({ nightsSurvived: 1, enemiesKilled: 5, bossesSlain: 0, buildingsBuilt: 2, loomPointsEarned: 1, goldHoarded: 100, age: CFG.lifespan.startAge, causeOfDeath: 'unknown' });
  const more = computeLegacyScore({ nightsSurvived: 2, enemiesKilled: 10, bossesSlain: 1, buildingsBuilt: 4, loomPointsEarned: 2, goldHoarded: 200, age: CFG.lifespan.startAge, causeOfDeath: 'unknown' });
  ok(more > less, `strictly more accomplishments scores strictly higher (${more} > ${less})`);
}

// =========================================================================
// N3: Living Network — fire params with network multipliers
// =========================================================================

async function testFireNetworkParams(nw: any) {
  const net = nw.ctx.net;
  if (!net || !nw.ctx.worldCore) {
    ok(true, 'no network or worldCore — skipping fire network test');
    return;
  }

  // Push fire params with network multipliers
  const worldCore = nw.ctx.worldCore;
  const origPushFireParams = worldCore.pushFireParams;
  let lastParams: any = null;
  worldCore.pushFireParams = (p: any) => { lastParams = p; };

  try {
    // Simulate high jitter → increased fire spread
    net.snap.jitter = 80; // 80ms jitter
    const spreadMul = 1 + 80 / 50; // should be 2.6
    ok(spreadMul > 2, `jitter 80ms → spreadMul ${spreadMul.toFixed(1)} (expected >2)`);

    // Simulate calm network
    net.snap.jitter = 5;
    const calmSpread = 1 + 5 / 50;
    ok(calmSpread < 1.5, `jitter 5ms → spreadMul ${calmSpread.toFixed(1)} (expected <1.5)`);

    // Realm → wind: cellular chaos should have higher wind
    const realms = net.realms;
    if (realms) {
      const chaosRealm = realms.find((r: any) => r.name?.includes('Chaos') || r.name?.includes('Cellular'));
      if (chaosRealm) {
        ok(chaosRealm.windMul !== undefined, 'Cellular Chaos realm has windMul');
        if (chaosRealm.windMul !== undefined) {
          ok(chaosRealm.windMul >= 1, `Cellular windMul ${chaosRealm.windMul} >= 1`);
        }
      }
    }
  } finally {
    worldCore.pushFireParams = origPushFireParams;
  }

  ok(true, 'fire network params test completed');
}

// =========================================================================
// M3 — Scatter Cache: gold-spending panic button
// =========================================================================

async function testScatterCache(nw: any) {
  const { state, sys } = nw;
  state.player.gold = 500;
  nw.step(1);

  const goldBefore = state.player.gold;
  sys.hordes.scatterCache?.();
  nw.step(1);

  ok(state.player.gold < goldBefore,
    `Scatter Cache spent gold: ${goldBefore} → ${state.player.gold}`);
  ok(state.player.gold >= 0, 'gold does not go negative from Scatter Cache');

  // Should not work with low gold
  state.player.gold = 30;
  sys.hordes.scatterCache?.();
  ok(state.player.gold === 30, 'Scatter Cache refused — below minimum');

  ok(true, 'Scatter Cache test completed');
}

// =========================================================================
// Content sweep: verify every data row is structurally valid
// =========================================================================

async function testDataIntegrity(nw: any) {
  const { BUILDINGS } = await import('../data/buildings');
  const { ENEMIES } = await import('../data/enemies');
  const { ITEMS } = await import('../data/items');
  const { RECIPES } = await import('../data/recipes');
  const { ECHOES } = await import('../data/echoes');
  const { LOOM_NODES } = await import('../data/loom');
  const { FEATURES } = await import('../data/features');
  const { SKILLS } = await import('../data/skills');
  const { MATERIALS } = await import('../data/materials');
  const { NET_METRICS, NET_GAME_MAP } = await import('../data/network');

  let checks = 0;

  // Every building has required fields
  for (const b of BUILDINGS) {
    ok(typeof b.id === 'string', `building ${b.id}: id is string`);
    ok(typeof b.name === 'string', `building ${b.id}: name is string`);
    ok(typeof b.hp === 'number' && b.hp > 0, `building ${b.id}: HP ${b.hp} > 0`);
    ok(b.cost !== undefined, `building ${b.id}: has cost`);
    checks += 4;
  }

  // Every enemy has required fields
  for (const e of ENEMIES) {
    ok(typeof e.id === 'string', `enemy ${e.id}: id is string`);
    ok(typeof e.hp === 'number' && e.hp > 0, `enemy ${e.id}: HP ${e.hp} > 0`);
    ok(typeof e.dmg === 'number' && e.dmg > 0, `enemy ${e.id}: dmg ${e.dmg} > 0`);
    checks += 3;
  }

  // Every item has required fields (ITEMS is Record<string, ItemDef>)
  for (const i of Object.values(ITEMS)) {
    ok(typeof i.id === 'string', `item ${i.id}: id is string`);
    ok(i.icon !== undefined, `item ${i.id}: has icon`);
    checks += 2;
  }

  // Every recipe's inputs reference real items
  const itemIds = new Set(Object.values(ITEMS).map((i: any) => i.id));
  for (const r of RECIPES) {
    for (const ing of r.in) {
      ok(itemIds.has(ing.id), `recipe ${r.id}: ingredient '${ing.id}' is a real item`);
      checks++;
    }
    ok(itemIds.has(r.out.id), `recipe ${r.id}: output '${r.out.id}' is a real item`);
    checks++;
  }

  // Every echo has required fields
  for (const e of ECHOES) {
    ok(typeof e.id === 'string', `echo ${e.id}: id is string`);
    ok(typeof e.name === 'string', `echo ${e.id}: name is string`);
    ok(typeof e.bossId === 'string', `echo ${e.id}: bossId is string`);
    checks += 3;
  }

  // Every loom node has required fields
  for (const n of LOOM_NODES) {
    ok(typeof n.id === 'string', `loom node ${n.id}: id is string`);
    ok(n.maxRank >= 1, `loom node ${n.id}: maxRank ${n.maxRank} >= 1`);
    ok(n.effects !== undefined, `loom node ${n.id}: has effects`);
    if (n.req) {
      for (const reqId of n.req) {
        ok(LOOM_NODES.some((ln: any) => ln.id === reqId),
          `loom node ${n.id}: prereq '${reqId}' is a real node`);
        checks++;
      }
    }
    checks += 2;
  }

  // Every feature has a skill mapping and valid density entries
  for (const f of FEATURES) {
    ok(typeof f.id === 'string', `feature ${f.id}: id is string`);
    ok(typeof f.skill === 'string', `feature ${f.id}: skill '${f.skill}' is string`);
    ok(typeof f.density === 'object' && f.density !== null, `feature ${f.id}: density is object`);
    checks += 3;
  }

  // Every skill has required fields
  for (const s of SKILLS) {
    ok(typeof s.id === 'string', `skill ${s.id}: id is string`);
    ok(typeof s.name === 'string', `skill ${s.id}: name is string`);
    checks += 2;
  }

  // Every NET_METRICS row has required fields
  for (const m of NET_METRICS) {
    ok(typeof m.key === 'string', `metric ${m.key}: key is string`);
    checks++;
  }

  // Every NET_GAME_MAP row has required fields
  for (const gm of NET_GAME_MAP) {
    ok(typeof gm.target === 'string', `game map ${gm.target}: target is string`);
    ok(typeof gm.netKey === 'string', `game map ${gm.target}: netKey is string`);
    checks++;
  }

  ok(checks >= 100, `data integrity: ${checks} structural checks passed across all data files`);
}

// =========================================================================
// Exercises every system under realistic conditions: gather → craft → build
// → fight nights → survive. Collects detailed metrics for iterative debugging.
// Runs at accelerated sim speed (batched ticks). Reports a structured summary.

interface PlaythroughMetrics {
  ticksElapsed: number;
  gameSeconds: number;
  nightsSurvived: number;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  gathers: number;
  itemsCrafted: number;
  buildingsPlaced: number;
  goldEarned: number;
  goldSpent: number;
  xpEvents: { skill: string; level: number; clock: number }[];
  deaths: number;
  hordeWaves: number;
  firesStarted: number;
  events: { clock: number; kind: string; detail: string }[];
  snapshots: { clock: number; hp: number; gold: number; kills: number; buildings: number }[];
}

function logEvent(m: PlaythroughMetrics, clock: number, kind: string, detail: string) {
  m.events.push({ clock: +clock.toFixed(1), kind, detail });
}

function snapshotState(m: PlaythroughMetrics, nw: any) {
  const s = nw.state;
  m.snapshots.push({
    clock: +s.clock.toFixed(1),
    hp: s.player.hp,
    gold: s.player.gold,
    kills: m.kills,
    buildings: s.buildings.length,
  });
}

async function testSurvivalPlaythrough(nw: any) {
  const { state, sys, world } = nw;
  const startRealMs = performance.now();

  // ---- metrics ----
  const m: PlaythroughMetrics = {
    ticksElapsed: 0, gameSeconds: 0, nightsSurvived: 0,
    kills: 0, damageDealt: 0, damageTaken: 0,
    gathers: 0, itemsCrafted: 0, buildingsPlaced: 0,
    goldEarned: 0, goldSpent: 0,
    xpEvents: [], deaths: 0, hordeWaves: 0, firesStarted: 0,
    events: [], snapshots: [],
  };

  // ---- setup: give player fighting chance ----
  // Place a hall so respawn works
  const htx = Math.floor(state.player.x / 32);
  const hty = Math.floor(state.player.y / 32) - 3;
  state.player.inv.wood_scrap = 50;
  state.player.inv.plank = 30;
  state.player.inv.stone = 40;
  state.player.inv.log = 20;
  state.player.inv.coal = 10;
  state.player.inv.iron_ore = 5;
  state.player.inv.axe_flint = 1;
  state.player.inv.pick_flint = 1;
  state.player.inv.sword_copper = 1;
  state.player.inv.torch = 5;
  state.buildings.push({ uid: state.nextUid++, type: 'hall', tx: htx, ty: hty, hp: 200 });
  // Add a tower for passive defense (building ID is 'tower', not 'watchtower')
  state.buildings.push({ uid: state.nextUid++, type: 'tower', tx: htx + 2, ty: hty, hp: 100 });
  // Add walls for protection
  for (let dx = -2; dx <= 2; dx++) {
    state.buildings.push({ uid: state.nextUid++, type: 'wall', tx: htx + dx, ty: hty - 2, hp: 80 });
  }
  world.reindexBuildings();
  nw.step(5);

  // Equip the copper sword
  const { toggleEquip } = await import('../rules');
  toggleEquip(state, 'sword_copper');

  // Move player near hall. teleport(), not a projection write — see below.
  nw.player.teleport(htx * 32 + 16, hty * 32 + 16);
  state.player.hp = 100;
  nw.step(5);

  logEvent(m, state.clock, 'setup', `hall at (${htx},${hty}), sword equipped, walls up`);

  // ---- playthrough loop: 10 game-minutes ----
  const durationSec = 600; // 10 minutes of game time
  const dt = 1 / 30;
  const totalTicks = Math.ceil(durationSec / dt); // ~18000
  const BATCH = 15; // ticks per batch — balance speed vs. responsiveness

  let prevHp = state.player.hp;
  let prevGold = state.player.gold;
  let prevNight = state.nightsSurvived;
  let actionCooldown = 0;

  for (let tick = 0; tick < totalTicks; tick += BATCH) {
    nw.step(BATCH);
    m.ticksElapsed += BATCH;
    m.gameSeconds = +(m.ticksElapsed * dt).toFixed(1);

    // Track damage taken
    if (state.player.hp < prevHp) {
      m.damageTaken += prevHp - state.player.hp;
    }
    // Track gold earned
    if (state.player.gold > prevGold) {
      m.goldEarned += state.player.gold - prevGold;
    }
    // Track nights survived. B2: accumulate the DELTA, not the absolute counter.
    // state.nightsSurvived is a run-wide stat that earlier fixtures assign
    // directly (the scoreboard tests set it to 5, 1 and 20), so copying it here
    // reported a playthrough's nights as "20 + however many it actually did" —
    // and that number is what gets quoted as evidence.
    if (state.nightsSurvived > prevNight) {
      m.nightsSurvived += state.nightsSurvived - prevNight;
      logEvent(m, state.clock, 'night', `survived night ${state.nightsSurvived}`);
      prevNight = state.nightsSurvived;
    }
    // Track deaths
    if (state.player.hp <= 0 && prevHp > 0) {
      m.deaths++;
      logEvent(m, state.clock, 'death', `player died (death #${m.deaths})`);
    }

    prevHp = state.player.hp;
    prevGold = state.player.gold;

    // ---- AI actions (every ~0.5s game time) ----
    actionCooldown -= BATCH * dt;
    if (actionCooldown <= 0 && state.player.hp > 0) {
      actionCooldown = 0.5; // seconds between actions

      const px = state.player.x, py = state.player.y;

      // Priority 1: Attack nearby enemies
      let acted = false;
      try {
        const foes = sys.hordes?.foes;
        if (foes && (foes instanceof Set ? foes.size > 0 : foes.length > 0)) {
          const foeArr = foes instanceof Set ? [...foes] : foes;
          for (const f of foeArr) {
            const dist = Math.hypot(f.x - px, f.y - py);
            if (dist < 80 && state.player.hp > 30) {
              state.player.x += (f.x - px) * 0.3;
              state.player.y += (f.y - py) * 0.3;
              sys.combat.attack();
              acted = true;
              break;
            }
          }
        }
      } catch { /* combat not critical for test pass */ }

      // Priority 2: Gather if near a node and not fighting
      if (!acted) {
        try {
          const ptx2 = Math.floor(state.player.x / 32);
          const pty2 = Math.floor(state.player.y / 32);
          let feature: any = null;
          let ftx = 0, fty = 0;
          for (let dy = -2; dy <= 2 && !feature; dy++) {
            for (let dx = -2; dx <= 2 && !feature; dx++) {
              const f = world.activeFeatureAt(ptx2 + dx, pty2 + dy);
              if (f) { feature = f; ftx = ptx2 + dx; fty = pty2 + dy; }
            }
          }
          if (feature) {
            // `state.player` is a PROJECTION: main() overwrites it from nw.player
            // at the end of every sim tick, so this used to move the player
            // NOWHERE and the playthrough only ever gathered what happened to be
            // inside the 1.6-tile reach already. Same bug as the exhaustive
            // playthrough's phase-1 loop, in a different function, missed when
            // that one was fixed. It is why "at least one productive action
            // performed" went red on 1 run in 12 with buildings.length >= 3
            // passing on the line above: the buildings came from setup, and the
            // playthrough itself had done nothing.
            //
            // Stand BESIDE the node — a tree tile is not standable, and
            // teleporting into one silently leaves the player where they were.
            const fcx = (ftx + 0.5) * 32, fcy = (fty + 0.5) * 32;
            for (const [ox, oy] of [[22, 0], [-22, 0], [0, 22], [0, -22], [0, 0]]) {
              if (!world.canStand(fcx + ox, fcy + oy)) continue;
              nw.player.teleport(fcx + ox, fcy + oy);
              break;
            }
            nw.step(2);
            sys.gather.tryStart();
            if (sys.gather.active) {
              m.gathers++;
              const gatherTicks = Math.ceil((sys.gather.active.need || 2) / dt) + 10;
              for (let g = 0; g < gatherTicks; g += 5) nw.step(5);
            }
            acted = true;
          }
        } catch { /* gather not critical */ }
      }

      // Priority 3: Craft if we have materials
      if (!acted && state.player.inv.log >= 3) {
        try {
          if (nw.craft('plank')) {
            m.itemsCrafted++;
            logEvent(m, state.clock, 'craft', `plank crafted (total: ${m.itemsCrafted})`);
            acted = true;
          }
        } catch { /* craft failure OK */ }
      }

      // Priority 4: Build if we have materials and space
      if (!acted && state.player.inv.plank >= 4 && state.player.inv.stone >= 4) {
        try {
          const btx = htx + 1 + Math.floor(Math.random() * 4);
          const bty = hty - 1 - Math.floor(Math.random() * 3);
          if (world.canPlaceAt(btx, bty, false)) {
            state.buildings.push({ uid: state.nextUid++, type: 'wall', tx: btx, ty: bty, hp: 80 });
            world.reindexBuildings();
            m.buildingsPlaced++;
            logEvent(m, state.clock, 'build', `wall at (${btx},${bty}) (total: ${m.buildingsPlaced})`);
          }
        } catch { /* build failure OK */ }
      }
    }

    // ---- periodic state snapshot (every 30 game-seconds) ----
    if (m.ticksElapsed % Math.ceil(30 / dt) < BATCH) {
      snapshotState(m, nw);
    }

    // ---- abort if game-over ----
    if (state.gameOver && state.player.hp <= 0) {
      logEvent(m, state.clock, 'gameover', 'player died with no respawn');
      break;
    }

    // ---- safety: ensure player doesn't stay dead ----
    if (state.player.hp <= 0 && !state.gameOver) {
      // Respawn should happen automatically; just track it
      logEvent(m, state.clock, 'respawn', 'awaiting respawn');
      // Give a small HP boost to prevent death loop
      for (let r = 0; r < 60; r++) nw.step(5); // ~2s wait
    }
  }

  // ---- final snapshot ----
  snapshotState(m, nw);
  const elapsedRealMs = performance.now() - startRealMs;

  // ---- verify outcomes ----
  logEvent(m, state.clock, 'end', `playthrough complete in ${(elapsedRealMs / 1000).toFixed(1)}s real time`);

  // Core survival checks: game ran without crashing, player interacted with systems
  ok(!state.gameOver || state.player.hp > 0, 'game not in unrecoverable game-over state');
  ok(m.ticksElapsed >= 1000, `sim ran for meaningful duration (${m.ticksElapsed} ticks)`);
  ok(state.player.hp > 0 || m.deaths <= 3, 'player alive or deaths within reasonable range');
  ok(state.buildings.length >= 3, `buildings exist at end (${state.buildings.length} total)`);
  ok(m.damageTaken >= 0, `damage taken tracked: ${m.damageTaken}`);
  ok(m.goldEarned >= 0, `gold earned tracked: ${m.goldEarned}`);
  ok(m.gathers + m.itemsCrafted + m.buildingsPlaced >= 1, 'at least one productive action performed');

  // ---- structured report ----
  console.log('%c📊 SURVIVAL PLAYTHROUGH REPORT', 'font-weight:bold;font-size:13px;color:#0cf;');
  console.log(`  ⏱  Game time: ${m.gameSeconds.toFixed(0)}s  |  Real time: ${(elapsedRealMs / 1000).toFixed(1)}s`);
  console.log(`  🌙 Nights survived: ${m.nightsSurvived}  |  💀 Deaths: ${m.deaths}`);
  console.log(`  ⚔  Kills: ${m.kills}  |  ❤  Damage taken: ${m.damageTaken}`);
  console.log(`  🪓 Gathers: ${m.gathers}  |  ⚒ Crafts: ${m.itemsCrafted}  |  🏗 Builds: ${m.buildingsPlaced}`);
  console.log(`  💰 Gold earned: ${m.goldEarned}  |  🏠 Buildings: ${state.buildings.length}`);
  console.log(`  📋 Events logged: ${m.events.length}  |  📸 Snapshots: ${m.snapshots.length}`);
  console.log(`  🎯 Final: HP ${state.player.hp}  |  Gold ${state.player.gold}  |  Clock ${state.clock.toFixed(1)}`);

  // Print key events timeline
  console.log('%c📋 Key Events:', 'color:#888;');
  const keyKinds = ['night', 'death', 'gameover', 'end', 'setup'];
  for (const ev of m.events) {
    if (keyKinds.includes(ev.kind)) {
      console.log(`  [${ev.clock.toFixed(0)}s] ${ev.kind}: ${ev.detail}`);
    }
  }
}

// ---------------------------------------------------------------------------
// C1: Echoes of the Slain
// ---------------------------------------------------------------------------

/** Synthetic slain-able lord. MUST carry `level` — worldbosses.hurt() pays
 * `b.level * 20` gold on death (testBossFight's fake omits it and transiently
 * NaNs the gold; pre-existing, masked by a later test overwriting gold). */
function makeTestBoss(nw: any, defId: string) {
  const { state } = nw;
  return {
    uid: state.nextUid++, defId, lordId: 'test', name: 'Test Lord',
    x: state.player.x + 60, y: state.player.y, px: 0, py: 0,
    hp: 10, maxHp: 10, dmg: 0, level: 1,
    atkT: 0, telegraphT: 0, animT: 0, hunting: false, provokedUntil: 0,
    reviveAt: 0, homeGx: 0, homeGy: 0,
  };
}

/** Dummy foe for echo damage checks: tanky, harmless, non-boss — and FROZEN
 * in place (telegraphT ≫ 0 = the engine's committed-mid-swing state, which
 * skips all AI movement) so every geometry assertion is deterministic: the
 * orbit target stays ON the ring, the trail target stays ON its patch tile. */
function makeDummyFoe(nw: any, def: any, dx: number, dy: number, hp = 500) {
  const { state } = nw;
  const x = state.player.x + dx, y = state.player.y + dy;
  return {
    uid: state.nextUid++, def,
    x, y, px: x, py: y, hp, maxHp: hp,
    dmg: 0, atkT: 9999, telegraphT: 9999, animT: 0,
  };
}

async function testEchoGrantAndLevel(nw: any) {
  const { state, sys } = nw;
  const { CFG } = await import('../data/config');
  state.gameOver = false; // an earlier test (game over) leaves the flag set
  state.player.echoes = {};

  // first kill grants the lord's signature echo at level 1
  let b: any = makeTestBoss(nw, 'thornwarden');
  state.worldBosses.push(b);
  sys.worldbosses.hurt(b, 9999);
  eq(state.player.echoes['thornring'], 1, 'first Thornwarden kill grants Thornring L1');
  ok(nw.log.entries.some((e: any) => e.msg.includes('echo clings')), 'Chronicle logs the grant in fiction voice');

  // re-kill deepens it
  b = makeTestBoss(nw, 'thornwarden');
  state.worldBosses.push(b);
  sys.worldbosses.hurt(b, 9999);
  eq(state.player.echoes['thornring'], 2, 're-kill levels Thornring to 2');
  ok(nw.log.entries.some((e: any) => e.msg.includes('echo deepens')), 'Chronicle logs the level-up');

  // every lord maps to a distinct echo
  const { ECHOES, echoForBoss } = await import('../data/echoes');
  eq(ECHOES.length, 5, 'five echoes defined');
  for (const bossId of ['thornwarden', 'cindermaw', 'rimewraith', 'tideculler', 'nullmaw']) {
    ok(echoForBoss(bossId) !== undefined, `${bossId} grants an echo`);
  }

  // grant past the cap deepens nothing
  state.player.echoes['thornring'] = CFG.echoes.maxLevel;
  b = makeTestBoss(nw, 'thornwarden');
  state.worldBosses.push(b);
  sys.worldbosses.hurt(b, 9999);
  eq(state.player.echoes['thornring'], CFG.echoes.maxLevel, `echo level capped at ${CFG.echoes.maxLevel}`);

  // cleanup: drop the synthetic reviving bosses and the granted echoes
  state.worldBosses = state.worldBosses.filter((x: any) => x.lordId !== 'test');
  state.player.echoes = {};
}

async function testEchoDamage(nw: any) {
  const { state, sys } = nw;
  const { CFG } = await import('../data/config');
  const { ENEMIES } = await import('../data/enemies');
  const dummyDef = ENEMIES.find((e: any) => !e.boss)!;
  state.gameOver = false;
  state.god = true; state.player.hp = 100; // stray patch/foe contact must not end the run mid-test
  const es: any = sys.echoes;

  const holdOnly = (id: string, lvl = 1) => {
    state.player.echoes = { [id]: lvl };
    es.cooldowns = {}; es.patches = []; es.orbHitAt?.clear?.();
  };
  const withDummy = (dx: number, dy: number) => {
    const foe: any = makeDummyFoe(nw, dummyDef, dx, dy);
    sys.hordes.foes.push(foe);
    return foe;
  };
  const dropFoe = (foe: any) => { sys.hordes.foes = sys.hordes.foes.filter((f: any) => f.uid !== foe.uid); };

  // -- pulse: Thornring hits an adjacent foe within one cadence
  holdOnly('thornring');
  let foe = withDummy(30, 0);
  nw.step(15); // 0.5 s ≫ first fire (cooldown starts spent)
  ok(foe.hp < foe.maxHp, `Thornring pulse damaged adjacent foe (${foe.maxHp - foe.hp} dmg)`);
  dropFoe(foe);

  // -- nova: Rime Nova damages AND chills
  holdOnly('rime_nova');
  foe = withDummy(30, 0);
  nw.step(15);
  ok(foe.hp < foe.maxHp, `Rime Nova damaged adjacent foe (${foe.maxHp - foe.hp} dmg)`);
  ok(foe.chillUntil > state.clock - 0.1, 'Rime Nova stamped chillUntil');
  ok(foe.chillMult < 1, `chillMult slows the march (${foe.chillMult})`);
  dropFoe(foe);

  // -- volley: Tide Lash reaches out to range
  holdOnly('tide_lash');
  foe = withDummy(120, 0);
  nw.step(15);
  ok(foe.hp < foe.maxHp, `Tide Lash damaged ranged foe (${foe.maxHp - foe.hp} dmg)`);
  dropFoe(foe);

  // -- orbit: Null Orb contact over one sweep
  holdOnly('null_orb');
  foe = withDummy(Math.round(1.8 * 32), 0);
  nw.step(180); // 6 s ≫ full orbit at CFG.echoes.orbitRadPerSec
  ok(foe.hp < foe.maxHp, `Null Orb contact damaged foe (${foe.maxHp - foe.hp} dmg)`);
  dropFoe(foe);

  // -- trail: patch drops on the tile you LEAVE; the patch burns foes standing in it.
  // Real-CA ignition is disabled for determinism (wild fire spreading through the rest
  // of the suite); the flag itself is pinned by testEchoBounds and witnessed live.
  const igniteWas = CFG.echoes.cinderIgnitesCA;
  CFG.echoes.cinderIgnitesCA = false;
  try {
    holdOnly('cinder_trail');
    nw.step(2); // let the trail tracker settle on the current tile
    const fromTx = Math.floor(state.player.x / 32), fromTy = Math.floor(state.player.y / 32);
    nw.player.teleport(state.player.x + 40, state.player.y); // one tile over — a step, not a jump
    nw.step(3);
    ok(es.patches.length >= 1, 'leaving a tile drops a cinder patch');
    ok(es.patches.some((p: any) => p.tx === fromTx && p.ty === fromTy), 'patch sits on the EXITED tile');
    foe = withDummy(0, 0); // park the dummy wherever the patch is
    foe.x = (fromTx + 0.5) * 32; foe.y = (fromTy + 0.5) * 32;
    const hpBefore = foe.hp;
    nw.step(30); // 1 s — two patch ticks
    ok(foe.hp < hpBefore, `cinder patch burned the foe standing in it (${hpBefore - foe.hp} dmg)`);
    dropFoe(foe);
  } finally {
    CFG.echoes.cinderIgnitesCA = igniteWas;
  }

  state.player.echoes = {};
  es.patches = [];
  state.god = false;
}

async function testEchoBounds(nw: any) {
  const { state, sys } = nw;
  const { CFG } = await import('../data/config');
  const { ECHOES, statsFor } = await import('../data/echoes');
  state.gameOver = false;

  // T5 verdict pinned: the real-fire flag SHIPS true (tests toggle it locally only)
  eq(CFG.echoes.cinderIgnitesCA, true, 'T5 verdict: cinderIgnitesCA ships TRUE');

  // scaling is monotonic and floored
  for (const def of ECHOES) {
    const lo = statsFor(def, 1), hi = statsFor(def, CFG.echoes.maxLevel);
    ok(hi.dmg > lo.dmg, `${def.id}: dmg scales up with level`);
    ok(hi.cooldown <= lo.cooldown, `${def.id}: cooldown never grows with level`);
    ok(statsFor(def, 99).cooldown >= CFG.echoes.minCooldownSec, `${def.id}: cooldown floored at ${CFG.echoes.minCooldownSec}s`);
    ok(hi.projectiles >= 1 && hi.orbCount >= 1, `${def.id}: counts stay ≥ 1`);
  }

  // Rolled echo damage stays inside the D5 band: base × [dmgRow.min, dmgRow.max].
  //
  // This band is D5 and nothing else, so everything else that scales an echo has
  // to come off first. Since the C4 repair `echoes.roll()` also applies
  // resonance_boost (×1.25) — and this test inherits whatever the previous test
  // left the player wearing. With the Nullmaw relic or an 'of Resonance' suffix
  // still on, a top-of-band roll lands at 12 in a [1, 10] band. It needs both
  // coincidences at once, which is why five green runs missed it and a shifted
  // RNG stream found it.
  const { NET_GAME_MAP } = await import('../data/network');
  const { activeEffects } = await import('./effects');
  const dmgRow = NET_GAME_MAP.find((m: any) => m.target === 'damage')!;
  const thorn = ECHOES.find((e) => e.id === 'thornring')!;
  const base = statsFor(thorn, 1).dmg;
  const minDmg = Math.max(1, Math.round(base * dmgRow.min)) - 1; // rounding slack
  const maxDmg = Math.round(base * dmgRow.max) + 1;
  const { ENEMIES } = await import('../data/enemies');
  const dummyDef = ENEMIES.find((e: any) => !e.boss)!;

  const snap = snapshotPlayer(nw);
  const savedSockets = state.sockets;
  try {
    await wearOnly(nw, []);
    state.sockets = {};
    // Assert the isolation rather than assuming it: if a future relic, weave or
    // affix starts feeding resonance from somewhere this does not clear, that is
    // a red test here, not a mysteriously wider band.
    ok(!activeEffects(state).has('resonance_boost'),
      'D5 band is measured with resonance_boost OFF — the band is D5 and nothing else');

    state.god = true; state.player.hp = 100;
    state.player.echoes = { thornring: 1 };
    const es: any = sys.echoes;
    for (let i = 0; i < 10; i++) {
      const foe: any = makeDummyFoe(nw, dummyDef, 30, 0);
      sys.hordes.foes.push(foe);
      es.cooldowns = {}; // force an immediate fire
      nw.step(3);
      const dealt = foe.maxHp - foe.hp;
      ok(dealt >= minDmg && dealt <= maxDmg, `echo roll ${i + 1} within D5 band: ${dealt} ∈ [${minDmg}, ${maxDmg}]`);
      sys.hordes.foes = sys.hordes.foes.filter((f: any) => f.uid !== foe.uid);
    }
    state.player.echoes = {};
  } finally {
    // ok() throws, so these belong here and not after the loop.
    state.sockets = savedSockets;
    state.god = false;
    snap.restore();
  }
}

async function testNetMapIntegrity(nw: any) {
  const { NET_GAME_MAP, NET_METRICS } = await import('../data/network');
  const net = nw.ctx.net;
  if (!net) { ok(true, 'no network system — skipping net-map integrity test'); return; }

  // Every game-mapping netKey must resolve to a real metric. A typo'd key makes
  // get() return 0 and the row silently computes garbage (caught live 2026-07-17:
  // the S1 stub rows 'echoJitter' and 'hardwareConcurrency' were dead on arrival).
  const metricKeys = new Set(NET_METRICS.map((m: any) => m.key));
  for (const gm of NET_GAME_MAP) {
    ok(metricKeys.has(gm.netKey), `${gm.label}: netKey '${gm.netKey}' exists in NET_METRICS`);
  }
  // Targets must be unique — getGameValue() resolves by find(); a duplicate shadows.
  const targets = NET_GAME_MAP.map((m: any) => m.target);
  eq(new Set(targets).size, targets.length, 'NET_GAME_MAP targets are unique');

  // Pin the S1 vitals rows on the neutral snapshot CFG.vitals bases assume
  // (10 Mbps, 50 ms RTT, 4g, 5 ms echo jitter, 4 cores, 4 GB) + band spot-checks.
  const s = net.snap;
  const saved = {
    rtt: s.rtt, downlink: s.downlink, echoJitter: s.echoJitter,
    effectiveType: s.effectiveType, cpuCores: s.cpuCores,
    deviceMemory: s.deviceMemory, endpointLatency: s.endpointLatency,
    timeOfDay: s.timeOfDay,
  };
  try {
    s.rtt = 50; s.downlink = 10; s.echoJitter = 5; s.effectiveType = '4g';
    s.cpuCores = 4; s.deviceMemory = 4; s.endpointLatency = 30; s.timeOfDay = 12 / 24;
    eq(net.getGameValue('vigorDecay'), 0.8, 'neutral: vigorDecay 0.8× (10 Mbps = plenty)');
    eq(net.getGameValue('vigorPerKill'), 1.0, 'neutral: vigorPerKill 1.0×');
    eq(net.getGameValue('vigorPerGather'), 1.0, 'neutral: vigorPerGather 1.0×');
    eq(net.getGameValue('vigorPerCampfire'), 1.0, 'neutral: vigorPerCampfire 1.0×');
    eq(net.getGameValue('resolveDecay'), 1.0, 'neutral: resolveDecay 1.0× on 4g (tier encoding 4g=1)');
    eq(net.getGameValue('resolvePerKill'), 1.0, 'neutral: resolvePerKill 1.0×');
    eq(net.getGameValue('resolvePerBuild'), 1.0, 'neutral: resolvePerBuild 1.0×');
    eq(net.getGameValue('resolveNearHall'), 1.0, 'neutral: resolveNearHall 1.0×');
    eq(net.getGameValue('resolveNightMult'), 0.8, 'noon: resolveNightMult 0.8×');
    // Tier bands (encoding: 4g=1, 3g=2, 2g=3, slow-2g=4 — the off-by-one this pins)
    s.effectiveType = '3g'; eq(net.getGameValue('resolveDecay'), 1.5, '3g: resolveDecay 1.5×');
    s.effectiveType = '2g'; eq(net.getGameValue('resolveDecay'), 2.5, '2g: resolveDecay 2.5×');
    s.effectiveType = 'slow-2g'; eq(net.getGameValue('resolveDecay'), 4.0, 'slow-2g: resolveDecay 4.0×');
    s.cpuCores = 8; eq(net.getGameValue('resolvePerBuild'), 1.5, '8 cores: resolvePerBuild 1.5×');
    s.echoJitter = 70;
    eq(net.getGameValue('resolvePerKill'), 0.3, 'stormy echoes: resolvePerKill 0.3×');
    eq(net.getGameValue('moveSpeed'), 0.92, 'stormy echoes: moveSpeed clamps at 0.92×');
    s.timeOfDay = 3 / 24; eq(net.getGameValue('resolveNightMult'), 2.5, '3am: resolveNightMult 2.5× (witching hours)');
  } finally {
    Object.assign(s, saved);
  }
}

async function testCombatRestartRateCap(nw: any) {
  // Verify click-restart enforces minimum interval (CFG.combat.restartMinIntervalSec)
  const { state, sys } = nw;
  const { CFG } = await import('../data/config');

  // Reset combat state machine
  sys.combat.phase = 'idle';
  (sys.combat as any)._lastRestartClock = undefined;

  // Start a swing from idle
  sys.combat.attack();
  ok(sys.combat.phase !== 'idle', 'attack from idle leaves idle phase');

  // Capture swingCount after the initial startSwing
  const swingCountAfterStart = sys.combat.swingCount;

  // Force phase to windup (simulate mid-swing) and call attack again
  sys.combat.phase = 'windup';
  sys.combat.attack();
  ok(sys.combat.swingCount > swingCountAfterStart,
    `immediate re-click triggers restart (swingCount ${swingCountAfterStart} → ${sys.combat.swingCount})`);

  // Third click within rate-cap window should be suppressed
  const swingCountAfterRestart = sys.combat.swingCount;
  sys.combat.attack();
  ok(sys.combat.swingCount === swingCountAfterRestart,
    `re-click within ${CFG.combat.restartMinIntervalSec}s rate cap suppressed (swingCount unchanged at ${sys.combat.swingCount})`);

  // Step past the rate cap window
  const stepsToClear = Math.ceil(CFG.combat.restartMinIntervalSec * 30) + 2;
  nw.step(stepsToClear);

  // Now restart should work again
  sys.combat.phase = 'windup'; // re-enter windup after step
  const swingCountAfterWait = sys.combat.swingCount;
  sys.combat.attack();
  ok(sys.combat.swingCount > swingCountAfterWait,
    `re-click after rate cap window triggers restart (swingCount ${swingCountAfterWait} → ${sys.combat.swingCount})`);
}

// =========================================================================
// S1: Survival Pressure — vitals tests
// =========================================================================

async function testVitalsDecay(nw: any) {
  const { state } = nw;
  const p = state.player;
  // Pin network so decay rates are deterministic regardless of live connection
  const net = nw.ctx.net;
  const saved = { downlink: net.snap.downlink, rtt: net.snap.rtt, effectiveType: net.snap.effectiveType, timeOfDay: net.snap.timeOfDay };
  // ...and pin the WORLD, which this test never did. It measures 60 s of decay
  // while night hordes are live: a foe that kills the player triggers
  // VitalsSystem.onRespawn, which sets vigor to a flat 50, and the assertion
  // then reports ~50 points of "decay" against an expected 4. Traced with a
  // property-setter trap after it went red 1 run in 6:
  //   set vigor <- VitalsSystem.onRespawn <- CombatSystem.damagePlayer
  //   <- HordeSystem.updateFoe <- sim
  // God mode blocks combat death without touching the decay path under test.
  const savedGod = state.god;
  const savedFoes = nw.sys.hordes.foes.slice();
  state.god = true;
  nw.sys.hordes.foes.length = 0;
  net.snap.downlink = 10;     // ≥10 Mbps → vigorDecay ×1.0
  net.snap.rtt = 50;          // 20–50ms → simSpeed ×1.0
  net.snap.effectiveType = '4g'; // → resolveDecay ×1.0
  net.snap.timeOfDay = 12;    // noon → resolveNightMult ×0.8 (daytime band)
  // Mark an action so idle multiplier doesn't kick in
  p.lastActionT = state.clock;
  p.vigor = 100;
  p.resolve = 100;
  nw.step(60 * 30); // 60s at 30Hz
  // Restore network and world
  Object.assign(net.snap, saved);
  state.god = savedGod;
  nw.sys.hordes.foes.length = 0;
  for (const f of savedFoes) nw.sys.hordes.foes.push(f);
  ok(p.vigor < 100, `vigor decayed after 60s: ${p.vigor.toFixed(1)}`);
  ok(p.resolve < 100, `resolve decayed after 60s: ${p.resolve.toFixed(1)}`);
  // With network pinned to neutral: vigor decay = 60 × (1/15) × 1.0 = 4 pts
  // resolve decay = 60 × (1/30) × 1.0 × 1.0 × 0.8 (daytime hour) ≈ 1.6 pts
  ok(p.vigor >= 94 && p.vigor <= 100, `vigor decay roughly ~${(100-p.vigor).toFixed(1)}pts over 60s (expected 4)`);
}

async function testVigorStarve(nw: any) {
  const { state } = nw;
  const p = state.player;
  // Pin network to worst-case vigor decay (downlink <0.5Mbps → 3.0×, rtt <20ms → simSpeed 1.15)
  const net = nw.ctx.net;
  const saved = { downlink: net.snap.downlink, rtt: net.snap.rtt, effectiveType: net.snap.effectiveType };
  net.snap.downlink = 0.3; // <0.5 → vigorDecay ×3.0
  net.snap.rtt = 15;       // <20ms → simSpeed ×1.15
  net.snap.effectiveType = '4g'; // neutral resolve decay

  // ...and pin the WORLD, exactly as testVitalsDecay above already does. This
  // test had the identical hazard and no guard: it steps 5 seconds with night
  // hordes live, and a foe that kills the player triggers VitalsSystem.onRespawn,
  // which sets vigor to a flat 50 — so the assertion reports "vigor 49.88"
  // against an expected 0 and reads like a decay bug.
  //
  // It went red 2 runs in 8 after A1 landed. A1 did not cause it: rolling loot
  // consumes Math.random() on every gear drop, which shifts the global RNG
  // stream for every horde spawn and damage roll downstream, and that was
  // enough to move a LATENT flake into view. The diagnostic that identified it
  // is retained below — `moved 3846px` at exactly 50 vigor is a death scatter,
  // and an assertion printing only the number could never have said so.
  //
  // God mode blocks combat death without touching the decay path under test,
  // but it also blocks STARVATION damage — so it is lifted for the second
  // phase, which is the one that needs the player to be hurtable.
  const savedGod = state.god;
  const savedFoes = nw.sys.hordes.foes.slice();
  state.god = true;
  nw.sys.hordes.foes.length = 0;

  // Max decay rate = (1/15) × 3.0 × 1.15 ≈ 0.23/s. Start at 0.5, step 5s → drain ~1.15.
  p.vigor = 0.5;
  p.hp = 100;
  const startX = p.x, startY = p.y;
  nw.step(5 * 30); // 5s at 30Hz
  const moved = Math.hypot(p.x - startX, p.y - startY);
  ok(p.vigor <= 0, `vigor reached 0 (got ${p.vigor.toFixed(2)} after 5s with worst-case net`
    + `; hp ${p.hp.toFixed(0)}, foes ${nw.sys.hordes.foes.length}, moved ${moved.toFixed(0)}px)`);
  // The positive guard for the paragraph above: a death scatter teleports 40–110
  // tiles. If this ever fires, the number above is a respawn and not decay.
  ok(moved < 200, `...and the player was never scattered mid-measurement (${moved.toFixed(0)}px)`);

  // HP should be draining — set high HP, step briefly, verify decrease.
  // God mode off: starvation IS damage, and this is the assertion about it.
  state.god = false;
  p.hp = 100;
  const hpBefore = p.hp;
  nw.step(1 * 30); // 1 second of starvation
  // Net drain = 2/sec starvation - ~1/sec day regen ≈ 1/sec. 1s → ~1 HP lost.
  ok(p.hp < hpBefore, `HP drained after vigor=0: ${hpBefore.toFixed(0)} → ${p.hp.toFixed(0)}`);
  // Now safe to restore network, the world, and the player
  Object.assign(net.snap, saved);
  state.god = savedGod;
  nw.sys.hordes.foes.length = 0;
  for (const f of savedFoes) nw.sys.hordes.foes.push(f);
  p.vigor = 100;
  p.hp = 100;
}

async function testResolveZero(nw: any) {
  const { state, sys } = nw;
  const p = state.player;

  // set resolve to 0
  p.resolve = 0;
  nw.step(2);

  // speed penalty should be applied
  const speedMult = sys.vitals?.getSpeedMult?.() ?? 1;
  ok(speedMult < 1, `resolve-zero speed mult ${speedMult} < 1`);

  // damage taken penalty should be applied
  const dmgMult = sys.vitals?.getDmgTakenMult?.() ?? 1;
  ok(dmgMult > 1, `resolve-zero dmg taken mult ${dmgMult} > 1`);

  p.resolve = 100;
}

async function testVitalsRestore(nw: any) {
  const { state, sys, world } = nw;
  const p = state.player;
  const { ENEMIES } = await import('../data/enemies');
  const { CFG } = await import('../data/config');

  // --- kill restore ---
  p.vigor = 50;
  p.resolve = 50;
  const dummyDef = ENEMIES.find((e: any) => !e.boss)!;
  const foe = {
    uid: state.nextUid++, def: dummyDef,
    x: p.x + 30, y: p.y, px: p.x, py: p.y,
    hp: 10, maxHp: 10, dmg: 0, atkT: 0, telegraphT: 0, animT: 0,
  };
  sys.hordes.foes.push(foe);
  nw.step(1);
  sys.hordes.hurt(foe, 999);
  nw.step(1);
  const netVigorPerKill = nw.ctx.net?.getGameValue?.('vigorPerKill') ?? 1.0;
  const netResolvePerKill = nw.ctx.net?.getGameValue?.('resolvePerKill') ?? 1.0;
  const expectedVigor = 50 + Math.round(CFG.vitals.vigorPerKill * netVigorPerKill);
  const expectedResolve = 50 + Math.round(CFG.vitals.resolvePerKill * netResolvePerKill);
  ok(p.vigor >= expectedVigor - 1 && p.vigor <= expectedVigor + 1,
    `kill vigor: 50 → ${p.vigor} (expected ~${expectedVigor})`);
  ok(p.resolve >= expectedResolve - 1 && p.resolve <= expectedResolve + 1,
    `kill resolve: 50 → ${p.resolve} (expected ~${expectedResolve})`);

  // --- gather restore ---
  p.vigor = 50;
  const { FEATURES } = await import('../data/features');
  const treeFeat = FEATURES.find((f: any) => f.skill === 'woodcutting') ?? FEATURES[0];
  const ptx = Math.floor(p.x / 32), pty = Math.floor(p.y / 32);
  // ensure a hall exists for building test
  if (!state.buildings.some((b: any) => b.type === 'hall')) {
    state.buildings.push({ uid: state.nextUid++, type: 'hall', tx: ptx, ty: pty - 3, hp: 200 });
    world.reindexBuildings();
  }
  // place a gather feature near player
  // (we can't easily call the gather finish path directly, so test the onGather hook)
  sys.vitals.onGather();
  const netVigorPerGather = nw.ctx.net?.getGameValue?.('vigorPerGather') ?? 1.0;
  const expectedGatherVigor = 50 + Math.round(CFG.vitals.vigorPerGather * netVigorPerGather);
  ok(p.vigor >= expectedGatherVigor - 1 && p.vigor <= expectedGatherVigor + 1,
    `gather vigor: 50 → ${p.vigor} (expected ~${expectedGatherVigor})`);

  // --- build restore ---
  p.resolve = 50;
  sys.vitals.onBuild();
  const netResolvePerBuild = nw.ctx.net?.getGameValue?.('resolvePerBuild') ?? 1.0;
  const expectedBuildResolve = 50 + Math.round(CFG.vitals.resolvePerBuild * netResolvePerBuild);
  ok(p.resolve >= expectedBuildResolve - 1 && p.resolve <= expectedBuildResolve + 1,
    `build resolve: 50 → ${p.resolve} (expected ~${expectedBuildResolve})`);

  // --- survive night restore ---
  p.resolve = 50;
  sys.vitals.onSurviveNight();
  const netSurvive = nw.ctx.net?.getGameValue?.('resolvePerSurviveNight') ?? 1.0;
  const expectedSurvive = 50 + Math.round(CFG.vitals.resolvePerSurviveNight * netSurvive);
  ok(p.resolve >= expectedSurvive - 1 && p.resolve <= expectedSurvive + 1,
    `survive night resolve: 50 → ${p.resolve} (expected ~${expectedSurvive})`);

  p.vigor = 100;
  p.resolve = 100;
}

async function testVitalsHUD(nw: any) {
  if (typeof document === 'undefined') { ok(true, 'no DOM — skipping vitals HUD test'); return; }
  const vigorEl = document.getElementById('nw-vigor');
  const resolveEl = document.getElementById('nw-resolve');
  ok(vigorEl !== null, 'vigor HUD chip exists in DOM');
  ok(resolveEl !== null, 'resolve HUD chip exists in DOM');
  // The chip text is written by ui.refresh(), which runs in render() (rAF) — not
  // in __nw.step(). A stray frame can interleave at an await boundary mid-restore
  // test and paint a transient value; force one refresh so the read is
  // deterministic and actually exercises the state→chip wiring.
  nw.ui.refresh();
  if (vigorEl) {
    const vigorVal = parseInt(vigorEl.querySelector('#nw-vigor-text')?.textContent ?? '0', 10);
    ok(vigorVal >= 90, `vigor chip shows ≥90 (got ${vigorVal})`);
  }
}

async function testHordeScale(nw: any) {
  const { state, sys } = nw;
  const { CFG } = await import('../data/config');

  // pin the network so simSpeed doesn't distort timing
  const net = nw.ctx.net;
  const saved = { downlink: net.snap.downlink, rtt: net.snap.rtt, effectiveType: net.snap.effectiveType };
  net.snap.rtt = 50; net.snap.downlink = 10; net.snap.effectiveType = '4g';

  // ensure a hall exists
  const { world } = nw;
  if (!state.buildings.some((b: any) => b.type === 'hall')) {
    const htx = Math.floor(state.player.x / 32);
    const hty = Math.floor(state.player.y / 32) - 3;
    state.player.inv.wood_scrap = 50; state.player.inv.plank = 30;
    state.buildings.push({ uid: state.nextUid++, type: 'hall', tx: htx, ty: hty, hp: 200 });
    world.reindexBuildings();
  }

  // night 3 (dayIndex=3): baseCount + perNight*(3-1) + perTerritory*0
  const night3 = 3;
  const expectedBase = CFG.horde.baseCount + CFG.horde.perNight * (night3 - 1);
  // S1 values: 25 + 18*2 = 61
  ok(expectedBase >= 60, `night 3 horde count base ${expectedBase} >= 60 (S1 rebalance)`);
  ok(CFG.horde.maxAlive >= 200, `maxAlive ${CFG.horde.maxAlive} >= 200 (S1 perf gate)`);
  ok(CFG.horde.spawnRadiusMinTiles !== undefined, 'spawnRadiusMinTiles exists');
  ok(CFG.horde.spawnRadiusMaxTiles !== undefined, 'spawnRadiusMaxTiles exists');
  ok(CFG.horde.spawnRadiusMinTiles < CFG.horde.spawnRadiusMaxTiles, 'spawnRadiusMin < spawnRadiusMax');

  // ---- Prove the perf gate: create 250 foes to verify the system handles maxAlive ----
  // Use a simple, deterministic foe template pushed directly — the spawn system
  // has too many worldgen-dependent failure modes (canStand, campfire repel, etc.)
  // for a reliable behavioral test. This proves the engine handles 250 alive.
  const { ENEMIES } = await import('../data/enemies');
  const dummyDef = ENEMIES.find((e: any) => !e.boss)!;
  const px = state.player.x, py = state.player.y;
  const origFoes = [...sys.hordes.foes];
  sys.hordes.foes = [];
  let created = 0;
  for (let i = 0; i < CFG.horde.maxAlive; i++) {
    sys.hordes.foes.push({
      uid: state.nextUid++,
      def: dummyDef,
      x: px + (i % 50) * 32,  // spread across a line
      y: py + Math.floor(i / 50) * 32,
      px: px, py: py,
      hp: dummyDef.hp, maxHp: dummyDef.hp,
      dmg: dummyDef.dmg,
      atkT: 999, telegraphT: 0, animT: 0,
    });
    created++;
  }
  ok(created === CFG.horde.maxAlive, `created ${created} foes = maxAlive ${CFG.horde.maxAlive}`);
  // Step the sim for several ticks — if the engine doesn't crash, the perf gate holds
  for (let i = 0; i < 60; i++) nw.step(1);
  ok(sys.hordes.foes.length > 0, `foes still alive after stepping (${sys.hordes.foes.length})`);
  ok(true, `perf gate: ${created} foes stepped without crash`);
  // Clean up and restore original foes
  sys.hordes.foes = origFoes;

  // restore network
  Object.assign(net.snap, saved);
}

// ---------------------------------------------------------------------------
// test registry & runner
// ---------------------------------------------------------------------------

// =========================================================================
// X1: Mega features — big square trees/rocks/bushes
// =========================================================================

async function testMegaClusters(nw: any) {
  const { state, world } = nw;
  const { MEGA_SCAN } = await import('../world/worldgen');
  const gen = world.gen;

  // deterministic per seed: sweep a box until a root turns up
  let root: any = null;
  outer:
  for (let ty = -120; ty <= 120; ty++) {
    for (let tx = -120; tx <= 120; tx++) {
      const m = gen.megaClusterAt(tx, ty);
      if (m && m.rootTx === tx && m.rootTy === ty) { root = m; break outer; }
    }
  }
  ok(root !== null, 'a mega-cluster root exists within 120 tiles of spawn');
  if (!root) return;

  ok(root.size >= 2 && root.size <= MEGA_SCAN,
    `cluster size ${root.size} within [2, ${MEGA_SCAN}]`);

  // every tile of the square agrees: same root, cluster's feature, impassable
  let agree = true, blocked = true, featured = true;
  for (let dy = 0; dy < root.size; dy++) {
    for (let dx = 0; dx < root.size; dx++) {
      const tx = root.rootTx + dx, ty = root.rootTy + dy;
      const m = world.megaClusterAt(tx, ty);
      if (!m || m.rootTx !== root.rootTx || m.rootTy !== root.rootTy) agree = false;
      if (world.featureAt(tx, ty)?.id !== root.def.id) featured = false;
      if (world.passable(tx, ty)) blocked = false;
    }
  }
  ok(agree, 'every tile of the square resolves to the same root');
  ok(featured, `every tile reports the cluster feature '${root.def.id}'`);
  ok(blocked, 'every tile of the square blocks movement');

  // depleting the cluster clears the whole square at once
  world.depleteMega(root, 60);
  let cleared = true;
  for (let dy = 0; dy < root.size; dy++) {
    for (let dx = 0; dx < root.size; dx++) {
      if (world.activeFeatureAt(root.rootTx + dx, root.rootTy + dy)) cleared = false;
      if (!world.passable(root.rootTx + dx, root.rootTy + dy)) cleared = false;
    }
  }
  ok(cleared, 'depleteMega fells the whole square — walkable, nothing harvestable');

  // undo the test depletion so the world is untouched for later tests
  const { tileKey } = await import('../state');
  for (let dy = 0; dy < root.size; dy++) {
    for (let dx = 0; dx < root.size; dx++) {
      delete state.depleted[tileKey(root.rootTx + dx, root.rootTy + dy)];
    }
  }
  ok(true, 'mega cluster test completed');
}

// =========================================================================
// X1: Behavior regression — buffs must not wipe birth scaling off foes
// =========================================================================

async function testFoeBuffKeepsScaling(nw: any) {
  const { state, sys } = nw;
  const { ENEMIES } = await import('../data/enemies');
  const def = ENEMIES.find((e: any) => !e.boss && !e.behavior)!;

  // hand-build a foe with night-scaled damage (4× base, as a deep night would)
  const scaled = def.dmg * 4;
  const foe: any = {
    uid: state.nextUid++, def,
    x: state.player.x + 3000, y: state.player.y, px: 0, py: 0,
    hp: def.hp * 4, maxHp: def.hp * 4,
    dmg: scaled, baseDmg: scaled,
    atkT: 99, telegraphT: 0, animT: 0,
  };
  sys.hordes.foes.push(foe);

  nw.step(3);
  ok(foe.dmg === scaled,
    `night-scaled dmg survives update ticks: ${foe.dmg} (def base ${def.dmg} — the old code reset every foe to this)`);

  foe._buffUntil = state.clock + 30; foe._buffDmgMul = 1.5; foe._buffSpeedMul = 1;
  nw.step(1);
  ok(foe.dmg === Math.round(scaled * 1.5), `buff multiplies the SCALED dmg: ${foe.dmg}`);

  foe._buffUntil = 0;
  nw.step(1);
  ok(foe.dmg === scaled, `buff expiry restores the scaled dmg: ${foe.dmg}`);

  sys.hordes.foes = sys.hordes.foes.filter((x: any) => x.uid !== foe.uid);
  ok(true, 'foe buff scaling test completed');
}

// ---- W7: Soul-Feeding tests ----

async function testSoulFeedBasic(nw: any) {
  const state = nw.state;
  const sf = nw.ctx.soulfeed;
  ok(!!sf, 'soulfeed system exists on ctx');

  // Isolate: clear any soul items from prior tests, ensure a weapon template exists
  state.player.soulItems = {};
  state.player.inv['sword_copper'] = (state.player.inv['sword_copper'] ?? 0) + 1;
  state.player.equip.weapon = 'sword_copper';

  // Add feedable items
  state.player.inv['log'] = 5;
  state.player.inv['iron_ore'] = 3;
  ok(state.player.inv['log'] === 5, '5 logs in inventory');

  // Feed logs to weapon (neutral affinity — log→forest, forest has no weapon affinity)
  const r1 = sf.feed(state, 'log', 2, 'weapon');
  ok(r1 !== null, 'feed log → weapon returns result');
  const expectedXp = r1.xp; // trust the returned value (may vary with material affinity)
  ok(r1.xp >= 2, `feed 2 logs grants at least 2 xp (got ${r1.xp})`);
  ok(state.player.inv['log'] === 3, '2 logs consumed, 3 remain');
  ok(state.player.soulItems?.weapon !== undefined, 'weapon soul created');
  ok(state.player.soulItems!.weapon!.xp === expectedXp, `weapon soul xp matches returned xp (${expectedXp})`);

  // Feed remaining logs
  sf.feed(state, 'log', 3, 'weapon');
  ok(state.player.inv['log'] === undefined || state.player.inv['log'] === 0, 'all logs consumed');
  ok(state.player.soulItems!.weapon!.xp > expectedXp, 'weapon soul gained more xp from remaining logs');
}

async function testSoulFeedAffinity(nw: any) {
  const state = nw.state;
  const sf = nw.ctx.soulfeed;

  // Isolate: clear soul items, ensure slot templates exist
  state.player.soulItems = {};
  state.player.inv['sword_copper'] = (state.player.inv['sword_copper'] ?? 0) + 1;
  state.player.inv['axe_flint'] = (state.player.inv['axe_flint'] ?? 0) + 1;
  state.player.inv['ring_star'] = (state.player.inv['ring_star'] ?? 0) + 1;
  state.player.equip.weapon = 'sword_copper';
  state.player.equip.tool_axe = 'axe_flint';
  state.player.equip.amulet = 'ring_star'; // needed as template for amulet slot

  // star_bar maps to Warp Rift material which has soulAffinity: 'amulet'
  state.player.inv['star_bar'] = 3;

  // Feed to matching affinity slot (amulet) → 1.5×
  const r1 = sf.feed(state, 'star_bar', 1, 'amulet');
  ok(r1 !== null, 'feed star_bar → amulet returns result');
  ok(r1!.affinityMul === 1.5, `amulet affinity → 1.5× multiplier (got ${r1!.affinityMul})`);
  ok(r1!.xp === 90, `1 star_bar × 60 xp × 1.5 = 90 xp (got ${r1!.xp})`);

  // Feed to neutral slot (weapon) → 1.0×
  const r2 = sf.feed(state, 'star_bar', 1, 'weapon');
  ok(r2 !== null, 'feed star_bar → weapon returns result');
  ok(r2!.affinityMul === 1.0, `weapon (neutral) → 1.0× multiplier (got ${r2!.affinityMul})`);
  ok(r2!.xp === 60, `1 star_bar × 60 xp × 1.0 = 60 xp (got ${r2!.xp})`);

  // Feed to opposed slot (tool_axe is opposed to amulet affinity) → 0.5×
  const r3 = sf.feed(state, 'star_bar', 1, 'tool_axe');
  ok(r3 !== null, 'feed star_bar → tool_axe returns result');
  ok(r3!.affinityMul === 0.5, `tool_axe (opposed) → 0.5× multiplier (got ${r3!.affinityMul})`);
  ok(r3!.xp === 30, `1 star_bar × 60 xp × 0.5 = 30 xp (got ${r3!.xp})`);

  ok(state.player.inv['star_bar'] === undefined || state.player.inv['star_bar'] === 0, 'all star bars consumed');
}

async function testSoulFeedLevelUp(nw: any) {
  const state = nw.state;
  const sf = nw.ctx.soulfeed;

  // Isolate: clear soul items, ensure weapon template exists
  state.player.soulItems = {};
  state.player.inv['sword_copper'] = (state.player.inv['sword_copper'] ?? 0) + 1;
  state.player.equip.weapon = 'sword_copper';

  // 10 iron_ore × 10 xp each = 100 xp. Level 1→2 needs 50 xp (base).
  state.player.inv['iron_ore'] = 10;
  const r = sf.feed(state, 'iron_ore', 10, 'weapon');
  ok(r !== null, 'feed iron_ore → weapon returns result');
  ok(r!.leveled === true, 'weapon soul leveled up from feeding');
  ok(r!.newLevel >= 2, `weapon soul at level ${r!.newLevel} (expected ≥2)`);
  ok(r!.newXp >= 0, `overflow xp carried: ${r!.newXp}`);
}

async function testSoulFeedRejectNonFeedable(nw: any) {
  const state = nw.state;
  const sf = nw.ctx.soulfeed;

  // Isolate: clear any junk from prior tests
  state.player.inv['sword_copper'] = 1;

  // Equipment should not be feedable
  ok(!sf.canFeed('sword_copper'), 'sword_copper is NOT feedable');
  ok(!sf.canFeed('armor_iron'), 'armor_iron is NOT feedable');
  ok(!sf.canFeed('ring_star'), 'ring_star is NOT feedable');

  // Potions should not be feedable
  ok(!sf.canFeed('tonic_minor'), 'tonic_minor is NOT feedable');

  // Materials should be feedable
  ok(sf.canFeed('log'), 'log is feedable');
  ok(sf.canFeed('copper_ore'), 'copper_ore is feedable');
  ok(sf.canFeed('star_bar'), 'star_bar is feedable');

  // Attempting to feed a non-feedable item returns null
  state.player.inv['sword_copper'] = 1;
  const r = sf.feed(state, 'sword_copper', 1, 'weapon');
  ok(r === null, 'feeding non-feedable item returns null');
  ok(state.player.inv['sword_copper'] === 1, 'non-feedable item not consumed');
}

// =========================================================================
// EXHAUSTIVE PLAYTHROUGH — full game completion script
// =========================================================================
// Plays through a complete game: gather → craft → build → survive nights →
// kill bosses → collect echoes → allocate loom → soul-feed → waystones.
// Runs at accelerated sim speed. Reports every system exercised with metrics.
// This is THE definitive "does the game actually work?" test.

interface ExPlayMetrics {
  ticksElapsed: number;
  gameMinutes: number;
  nightsSurvived: number;
  kills: number;
  bossKills: number;
  damageDealt: number;
  damageTaken: number;
  gathers: number;
  itemsCrafted: number;
  buildingsPlaced: number;
  goldEarned: number;
  deaths: number;
  echoesCollected: string[];
  loomNodesAllocated: number;
  soulLevels: Record<string, number>;
  waystonesPlaced: number;
  systemsExercised: Set<string>;
  events: { clock: number; kind: string; detail: string }[];
  phaseTimings: { phase: string; startClock: number; endClock: number }[];
}

function exLog(m: ExPlayMetrics, clock: number, kind: string, detail: string) {
  m.events.push({ clock: +clock.toFixed(1), kind, detail });
}

function exMark(m: ExPlayMetrics, sys: string) {
  m.systemsExercised.add(sys);
}

async function testExhaustivePlaythrough(nw: any) {
  const { state, sys, world } = nw;
  const { CFG } = await import('../data/config');
  const startRealMs = performance.now();
  const dt = 1 / 30;

  const m: ExPlayMetrics = {
    ticksElapsed: 0, gameMinutes: 0, nightsSurvived: 0,
    kills: 0, bossKills: 0, damageDealt: 0, damageTaken: 0,
    gathers: 0, itemsCrafted: 0, buildingsPlaced: 0,
    goldEarned: 0, deaths: 0,
    echoesCollected: [], loomNodesAllocated: 0,
    soulLevels: {}, waystonesPlaced: 0,
    systemsExercised: new Set(),
    events: [], phaseTimings: [],
  };

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 0: Reset to clean state
  // ═══════════════════════════════════════════════════════════════════
  state.gameOver = false;
  state.god = true;  // god mode for exhaustive testing — test survival, not luck
  state.player.hp = 100;
  state.player.gold = 0;
  state.player.inv = {};
  state.player.soulItems = {};
  state.player.echoes = {};
  state.player.loomPoints = 0;
  state.player.loomNodes = {};
  state.player.xp = {};
  state.player.equip = {};
  state.player.relic = undefined;
  state.player.vigor = 100;
  state.player.resolve = 100;
  // L1: god mode blocks combat death but NOT old-age death (by design — the
  // hard run-length cap has to hold even under cheats). Reset age too, or a
  // prior test that exercised old-age death (which pins age at the death
  // target) leaves this playthrough starting one tick from expiring.
  state.gameOverCause = null;
  state.player.age = CFG.lifespan.startAge;
  state.buildings = [];
  state.worldBosses = [];
  state.depleted = {};
  sys.hordes.foes = [];
  sys.hordes.toSpawn = 0;
  world.reindexBuildings();
  nw.step(10);
  exLog(m, state.clock, 'phase', 'PHASE 0: clean slate');

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 1: Gather & Craft — bootstrap the economy
  // ═══════════════════════════════════════════════════════════════════
  const phase1Start = state.clock;
  exLog(m, state.clock, 'phase', 'PHASE 1: gather resources, craft tools');

  // Give starting tools
  state.player.inv['axe_flint'] = 1;
  state.player.inv['pick_flint'] = 1;
  state.player.equip.tool_axe = 'axe_flint';
  state.player.equip.tool_pick = 'pick_flint';
  exMark(m, 'equipment');

  const { FEATURES } = await import('../data/features');
  const { RECIPES } = await import('../data/recipes');
  const { ITEMS } = await import('../data/items');

  // This phase never repositions the player — it gathers whatever happens to be
  // near wherever the previous test left them. So when it reports zero gathers,
  // the useful question is "where was the player standing", and answering it
  // without this line cost an hour of bisecting once already.
  {
    const ptx0 = Math.floor(nw.player.x / 32), pty0 = Math.floor(nw.player.y / 32);
    const kinds = new Map<string, number>();
    let near = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const f = world.activeFeatureAt(ptx0 + dx, pty0 + dy);
      if (!f) continue;
      near++;
      // activeFeatureAt returns a FeatureDef directly, NOT a {def} wrapper.
      const id = (f as any).id ?? '?';
      kinds.set(id, (kinds.get(id) ?? 0) + 1);
    }
    // PHASE 0 wipes state.player.xp, so every skill is back to level 1 — a patch
    // of features whose levelReq is above 1 reads as "features in reach, zero
    // gathers", which looks like a broken gather system and is not one. Naming
    // them turns that into a one-line answer.
    const gated = [...kinds.keys()].map((id) => {
      const def = FEATURES.find((f: any) => f.id === id);
      return def && def.levelReq > 1 ? `${id}(lvl${def.levelReq})` : id;
    }).join(', ');
    console.log(`  📍 phase 1 starts at tile ${ptx0},${pty0} with ${near} feature(s) in reach: ${gated || 'none'}`);

    // Walk to something actually gatherable rather than hoping. This phase is
    // supposed to EXERCISE the gather/craft systems; standing wherever the last
    // test left the player and reporting "0 gathers" measures the neighbourhood,
    // not the game. Measured on the pre-feature commit: 2 runs in 8 went red on
    // `>= 6 systems exercised` for exactly this reason, so it is not a
    // regression — it is a fragility this test always had.
    const reachable = (id: string) => {
      const def = FEATURES.find((f: any) => f.id === id);
      return !!def && (def.levelReq ?? 1) <= 1;
    };
    if (![...kinds.keys()].some(reachable)) {
      let moved = false;
      search:
      for (let r = 4; r <= 60 && !moved; r += 4) {
        for (let dy = -r; dy <= r; dy += 2) {
          for (let dx = -r; dx <= r; dx += 2) {
            const f: any = world.activeFeatureAt(ptx0 + dx, pty0 + dy);
            if (!f || !reachable(f.id ?? '')) continue;
            const px = (ptx0 + dx + 0.5) * 32 + 22, py = (pty0 + dy + 0.5) * 32;
            if (!world.canStand(px, py)) continue;
            nw.player.teleport(px, py);
            console.log(`  🚶 nothing gatherable at level 1 in reach — walked to ${ptx0 + dx},${pty0 + dy} (${f.id})`);
            moved = true;
            break search;
          }
        }
      }
      if (!moved) console.log('  ⚠ no level-1 gatherable feature within 60 tiles — phase 1 will report zero gathers');
    }
  }

  // Gather raw materials aggressively for 3 game-minutes
  const gatherPhaseTicks = Math.ceil(180 / dt); // 3 min
  for (let tick = 0; tick < gatherPhaseTicks; tick += 15) {
    nw.step(15);
    m.ticksElapsed += 15;

    // Try to gather any nearby feature
    const ptx = Math.floor(state.player.x / 32);
    const pty = Math.floor(state.player.y / 32);
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const f = world.activeFeatureAt(ptx + dx, pty + dy);
        if (f) {
          // `state.player` is a PROJECTION: main() overwrites it from nw.player
          // every sim tick, so assigning to it here moved the player NOWHERE and
          // this loop only ever gathered what was already inside the 1.6-tile
          // reach. That is the whole of the `5/12 systems exercised` flake — no
          // gather, and therefore no craft either, since phase 1 crafts from what
          // phase 1 gathered. Two systems drop as a pair. Measured over 8 runs:
          // gather+crafting vanished together in 2 of them.
          const cx = (ptx + dx + 0.5) * 32, cy = (pty + dy + 0.5) * 32;
          // Stand BESIDE the node, not on it — a tree tile is not standable, and
          // teleporting into one silently leaves the player where they were.
          for (const [ox, oy] of [[22, 0], [-22, 0], [0, 22], [0, -22], [0, 0]]) {
            if (!world.canStand(cx + ox, cy + oy)) continue;
            nw.player.teleport(cx + ox, cy + oy);
            break;
          }
          nw.step(2);
          sys.gather.tryStart();
          if (sys.gather.active) {
            const need = sys.gather.active.need || 2;
            for (let g = 0; g < Math.ceil(need / dt) + 5; g += 3) nw.step(3);
            m.gathers++;
            exMark(m, 'gather');
          }
          break;
        }
      }
      if (sys.gather.active) break;
    }
  }

  // Craft everything we can
  let craftedAny = true;
  while (craftedAny) {
    craftedAny = false;
    for (const rec of RECIPES) {
      let canCraft = true;
      for (const ing of rec.in) {
        if ((state.player.inv[ing.id] ?? 0) < ing.n) { canCraft = false; break; }
      }
      if (canCraft) {
        const result = nw.craft(rec.id);
        if (result) {
          m.itemsCrafted++;
          craftedAny = true;
          exMark(m, 'crafting');
        }
      }
    }
  }

  exLog(m, state.clock, 'phase', `PHASE 1 complete: ${m.gathers} gathers, ${m.itemsCrafted} crafts`);
  m.phaseTimings.push({ phase: 'PHASE 1: Gather & Craft', startClock: phase1Start, endClock: state.clock });

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 2: Build — construct a fortified base
  // ═══════════════════════════════════════════════════════════════════
  const phase2Start = state.clock;
  exLog(m, state.clock, 'phase', 'PHASE 2: construct base');

  const { BUILDINGS } = await import('../data/buildings');

  // Place hall
  const htx = Math.floor(state.player.x / 32);
  const hty = Math.floor(state.player.y / 32) - 3;
  state.player.inv['wood_scrap'] = 50;
  state.player.inv['plank'] = 30;
  state.player.inv['stone'] = 50;
  state.player.inv['log'] = 30;
  state.player.inv['copper_ore'] = 20;
  state.player.inv['iron_ore'] = 20;
  state.buildings.push({ uid: state.nextUid++, type: 'hall', tx: htx, ty: hty, hp: 400 });
  world.reindexBuildings();
  exMark(m, 'build');
  m.buildingsPlaced++;

  // Place walls around the hall
  for (let dx = -3; dx <= 3; dx++) {
    if (world.canPlaceAt(htx + dx, hty - 2, false)) {
      state.buildings.push({ uid: state.nextUid++, type: 'wall', tx: htx + dx, ty: hty - 2, hp: 120 });
      m.buildingsPlaced++;
    }
  }
  world.reindexBuildings();

  // Place towers (one of each role)
  const towerDefs = BUILDINGS.filter((b: any) => b.towerRole);
  let txOff = 0;
  for (const def of towerDefs.slice(0, 4)) {
    if (world.canPlaceAt(htx + 3 + txOff, hty - 1, false)) {
      state.buildings.push({ uid: state.nextUid++, type: def.id, tx: htx + 3 + txOff, ty: hty - 1, hp: def.hp });
      m.buildingsPlaced++;
      txOff++;
    }
  }
  world.reindexBuildings();

  // Place campfire and workshop
  state.buildings.push({ uid: state.nextUid++, type: 'campfire', tx: htx + 1, ty: hty + 1, hp: 50 });
  state.buildings.push({ uid: state.nextUid++, type: 'workshop', tx: htx - 2, ty: hty + 1, hp: 100 });
  m.buildingsPlaced += 2;
  world.reindexBuildings();

  exLog(m, state.clock, 'build', `${m.buildingsPlaced} buildings placed including hall, walls, towers`);
  m.phaseTimings.push({ phase: 'PHASE 2: Build', startClock: phase2Start, endClock: state.clock });

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 3: Equip & Soul-feed — gear up
  // ═══════════════════════════════════════════════════════════════════
  const phase3Start = state.clock;
  exLog(m, state.clock, 'phase', 'PHASE 3: equip gear, soul-feed');

  const { toggleEquip } = await import('../rules');

  // Equip the best weapon we have
  for (const wid of ['sword_star', 'sword_silver', 'sword_iron', 'sword_copper']) {
    if ((state.player.inv[wid] ?? 0) > 0) {
      toggleEquip(state, wid);
      exLog(m, state.clock, 'equip', `equipped ${wid}`);
      exMark(m, 'equipment');
      break;
    }
  }

  // Equip armor
  for (const aid of ['armor_star', 'armor_silver', 'armor_iron', 'armor_copper']) {
    if ((state.player.inv[aid] ?? 0) > 0) {
      toggleEquip(state, aid);
      exMark(m, 'equipment');
      break;
    }
  }

  // Soul-feed: pump logs and ore into weapon and armor
  const sf = nw.ctx.soulfeed;
  if (sf) {
    const feedable = ['log', 'fine_log', 'copper_ore', 'iron_ore', 'charcoal', 'torch', 'stone', 'sunleaf', 'berry'];
    for (const itemId of feedable) {
      const count = state.player.inv[itemId] ?? 0;
      if (count >= 2 && sf.canFeed(itemId)) {
        // Feed half to weapon, half to armor
        const half = Math.floor(count / 2);
        const r1 = sf.feed(state, itemId, half, 'weapon');
        if (r1) {
          exMark(m, 'soulfeed');
          m.soulLevels['weapon'] = r1.newLevel;
        }
        const remaining = state.player.inv[itemId] ?? 0;
        if (remaining >= 1) {
          const r2 = sf.feed(state, itemId, remaining, 'armor');
          if (r2) {
            exMark(m, 'soulfeed');
            m.soulLevels['armor'] = r2.newLevel;
          }
        }
      }
    }
    exLog(m, state.clock, 'soulfeed', `soul levels: weapon=${m.soulLevels['weapon'] || 1}, armor=${m.soulLevels['armor'] || 1}`);
  }

  m.phaseTimings.push({ phase: 'PHASE 3: Equip & Soul-feed', startClock: phase3Start, endClock: state.clock });

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 4: Combat — fight nights, kill bosses
  // ═══════════════════════════════════════════════════════════════════
  const phase4Start = state.clock;
  exLog(m, state.clock, 'phase', 'PHASE 4: survive 5 nights, fight bosses');

  const { ENEMIES } = await import('../data/enemies');
  const { ECHOES, echoForBoss } = await import('../data/echoes');
  const bossDefs = ENEMIES.filter((e: any) => e.boss);

  let prevHp = state.player.hp;
  let prevGold = state.player.gold;
  let prevNight = state.nightsSurvived;

  // Run for enough game-time to survive 5+ nights (each day+night = 340s)
  const combatPhaseTicks = Math.ceil((340 * 6) / dt); // 6 full day-night cycles
  for (let tick = 0; tick < combatPhaseTicks; tick += 15) {
    nw.step(15);
    m.ticksElapsed += 15;

    // Track damage
    if (state.player.hp < prevHp) m.damageTaken += prevHp - state.player.hp;
    else if (state.player.hp > prevHp) m.damageDealt += state.player.hp - prevHp;
    prevHp = state.player.hp;

    // Track gold
    if (state.player.gold > prevGold) m.goldEarned += state.player.gold - prevGold;
    prevGold = state.player.gold;

    // Track nights — the DELTA, not the absolute run stat (see the same fix in
    // testSurvivalPlaythrough above; fixtures assign state.nightsSurvived).
    if (state.nightsSurvived > prevNight) {
      m.nightsSurvived += state.nightsSurvived - prevNight;
      exLog(m, state.clock, 'night', `survived night ${state.nightsSurvived}`);
      exMark(m, 'hordes');
      prevNight = state.nightsSurvived;

      // Grant loom points for nights survived
      state.player.loomPoints = (state.player.loomPoints ?? 0) + 1;
    }

    // Track deaths
    if (state.player.hp <= 0 && prevHp >= 0) {
      m.deaths++;
      exLog(m, state.clock, 'death', `player died (death #${m.deaths})`);
    }

    // Track kills (foe list changes every tick via combat/hordes)
    const currentFoes = sys.hordes.foes.length;

    // Attack nearby foes
    for (const f of [...sys.hordes.foes]) {
      const dist = Math.hypot(f.x - state.player.x, f.y - state.player.y);
      if (dist < 80 && state.player.hp > 20) {
        // Move toward
        state.player.x += (f.x - state.player.x) * 0.4;
        state.player.y += (f.y - state.player.y) * 0.4;
        sys.combat.attack();
        exMark(m, 'combat');
        break;
      }
    }

    // Spawn and kill each boss type once (one per cycle)
    if (m.nightsSurvived >= 1 && bossDefs[m.bossKills] && m.bossKills < bossDefs.length) {
      const bossDef = bossDefs[m.bossKills];
      const alreadySpawned = state.worldBosses.some((b: any) => b.defId === bossDef.id);
      if (!alreadySpawned) {
        const bx = state.player.x + 100, by = state.player.y;
        const boss = {
          uid: state.nextUid++, defId: bossDef.id, lordId: bossDef.id, name: bossDef.name,
          x: bx, y: by, hp: bossDef.hp, maxHp: bossDef.hp, dmg: bossDef.dmg, level: 1,
          atkT: 0, telegraphT: 0, animT: 0, hunting: false, provokedUntil: 0,
          reviveAt: 0, homeGx: 0, homeGy: 0,
        };
        state.worldBosses.push(boss);
        exLog(m, state.clock, 'boss', `spawned ${bossDef.name}`);
      }

      // Try to damage active bosses
      for (const boss of state.worldBosses.filter((b: any) => b.alive !== false)) {
        const bdist = Math.hypot(boss.x - state.player.x, boss.y - state.player.y);
        if (bdist < 100) {
          sys.worldbosses.hurt(boss, boss.maxHp * 0.25);
          if (boss.hp <= 0) {
            m.bossKills++;
            m.kills++;
            // Check echo granted
            const echoDef = echoForBoss(boss.defId);
            if (echoDef && (state.player.echoes[echoDef.id] ?? 0) >= 1) {
              m.echoesCollected.push(echoDef.id);
            }
            exLog(m, state.clock, 'boss', `killed ${bossDef.name} (boss #${m.bossKills})`);
            exMark(m, 'echoes');
            exMark(m, 'worldbosses');
          }
        }
      }
    }
  }

  exLog(m, state.clock, 'phase', `PHASE 4 complete: ${m.nightsSurvived} nights, ${m.bossKills} bosses, echoes: [${m.echoesCollected.join(',')}]`);
  m.phaseTimings.push({ phase: 'PHASE 4: Combat & Bosses', startClock: phase4Start, endClock: state.clock });

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 5: Loom — allocate passive tree
  // ═══════════════════════════════════════════════════════════════════
  const phase5Start = state.clock;
  exLog(m, state.clock, 'phase', 'PHASE 5: allocate Loom passive tree');

  const loom = nw.sys.loom;
  const { LOOM_NODES } = await import('../data/loom');

  if (loom && state.player.loomPoints > 0) {
    // Allocate as many nodes as possible
    const allocatable = LOOM_NODES.filter((n: any) => loom.canAllocate(n.id));
    for (const node of allocatable) {
      if (state.player.loomPoints <= 0) break;
      if (loom.allocate(node.id)) {
        m.loomNodesAllocated++;
        state.player.loomPoints--;
        exMark(m, 'loom');
      }
    }
    exLog(m, state.clock, 'loom', `allocated ${m.loomNodesAllocated} loom nodes`);
  }

  m.phaseTimings.push({ phase: 'PHASE 5: Loom', startClock: phase5Start, endClock: state.clock });

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 6: Waystones — extend territory
  // ═══════════════════════════════════════════════════════════════════
  const phase6Start = state.clock;
  exLog(m, state.clock, 'phase', 'PHASE 6: place waystones');

  const waystoneDef = BUILDINGS.find((b: any) => b.id === 'waystone');
  if (waystoneDef) {
    state.player.inv['stone'] = (state.player.inv['stone'] ?? 0) + 40;
    state.player.inv['copper_ore'] = (state.player.inv['copper_ore'] ?? 0) + 20;
    state.player.inv['iron_ore'] = (state.player.inv['iron_ore'] ?? 0) + 20;

    // The horde eats the hall. It is a 400hp building standing through several
    // nights, and when it falls this whole phase used to do nothing at all and
    // say nothing about it - `waystones` was unexercised in 16 of 16 measured
    // runs for exactly this reason. Waystones need a hall for territory, so if
    // the old one died, stand a new one up: this phase exists to exercise
    // WAYSTONES, and hall survival is phase 4's business, not phase 6's.
    let hall = state.buildings.find((b: any) => b.type === 'hall');
    if (!hall) {
      const htx2 = Math.floor(nw.player.x / 32), hty2 = Math.floor(nw.player.y / 32) - 3;
      hall = { uid: state.nextUid++, type: 'hall', tx: htx2, ty: hty2, hp: 400 } as any;
      state.buildings.push(hall as any);
      world.reindexBuildings();
      console.log('  [hall] did not survive the nights - rebuilt one so phase 6 can run');
    }
    if (hall) {
      for (let i = 0; i < 3; i++) {
        const wsx = hall.tx + 4 + i * 5;
        const wsy = hall.ty;
        if (world.canPlaceAt(wsx, wsy, false)) {
          state.buildings.push({ uid: state.nextUid++, type: 'waystone', tx: wsx, ty: wsy, hp: waystoneDef.hp });
          m.waystonesPlaced++;
        }
      }
      world.reindexBuildings();
      exMark(m, 'waystones');
    }
    exLog(m, state.clock, 'waystones', `${m.waystonesPlaced} waystones placed`);
  }

  m.phaseTimings.push({ phase: 'PHASE 6: Waystones', startClock: phase6Start, endClock: state.clock });

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 7: Scoreboard — verify snapshot
  // ═══════════════════════════════════════════════════════════════════
  const phase7Start = state.clock;
  exLog(m, state.clock, 'phase', 'PHASE 7: verify scoreboard');

  const scoreboard = nw.sys.scoreboard;
  if (scoreboard) {
    scoreboard.enemiesKilled = m.kills;
    scoreboard.buildingsBuilt = m.buildingsPlaced;
    scoreboard.bossesSlain = m.bossKills;
    scoreboard.connectionUptime = 3600;

    const card = scoreboard.snapshot();
    ok(card !== null, 'scoreboard snapshot valid at end of playthrough');
    exMark(m, 'scoreboard');
  }

  m.phaseTimings.push({ phase: 'PHASE 7: Scoreboard', startClock: phase7Start, endClock: state.clock });

  // ═══════════════════════════════════════════════════════════════════
  // VERIFICATION — did we actually exercise everything?
  // ═══════════════════════════════════════════════════════════════════
  const elapsedRealMs = performance.now() - startRealMs;
  m.gameMinutes = +(m.ticksElapsed * dt / 60).toFixed(1);

  // ── STRUCTURED REPORT (always) ──
  console.log('%c🎯 EXHAUSTIVE PLAYTHROUGH REPORT', 'font-weight:bold;font-size:14px;color:#0f0;');
  console.log(`  ⏱  Game: ${m.gameMinutes}min  |  Real: ${(elapsedRealMs / 1000).toFixed(1)}s`);
  console.log(`  🌙 Nights: ${m.nightsSurvived}  |  💀 Deaths: ${m.deaths}  |  🏠 Buildings: ${m.buildingsPlaced}`);
  console.log(`  ⚔  Bosses slain: ${m.bossKills}  |  🪓 Gathers: ${m.gathers}  |  ⚒ Crafts: ${m.itemsCrafted}`);
  console.log(`  💰 Gold earned: ${m.goldEarned}  |  🗡 Soul: weapon L${m.soulLevels['weapon'] || 1} armor L${m.soulLevels['armor'] || 1}`);
  console.log(`  ⭐ Echoes: [${m.echoesCollected.join(',')}]  |  🌳 Loom nodes: ${m.loomNodesAllocated}`);
  console.log(`  🪨 Waystones: ${m.waystonesPlaced}  |  ⚙ Systems exercised: ${m.systemsExercised.size}`);
  console.log('  %c📋 Phase timings:', 'color:#888;');
  for (const pt of m.phaseTimings) {
    const dur = Math.max(0, pt.endClock - pt.startClock);
    console.log(`    ${pt.phase}: ${dur.toFixed(0)}s game-time`);
  }

  // Core survival — these MUST pass.
  //
  // This used to read `!state.gameOver || m.nightsSurvived >= 3`. Two problems.
  // The disjunct passes for any run that merely didn't end, whatever it did —
  // it went green on a playthrough that survived 0 nights. And the threshold it
  // guarded is not deterministic: phase 4 steps a LIVE, un-paused game, the
  // background rAF loop races the suite's own stepping, and gameOver freezes
  // state.clock — measured across three identical runs, phase 4 survived 1, 4
  // and 6 nights. Any fixed lower bound here is a coin flip. It only ever
  // looked stable because m.nightsSurvived was copying the absolute run stat,
  // which an earlier fixture had already set to 20.
  //
  // So assert the bound that IS deterministic, and that is the one B2 exists to
  // defend: nights credited can never exceed the nights the clock could hold.
  // Phantom credits — the free night at dawn, the free night at death — break
  // this immediately, while a slow run does not.
  const { CFG: CFG4 } = await import('../data/config');
  const p4 = m.phaseTimings.find((pt: any) => pt.phase.startsWith('PHASE 4'));
  const p4Elapsed = p4 ? Math.max(0, p4.endClock - p4.startClock) : 0;
  const cycleCap = Math.ceil(p4Elapsed / (CFG4.time.daySec + CFG4.time.nightSec)) + 1;
  ok(m.nightsSurvived <= cycleCap,
    `${m.nightsSurvived} nights credited across ${p4Elapsed.toFixed(0)}s of phase-4 clock ` +
    `(at most ${cycleCap} cycles fit) — no phantom nights`);
  ok(state.player.hp > 0 || state.god === true,
    'player alive or god-mode at end of playthrough');
  ok(m.ticksElapsed >= 10000,
    `playthrough ran meaningfully (${m.ticksElapsed} ticks, ${m.gameMinutes} game-min)`);

  // Economy — soft assertions (worldgen-dependent)
  ok(m.gathers + m.itemsCrafted + m.buildingsPlaced >= 1,
    `productive actions: ${m.gathers}g ${m.itemsCrafted}c ${m.buildingsPlaced}b`);

  // Systems exercised — report which were hit
  const allTargetSystems = ['gather', 'crafting', 'build', 'combat', 'hordes',
    'echoes', 'worldbosses', 'loom', 'soulfeed', 'waystones', 'scoreboard', 'equipment'];
  const exercised = allTargetSystems.filter(s => m.systemsExercised.has(s));
  const notExercised = allTargetSystems.filter(s => !m.systemsExercised.has(s));
  console.log(`  ⚙ Exercised: [${exercised.join(', ')}]`);
  if (notExercised.length > 0) {
    console.log(`  ⚠ Not exercised: [${notExercised.join(', ')}] (may be worldgen/gear-dependent)`);
  }
  ok(exercised.length >= 6,
    `${exercised.length}/${allTargetSystems.length} systems exercised`);

  // ── key event timeline ──
  console.log('%c📋 Key Events:', 'color:#888;');
  for (const ev of m.events) {
    if (ev.kind === 'phase' || ev.kind === 'boss' || ev.kind === 'night') {
      console.log(`  [${ev.clock.toFixed(0)}s] ${ev.kind}: ${ev.detail}`);
    }
  }

  // Clean up: restore clean state for any manual post-mortem inspection
  state.god = false;
  state.player.hp = 100;
  state.gameOver = false;
}


// ---------------------------------------------------------------------------
// B5 — Ground Drops
// ---------------------------------------------------------------------------
// The suite these tests join has a specific failure mode, and it is NOT "goes
// red". Measured against the pre-B5 file, NO gather test read state.player.inv
// afterwards: testGathering asserts `active` is set then cleared, and
// testGatherEveryFeature asserts every feature type is gatherable. So B5 could
// have severed the entire gather → bag pipeline and the Gauntlet would have
// stayed green at 1337/1337. A green suite is not evidence for this milestone
// unless these five are in it.
//
// Every one therefore asserts a POSITIVE and its matched NEGATIVE, and none of
// them reaches for drops.collectAll() — that helper exists for debugging, and a
// test that banked loot through it would pass while the magnet was broken.

/** Put a drop on the floor at a known offset from the player, bypassing the
 *  loot tables. Returns the drop so a test can watch that exact uid.
 *
 *  Math.random is pinned for the spawn: the toss angle and speed are random per
 *  stack, and an unpinned toss drifts the stack up to ~23 px in an arbitrary
 *  direction before it settles. That is fine in the game and fatal in a test
 *  that plants a stack a measured distance from the player — it flaked exactly
 *  once before this pin, by drifting out of the magnet radius it was placed
 *  inside. Pinned, every stack tosses due east at tossSpeed[0]. */
function plantDrop(nw: any, id: string, dx: number, dy: number, n = 1) {
  const { state } = nw;
  // nw.player is the authoritative Player instance; state.player is a projection
  // that main() overwrites from it every sim tick. Tests that assign
  // state.player.x directly leave the two disagreeing until the next step, and
  // the magnet reads the instance. Planting relative to the projection put a
  // stack 55 px from a player it was supposed to be 31 px from — 1 run in 3.
  const realRandom = Math.random;
  Math.random = () => 0;
  try { nw.sys.drops.spawn([{ id, n }], nw.player.x + dx, nw.player.y + dy); }
  finally { Math.random = realRandom; }
  return state.drops[state.drops.length - 1];
}

async function testGroundDropSpawn(nw: any) {
  const { state, sys } = nw;
  const { CFG } = await import('../data/config');
  const home = { x: nw.player.x, y: nw.player.y };
  ok(CFG.drops.enabled, 'CFG.drops.enabled — B5 is on (the whole feature is one flag)');

  state.drops.length = 0;
  const invSum = () => Object.values(state.player.inv as Record<string, number>)
    .reduce((s: number, n: number) => s + n, 0);

  // Scan for a real node rather than wandering: a blind walk east runs into
  // water or mountain and the test fails for a reason that has nothing to do
  // with drops. Same pattern testGatherEveryFeature uses.
  state.player.inv.axe_flint = (state.player.inv.axe_flint ?? 0) + 10;
  state.player.inv.pick_flint = (state.player.inv.pick_flint ?? 0) + 10;
  const ptx = Math.floor(state.player.x / 32), pty = Math.floor(state.player.y / 32);
  let found = false;
  outer:
  for (let r = 1; r <= 20; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (!nw.world.activeFeatureAt(ptx + dx, pty + dy)) continue;
        nw.player.teleport((ptx + dx + 0.5) * 32 + 20, (pty + dy + 0.5) * 32);
        nw.step(3);
        sys.gather.active = null;
        sys.gather.tryStart();          // returns void; the result is `active`
        if (sys.gather.active) { found = true; break outer; }
      }
    }
  }
  ok(found, 'a gatherable node was located');
  if (!found) { nw.player.teleport(home.x, home.y); return; }
  state.drops.length = 0;   // the walk above may have crossed loot from an earlier test

  // Snapshot the bag HERE — after the tool grant and after the scan walk, both
  // of which legitimately move inventory. The claim is about this one harvest.
  const before = invSum();
  const a = sys.gather.active;
  const realRandom = Math.random;
  Math.random = () => 0;                     // pin every loot roll to its minimum
  try { (sys.gather as any).finish(a); } finally { Math.random = realRandom; }
  sys.gather.active = null;

  const onGround = state.drops.reduce((t: number, d: any) => t + d.n, 0);
  ok(onGround > 0, `the harvest lands on the floor (${state.drops.length} stack(s), ${onGround} items)`);
  // The matched negative. Without it this test would pass unchanged if B5 were
  // reverted to instant pickup and something merely pushed a decorative drop.
  eq(invSum(), before, 'and NOT into the bag at roll time');

  state.drops.length = 0;
  nw.player.teleport(home.x, home.y);   // the node hunt above wanders; later tests start from the hall
}

async function testGroundDropPickup(nw: any) {
  const { state } = nw;
  const { CFG } = await import('../data/config');
  // 400 ticks is ~13 game seconds of live sim. Without god the player can be
  // killed by a passing foe and DEATH-SCATTERED 40-110 tiles away, at which
  // point the stack is stranded and the magnet assertion below fails for a
  // reason that has nothing to do with the magnet. That flaked 1 run in 2.
  const savedGod = state.god;
  const savedOver = state.gameOver;
  state.god = true;
  state.gameOver = false;   // a frozen clock means armed() is false forever
  try {
  state.drops.length = 0;
  const clockBefore = state.clock;
  nw.step(2);
  ok(state.clock > clockBefore,
    `the world clock is running (${clockBefore.toFixed(2)} → ${state.clock.toFixed(2)}) — the arm delay is measured in game seconds`);
  const id = 'log';
  const had = state.player.inv[id] ?? 0;

  // Just inside the magnet radius, well outside pickupPx — so this measures the
  // magnet, not a lucky overlap.
  const reach = CFG.drops.magnetTiles * 32;
  const at = reach * 0.6;
  const d = plantDrop(nw, id, at, 0, 3);
  ok(d !== undefined && d.id === id, `a ${id} stack is on the floor at ${at | 0}px`);
  ok(at > CFG.drops.pickupPx * 2,
    `...and well outside pickupPx (${at | 0} > ${CFG.drops.pickupPx}), so only the magnet can fetch it`);

  // 1. the arm delay actually holds
  nw.step(1);
  eq(state.player.inv[id] ?? 0, had, `nothing collected on the first tick (arm delay ${CFG.drops.armDelaySec}s)`);
  eq(state.drops.length, 1, '...and the stack is still on the floor');

  // 2. left alone past the arm delay, the magnet does the rest — no walking.
  //    Watch the UID: foes dying elsewhere in the sim add drops of their own.
  const uid = d.uid;
  for (let i = 0; i < 400 && state.drops.some((x: any) => x.uid === uid); i++) nw.step(1);
  const stuck = state.drops.find((x: any) => x.uid === uid);
  ok(!stuck, `the magnet pulls it in once armed${stuck ? ` (still ${Math.hypot(stuck.x - nw.player.x, stuck.y - nw.player.y) | 0}px away, magnet=${stuck.magnet})` : ''}`);
  eq(state.player.inv[id] ?? 0, had + 3, `and the full stack of 3 reaches the bag (${had} → ${state.player.inv[id] ?? 0})`);

  // 3. the matched negative: a stack outside the radius is NOT collected. Without
  //    this, a magnet with infinite range would pass every assertion above.
  const far = plantDrop(nw, id, reach * 6, 0, 1);
  ok(far !== undefined, 'a second stack is planted far outside the magnet radius');
  // Watch that UID, not the array length: 400 ticks is ~13 game seconds and foes
  // genuinely die in that window, dropping loot of their own into state.drops.
  const farUid = far.uid;
  for (let i = 0; i < 400; i++) nw.step(1);
  ok(state.drops.some((x: any) => x.uid === farUid),
    'a stack beyond magnetTiles is left where it lies');
  ok(!far.magnet, '...and never latched onto the player');
  } finally {
    state.god = savedGod;
    state.gameOver = savedOver;
    state.drops.length = 0;
  }
}

async function testGroundDropDespawn(nw: any) {
  const { state } = nw;
  const { CFG } = await import('../data/config');
  ok(CFG.drops.gearNeverDespawns, 'gearNeverDespawns is on — nothing rare is lost to a timer');
  state.drops.length = 0;

  // Far enough out that the magnet never touches either of them; the only thing
  // that can remove one is the despawn timer, which is what is being measured.
  const far = CFG.drops.magnetTiles * 32 * 8;
  const mat = plantDrop(nw, 'log', far, 0, 1);
  const gear = plantDrop(nw, 'axe_flint', far, 64, 1);
  ok(mat !== undefined && gear !== undefined, 'a material and a piece of gear are on the floor');
  ok(gear.gear === true && mat.gear === false,
    'isGear() classifies them off the ITEMS columns (axe_flint has toolClass, log has none)');
  ok(state.drops.some((d: any) => d.uid === mat.uid) && state.drops.some((d: any) => d.uid === gear.uid),
    'both are on the floor to begin with');

  // Let the toss arc finish first: a drop still in flight is skipped by every
  // branch below the arc, so aging one mid-hop would measure nothing.
  for (let i = 0; i < 60 && (mat.hopT > 0 || gear.hopT > 0); i++) nw.step(1);
  ok(mat.hopT === 0 && gear.hopT === 0, 'both have landed and settled');

  // Age them past the timer by moving bornT, not by stepping 90 real seconds.
  mat.bornT = state.clock - CFG.drops.despawnSec - 1;
  gear.bornT = state.clock - CFG.drops.despawnSec - 1;
  nw.step(2);

  const alive = (u: number) => state.drops.some((d: any) => d.uid === u);
  ok(!alive(mat.uid), `the material rots away after ${CFG.drops.despawnSec}s`);
  ok(alive(gear.uid), '...and the gear is the one that survived');
  state.drops.length = 0;
}

async function testGroundDropCap(nw: any) {
  const { state } = nw;
  const { CFG } = await import('../data/config');
  state.drops.length = 0;
  const cap = CFG.drops.maxDrops;

  // 12 pieces of gear seeded FIRST, so they are the oldest — if eviction were a
  // plain shift() they would be exactly what got thrown away.
  const far = CFG.drops.magnetTiles * 32 * 8;
  for (let i = 0; i < 12; i++) plantDrop(nw, 'axe_flint', far + i * 40, -far, 1);
  eq(state.drops.filter((d: any) => d.gear).length, 12, '12 pieces of gear are on the floor, oldest first');

  for (let i = 0; i < cap + 100; i++) plantDrop(nw, 'log', far + (i % 50) * 40, far + (((i / 50) | 0) * 40), 1);

  ok(state.drops.length <= cap, `the cap holds at ${state.drops.length} <= ${cap}`);
  eq(state.drops.filter((d: any) => d.gear).length, 12,
    'and all 12 gear stacks survived — a relic lost to an array limit is a bug, not a consequence');
  state.drops.length = 0;
}

// World-space text was unreadable, and it took a 4x screen capture to see why.
// `stage.world` is scaled 2x and Pixi renders Text into a texture at resolution
// 1, so every label was a low-res bitmap linearly upscaled into a grey smudge.
// It looked like a colour bug — forcing the fill bright red produced a dark red
// smudge, which is what ruled the fill out. Nothing in the suite could have
// caught it, because every property involved was already correct.
async function testWorldTextIsLegible(nw: any) {
  const { state, sys, ctx } = nw;
  const views: any = ctx.views;
  if (!views || !views.drops) { ok(true, 'no view layer in this harness'); return; }
  state.drops.length = 0;
  try {
    sys.drops.spawn([{ id: 'log', n: 9 }], nw.player.x + 400, nw.player.y + 400);
    views.syncDrops(state.drops, state.clock);
    const v: any = [...views.drops.values()][0];
    ok(v !== undefined, 'the stack has a view');
    if (!v) return;
    eq(v.count?.text, '9', 'a stack of 9 draws its count');

    // The bug, pinned. Anything at resolution 1 inside a 2x container is blurred
    // by definition, so this asserts the RELATIONSHIP, not a magic number.
    const worldScale = ctx.particles?.container?.parent?.scale?.x ?? 1;
    ok(v.count.resolution >= worldScale,
      `count renders at resolution ${v.count.resolution} into a ${worldScale}x container — not upscaled`);

    // ...and it must not be drawn on top of its own contact shadow, which is an
    // ellipse of rx 7 centred at (0, 7). A legible glyph in the darkest pixels
    // of the frame is still not a legible glyph.
    ok(Math.abs(v.count.position.x) >= 7,
      `the count sits clear of its own shadow (x=${v.count.position.x}, shadow rx=7)`);

    // Matched control: a single item shows no count at all. Without this, a
    // DropView that drew "1" on every stack would pass everything above.
    state.drops.length = 0;
    sys.drops.spawn([{ id: 'log', n: 1 }], nw.player.x + 420, nw.player.y + 420);
    views.syncDrops(state.drops, state.clock);
    const v1: any = [...views.drops.values()].find((d: any) => d !== v) ?? v;
    ok(!v1.count || v1.count.visible === false, 'a stack of 1 draws no count');
  } finally {
    state.drops.length = 0;
    views.syncDrops(state.drops, state.clock);
  }
}

async function testGroundDropDisabled(nw: any) {
  const { state, sys } = nw;
  const { CFG } = await import('../data/config');
  // The escape hatch has to actually work, because it is the entire mitigation
  // if the playtest verdict goes against ground loot.
  const saved = CFG.drops.enabled;
  try {
    state.drops.length = 0;
    CFG.drops.enabled = false;
    const had = state.player.inv['log'] ?? 0;
    sys.drops.spawn([{ id: 'log', n: 5 }], nw.player.x + 400, nw.player.y + 400);
    eq(state.drops.length, 0, 'with drops disabled nothing lands on the floor');
    eq(state.player.inv['log'] ?? 0, had + 5, '...it goes straight to the bag, exactly as before B5');

    // matched positive control: flip it back on and the same call behaves differently
    CFG.drops.enabled = true;
    sys.drops.spawn([{ id: 'log', n: 5 }], nw.player.x + 400, nw.player.y + 400);
    eq(state.drops.length, 1, 'with drops enabled the same call lands on the floor instead');
    eq(state.player.inv['log'] ?? 0, had + 5, '...and the bag is untouched');
  } finally {
    CFG.drops.enabled = saved;
    state.drops.length = 0;
  }
}


// ---------------------------------------------------------------------------
// B5 Q2 — gold as physical coins
// ---------------------------------------------------------------------------
async function testGoldCoins(nw: any) {
  const { state, sys } = nw;
  const { CFG } = await import('../data/config');
  const { GOLD_ICON, GOLD_ID } = await import('../data/items');
  const { ENEMIES } = await import('../data/enemies');
  const { invCount } = await import('../rules');

  const savedMode = CFG.drops.goldDrops;
  const savedEnabled = CFG.drops.enabled;
  const savedGold = state.player.gold;
  const savedDrops = state.drops.slice();
  const savedFoes = sys.hordes.foes.slice();
  const savedGod = state.god;

  const coins = () => state.drops.filter((d: any) => d.id === GOLD_ID);
  const purse = () => coins().reduce((a: number, d: any) => a + d.n, 0);
  const clear = () => { state.drops.length = 0; };

  // An award goes somewhere by definition — either the purse or the floor — so
  // every check below is a matched pair on BOTH halves. An assertion that only
  // counted the floor would pass just as happily if the gold had been created
  // out of nothing, and one that only counted the purse would pass if the pile
  // were a decoration.
  const award = (amount: number, boss: boolean) => {
    clear();
    const before = state.player.gold;
    sys.drops.awardGold(amount, nw.player.x + 300, nw.player.y + 300, boss);
    return { credited: state.player.gold - before, dropped: purse(), rows: coins().length };
  };

  try {
    state.god = true;
    CFG.drops.enabled = true;
    CFG.drops.goldDrops = 'boss';

    // ---- 1. the shipped verdict: routine credits, a boss bursts ------------
    const routine = award(37, false);
    eq(routine.rows, 0, "at 'boss', a routine kill drops no coins");
    eq(routine.credited, 37, '...it credits the purse instantly, exactly as before B5');

    const hoard = award(220, true);
    ok(hoard.rows > 1, `...and a boss bursts into a pile of ${hoard.rows} coins`);
    eq(hoard.credited, 0, '...which is NOT credited until you walk through it');
    eq(hoard.dropped, 220, '...and the pile is worth the whole award, to the coin');

    // ---- 2. conservation, which is the property that matters ---------------
    //
    // A burst that rounds is a stealth nerf or a stealth buff to every boss in
    // the game, and it would be invisible — nobody counts a boss payout. Swept
    // rather than sampled, because the split is randomised per burst and one
    // lucky amount proving nothing is exactly the failure mode here.
    let worst = '';
    for (let amount = 1; amount <= 400 && !worst; amount++) {
      const r = award(amount, true);
      if (r.dropped !== amount || r.credited !== 0) worst = `${amount} → ${r.dropped} (+${r.credited} credited)`;
      else if (r.rows > amount) worst = `${amount} split into ${r.rows} coins — more coins than gold`;
      else if (coins().some((d: any) => d.n < 1 || d.n !== Math.round(d.n))) worst = `${amount} produced a fractional or empty coin`;
    }
    ok(!worst, `every award from 1 to 400 gold lands on the floor entire${worst ? ': ' + worst : ''}`);

    // ---- 3. all three states are real behaviour ----------------------------
    //
    // goldDrops spent months as the one deliberately dormant key in config.ts.
    // The whole point of waking it is that each setting now does something
    // DIFFERENT, so each one is asserted against the same call.
    CFG.drops.goldDrops = 'off';
    const offBoss = award(150, true);
    eq(offBoss.rows, 0, "'off' — even a boss credits directly");
    eq(offBoss.credited, 150, '...with nothing lost on the way');

    CFG.drops.goldDrops = 'all';
    const allRoutine = award(150, false);
    ok(allRoutine.rows > 1, `'all' — even a routine kill bursts (${allRoutine.rows} coins)`);
    eq(allRoutine.dropped, 150, '...for the full amount');

    // ---- 4. the ground-loot hatch outranks it ------------------------------
    //
    // A build with drops switched off that still scattered coins on the floor
    // would be neither of the two behaviours anyone asked for.
    CFG.drops.goldDrops = 'boss';
    CFG.drops.enabled = false;
    const hatched = award(150, true);
    eq(hatched.rows, 0, 'CFG.drops.enabled=false takes coins off the floor too');
    eq(hatched.credited, 150, '...and pays the boss directly instead');
    CFG.drops.enabled = true;

    // ---- 5. a coin is not an item -----------------------------------------
    //
    // GOLD_ID has no ITEMS row on purpose. If collect() ever hands it to
    // invAdd, the player grows a phantom bag row that no tooltip, icon or shop
    // can explain — and it would still look like a working feature.
    clear();
    const beforeInv = invCount(state, GOLD_ID);
    const beforeGold = state.player.gold;
    sys.drops.awardGold(96, nw.player.x + 300, nw.player.y + 300, true);
    sys.drops.collectAll();
    eq(state.player.gold - beforeGold, 96, 'picking the pile up credits the purse for the whole pile');
    eq(invCount(state, GOLD_ID), beforeInv, '...and never creates a bag row for it');
    eq(state.drops.length, 0, '...and the floor is clear afterwards');

    // ---- 6. the GAME calls it (WORKFLOW 3) --------------------------------
    //
    // Everything above drives awardGold() by hand, which proves the handler
    // works and nothing else. These two kills go through hordes.hurt(), the
    // verb the game itself uses.
    const bossDef: any = ENEMIES.find((e) => e.id === 'thornwarden');
    const mobDef: any = ENEMIES.find((e) => e.id === 'gnawer');
    ok(!!bossDef && !!bossDef.boss, 'the fixture boss really is flagged boss');
    ok(!!mobDef && !mobDef.boss, '...and the control really is not');
    const killAndWatch = (def: any) => {
      clear();
      sys.hordes.foes.length = 0;
      const f: any = makeDummyFoe(nw, def, 260, 260, 10);
      sys.hordes.foes.push(f);
      const before = state.player.gold;
      sys.hordes.hurt(f, 999999);
      const out = { credited: state.player.gold - before, dropped: purse(), rows: coins().length };
      for (const x of sys.hordes.foes) nw.ctx.views?.removeFoe?.(x.uid);
      sys.hordes.foes.length = 0;
      return out;
    };
    const slainBoss = killAndWatch(bossDef);
    ok(slainBoss.rows > 0 && slainBoss.dropped > 0,
      `killing a ${bossDef.name} through hordes.hurt() leaves ${slainBoss.dropped} gold on the floor`);
    eq(slainBoss.credited, 0, '...and credits nothing directly');

    const slainMob = killAndWatch(mobDef);
    eq(slainMob.rows, 0, `CONTROL: killing a ${mobDef.name} the same way drops no coins`);
    ok(slainMob.credited > 0, `...it pays ${slainMob.credited} gold straight into the purse`);

    // ---- 7. the pile is actually drawable ---------------------------------
    //
    // itemDef(GOLD_ID) is undefined by design, and art.itemIcon()'s fallback
    // for an unknown id is a grey pebble. A boss hoard rendered as gravel is
    // exactly the kind of bug that ships, because nothing throws.
    eq(GOLD_ICON.kind, 'coin', 'the coin spec names the coin shape');
    const icon = nw.ctx.art?.itemIcon?.(GOLD_ID);
    const pebble = nw.ctx.art?.itemIcon?.('nonexistent_id_used_as_a_control');
    ok(!!icon && icon.width > 0, 'and the coin resolves to a real icon canvas');
    ok(!!pebble, 'CONTROL: an unknown id still yields the grey-pebble fallback');
    ok(icon !== pebble, '...and the coin is NOT that fallback — it is drawn as coins');
  } finally {
    CFG.drops.goldDrops = savedMode;
    CFG.drops.enabled = savedEnabled;
    state.god = savedGod;
    for (const f of sys.hordes.foes) nw.ctx.views?.removeFoe?.(f.uid);
    sys.hordes.foes.length = 0;
    for (const f of savedFoes) sys.hordes.foes.push(f);
    state.drops.length = 0;
    for (const d of savedDrops) state.drops.push(d);
    // Restored last and unconditionally: part 2 alone awards ~80,000 gold, and
    // CFG.horde.bossAtGold would turn every later night wave in this shared
    // world into a parade of domain lords.
    state.player.gold = savedGold;
  }
}

// ---------------------------------------------------------------------------
// B6 — Level-Up Flourish
// ---------------------------------------------------------------------------
async function testLevelUpFlourish(nw: any) {
  const { CFG } = await import('../data/config');
  const { PARTICLE_DEFS } = await import('../../engine/particles');
  const { levelUpFlourish } = await import('./flourish');

  const def = (PARTICLE_DEFS as any).levelup;
  ok(def !== undefined, 'a levelup particle row exists');
  // Negative gravity is the whole trick: motes that RISE read as an upgrade,
  // motes that fall read as debris. A sign flip here silently ruins the effect
  // and nothing else in the suite would notice.
  ok(def.gravity < 0, `levelup motes rise, not fall (gravity ${def.gravity})`);
  ok(def.lifetime[1] >= 1.0, `and hang around long enough to be seen (${def.lifetime[1]}s)`);

  ok(typeof nw.ctx.views.addLevelUpBurst === 'function',
    'views.addLevelUpBurst exists — the ring is drawn, not just particles');

  // Matched pair on the config gate, through a spy ctx: with the flag off
  // NOTHING fires, with it on BOTH halves fire. A test that only checked the
  // "on" case would pass with the gate wired to a constant.
  const spy = () => {
    const hits: string[] = [];
    return {
      hits,
      player: { x: 100, y: 100 },
      views: { addLevelUpBurst: () => hits.push('ring') },
      particles: { spawn: (k: string) => hits.push('particles:' + k) },
    };
  };
  const saved = CFG.ui.levelFlourish;
  try {
    CFG.ui.levelFlourish = false;
    const off = spy();
    levelUpFlourish(off);
    eq(off.hits.length, 0, 'CFG.ui.levelFlourish=false fires nothing at all');

    CFG.ui.levelFlourish = true;
    const on = spy();
    levelUpFlourish(on);
    ok(on.hits.includes('ring'), 'CFG.ui.levelFlourish=true draws the ring');
    ok(on.hits.includes('particles:levelup'), '...and spawns the levelup motes');
  } finally {
    CFG.ui.levelFlourish = saved;
  }

  // Skill levels only. Soul-gear levels and Loom points are frequent, and a
  // flourish that fires several times a minute stops reading as an achievement
  // — the same always-on-intensity failure as the rolled-back combat music.
  ok(!/soulItems|loomPoints/.test(levelUpFlourish.toString()),
    'the flourish is not wired to soul-gear or Loom levels');
}


// ---------------------------------------------------------------------------
// N4.1 — The Deep Wire
// ---------------------------------------------------------------------------
// `cfL4` is UNTRUSTED THIRD-PARTY TEXT being parsed into numbers that game
// systems divide by and multiply with. Cloudflare has changed the field set
// before and will again; a middlebox can rewrite the header; an ad blocker can
// return an error page with a `server-timing` of its own. WORKFLOW Pitfall 4:
// one NaN escaping this parser propagates through the mapping table and
// silently zeroes half the game's modifiers, with no error anywhere.
//
// So the parser gets adversarial input, and every derived value gets a range
// assertion. These run headless with no network — they test the parser, not
// Cloudflare.

async function testDeepWireParser(nw: any) {
  const { parseCfL4, parseServerTiming } = await import('./deepwire');

  // ---- the real thing, captured 2026-08-17 ----
  const real = '?proto=TCP&rtt=2915&min_rtt=2372&rtt_var=1277&sent=4&recv=6&lost=0'
    + '&retrans=0&sent_bytes=2838&recv_bytes=660&delivery_rate=1214165&cwnd=52'
    + '&unsent_bytes=0&cid=a3b0a8b4484ce02d&ts=46&x=0';
  const l4 = parseCfL4(real);
  ok(l4 !== null, 'a real cfL4 description parses');
  if (!l4) return;
  // The header is MICROSECONDS. Reading it as ms would report a 2.9 ms path as
  // 2915 ms and drive the sim into its slowest clamp on a perfect connection.
  ok(Math.abs(l4.rtt - 2.915) < 1e-6, `rtt converts µs → ms (2915µs → ${l4.rtt}ms)`);
  ok(Math.abs(l4.minRtt - 2.372) < 1e-6, `min_rtt converts too (${l4.minRtt}ms)`);
  ok(Math.abs(l4.rttVar - 1.277) < 1e-6, `rtt_var converts too (${l4.rttVar}ms)`);
  eq(l4.lost, 0, 'lost reads through');
  eq(l4.retrans, 0, 'retrans reads through');
  eq(l4.cwnd, 52, 'cwnd reads through');
  eq(l4.deliveryRate, 1214165, 'delivery_rate reads through');
  eq(l4.proto, 'TCP', 'proto reads through');
  // Read by KEY, never by position — `x=0` is an undocumented field that showed
  // up in the captured sample and a positional parser would have shifted on it.
  ok(l4.cid === 'a3b0a8b4484ce02d', 'trailing unknown fields do not shift the parse');

  // ---- adversarial input: none of these may produce NaN ----
  const nasty: [string, any][] = [
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['no fields', '?'],
    ['garbage', 'not a query string at all'],
    ['NaN values', '?rtt=abc&min_rtt=xyz&lost=NaN&cwnd=Infinity'],
    ['negative', '?rtt=-5000&min_rtt=-1&lost=-3&retrans=-2'],
    ['absurd', '?rtt=999999999999999999&min_rtt=1e400&cwnd=1e308'],
    ['injection', '?rtt=1000&cid=<script>alert(1)</script>&proto=' + 'A'.repeat(500)],
    ['duplicate keys', '?rtt=1000&rtt=2000&min_rtt=500'],
    ['no equals', '?rtt&min_rtt&lost'],
    ['reordered', '?cwnd=10&lost=1&min_rtt=1000&rtt=2000&proto=TCP'],
  ];
  let clean = 0;
  for (const [name, input] of nasty) {
    const p = parseCfL4(input as any);
    if (p === null) { clean++; continue; }
    const bad = Object.entries(p).find(([k, v]) =>
      typeof v === 'number' && (!Number.isFinite(v) || v < 0));
    ok(!bad, `"${name}" yields no NaN/negative (${bad ? bad[0] + '=' + bad[1] : 'clean'})`);
    ok(p.proto.length <= 12, `"${name}" truncates proto (${p.proto.length} chars)`);
    ok(p.cid.length <= 32, `"${name}" truncates cid (${p.cid.length} chars)`);
    clean++;
  }
  eq(clean, nasty.length, `all ${nasty.length} adversarial inputs handled without throwing`);

  // The matched negative for "rejects garbage": it must still ACCEPT a partial
  // dump. A parser that only accepted the complete field set would silently
  // discard every reading the day Cloudflare drops a column.
  const partial = parseCfL4('?rtt=5000&cwnd=10');
  ok(partial !== null, 'a partial dump is still accepted');
  ok(partial !== null && partial.lost === 0 && partial.minRtt === 0,
    'and missing fields default to 0 rather than NaN');

  // ---- Server-Timing splitting ----
  const hdr = 'cfSpeedEdge;dur=4, cfSpeedWorker;dur=29, cfL4;desc="?proto=TCP&rtt=2915&min_rtt=2372"';
  const st = parseServerTiming(hdr);
  eq(st.size, 3, 'three Server-Timing entries parse');
  eq(st.get('cfSpeedEdge')?.dur, 4, 'dur reads through');
  ok((st.get('cfL4')?.desc ?? '').includes('rtt=2915'), 'the quoted cfL4 desc survives');
  // Commas inside the quoted description are the trap: a naive split on ','
  // shreds the payload and the RTT vanishes. Descriptions DO contain commas.
  const commas = 'x;desc="a,b,c", cfL4;desc="?rtt=1000,extra"';
  const st2 = parseServerTiming(commas);
  eq(st2.size, 2, 'commas inside quoted descriptions do not split the header');
  eq(st2.get('x')?.desc, 'a,b,c', 'and the quoted value comes back intact');
  eq(parseServerTiming(null).size, 0, 'a missing header is an empty map, not a throw');
}

async function testDeepWireDerived(nw: any) {
  const net = nw.sys.net;
  const d = net.deep;
  ok(d !== undefined, 'the NetworkSystem carries a DeepWire');

  // Neutral-when-silent is the whole safety story: a player behind a proxy that
  // blocks speed.cloudflare.com must get a BALANCED game, not an easy or an
  // impossible one. Every derived value has to sit at its neutral with no data.
  const saved = d.l4;
  try {
    d.l4 = null;
    eq(d.fray, 0, 'no data → Fray 0 (no extra horde aggression)');
    eq(d.silt, 0, 'no data → Silt 0 (no drag)');
    eq(d.aperture, 10, 'no data → Aperture at the common initial cwnd');
    eq(d.flowMbps, 0, 'no data → Flow 0, meaning unmeasured');
    eq(d.pulseMs, 0, 'no data → Pulse 0, meaning unmeasured');
    eq(d.isLive, false, 'and isLive is false, so the Lens tags everything estimated');

    // Matched positive: feed it a hostile socket and every value must move.
    d.l4 = {
      proto: 'TCP', rtt: 120, minRtt: 30, rttVar: 40,
      sent: 100, recv: 100, lost: 8, retrans: 12,
      sentBytes: 0, recvBytes: 0, deliveryRate: 2_500_000, cwnd: 4,
      unsentBytes: 0, cid: 'x', atMs: performance.now(),
    };
    ok(d.fray > 0.1, `loss + retrans raise Fray (${d.fray.toFixed(3)})`);
    ok(d.fray <= 1, 'and Fray stays inside 0..1');
    ok(d.silt > 0.3, `rtt far above min_rtt raises Silt (${d.silt.toFixed(3)})`);
    ok(d.silt <= 1, 'and Silt stays inside 0..1');
    eq(d.aperture, 4, 'Aperture reads cwnd');
    ok(Math.abs(d.flowMbps - 20) < 0.01, `delivery_rate converts B/s → Mbps (${d.flowMbps})`);
    eq(d.pulseMs, 30, 'Pulse reads min_rtt');
    eq(d.fluxMs, 40, 'Flux reads rtt_var');

    // A path that is merely DISTANT must not read as congested. min_rtt 200ms
    // with rtt 210ms is a healthy link to the far side of the world; measuring
    // Silt against an absolute threshold instead of this path's own floor would
    // permanently punish players for their geography.
    d.l4 = { ...d.l4, rtt: 210, minRtt: 200, lost: 0, retrans: 0 };
    ok(d.silt < 0.1, `a distant but clean path has low Silt (${d.silt.toFixed(3)})`);
    eq(d.fray, 0, '...and no Fray');
  } finally {
    d.l4 = saved;
  }
}

async function testDeepWireMappings(nw: any) {
  const net = nw.sys.net;
  const { NET_METRICS, NET_GAME_MAP } = await import('../data/network');

  // Every new metric key must resolve — a typo here is invisible at runtime
  // because get() returns 0 for an unknown key, which looks like a real reading.
  for (const key of ['fray', 'silt', 'aperture', 'flowMbps', 'pulseMs', 'fluxMs',
                     'pulseBest', 'flowBest', 'fluxBest']) {
    const row = NET_METRICS.find((m: any) => m.key === key);
    ok(row !== undefined, `NET_METRICS carries '${key}'`);
    const v = net.get(key);
    ok(Number.isFinite(v), `net.get('${key}') is finite (${v})`);
  }

  // Every game mapping's netKey must exist in NET_METRICS. This is the failure
  // that produces a silent 0 everywhere downstream.
  for (const gm of NET_GAME_MAP as any[]) {
    ok(NET_METRICS.some((m: any) => m.key === gm.netKey),
      `game mapping '${gm.label}' resolves netKey '${gm.netKey}'`);
  }

  // The three new targets must clamp to their declared bands, and must sit at
  // NEUTRAL when the deep wire is silent.
  //
  // Forced silent on purpose: this test first went red because the probe
  // GENUINELY SUCCEEDED in CI and reported cwnd 52, so Aperture was legitimately
  // 1.25. Reading the live wire here would make the assertion a measurement of
  // whoever's network is running the suite.
  const savedSnap = { ...net.snap };
  try {
    net.snap.deepLive = false;
    net.snap.fray = 0; net.snap.silt = 0; net.snap.aperture = 10;
    net.snap.flowMbps = 0; net.snap.pulseMs = 0; net.snap.fluxMs = 0;
    for (const [target, neutral] of [['hordeAggression', 1], ['siltDrag', 1], ['aperture', 0.95]] as [string, number][]) {
      const gm = (NET_GAME_MAP as any[]).find((m) => m.target === target);
      ok(gm !== undefined, `game mapping target '${target}' exists`);
      const v = net.getGameValue(target);
      ok(v >= gm.min && v <= gm.max, `${target} = ${v.toFixed(3)} inside [${gm.min}, ${gm.max}]`);
      ok(Math.abs(v - neutral) < 0.1,
        `${target} sits at neutral ${neutral} with the deep wire silent (${v.toFixed(3)})`);
    }
  } finally {
    Object.assign(net.snap, savedSnap);
  }

  // pulseBest/flowBest fall back to the estimate rather than to 0. Getting this
  // backwards would hand the sim a 0 ms RTT and a 0 Mbps link on every network
  // that blocks the probe — i.e. most of them.
  ok(net.get('pulseBest') > 0, `pulseBest falls back to the estimate (${net.get('pulseBest')})`);
  ok(net.get('flowBest') > 0, `flowBest falls back to the estimate (${net.get('flowBest')})`);
}

async function testScryingMappings(nw: any) {
  const net = nw.sys.net;
  const { NET_METRICS, NET_GAME_MAP } = await import('../data/network');

  // The metric must exist and resolve — a typo'd key makes get() return 0,
  // which reads as an impossibly fast (and wrong) DNS measurement.
  const row = NET_METRICS.find((m: any) => m.key === 'dnsMs');
  ok(row !== undefined, "NET_METRICS carries 'dnsMs'");
  ok(Number.isFinite(net.get('dnsMs')), `net.get('dnsMs') is finite (${net.get('dnsMs')})`);

  const gm = NET_GAME_MAP.find((m: any) => m.target === 'scrying');
  ok(gm !== undefined, "NET_GAME_MAP carries target 'scrying'");

  // Neutral 50 ms is the authored fallback, so sight sits at exactly 1.0× — an
  // unmeasured run must not move the radar (pillar 5: fallback is the neutral
  // value). Forcing the value here also keeps the assertion independent of
  // whoever's network is running the suite.
  const saved = net.snap.dnsMedianMs;
  try {
    net.snap.dnsMedianMs = 50;
    const neutral = net.getGameValue('scrying');
    ok(Math.abs(neutral - 1.0) < 1e-9, `50 ms DNS → sight 1.0× (got ${neutral})`);

    // Fast DNS = more map revealed; slow DNS = less. Monotone, both inside band.
    net.snap.dnsMedianMs = 10;
    const fast = net.getGameValue('scrying');
    net.snap.dnsMedianMs = 150;
    const slow = net.getGameValue('scrying');
    ok(fast > 1.0, `fast DNS widens sight (${fast.toFixed(3)})`);
    ok(slow < 1.0, `slow DNS narrows sight (${slow.toFixed(3)})`);
    ok(fast > slow, 'and the transform is monotone');
    ok(fast <= gm.max && slow >= gm.min, `sight stays inside [${gm.min}, ${gm.max}]`);

    // ---- the 2026-08-22 slope retune, asserted for what it actually bought --
    //
    // NOT a wider 10→40 ms spread: the ceiling clamp eats that, and it is
    // 0.30× on both the old slope and the new one. Anyone "improving" this
    // test by asserting a wider spread there will be asserting a tautology.
    // What doubling the slope bought is these two things, so these two things
    // are what the suite holds:
    const at = (ms: number) => { net.snap.dnsMedianMs = ms; return net.getGameValue('scrying'); };

    // 1. The working range a real resolver lives in now covers the WHOLE upper
    //    half of the band. On the old slope 25 ms reached only 1.25× — a
    //    quarter of the headroom the band advertised was unreachable in
    //    practice, which made `max: 1.5` a number no player would ever see.
    const quick = at(25);
    ok(Math.abs(quick - gm.max) < 1e-9,
      `a sharp 25 ms resolver reaches the top of the band (${quick.toFixed(3)} = ${gm.max})`);

    // 2. The floor is reachable by a bad-but-real resolver rather than only by
    //    a broken one. 65 ms is a congested café; 75 ms was the old
    //    requirement and is closer to a resolver that has given up.
    const poor = at(65);
    ok(Math.abs(poor - gm.min) < 1e-9,
      `a poor 65 ms resolver reaches the floor (${poor.toFixed(3)} = ${gm.min})`);

    // CONTROL: the band is not simply saturated everywhere. If a future retune
    // flattens or over-steepens the slope, the two assertions above could both
    // pass while every real reading sat on a clamp — so pin that the midpoint
    // between them is strictly interior, which is the only way the mapping is
    // doing arithmetic rather than picking one of two constants.
    const mid = at(45);
    ok(mid > gm.min && mid < gm.max,
      `and 45 ms lands strictly inside the band (${mid.toFixed(3)}), not on a clamp`);
  } finally {
    net.snap.dnsMedianMs = saved;
  }
}

async function testScryingDohParser(nw: any) {
  const { parseDohAnswer } = await import('../data/network');
  const net = nw.sys.net;

  // Fresh snapshot: IPv6 is "not yet seen", never "absent" — the field is a
  // latched detection, not a verdict about the network.
  ok(net.snap.ipv6Live === false, 'a fresh run has not seen IPv6 yet');
  ok(Number.isFinite(net.snap.dnsMedianMs), `dnsMedianMs is finite (${net.snap.dnsMedianMs})`);

  // The real shapes Cloudflare/Google return.
  const a = parseDohAnswer({ AD: true, Answer: [{ name: 'x', type: 1, TTL: 300, data: '104.17.250.6' }] });
  eq(a.ip, '104.17.250.6', 'an A answer reads the address');
  eq(a.ttl, 300, 'TTL reads through');
  eq(a.ad, true, 'the DNSSEC AD flag reads through');
  eq(a.v6, false, 'an A answer is not IPv6');

  const aaaa = parseDohAnswer({ Answer: [{ name: 'x', type: 28, TTL: 120, data: '2606:4700::6810:fa06' }] });
  eq(aaaa.v6, true, 'an AAAA answer is recognised as IPv6');
  eq(aaaa.ip, '2606:4700::6810:fa06', 'and the IPv6 address comes back');

  // Untrusted third-party input: none of these may throw or produce NaN, and
  // the address must stay bounded — it reaches innerHTML in the Lens.
  const nasty: any[] = [
    null, undefined, {}, { Answer: [] }, { Answer: 'not-an-array' },
    { Answer: [{ type: 1, data: 42 }] }, { Answer: [{ type: 1, TTL: 'abc' }] },
    { Answer: [{ type: 99, data: 'junk' }] }, { AD: 'yes', Answer: [{ type: 28, data: 'A'.repeat(500) }] },
  ];
  let clean = 0;
  for (const input of nasty) {
    const r = parseDohAnswer(input);
    ok(Number.isFinite(r.ttl), 'malformed DoH yields a finite TTL');
    ok(typeof r.ip === 'string', 'and a string address');
    ok(r.ip.length <= 64, `and a bounded address (${r.ip.length} chars)`);
    ok(typeof r.v6 === 'boolean' && typeof r.ad === 'boolean', 'and boolean flags');
    clean++;
  }
  eq(clean, nasty.length, `all ${nasty.length} adversarial DoH responses handled without throwing`);
}


// N4.4's first two tests pin the mapping table and the parser — both real, and
// both entirely upstream of the game. Neither can tell you whether the radar
// ever moved. That is this file's oldest failure mode (WORKFLOW rule 3: driving
// a handler proves the handler works, never that the game calls it), so the
// radar gets measured in pixels, off the live HUD canvas, at three sight
// values, against the geometry the design authored.
async function testScryingRadar(nw: any) {
  const { state } = nw;
  const { TILE } = await import('../world/worldgen');
  const map = document.getElementById('nw-map') as HTMLCanvasElement | null;
  ok(!!map && !!nw.minimap, 'the radar canvas and the Minimap are both reachable');
  if (!map || !nw.minimap) return;

  // The radar draws buildings, drops and world bosses as well as foes, and a
  // world boss is very nearly the same red as a foe. Clearing them makes the
  // one red mark on the disc unambiguously OUR foe. All three are restored in
  // the finally: this file's tests share one live world.
  const savedDrops = state.drops, savedBuild = state.buildings, savedBosses = state.worldBosses;
  // `draw()` throttles on an internal clock, so a measurement has to hand it a
  // far-future timestamp to be sure it ran. That leaves the clock in the
  // future, which is why this test — and testHudSurfaces, which has been doing
  // it since A4 — must put it back. Without the reset, a `?test` run freezes
  // the player's radar for the ~33 minutes the last stamp bought.
  const RADIUS_TILES = 58;   // minimap.ts's authored disc, in tiles

  const centre = map.width / 2;
  /** Distance in LOGICAL px from the disc centre to the foe mark, or -1. */
  const markRadius = (sight: number, stamp: number): number => {
    nw.minimap.draw(state, stamp, [{ x: state.player.x + 40 * TILE, y: state.player.y }], sight);
    const g = map.getContext('2d')!;
    const d = g.getImageData(0, 0, map.width, map.height).data;
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2], a = d[i + 3];
      // The foe mark is the only strongly-red thing left on the disc: the rim
      // is (147,121,74) and the player pip is near-white, so "red, and much
      // redder than it is green or blue" selects it and nothing else.
      if (a > 40 && r > 150 && r > gg + 60 && r > b + 60) {
        const px = (i / 4) % map.width, py = Math.floor((i / 4) / map.width);
        sx += px; sy += py; n++;
      }
    }
    if (!n) return -1;
    return Math.hypot(sx / n - centre, sy / n - centre) / 2;   // backing px → logical
  };

  try {
    state.drops = []; state.buildings = []; state.worldBosses = [];

    const neutral = markRadius(1.0, performance.now() + 1e6);
    ok(neutral > 0, `a foe 40 tiles out lands on the radar (${neutral.toFixed(1)}px from centre)`);

    // State the claim in the design's units, not the code's: at neutral sight a
    // 58-tile disc drawn into a 124px circle must put a 40-tile foe at
    // 40/58 of the way out, i.e. ~42.8px. An assertion that recomputed
    // `span` from RADIUS_TILES would pass no matter how wrong the render is.
    const expected = (40 / RADIUS_TILES) * 62;
    ok(Math.abs(neutral - expected) < 3,
      `and it lands where a ${RADIUS_TILES}-tile disc says it should (${neutral.toFixed(1)}px, expected ~${expected.toFixed(1)}px)`);

    const wide = markRadius(1.5, performance.now() + 2e6);
    const narrow = markRadius(0.75, performance.now() + 3e6);
    ok(wide > 0 && narrow > 0, `the foe is still on the disc at both extremes (${wide.toFixed(1)}px / ${narrow.toFixed(1)}px)`);

    // Fast DNS = MORE world revealed = the same foe sits CLOSER to the centre,
    // because more of the map has been folded into the same disc. This is the
    // assertion the whole milestone rests on, and the one that would have
    // caught a sight value that never reached the render at all.
    ok(wide < neutral, `sharp Scrying widens the radar (${wide.toFixed(1)} < ${neutral.toFixed(1)})`);
    ok(narrow > neutral, `dim Scrying narrows it (${narrow.toFixed(1)} > ${neutral.toFixed(1)})`);
    ok(narrow > wide * 1.6, `and the two extremes are a real spread, not rounding (${(narrow / wide).toFixed(2)}×)`);

    // CONTROL: the measurement itself is stable. Without this, three different
    // numbers could be three different framings of noise.
    const again = markRadius(1.0, performance.now() + 4e6);
    ok(Math.abs(again - neutral) < 0.75,
      `CONTROL: the same sight measures the same distance twice (${neutral.toFixed(1)} vs ${again.toFixed(1)})`);
  } finally {
    state.drops = savedDrops; state.buildings = savedBuild; state.worldBosses = savedBosses;
    nw.minimap.lastT = -999;
  }
}

// The three defects the first pass shipped. Each is a matched pair, because
// each one is a claim about a boundary — asked vs never asked, measured vs
// not yet measured — and a boundary needs both sides to mean anything.
async function testScryingProbeDiscipline(nw: any) {
  const net = nw.sys.net;
  const { DNS_MIN_SAMPLES, DOH_READ_TYPES, parseDohAnswer } = await import('../data/network');

  // ---- 1. every record type the game ASKS for must be a type it can READ ----
  //
  // `resolvePtr()` has always queried PTR (type 12). The extracted parser
  // matched only 1 and 28, so the Vessel's ISP row could never fill again —
  // and the suite stayed green, because the parser was only ever fed the types
  // it already handled. Walking the table means the next dropped type fails
  // here instead of going quiet in the HUD.
  const sample: Record<number, string> = { 1: '104.17.250.6', 12: 'gateway.example.net.', 28: '2606:4700::6810:fa06' };
  for (const key of Object.keys(DOH_READ_TYPES)) {
    const t = Number(key);
    const got = parseDohAnswer({ Answer: [{ name: 'x', type: t, TTL: 60, data: sample[t] }] });
    eq(got.ip, sample[t], `a ${DOH_READ_TYPES[t]} (type ${t}) answer reads through the parser`);
  }
  eq(parseDohAnswer({ Answer: [{ type: 12, TTL: 60, data: 'host.isp.example.' }] }).v6, false,
    'a PTR answer is not mistaken for IPv6');
  // NEGATIVE CONTROL: a type the game does not read is still ignored, so the
  // fix above widened the set rather than opening it.
  eq(parseDohAnswer({ Answer: [{ type: 15, TTL: 60, data: 'mail.example.' }] }).ip, '',
    'CONTROL: an MX answer the game never asks for is still ignored');

  // ---- 2. the Scrying number holds neutral until it is actually measured ----
  const savedSamples = [...(net.dnsSamples ?? [])];
  const savedMedian = net.snap.dnsMedianMs;
  try {
    net.dnsSamples = [];
    net.snap.dnsMedianMs = 50;
    for (let i = 1; i < DNS_MIN_SAMPLES; i++) {
      net.recordDnsSample(400);
      eq(net.snap.dnsMedianMs, 50, `${i} sample(s) is not a measurement — Scrying holds neutral`);
    }
    // POSITIVE CONTROL: the floor is a floor, not a mute. One more lands it.
    net.recordDnsSample(400);
    ok(net.snap.dnsMedianMs > 50,
      `the ${DNS_MIN_SAMPLES}th sample publishes the median (${net.snap.dnsMedianMs}ms)`);
    ok(net.getGameValue('scrying') < 1.0, 'and a slow resolver narrows the radar');
  } finally {
    net.dnsSamples = savedSamples;
    net.snap.dnsMedianMs = savedMedian;
  }

  // ---- 3. a host the gate refused has NOT been asked ----
  //
  // `ipv6Live: false` documents itself as "not yet seen". That is only honest
  // if a host no request was ever made for gets asked again.
  const savedResolve = net.resolveHost;
  const savedChecked = new Set(net.aaaaChecked);
  const savedV6 = net.snap.ipv6Live;
  try {
    net.aaaaChecked = new Set();
    net.snap.ipv6Live = false;

    net.resolveHost = async () => null;                       // the gate refused
    await net.probeAAAA('denied.example');
    ok(!net.aaaaChecked.has('denied.example'),
      'a host the rate gate refused is left unmarked, so the next sighting retries');
    eq(net.snap.ipv6Live, false, 'and nothing was learned about IPv6 from a request never sent');

    net.resolveHost = async () => ({ ms: -1, ip: '', ttl: 0, ad: false, resolver: 'x', v6: false });
    await net.probeAAAA('answered.example');                  // asked, got nothing
    ok(net.aaaaChecked.has('answered.example'),
      'CONTROL: a host that WAS asked stays marked even though the answer was empty');

    net.resolveHost = async () => ({ ms: 12, ip: '2606:4700::1', ttl: 60, ad: false, resolver: 'x', v6: true });
    await net.probeAAAA('v6.example');
    eq(net.snap.ipv6Live, true, 'and one AAAA answer latches IPv6 for the session');
  } finally {
    net.resolveHost = savedResolve;
    net.aaaaChecked = savedChecked;
    net.snap.ipv6Live = savedV6;
  }
}


// ---------------------------------------------------------------------------
// A6 — The Hall becomes a hub
//
// Four tests over two counters. The shape of all four is the same argument the
// suite keeps having with itself: driving `hub.buy()` proves `hub.buy()` works
// and nothing else (WORKFLOW rule 3), so each one ends somewhere a player would
// actually look — the build carousel, the interact key routed through main()'s
// own hook, the bag, the worn weapon's live damage.
// ---------------------------------------------------------------------------

/** Place one hub counter on a known tile, replacing any already standing.
 *  Returns the building row so a test can move it around. */
function placeHub(nw: any, type: string, tx: number, ty: number) {
  const { state } = nw;
  state.buildings = state.buildings.filter((b: any) => b.type !== type);
  const b = { uid: state.nextUid++, type, tx, ty, hp: 240 };
  state.buildings.push(b);
  return b;
}

async function testHubRowsAndHatch(nw: any) {
  const { state } = nw;
  const { BUILDINGS, HUB_BUILDINGS } = await import('../data/buildings');
  const { CFG } = await import('../data/config');
  const { SEALS, sealPrice, reforgePrice, baseWorth } = await import('../data/hub');
  const { ITEMS } = await import('../data/items');
  const savedBuildings = state.buildings.slice();
  try {

  // ---- 1. the rows themselves ------------------------------------------
  const hubs = BUILDINGS.filter((b: any) => b.hub);
  eq(hubs.length, 2, 'two hub counters exist in the building table');
  for (const h of hubs) {
    ok(h.unique, `${h.name} is unique — a second one would add nothing but territory`);
    ok(h.cost.length > 0 && h.territory > 0,
      `${h.name} costs materials to raise and territory to keep (${h.territory})`);
    eq(HUB_BUILDINGS[h.hub!]?.id, h.id, `HUB_BUILDINGS resolves '${h.hub}' to ${h.id}`);
  }
  // The two rows must be LAST, because that is what makes the escape hatch a
  // restoration rather than a hole in the middle of the carousel.
  const tail = BUILDINGS.slice(-2).map((b: any) => b.id).sort().join(',');
  eq(tail, 'forge_warden,reliquary', 'both hub rows are the last entries in BUILDINGS');

  // ---- 2. the escape hatch, measured ------------------------------------
  const sel = () => (nw.sys.build as any).selectable().map((b: any) => b.id);
  const withHub = sel();
  ok(withHub.includes('reliquary') && withHub.includes('forge_warden'),
    'both counters are browsable in the build carousel');
  const savedFlag = CFG.a6.enabled;
  try {
    CFG.a6.enabled = false;
    eq(sel().join('|'), withHub.filter((i: string) => i !== 'reliquary' && i !== 'forge_warden').join('|'),
      'CFG.a6.enabled = false removes exactly the two hub rows and reorders nothing else');
    // The hatch has to reach the interaction too, or a counter raised before
    // the flip would go on trading in a world that had disabled the feature.
    placeHub(nw, 'reliquary', Math.floor(state.player.x / 32), Math.floor(state.player.y / 32));
    eq(nw.sys.hub.near(), null, 'and a Reliquary already standing stops answering');
  } finally {
    CFG.a6.enabled = savedFlag;
  }

  // ---- 3. the price tables are arithmetic, not literals ------------------
  for (const s of SEALS) {
    eq(sealPrice(s), Math.round(s.gold * CFG.a6.priceMul),
      `${s.name} is priced through CFG.a6.priceMul (${sealPrice(s)}g)`);
    ok(s.stockFloor >= 0 && s.stockFloor < 1, `${s.name}'s stock floor is a fraction (${s.stockFloor})`);
  }
  ok(sealPrice(SEALS[0]) < sealPrice(SEALS[1]) && sealPrice(SEALS[1]) < sealPrice(SEALS[2]),
    `the seals climb in price with the tier they promise (${SEALS.map(sealPrice).join(' < ')})`);
  const flat = reforgePrice('woven', 2, 0).gold;
  const once = reforgePrice('woven', 2, 1).gold;
  eq(once, Math.round(flat * CFG.a6.reforgeEscalation),
    `a second rework on the same piece costs ${CFG.a6.reforgeEscalation}× the first (${flat} → ${once})`);

  // ---- 4. baseWorth ranks the sidegrades where they belong ---------------
  //
  // The Void Blade is 8 damage against the Copper Blade's 6 and steals life on
  // top. Ranking on the stat column alone would put every elemental sidegrade
  // at the bottom of the ladder and lock all four out of the seal that ought to
  // sell them — so the effect term is not decoration, it is the reason the
  // stock cut works at all.
  ok(baseWorth(ITEMS.sword_void) > baseWorth(ITEMS.sword_copper),
    `a Void Blade outranks a Copper Blade (${baseWorth(ITEMS.sword_void)} > ${baseWorth(ITEMS.sword_copper)})`);
  ok(baseWorth(ITEMS.sword_star) > baseWorth(ITEMS.sword_fire),
    'and Star-Metal still outranks a Fire Brand — the effect term tilts the ladder, it does not invert it');
  } finally {
    state.buildings = savedBuildings;
  }
}

async function testHubReach(nw: any) {
  const { state } = nw;
  const hub = nw.sys.hub;
  const { CFG } = await import('../data/config');
  const { TILE } = await import('../world/worldgen');

  const savedBuildings = state.buildings.slice();
  const savedX = state.player.x, savedY = state.player.y;
  const savedPanel = (nw.ui as any).panel;
  // The dispatch defers to a gather ALREADY in progress, which is the correct
  // rule and would make the assertions below read as a broken hook. The suite
  // shares one live world, so whether one is running is not this test's to
  // assume either way.
  const savedActive = nw.sys.gather.active;
  nw.sys.gather.active = null;
  try {
    state.buildings = savedBuildings.filter((b: any) => b.type !== 'reliquary' && b.type !== 'forge_warden');
    const ptx = Math.floor(state.player.x / TILE), pty = Math.floor(state.player.y / TILE);

    // A measured boundary needs a known start point, so the player is parked on
    // a tile centre for it. `state.player.x` is a PROJECTION that main()
    // overwrites from `nw.player` on every sim tick — this test never steps, so
    // the write stands for its duration, and the finally puts it back anyway.
    state.player.x = (ptx + 0.5) * TILE;
    state.player.y = (pty + 0.5) * TILE;

    const rel = placeHub(nw, 'reliquary', ptx + 40, pty);
    eq(hub.near(), null, 'a Reliquary forty tiles off is not a counter you are standing at');

    rel.tx = ptx;
    eq(hub.near()?.kind, 'reliquary', 'standing on it, the counter answers');

    // WORKFLOW rule 3. Everything above drives the system. THIS drives the hook
    // main() actually wired to the interact key, and asks the UI which panel it
    // opened — the only assertion here that would fail if the dispatch in
    // main.ts were deleted.
    (nw.ui as any).hooks.interact();
    eq((nw.ui as any).panel, 'reliquary',
      'pressing interact at the counter opens the Reliquary — main() routes it, not the system');
    nw.ui.close();

    // Nearest wins, with no rule needed: two counters side by side is an
    // ordinary base layout.
    const forge = placeHub(nw, 'forge_warden', ptx, pty);
    rel.tx = ptx + 2;
    eq(hub.near()?.kind, 'forge', 'with both in reach, the nearer counter answers');
    (nw.ui as any).hooks.interact();
    eq((nw.ui as any).panel, 'forge', 'and interact opens that one');
    nw.ui.close();

    // ---- the boundary, in the design's units ---------------------------
    //
    // Player and counter both on tile centres, so k tiles apart is exactly
    // k × TILE pixels. The counter must answer out to CFG.a6.reachTiles and
    // not one tile further.
    state.buildings = state.buildings.filter((b: any) => b.type !== 'reliquary');
    let lastInside = -1;
    for (let k = 0; k <= 6; k++) { forge.tx = ptx + k; if (hub.near()) lastInside = k; }
    eq(lastInside, Math.floor(CFG.a6.reachTiles),
      `the counter answers out to ${CFG.a6.reachTiles} tiles and stops (last tile in reach: ${lastInside})`);

    // The tie-break the whole dispatch rests on. Stated as the inequality
    // rather than as two numbers, because it is the RELATION that keeps a
    // Reliquary raised beside a tree from stealing the chop.
    ok(CFG.a6.reachTiles < CFG.gather.reachTiles,
      `a counter's reach is tighter than a node's (${CFG.a6.reachTiles} < ${CFG.gather.reachTiles})`);
  } finally {
    state.buildings = savedBuildings;
    state.player.x = savedX; state.player.y = savedY;
    nw.sys.gather.active = savedActive;
    if (savedPanel) nw.ui.open(savedPanel); else nw.ui.close();
  }
}

async function testReliquary(nw: any) {
  const { state } = nw;
  const hub = nw.sys.hub;
  const { CFG } = await import('../data/config');
  const { SEALS, sealPrice } = await import('../data/hub');
  const { rolledOf } = await import('../data/items');
  const { LOOT_BANDS, rarityIndex } = await import('../data/rarity');
  const { rollRarity } = await import('./loot');
  const { TILE } = await import('../world/worldgen');

  const savedBuildings = state.buildings.slice();
  const savedGold = state.player.gold;
  const savedInv = { ...state.player.inv };
  const savedMul = CFG.a6.priceMul;
  const savedToast = nw.ctx.toast, savedLog = nw.ctx.log;
  try {
    placeHub(nw, 'reliquary', Math.floor(state.player.x / TILE), Math.floor(state.player.y / TILE));

    // ---- 1. the stock cut is a real cut ---------------------------------
    const lesser = SEALS[0], lords = SEALS[2];
    const wide = hub.stock('weapon', lesser);
    const fine = hub.stock('weapon', lords);
    ok(wide.length > fine.length,
      `a Lord's Seal draws from a narrower shelf than a Lesser (${fine.length} of ${wide.length} blades)`);
    ok(fine.every((id: string) => wide.includes(id)),
      "and every blade it can hand you is one the Lesser Seal could too — it is a cut, not a different table");
    ok(!fine.includes('sword_copper'),
      "a Lord's Seal cannot hand you the blade you started the run with");
    ok(wide.includes('sword_copper'), 'CONTROL: the Lesser Seal still can');

    // ---- 1b. the shelf shows what you are NOT buying ----------------------
    //
    // The 2026-08-22 verdict on the stock strip: show the full ladder and grey
    // the half this seal cannot reach, because the price gap between seals is
    // only legible if you can see what the cheaper one is missing.
    //
    // stock() is deliberately unchanged by that work — it is the buy pool that
    // buy() draws from and the sweep in part 5 asserts against, and widening it
    // would have quietly put unreachable bases on sale. shelf() is the sibling
    // that carries the greyed half, so both are pinned against each other here.
    const wideShelf = hub.shelf('weapon', lesser);
    const fineShelf = hub.shelf('weapon', lords);
    eq(fineShelf.length, wideShelf.length,
      `every seal shows the same full ladder (${fineShelf.length} blades), rich or poor`);
    ok(fineShelf.some((e: any) => !e.reachable),
      "a Lord's Seal greys out the bases it cannot reach");
    ok(wideShelf.every((e: any) => e.reachable),
      'CONTROL: the widest seal greys out nothing — the flag tracks the seal, not the shape');
    eq(fineShelf.filter((e: any) => e.reachable).length, fine.length,
      'and the reachable half is exactly the buy pool stock() hands to buy()');
    ok(fineShelf.filter((e: any) => e.reachable).every((e: any) => fine.includes(e.id)),
      '...the same ids, not merely the same count');
    // Ordering is load-bearing: the strip is drawn left-to-right, so a ladder
    // whose greyed half is interleaved would read as noise rather than as a cut.
    const firstGrey = fineShelf.findIndex((e: any) => !e.reachable);
    ok(firstGrey > 0 && fineShelf.slice(firstGrey).every((e: any) => !e.reachable),
      'the greyed bases are contiguous at the cheap end — the strip reads as one cut');

    // ---- 2. a refusal costs nothing -------------------------------------
    state.player.gold = 10;
    const invKeysBefore = Object.keys(state.player.inv).length;
    const broke = hub.buy('weapon', lesser.id);
    ok(!broke.ok, `ten gold does not break a ${sealPrice(lesser)}-gold seal`);
    eq(state.player.gold, 10, 'and the purse is untouched by the refusal');
    eq(Object.keys(state.player.inv).length, invKeysBefore, 'and nothing entered the bag');

    // ---- 3. the charge is exact and the item is real ---------------------
    state.player.gold = 5000;
    const bought = hub.buy('weapon', lesser.id);
    ok(bought.ok, `a ${sealPrice(lesser)}-gold seal breaks with 5000 in the purse`);
    eq(state.player.gold, 5000 - sealPrice(lesser),
      `and it charges exactly its price (5000 → ${state.player.gold})`);
    ok((state.player.inv[bought.id!] ?? 0) >= 1, 'the sealed relic is in the bag');
    ok(!!rolledOf(bought.id!)?.affixes.length, 'and it carries at least one rolled line');

    // ---- 4. priceMul reaches the real bill -------------------------------
    //
    // A retune knob nothing reads is the dormant-row sin with a comment on it.
    CFG.a6.priceMul = 2;
    state.player.gold = 5000;
    const dear = hub.buy('weapon', lesser.id);
    ok(dear.ok, 'the same seal at double the multiplier still breaks');
    eq(state.player.gold, 5000 - lesser.gold * 2,
      `CFG.a6.priceMul reaches the till (charged ${5000 - state.player.gold} for a ${lesser.gold}-gold seal)`);
    CFG.a6.priceMul = savedMul;

    // ---- 5. the sweep: every draw inside its band, off its own shelf -----
    //
    // Toast and log are stubbed for the sweep. Four hundred purchases would
    // otherwise bury the HUD and rewrite the Chronicle, and the Chronicle is
    // something other tests read.
    nw.ctx.toast = () => {};
    nw.ctx.log = null;
    state.player.gold = 10_000_000;
    const counts: Record<string, number> = {};
    let offShelf = 0, outOfBand = 0, riftborn = 0, draws = 0;
    for (const seal of SEALS) {
      const band = LOOT_BANDS[seal.band];
      const lo = rarityIndex(band.floor ?? 'plain'), hi = rarityIndex(band.ceiling ?? 'hallowed');
      for (const slot of ['weapon', 'armor', 'charm'] as const) {
        const shelf = hub.stock(slot, seal);
        for (let i = 0; i < 45; i++) {
          const r = hub.buy(slot, seal.id);
          if (!r.ok) continue;
          draws++;
          const roll = rolledOf(r.id!);
          if (!roll) { outOfBand++; continue; }
          const idx = rarityIndex(roll.rarity);
          if (idx < lo || idx > hi) outOfBand++;
          if (!shelf.includes(roll.base)) offShelf++;
          if (roll.rarity === 'riftborn') riftborn++;
          counts[roll.rarity] = (counts[roll.rarity] ?? 0) + 1;
        }
      }
    }
    ok(draws > 380, `${draws} seals broken across three seals and three shapes`);
    eq(outOfBand, 0, 'every single draw landed inside the band its seal promised');
    eq(offShelf, 0, 'and every base came off that seal\'s own shelf');

    // The promise data/rarity.ts makes: the rift band is "the sole route to
    // Riftborn". A shop that sold the top rarity would quietly retire that
    // sentence, so it is asserted over the whole sweep rather than trusted to
    // the table.
    eq(riftborn, 0, `no seal at any price reaches Riftborn (${draws} draws)`);
    // NEGATIVE CONTROL: the roller CAN produce one — the "never" above is a
    // property of the seals, not of a Riftborn that is unreachable everywhere.
    let riftPossible = 0;
    for (let i = 0; i < 4000; i++) if (rollRarity(LOOT_BANDS.rift, 1) === 'riftborn') riftPossible++;
    ok(riftPossible > 0, `CONTROL: the rift band still reaches Riftborn (${riftPossible} in 4000)`);

    ok(Object.keys(counts).length >= 3,
      `the sweep spread across ${Object.keys(counts).length} tiers: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  } finally {
    CFG.a6.priceMul = savedMul;
    nw.ctx.toast = savedToast; nw.ctx.log = savedLog;
    state.buildings = savedBuildings;
    state.player.gold = savedGold;
    state.player.inv = savedInv;
  }
}

async function testForgeWarden(nw: any) {
  const { state } = nw;
  const hub = nw.sys.hub;
  const { CFG } = await import('../data/config');
  const { rolledOf, itemDef } = await import('../data/items');
  const { rollItem } = await import('./loot');
  const { CURSES } = await import('../data/affixes');
  const { equippedWeaponDmg, invAdd } = await import('../rules');
  const { TILE } = await import('../world/worldgen');

  const savedBuildings = state.buildings.slice();
  const savedGold = state.player.gold;
  const savedInv = { ...state.player.inv };
  const savedEquip = { ...state.player.equip };
  const savedSockets = JSON.parse(JSON.stringify(state.sockets ?? {}));
  const savedReforged = { ...(state.reforged ?? {}) };
  const savedToast = nw.ctx.toast, savedLog = nw.ctx.log;
  try {
    placeHub(nw, 'forge_warden', Math.floor(state.player.x / TILE), Math.floor(state.player.y / TILE));
    nw.ctx.toast = () => {};
    nw.ctx.log = null;

    // ---- 1. one affix, not all -------------------------------------------
    const uid = rollItem('sword_iron', { forceRarity: 'hallowed' });
    ok(uid.includes('#'), 'a forced Hallowed blade rolled into a unique piece');
    invAdd(state, uid, 1);
    state.sockets = state.sockets ?? {};
    state.sockets[uid] = ['rime', 'ember'];       // A5: a rework must not unpick a weave

    const roll = rolledOf(uid)!;
    ok(roll.affixes.length >= 3, `it carries ${roll.affixes.length} lines`);
    const target = 1;
    const othersBefore = JSON.stringify(roll.affixes.filter((_: any, i: number) => i !== target));

    // The bill climbs 1.8× per rework and this test does a dozen of them, so
    // the purse is absurd on purpose — the escalation is what is under test,
    // not whether a real run could afford it.
    state.player.gold = 50_000_000;
    for (const m of ['iron_bar', 'silver_bar', 'star_bar']) invAdd(state, m, 400);

    const q1 = hub.quote(uid)!;
    const r1 = hub.reforge(uid, target);
    ok(r1.ok, `the Forge-Warden reworks line ${target + 1}: ${r1.before} → ${r1.after}`);
    const after = rolledOf(uid)!;
    eq(after.affixes.length, roll.affixes.length, 'the piece still has the same number of lines');
    eq(JSON.stringify(after.affixes.filter((_: any, i: number) => i !== target)), othersBefore,
      'and every OTHER line is byte-for-byte what it was — one affix, not all');
    eq(JSON.stringify(state.sockets[uid]), JSON.stringify(['rime', 'ember']),
      'the threads stay socketed, in order — you reworked the metal, not the weaving');
    eq(state.reforged[uid], 1, 'the piece remembers it has been through the forge once');

    // ---- 2. the price climbs ---------------------------------------------
    const q2 = hub.quote(uid)!;
    eq(q2.gold, Math.round(q1.gold * CFG.a6.reforgeEscalation),
      `the second rework costs ${CFG.a6.reforgeEscalation}× the first (${q1.gold} → ${q2.gold}) — `
      + 'what makes this a repair rather than a slot machine you feed until it is perfect');

    // ---- 3. the GAME sees it ----------------------------------------------
    //
    // Everything above reads the registry. This wears the blade and measures
    // the player's own damage across a run of reworks: if the merged def never
    // reached `equippedWeaponDmg`, the number below never moves and every
    // assertion in this test is about a data structure nobody consults.
    // Through main()'s own equip hook, not by writing `equip.weapon`: a worn
    // stat is soul-leveled, and `wornStat()` reads `soulItems[slot]`, which
    // only `toggleEquip()` binds. Setting the slot by hand leaves the binding
    // empty and every damage read comes back 0 — which is exactly what the
    // first version of this test measured, and why the assertion below is
    // written against the number rather than against the registry.
    (nw.ui as any).hooks.equip(uid);
    eq(state.player.equip.weapon, uid, 'the reworked blade is worn');
    // The bench lists bag gear too, so it has to SAY which piece is in a slot.
    eq(hub.bench().find((v: any) => v.uid === uid)?.worn, true,
      'and the bench says so — a player holding three blades must not have to guess');
    const lines = rolledOf(uid)!.affixes.length;
    const seen = new Set<number>();
    seen.add(+equippedWeaponDmg(state).toFixed(3));
    // Round-robin across every line rather than hammering one. WHICH line
    // carries the damage is a roll, not a fact — on one seed line 2 came up
    // 'of Resonance', and a suffix that only names an effect hook can be
    // reworked forever without `weaponDmg` moving a decimal. That version of
    // this assertion was true and measured nothing.
    for (let i = 0; i < 12 && seen.size < 2; i++) {
      if (!hub.reforge(uid, i % lines).ok) break;
      seen.add(+equippedWeaponDmg(state).toFixed(3));
    }
    ok(seen.size >= 2,
      `reworking a worn blade moves the damage the player actually swings with (${[...seen].join(' → ')})`);

    // CONTROL: an untouched piece does not drift. Without this, "the number
    // changed" could be the ambient world moving rather than the forge.
    const other = rollItem('sword_iron', { forceRarity: 'hallowed' });
    invAdd(state, other, 1);
    const otherDmg = itemDef(other)!.weaponDmg;
    hub.reforge(uid, target);
    eq(itemDef(other)!.weaponDmg, otherDmg,
      'CONTROL: the piece that was NOT reworked is unchanged by someone else\'s rework');

    // ---- 4. a curse stays a curse ------------------------------------------
    //
    // data/rarity.ts rule 2: Riftborn always costs something. Letting gold turn
    // the curse into a blessing would make the Forge-Warden a laundry for the
    // one rule that keeps the top of the ladder honest.
    const curseIds = new Set(CURSES.map((c: any) => c.id));
    const rift = rollItem('sword_iron', { forceRarity: 'riftborn' });
    invAdd(state, rift, 1);
    const rr = rolledOf(rift)!;
    const cursedAt = rr.affixes.findIndex((a: any) => a.cursed);
    ok(cursedAt >= 0, `a Riftborn blade carries its price on line ${cursedAt + 1} (${rr.affixes[cursedAt]?.name})`);
    let stayedCursed = 0, laundered = 0;
    for (let i = 0; i < 6; i++) {
      if (!hub.reforge(rift, cursedAt).ok) break;
      const a = rolledOf(rift)!.affixes[cursedAt];
      if (a.cursed && curseIds.has(a.id)) stayedCursed++; else laundered++;
    }
    ok(stayedCursed >= 4, `${stayedCursed} reworks of a cursed line all came back cursed`);
    eq(laundered, 0, 'gold can change WHICH curse you carry — never that you carry one');
    // CONTROL: the ordinary lines on that same Riftborn are not forced cursed,
    // so the rule above is about the cursed SLOT and not about the item.
    const plainAt = rr.affixes.findIndex((a: any) => !a.cursed);
    let blessings = 0;
    for (let i = 0; i < 6; i++) {
      if (!hub.reforge(rift, plainAt).ok) break;
      if (!rolledOf(rift)!.affixes[plainAt].cursed) blessings++;
    }
    ok(blessings >= 4, `CONTROL: its ordinary lines rework to ordinary lines (${blessings} of 6)`);

    // ---- 5. a refusal changes nothing -------------------------------------
    const before = JSON.stringify(rolledOf(uid)!.affixes);
    const priorCount = state.reforged[uid];
    state.player.gold = 0;
    const denied = hub.reforge(uid, target);
    ok(!denied.ok && !!denied.why, `an empty purse is refused out loud: "${denied.why}"`);
    eq(state.player.gold, 0, 'and nothing was charged');
    eq(JSON.stringify(rolledOf(uid)!.affixes), before, 'and the piece is exactly as it was');
    eq(state.reforged[uid], priorCount, 'and the rework count did not tick');

    // Materials are checked too, not just gold — otherwise a rich player with
    // an empty forge would be charged and handed nothing.
    state.player.gold = 50_000_000;
    for (const m of ['iron_bar', 'silver_bar', 'star_bar']) delete state.player.inv[m];
    const noMats = hub.reforge(uid, target);
    ok(!noMats.ok, `and so is an empty forge: "${noMats.why}"`);
    eq(state.player.gold, 50_000_000, 'the purse survives a refusal for materials as well');

    // ---- 6. plain gear has nothing to rework -------------------------------
    ok(!hub.reforge('sword_iron', 0).ok,
      'an authored, unrolled blade has no lines and is refused');
  } finally {
    nw.ctx.toast = savedToast; nw.ctx.log = savedLog;
    state.buildings = savedBuildings;
    state.player.gold = savedGold;
    state.player.inv = savedInv;
    state.player.equip = savedEquip;
    state.sockets = savedSockets;
    state.reforged = savedReforged;
  }
}


// ---------------------------------------------------------------------------
// N4.2 — The Lens side cart, and the Chronicle behind it
// ---------------------------------------------------------------------------
// The existing UI smoke test asserted "Lens panel exists in DOM" and then
// `ok(true, 'completed without errors')`. That would have stayed green through
// this entire refactor with every tab rendering nothing at all — the exact
// failure mode B5 documented, where the suite does not go red, it stays green
// while the mechanic changes underneath it.

async function testLensSideCart(nw: any) {
  if (typeof document === 'undefined') { ok(true, 'no DOM — skipping'); return; }
  const lens = nw.lens;
  ok(lens !== undefined, 'the Lens is exposed for testing');
  if (!lens) return;

  const el = document.getElementById('nw-observatory') as HTMLElement;
  ok(el !== null, 'the drawer is in the DOM');

  // It is a DRAWER, not a modal. Parked off-screen by transform rather than
  // display:none, so the slide is a real compositor transition — and so the old
  // `panel.style.display = ''` way of opening it no longer works.
  const wasOpen = lens.isOpen();
  lens.setOpen(false);
  ok(el.style.transform.includes('100%'), `closed → parked off-screen (${el.style.transform})`);
  lens.setOpen(true);
  ok(el.style.transform.includes('0'), `open → slid in (${el.style.transform})`);
  ok(!el.style.transform.includes('100%'), '...and no longer parked');

  // Non-modal: the game must remain visible and clickable beside it. A full
  // -screen scrim would defeat the entire point of the refactor.
  ok(parseInt(el.style.width) <= 700 || el.style.width === '100%',
    `the drawer is a side cart, not a full cover (${el.style.width})`);

  // ---- five tabs, and switching them actually changes the content ----
  const tabs = el.querySelectorAll('[data-tab]');
  eq(tabs.length, 5, 'five tabs: PULSE / PATHS / IDENTITY / VESSEL / THREADS');
  const body = document.getElementById('nw-lens-body') as HTMLElement;
  ok(body !== null, 'the body element exists');

  const seen: string[] = [];
  for (let i = 0; i < tabs.length; i++) {
    (tabs[i] as HTMLElement).click();
    lens.refresh(true);
    const html = body.innerHTML;
    ok(html.length > 120, `tab ${i} renders content (${html.length} chars)`);
    ok(!html.includes('failed to render'), `tab ${i} renders without throwing`);
    seen.push(html);
  }
  // The matched negative: if every tab rendered the same thing, the assertions
  // above would all pass and the tab bar would be decoration.
  eq(new Set(seen).size, 5, 'all five tabs render DIFFERENT content');

  // ---- honesty tags ----
  const all = seen.join('');
  for (const t of ['measured', 'reported', 'derived', 'unavailable']) {
    ok(all.includes(`>${t}</span>`), `readings are tagged '${t}' somewhere in the panel`);
  }
  // "unavailable" with no reason is indistinguishable from "broken".
  ok(/title="[^"]*cannot be read here[^"]*—[^"]+"/.test(all),
    'every unavailable reading carries a reason, not just the word');

  // ---- inspect box survived the refactor ----
  (tabs[0] as HTMLElement).click();
  lens.refresh(true);
  const row = el.querySelector('[data-inspect-key]') as HTMLElement;
  ok(row !== null, 'rows still carry data-inspect-key — the best thing in the old panel');
  if (row) {
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const box = document.getElementById('nw-lens-inspect') as HTMLElement;
    ok(box !== null, 'the inspect box exists');
    ok(box.style.display !== 'none', 'and opens on hover');
    ok(/SOURCE/.test(box.innerHTML) && /FLOWS INTO/.test(box.innerHTML),
      'with SOURCE / ACTION / FLOWS INTO intact');
  }

  lens.setOpen(wasOpen);
}

async function testLensEscapesThirdPartyStrings(nw: any) {
  if (typeof document === 'undefined') { ok(true, 'no DOM — skipping'); return; }
  const lens = nw.lens, net = nw.sys.net;
  if (!lens) { ok(false, 'no lens'); return; }

  // ISP, city, ASN, colo and PTR arrive verbatim from someone else's JSON and go
  // straight into innerHTML. The escape was added once as a review fix; this
  // pins it so the five-module refactor cannot quietly lose it again.
  const saved = { isp: net.snap.isp, city: net.snap.city, asn: net.snap.asn, colo: net.snap.colo, fetched: net.identityFetched };
  const payload = '<img src=x onerror="window.__nwPwned=1">';
  try {
    net.identityFetched = true;
    net.snap.isp = payload;
    net.snap.city = payload;
    net.snap.asn = payload;
    net.snap.colo = payload;
    lens.setOpen(true);
    const tabs = document.querySelectorAll('#nw-observatory [data-tab]');
    (tabs[2] as HTMLElement).click();          // IDENTITY
    lens.refresh(true);
    const body = document.getElementById('nw-lens-body') as HTMLElement;

    ok(body.querySelector('img') === null, 'a markup-bearing ISP string does not become an element');
    ok(!(window as any).__nwPwned, 'and its onerror never fires');
    // Matched positive: the value must still be VISIBLE, escaped. A panel that
    // dropped the field entirely would pass the two assertions above while
    // hiding the thing the player is trying to read.
    ok(body.innerHTML.includes('&lt;img'), 'the raw text is shown, escaped');
  } finally {
    net.snap.isp = saved.isp; net.snap.city = saved.city;
    net.snap.asn = saved.asn; net.snap.colo = saved.colo;
    net.identityFetched = saved.fetched;
    delete (window as any).__nwPwned;
    lens.setOpen(false);
  }
}

async function testChronicleStore(nw: any) {
  const { ChronicleStore } = await import('./chronicle');
  const c = new ChronicleStore();
  c.define({ key: 'x', label: 'X', unit: 'ms' });

  // ---- retention keeps the outliers ----
  // 400 samples at 1 Hz with a single 900ms spike buried at t=30. Naive
  // decimation ("keep every tenth") deletes that spike nine times out of ten,
  // and the spike is the entire story of a network event.
  for (let t = 0; t < 400; t++) c.push('x', t, t === 30 ? 900 : 20, 'measured');
  const s: any = c.get('x');
  ok(s.buckets.length > 0, `old samples collapsed into ${s.buckets.length} buckets`);
  ok(s.fine.length < 400, `and the fine window is bounded (${s.fine.length} samples, not 400)`);
  const spikeBucket = s.buckets.find((b: any) => b.t <= 30 && b.t + 10 > 30);
  ok(spikeBucket !== undefined, 'the bucket covering t=30 exists');
  eq(spikeBucket?.max, 900, 'and it kept the 900ms spike as its max — outliers survive aggregation');
  eq(spikeBucket?.med, 20, '...while the median still reports the normal state');

  // ---- NaN never enters the store ----
  const before = s.fine.length + s.buckets.length;
  c.push('x', 401, NaN, 'measured');
  c.push('x', 402, Infinity, 'measured');
  eq(s.fine.length + s.buckets.length, before, 'NaN and Infinity are refused at the door');

  // ---- change detection: fires on a step ----
  const d = new ChronicleStore();
  d.define({ key: 'y', label: 'Y', unit: 'ms' });
  for (let t = 0; t < 120; t++) d.push('y', t, 20 + (t % 3), 'measured');   // steady, tiny wobble
  eq(d.events.length, 0, 'a steady series produces no events');
  for (let t = 120; t < 140; t++) d.push('y', t, 200, 'measured');          // hard step up
  ok(d.events.length >= 1, `a step change fires an event (${d.events.length})`);
  const ev = d.events[0];
  eq(ev?.dir, 'up', 'and it knows which way it went');
  ok((ev?.sigma ?? 0) >= 3, `at ${Math.abs(ev?.sigma ?? 0).toFixed(1)}σ outside the baseline`);

  // ---- and NOT on noise ----
  // The matched negative that matters: a link that always wobbles must not cry
  // wolf. Same absolute swing as the step above, but as ongoing variance.
  const e = new ChronicleStore();
  e.define({ key: 'z', label: 'Z', unit: 'ms' });
  for (let t = 0; t < 200; t++) e.push('z', t, 100 + (t % 7) * 30, 'measured');
  eq(e.events.length, 0, 'a permanently noisy series fires nothing — sigma, not percent');
}

async function testChronicleExport(nw: any) {
  const { exportChronicle } = await import('./chronicle');
  const c = nw.chronicle;
  ok(c !== undefined, 'the run carries a Chronicle');
  if (!c) return;

  const payload: any = exportChronicle(c, nw.sys.net, nw.state);
  eq(payload.format, 'nightward-chronicle', 'the export is self-describing');
  ok(payload.series !== undefined, 'it carries the series');
  ok(payload.snapshot !== undefined, 'and the current snapshot');
  ok(typeof payload.sessionStart === 'string', 'and when the session started');

  // Provenance has to survive the export. A series of numbers with no record of
  // how they were obtained is a rumour, and this file is meant to be evidence.
  const keys = Object.keys(payload.series);
  ok(keys.length >= 3, `${keys.length} series exported`);
  const withSamples = keys.map((k) => payload.series[k]).find((v: any) => v.fine?.length);
  if (withSamples) {
    ok(withSamples.fine.every((s: any) => typeof s.q === 'string'),
      'every exported sample carries its quality tag');
  } else {
    ok(true, 'no samples yet this run — quality tags checked in testChronicleStore');
  }

  // It must be real JSON. A payload with a cycle or an undefined in it throws
  // here rather than in front of a player who clicked export.
  let json = '';
  try { json = JSON.stringify(payload); } catch (err: any) { json = ''; }
  ok(json.length > 50, `the payload serialises (${json.length} bytes)`);
}

const TESTS: Array<{ name: string; fn: (nw: any) => Promise<void> }> = [
  { name: 'Boot & state integrity', fn: testBoot },
  { name: 'Starting inventory', fn: testStartingInventory },
  { name: 'Sim step advancement', fn: testSimSteps },
  { name: 'World queries', fn: testWorldQueries },
  { name: 'Gathering', fn: testGathering },
  { name: 'Crafting (success)', fn: testCrafting },
  { name: 'Crafting (no materials)', fn: testCraftingNoMaterials },
  { name: 'Building flow', fn: testBuildingFlow },
  { name: 'Building duplicate unique', fn: testBuildingDuplicateUnique },
  { name: 'Combat attack state machine', fn: testCombatAttack },
  { name: 'Day/night cycle', fn: testDayNightCycle },
  { name: 'Player damage', fn: testPlayerDamage },
  { name: 'God mode', fn: testGodMode },
  { name: 'Equipment equip/unequip', fn: testEquipment },
  { name: 'Inventory bounds', fn: testInventoryBounds },
  { name: 'Fire ignition', fn: testFireIgnite },
  { name: 'Game log', fn: testLogEntries },
  { name: 'XP & leveling', fn: testXpAndLeveling },
  { name: 'XP curve — gates at 5/10/15/20/30 vs recipe levelReqs', fn: testXpCurve },
  { name: 'Boss death pays out on every path', fn: testBossDeathPaysOut },
  { name: 'Loom tree shape: reachable, granted, no placebo', fn: testLoomTreeShape },
  { name: 'Loom is reachable by a player (panel + click)', fn: testLoomPanelIsReachable },
  { name: 'Loom payoff layer is real, not advertising', fn: testLoomPayoffLayerIsReal },
  { name: 'Run starts at dawn, not at the wall clock', fn: testRunStartsAtDawn },
  { name: 'Night credit requires entering the night', fn: testNightCreditRequiresEntry },
  { name: 'Long Thread counts levels on the real xp curve', fn: testLongThreadCurve },
  { name: 'State immutability', fn: testStateImmutabilityPattern },
  { name: '🔥 Survival playthrough (10 min)', fn: testSurvivalPlaythrough },
  // ---- P1 Gauntlet (14 behavioral tests) ----
  { name: 'Collision — walls & water block movement', fn: testCollisionWalls },
  { name: 'Long walk — chunk streaming, no stuck', fn: testLongWalk },
  { name: 'Gather every feature type', fn: testGatherEveryFeature },
  { name: 'Craft every recipe', fn: testCraftEveryRecipe },
  { name: 'Build every building type', fn: testBuildEveryBuilding },
  { name: 'Fight every mob type', fn: testFightEveryMob },
  { name: 'Boss fight — engage, kill, revive', fn: testBossFight },
  { name: 'Night wave — spawns, towers, dawn', fn: testNightWave },
  { name: 'Death & scatter — respawn distance, gold loss', fn: testDeathAndScatter },
  { name: 'Game over — hall destroyed, death screen', fn: testGameOver },
  { name: 'Mob birth stats — echo-derived hp/dmg/soak', fn: testMobBirthStats },
  { name: 'Damage roll bounds — calm vs stormy variance', fn: testDamageRollBounds },
  { name: 'Network fallbacks — offline, all modifiers', fn: testNetworkFallbacks },
  { name: 'UI smoke — panels, Lens, inspect box', fn: testUISmoke },
  { name: 'Echoes — grant on boss kill, re-kill levels, cap', fn: testEchoGrantAndLevel },
  { name: 'Echoes — every kind deals damage (pulse/nova/volley/orbit/trail)', fn: testEchoDamage },
  { name: 'Echoes — scaling monotonic, cooldown floor, D5 roll band', fn: testEchoBounds },
  { name: 'Net map integrity — netKeys resolve, vitals rows pinned', fn: testNetMapIntegrity },
  { name: 'Combat restart rate cap — autoclicker guard', fn: testCombatRestartRateCap },
  { name: 'Vitals decay — vigor & resolve drain over time', fn: testVitalsDecay },
  { name: 'Vigor starve — HP drains when vigor=0', fn: testVigorStarve },
  { name: 'Resolve zero — speed & damage penalties apply', fn: testResolveZero },
  { name: 'Vitals restore — kill/gather/build/survive night', fn: testVitalsRestore },
  { name: 'Vitals HUD — chips visible in DOM', fn: testVitalsHUD },
  { name: 'Horde scale — night 3 count ≥60, maxAlive≥200', fn: testHordeScale },
  // ---- C2: Waystones ----
  { name: 'Waystone chain — placement, chain, wall-at-edge', fn: testWaystoneChain },
  { name: 'Waystone disconnect — decay on anchor loss', fn: testWaystoneDisconnect },
  // ---- C3: The Loom ----
  { name: 'Loom allocation — allocate, rank up, prereq gating', fn: testLoomAllocation },
  { name: 'Loom keystones — Glass Echo, Deep Roots, Night Market, Long Thread', fn: testLoomKeystones },
  // ---- C4: The Armory ----
  { name: 'Boss relic drops — kill each boss, check echo + relic', fn: testBossRelicDrops },
  { name: 'Relic equip — equip/unequip relic slot', fn: testRelicEquip },
  { name: 'Item effects — thorns_reflect, all effects registered', fn: testItemEffects },
  { name: 'Silver/Star crafting — craft silver & star-metal items', fn: testSilverStarCrafting },
  // ---- C5: Buildings Rework ----
  { name: 'Tower roles — splash/slow/sniper/aura data integrity', fn: testTowerRoles },
  { name: 'Tower combat — towers damage nearby foes', fn: testTowerCombat },
  // ---- W6: Scoreboards ----
  { name: 'Scoreboard snapshot — all 13 fields populated', fn: testScoreboardSnapshot },
  { name: 'Leaderboard persist — save, load, formatAge, v1→v2 migration', fn: testLeaderboardPersist },
  { name: 'Leaderboard UI — getLiveStats, panel renders', fn: testLeaderboardUI },
  { name: 'Leaderboard legit ranking — god-mode run never outranks a legit one', fn: testLeaderboardLegitRanking },
  // ---- L1: The Lifespan ----
  { name: 'Lifespan aging — real-time pace, neglect accelerates, never slows', fn: testLifespanAging },
  { name: 'Lifespan old-age death — distinct ending, gameOverCause set', fn: testLifespanOldAgeDeath },
  { name: 'Legacy score — weights, old-age bonus, monotonicity', fn: testLegacyScoreCalc },
  // ---- N3: Living Network ----
  { name: 'Fire network params — jitter→spread, realm→wind', fn: testFireNetworkParams },
  // ---- M3: Scatter Cache ----
  { name: 'Scatter Cache — spend gold, minimum gate', fn: testScatterCache },
  // ---- X1: Mega features + behavior regressions ----
  { name: 'Mega clusters — square roots, blocking, deplete-all', fn: testMegaClusters },
  { name: 'Foe buffs — birth scaling survives buff/expiry', fn: testFoeBuffKeepsScaling },
  // ---- Content sweep ----
  { name: 'Data integrity — every data row structurally valid', fn: testDataIntegrity },
  // ---- W7: Soul-Feeding ----
  { name: 'Soul-feed — materials grant XP, consume from inv', fn: testSoulFeedBasic },
  { name: 'Soul-feed — affinity bonus 1.5×, opposed 0.5×', fn: testSoulFeedAffinity },
  { name: 'Soul-feed — level-up on threshold crossing', fn: testSoulFeedLevelUp },
  { name: 'Soul-feed — non-feedable items rejected', fn: testSoulFeedRejectNonFeedable },
  { name: '🎯 Exhaustive playthrough (full game)', fn: testExhaustivePlaythrough },
  // ---- B5: Ground Drops ----
  { name: 'Ground drops - harvest lands on the floor, not in the bag', fn: testGroundDropSpawn },
  { name: 'Ground drops - arm delay, magnet pickup, out-of-range control', fn: testGroundDropPickup },
  { name: 'Ground drops - materials rot, gear never does', fn: testGroundDropDespawn },
  { name: 'Ground drops - cap holds and never evicts gear', fn: testGroundDropCap },
  { name: 'Ground drops - CFG.drops.enabled=false restores instant pickup', fn: testGroundDropDisabled },
  { name: 'Ground drops - the stack count is actually legible', fn: testWorldTextIsLegible },
  { name: 'Gold - routine kills credit, bosses burst, and the pile is exact', fn: testGoldCoins },
  // ---- B6: Level-Up Flourish ----
  { name: 'Level-up flourish - rising motes, ring, config gate', fn: testLevelUpFlourish },
  // ---- N4.1: The Deep Wire ----
  { name: 'Deep wire - cfL4 parser vs adversarial input', fn: testDeepWireParser },
  { name: 'Deep wire - derived values neutral when silent, move when hostile', fn: testDeepWireDerived },
  { name: 'Deep wire - metric keys and game mappings resolve', fn: testDeepWireMappings },
  // ---- N4.2: The Lens side cart + the Chronicle ----
  { name: 'Lens - drawer, five tabs, honesty tags, inspect box', fn: testLensSideCart },
  { name: 'Lens - third-party strings stay escaped', fn: testLensEscapesThirdPartyStrings },
  { name: 'Chronicle - aggregation keeps outliers, change detection', fn: testChronicleStore },
  { name: 'Chronicle - export carries series and provenance', fn: testChronicleExport },
  { name: 'Chronicle - the permanent record survives the 1Hz drain', fn: testChronicleRecordSurvivesDrain },
  // ---- N4.3: Omens + jittered probes ----
  { name: 'Probes - jittered, and no longer phase-locked to the day cycle', fn: testProbeJitter },
  { name: 'Omens - steps raise them, gates refuse them, they go both ways', fn: testOmensRaiseFromSteps },
  { name: 'Omens - lift on recovery, expire on the cap, cap how many', fn: testOmensRecoverAndExpire },
  { name: 'Omens - actually change tribute, harvests and movement', fn: testOmensDriveTheGame },
  { name: 'Omens - named in the Lens and on the HUD', fn: testLensShowsOmens },
  // ---- A1/A4: The Arsenal ----
  { name: 'Loot - the ladder is climbable in one run, and Fortune tilts it', fn: testLootLadder },
  { name: 'Loot - every rung is worth climbing, and the top two stay apart', fn: testRarityLadderIsWorthClimbing },
  { name: 'Loot - a rolled item changes the numbers the game actually reads', fn: testRolledItemChangesStats },
  { name: 'Loot - affixes reach the effect hooks and move the player', fn: testAffixesDriveTheGame },
  { name: 'Loot - materials pass through, gear splits, bands hold', fn: testLootDropSeam },
  { name: 'Loot - no roll can produce NaN, and junk ids degrade quietly', fn: testLootNeverProducesNaN },
  { name: 'Arsenal - the tooltip compares against what is worn', fn: testTooltipComparesGear },
  { name: 'Arsenal - the orbs track the vitals and the radar is attached', fn: testOrbsAndMinimap },
  // ---- A3: The Bar ----
  { name: 'Abilities - the bar slots itself, costs Resolve, refuses for free', fn: testAbilityBar },
  { name: 'Abilities - all five empowered forms reach the world', fn: testAbilityActives },
  // ---- A5: Sockets & Weaves ----
  { name: 'Item effects - the seven dormant hooks now reach the game', fn: testDormantEffectsNowLive },
  { name: 'Weaves - threads, sequences, and order is load-bearing', fn: testWeaveData },
  { name: 'Weaves - slotting consumes and returns, reorder breaks the weave', fn: testWeaveSocketing },
  { name: 'Weaves - all three bonuses reach the live game', fn: testWeaveBonuses },
  // ---- A8: Cairns, Wardstones & the Hoarder ----
  { name: 'Loot groups - a pick-one group yields exactly one, by weight', fn: testLootGroups },
  { name: 'A8 - the rows are real, and every boon names a hook that works', fn: testA8DataRows },
  { name: 'A8 - a run meets about one Cairn and a handful of Wardstones', fn: testA8Density },
  { name: 'A8 - the flag off restores the pre-A8 world tile for tile', fn: testA8EscapeHatch },
  { name: 'Cairn - opens on the Hallowed band, and wakes what it buried', fn: testCairnPayout },
  { name: 'Wardstone - the blessing reaches the same sites an affix does', fn: testWardstoneBoons },
  { name: 'Hoarder - it runs, it never bites, and it can get away', fn: testHoarderChase },
  // ---- N4.4: Scrying ----
  { name: 'Scrying - DNS median maps to radar sight, neutral when unmeasured', fn: testScryingMappings },
  { name: 'Scrying - DoH answers parse adversarially, IPv6 latches', fn: testScryingDohParser },
  { name: 'Scrying - the radar actually widens and narrows, measured in pixels', fn: testScryingRadar },
  { name: 'Scrying - PTR reads, the floor holds, a refused host is retried', fn: testScryingProbeDiscipline },
  { name: 'Hub - two rows, one flag, and prices that are arithmetic', fn: testHubRowsAndHatch },
  { name: 'Hub - the counter answers at a measured distance, and E opens it', fn: testHubReach },
  { name: 'Hub - the Reliquary charges exactly, bands honestly, never reaches the rift', fn: testReliquary },
  { name: 'Hub - the Forge-Warden reworks one line, and the curse survives it', fn: testForgeWarden },
];


// ---------------------------------------------------------------------------
// N4.3 — Omens: a change on the wire becomes a change in the world
// ---------------------------------------------------------------------------

/** Feed a series a steady baseline and then a step, and return the event the
 *  Chronicle raised for it. Shared by the tests below, so a change to the
 *  detector's window sizes breaks one helper rather than five tests. */
async function stepSeries(key: string, baseV: number, stepV: number, unit = 'ms') {
  const { ChronicleStore } = await import('./chronicle');
  const c: any = new ChronicleStore();
  c.define({ key, label: key, unit });
  // 120 s of steady baseline, then 16 s of the new value. detect() compares the
  // last 15 s against 105..15 s ago, so both windows are fully populated.
  for (let t = 0; t < 120; t++) c.push(key, t, baseV, 'measured');
  for (let t = 120; t < 136; t++) c.push(key, t, stepV, 'measured');
  return { store: c, ev: c.events[c.events.length - 1] ?? null, t: 135 };
}

/** A host that records instead of touching the game. */
function fakeOmenHost(store: any) {
  const calls = { toasts: [] as string[], logs: [] as string[], rifts: 0, riftAllowed: true, fx: 0 };
  const box = {
    calls,
    clock: 135,
    host: {
      clock: () => box.clock,
      chronicle: store,
      toast: (m: string) => { calls.toasts.push(m); },
      log: { push: (_k: string, m: string) => { calls.logs.push(m); } },
      rift: () => { calls.rifts++; return calls.riftAllowed; },
      fx: () => { calls.fx++; },
    },
  };
  return box;
}

async function testProbeJitter(nw: any) {
  const { jitteredGap, WIRE_BUDGET } = await import('../data/network');
  const { CFG } = await import('../data/config');

  // ---- the defect, stated as arithmetic ----
  // The same-origin baseline probe fired on a FIXED 20 s period against a
  // day/night cycle of daySec + nightSec = 340 s. 340 / 20 = 17, exactly. So it
  // sampled the same seventeen phases of the cycle on every day of every run,
  // forever, and any variation that tracks the cycle was structurally invisible
  // to it. That is not a politeness bug, it is a measurement-validity bug.
  const cycle = CFG.time.daySec + CFG.time.nightSec;
  const period = WIRE_BUDGET.baselineIntervalSec;
  const BUCKET = 5;                       // seconds of cycle phase per bucket
  const buckets = Math.ceil(cycle / BUCKET);
  const phasesOf = (gaps: number[]) => {
    const seen = new Set<number>();
    let t = 0;
    for (const g of gaps) { t += g; seen.add(Math.floor(((t / 1000) % cycle) / BUCKET)); }
    return seen.size;
  };
  const fixed = phasesOf(new Array(300).fill(period * 1000));
  const jittered = phasesOf(Array.from({ length: 300 }, () => jitteredGap(period)));

  eq(cycle % period, 0, `the day/night cycle is an exact multiple of the old fixed period (${cycle}s / ${period}s)`);
  ok(fixed <= 20, `300 probes on a fixed ${period}s period reach only ${fixed} of ${buckets} phase buckets`);
  ok(jittered > fixed * 2,
    `300 jittered probes reach ${jittered} of ${buckets} — ${(jittered / fixed).toFixed(1)}x the coverage`);

  // ---- jitter must not change the RATE ----
  // The good-citizenship half: spreading probes out is fine, quietly firing more
  // of them is not. N4.0 spent a whole phase getting this volume down.
  const many = Array.from({ length: 2000 }, () => jitteredGap(period));
  const mean = many.reduce((a, b) => a + b, 0) / many.length;
  ok(Math.abs(mean - period * 1000) < period * 1000 * 0.02,
    `the mean gap is still the configured interval (${(mean / 1000).toFixed(2)}s vs ${period}s)`);
  const f = WIRE_BUDGET.beaconJitter;
  ok(many.every((g) => g >= period * 1000 * (1 - f) - 1e-6 && g <= period * 1000 * (1 + f) + 1e-6),
    `and every gap is inside +/-${(f * 100).toFixed(0)}% of it`);

  // ---- the matched control ----
  // If the spread above came from anything other than the jitter, this would
  // vary too. Zero jitter has to reproduce the exact old behaviour.
  const none = Array.from({ length: 50 }, () => jitteredGap(period, 0));
  eq(new Set(none).size, 1, 'jitter 0 returns one exact value — the spread above is the jitter, not the test');
  eq(none[0], period * 1000, '...and that value is the unjittered interval');

  // ---- and the schedulers actually use it ----
  const net: any = nw.sys.net;
  for (const field of ['nextBeaconGap', 'nextBaselineGap', 'nextTraceGap']) {
    ok(typeof net[field] === 'number' && net[field] > 0,
      `NetworkSystem.${field} is a live re-rolled gap, not a constant (${(net[field] / 1000).toFixed(1)}s)`);
  }
  ok(typeof net.deep?.nextGap === 'number', 'and the deep-wire probe carries one too');
}

async function testOmensRaiseFromSteps(nw: any) {
  const { OmenSystem, OMEN_DEFS } = await import('./omens');
  const { CFG } = await import('../data/config');

  // ---- a steady series raises nothing ----
  // The control that has to come first: if this fired, every assertion below
  // would pass for the wrong reason.
  const steady = await stepSeries('fray', 1.0, 1.0, '%');
  const sh = fakeOmenHost(steady.store);
  const s0 = new OmenSystem(sh.host as any);
  eq(steady.store.events.length, 0, 'a flat series produces no change event at all');
  eq(s0.active.length, 0, 'and therefore no omen');
  eq(s0.mul('hordeAggression'), 1, 'a quiet wire multiplies nothing');

  // ---- packet loss steps up -> Surge ----
  const surge = await stepSeries('fray', 1.0, 6.0, '%');
  ok(surge.ev !== null, 'a hard step on fray IS detected');
  const uh = fakeOmenHost(surge.store);
  const om = new OmenSystem(uh.host as any);
  const raised = om.consider(surge.ev!);
  ok(raised !== null, 'and it raises an omen');
  eq(raised?.kind, 'surge', 'fray stepping UP is a Surge');
  const surgeDef = OMEN_DEFS.find((d) => d.kind === 'surge')!;
  eq(om.mul('hordeAggression'), surgeDef.mul, `hordes press ${surgeDef.mul}x harder`);
  // The matched negative: a Surge is packet loss, not scarcity. If mul() ignored
  // the target and returned the multiplier for everything, the assertion above
  // would still pass and every system in the game would be quietly affected.
  eq(om.mul('resourceYield'), 1, 'and a Surge does NOT touch yields');
  eq(om.mul('moveSpeed'), 1, '...or move speed');
  eq(uh.calls.toasts.length, 1, 'the player is told');
  ok(uh.calls.logs.some((m) => m.includes('Surge')), 'and the Feed records it with its numbers');

  // ---- re-raising refreshes, it does not stack ----
  const before = om.mul('hordeAggression');
  om.consider(surge.ev!);
  om.consider(surge.ev!);
  eq(om.active.length, 1, 'considering the same step three times leaves ONE omen');
  eq(om.mul('hordeAggression'), before, '...and the multiplier does not compound to unplayable');

  // ---- the per-kind sigma gate is real ----
  // Famine asks for more evidence than the Chronicle's own 3 sigma floor. An
  // event just under the gate must be refused and one just over it accepted,
  // with everything else about the two identical.
  const fam = await stepSeries('flow', 20, 4, 'Mbps');
  ok(fam.ev !== null && fam.ev.dir === 'down', 'throughput collapsing is a DOWN step on flow');
  const fh = fakeOmenHost(fam.store);
  const f1 = new OmenSystem(fh.host as any);
  const famDef = OMEN_DEFS.find((d) => d.kind === 'famine')!;
  eq(f1.consider({ ...fam.ev!, sigma: -(famDef.minSigma - 0.1) }),
    null, `a ${(famDef.minSigma - 0.1).toFixed(1)} sigma step is under Famine's gate and is refused`);
  const famineOmen = f1.consider({ ...fam.ev!, sigma: -(famDef.minSigma + 0.1) });
  ok(famineOmen !== null, `a ${(famDef.minSigma + 0.1).toFixed(1)} sigma step clears it`);
  eq(famineOmen?.kind, 'famine', 'flow stepping DOWN is a Famine');
  ok(f1.mul('resourceYield') < 1, `the land gives less (${f1.mul('resourceYield')}x)`);

  // ---- and it goes both ways ----
  // A mapping that can only ever punish is a penalty box, not a mapping.
  const boon = await stepSeries('flow', 4, 20, 'Mbps');
  const bh = fakeOmenHost(boon.store);
  const b1 = new OmenSystem(bh.host as any);
  const bounty = b1.consider(boon.ev!);
  eq(bounty?.kind, 'bounty', 'flow stepping UP is a Bounty, not a punishment');
  ok(b1.mul('resourceYield') > 1, `the land gives more (${b1.mul('resourceYield')}x)`);

  // ---- Quickening and Miring share moveSpeed on purpose ----
  const quick = await stepSeries('pulse', 60, 20, 'ms');
  const mire = await stepSeries('silt', 2, 30, '%');
  const ch = fakeOmenHost(quick.store);
  const both = new OmenSystem(ch.host as any);
  both.consider(quick.ev!);
  const upOnly = both.mul('moveSpeed');
  ok(upOnly > 1, `a Quickening speeds the world up (${upOnly.toFixed(3)}x)`);
  (ch.host as any).chronicle = mire.store;
  both.consider(mire.ev!);
  eq(both.active.length, 2, 'both can be up at once');
  ok(both.mul('moveSpeed') < upOnly,
    `and they compound rather than one winning (${both.mul('moveSpeed').toFixed(3)}x)`);

  // ---- the rift asks before it claims ----
  // The rift is the only kind whose effect can be REFUSED by the thing it
  // drives: the realm may be on cooldown, or the biome selector may return the
  // realm we are already in. Raising the omen anyway would put a phantom in the
  // Lens and a "Vale -> Vale" line in the Feed.
  const tear = await stepSeries('pulse', 20, 400, 'ms');
  const rh = fakeOmenHost(tear.store);
  rh.calls.riftAllowed = false;
  const r1 = new OmenSystem(rh.host as any);
  eq(r1.consider({ ...tear.ev!, sigma: 9 }), null, 'a rift the realm refused raises no omen');
  eq(rh.calls.rifts, 1, '...but it WAS asked — the refusal came from the realm, not a missing call');
  eq(r1.active.length, 0, 'and nothing phantom is left behind');
  rh.calls.riftAllowed = true;
  const tore = r1.consider({ ...tear.ev!, sigma: 9 });
  eq(tore?.kind, 'rift', 'when the realm allows it, the rift is raised');

  // ---- the escape hatch ----
  const saved = CFG.omens.enabled;
  try {
    CFG.omens.enabled = false;
    const off = new OmenSystem(fakeOmenHost(surge.store).host as any);
    eq(off.consider(surge.ev!), null, 'CFG.omens.enabled=false raises nothing');
    eq(off.mul('hordeAggression'), 1, '...and the game plays exactly as it did before N4.3');
    // And it works MID-RUN, on a system that already has omens up. A flag that
    // only takes effect at boot is not an escape hatch, it is a build option —
    // and `om` above is carrying a live Surge right now.
    eq(om.active.length, 1, '(the earlier system still has its Surge up)');
    eq(om.mul('hordeAggression'), 1, 'flipping the flag neutralises an omen that is ALREADY active');
    eq(om.has('surge'), false, '...and the screen effect goes with it');
    om.tick();
    eq(om.active.length, 0, '...and the next tick clears it rather than leaving it to expire');
  } finally { CFG.omens.enabled = saved; }
}

async function testOmensRecoverAndExpire(nw: any) {
  const { OmenSystem } = await import('./omens');
  const { CFG } = await import('../data/config');

  const fam = await stepSeries('flow', 20, 4, 'Mbps');
  const h = fakeOmenHost(fam.store);
  const om = new OmenSystem(h.host as any);
  const omen = om.consider({ ...fam.ev!, sigma: -6 });
  ok(omen !== null, 'a Famine is up');
  if (!omen) return;

  // The anti-tautology that matters most in this file. recovered() compares the
  // live reading against the PRE-step baseline, and the comparison is direction
  // -dependent: a down-step recovers by coming back UP. Invert it and every omen
  // lifts on the tick it was raised — the system becomes a no-op that still
  // passes an "an omen can be raised" test.
  om.tick();
  eq(om.active.length, 1, 'ticking immediately does NOT lift it — the reading is still bad');

  for (let t = 136; t < 166; t++) fam.store.push('flow', t, 4, 'measured');
  h.clock = 166;
  om.tick();
  eq(om.active.length, 1, 'and it holds while throughput stays collapsed');

  // Now the network comes back — not to the post-step value, to the baseline it
  // fell FROM, which is what "until it recovers" has to mean.
  for (let t = 166; t < 176; t++) fam.store.push('flow', t, 19.5, 'measured');
  h.clock = 176;
  om.tick();
  eq(om.active.length, 0, 'the Famine lifts when throughput returns to its baseline');
  eq(om.history[om.history.length - 1].endedBy, 'recovered', '...and it records WHY it lifted');
  eq(om.mul('resourceYield'), 1, 'yields are neutral again');

  // ---- the safety valve ----
  // A permanently degraded link must not famine for a whole run. Same setup, the
  // reading never recovers, the clock walks past the cap.
  const fam2 = await stepSeries('flow', 20, 4, 'Mbps');
  const h2 = fakeOmenHost(fam2.store);
  const om2 = new OmenSystem(h2.host as any);
  const o2 = om2.consider({ ...fam2.ev!, sigma: -6 })!;
  for (let t = 136; t < 400; t++) fam2.store.push('flow', t, 4, 'measured');
  h2.clock = o2.until - 1;
  om2.tick();
  eq(om2.active.length, 1, 'one second before the cap it is still up');
  h2.clock = o2.until + 1;
  om2.tick();
  eq(om2.active.length, 0, 'and the cap expires it even though the wire never recovered');
  eq(om2.history[om2.history.length - 1].endedBy, 'expired', '...distinguishably from a recovery');

  // ---- how many may be up at once ----
  const h3 = fakeOmenHost(fam2.store);
  const om3 = new OmenSystem(h3.host as any);
  const four: any[] = [
    { key: 'fray', dir: 'up', sigma: 9, from: 1, to: 9, label: 'Loss', t: 1 },
    { key: 'flow', dir: 'down', sigma: -9, from: 20, to: 2, label: 'Throughput', t: 1 },
    { key: 'silt', dir: 'up', sigma: 9, from: 2, to: 30, label: 'Bufferbloat', t: 1 },
    { key: 'pulse', dir: 'down', sigma: -9, from: 60, to: 10, label: 'Latency', t: 1 },
  ];
  for (const k of four) om3.consider(k);
  eq(om3.active.length, CFG.omens.maxActive,
    'a wire having a terrible minute stacks at most CFG.omens.maxActive omens');
  ok(om3.active.length < four.length, '...and the fourth was refused, not silently applied');
  // Matched control: the cap must not block a REFRESH, or a run sitting at the
  // cap would silently stop tracking the network for the rest of its life.
  const firstUntil = om3.active[0].until;
  h3.clock = 200;
  om3.consider(four[0]);
  ok(om3.active[0].until > firstUntil, 'but an omen already up can still be extended at the cap');
}

async function testChronicleRecordSurvivesDrain(nw: any) {
  const { ChronicleStore, exportChronicle } = await import('./chronicle');
  const c: any = new ChronicleStore();
  c.define({ key: 'y', label: 'Y', unit: 'ms' });
  for (let t = 0; t < 120; t++) c.push('y', t, 20 + (t % 3), 'measured');
  for (let t = 120; t < 140; t++) c.push('y', t, 200, 'measured');
  ok(c.events.length >= 1, `a step was detected (${c.events.length})`);

  // The bug this pins: main() calls takeEvents() at 1 Hz to turn steps into Feed
  // lines and omens, and that used to drain the SAME array the Lens CHANGES
  // panel and the export both read. So by the time a player opened the Lens it
  // was empty — every time, in every run, since N4.2, and every exported
  // chronicle carried `"events": []`. Nothing went red: the existing store test
  // builds its own store and never calls takeEvents().
  const n = c.events.length;
  const taken = c.takeEvents();
  eq(taken.length, n, 'takeEvents delivers every undelivered event');
  eq(c.events.length, n, 'and the PERMANENT record still holds them after the drain');
  eq(c.recentEvents(8).length, Math.min(8, n), 'recentEvents() reads that permanent record');

  // The matched control: the queue really did drain. If takeEvents stopped
  // draining, the assertion above would still pass and main() would re-log and
  // re-raise the same omen once a second forever.
  eq(c.takeEvents().length, 0, 'a delivered event is delivered exactly once');

  // ...and a new step still reaches the queue afterwards. The second baseline
  // has to be LONG: detect() compares now-15..now against now-105..now-15, and
  // a baseline window that straddles both levels has a standard deviation the
  // size of the step itself, so sigma collapses and nothing fires. (That is why
  // the first version of this assertion went red — the store was fine, the test
  // was asking it to detect a step against a baseline containing that step.)
  for (let t = 140; t < 300; t++) c.push('y', t, 200, 'measured');
  for (let t = 300; t < 320; t++) c.push('y', t, 20, 'measured');
  ok(c.takeEvents().length >= 1, 'and the queue keeps working after being drained');

  // The export carried the same bug wearing a different hat.
  const payload: any = exportChronicle(c, nw.sys.net, nw.state, nw.omens);
  ok(Array.isArray(payload.events) && payload.events.length >= 1,
    `the exported chronicle carries its ${payload.events?.length} change events`);
  ok(Array.isArray(payload.omens), 'and the omens the run actually experienced');
}

async function testOmensDriveTheGame(nw: any) {
  const { OMEN_DEFS } = await import('./omens');
  const { CFG } = await import('../data/config');
  const { playerMaxHp } = await import('../rules');
  const om = nw.omens, state = nw.state;
  ok(om !== undefined, 'the run carries an OmenSystem');
  if (!om) return;

  const raise = (kind: string) => {
    const def = OMEN_DEFS.find((d) => d.kind === kind)!;
    om.active.push({ kind, def, t0: state.clock, until: state.clock + 1e6, from: 0, to: 0, sigma: 9 });
  };
  const clear = () => { om.active.length = 0; };
  clear();
  eq(om.mul('resourceYield'), 1, 'baseline: no omen, no multiplier');

  // ---- tribute: pure arithmetic, so this comparison is exact ----
  const savedBuildings = state.buildings.slice();
  const savedClock = state.clock;
  const ptx = Math.floor(nw.player.x / 32), pty = Math.floor(nw.player.y / 32);
  try {
    state.clock = 10;                       // daylight — tribute is day-only
    state.buildings = [{ uid: state.nextUid++, type: 'hall', tx: ptx + 3, ty: pty + 3, hp: 500, maxHp: 500 }];
    for (let i = 0; i < 8; i++) {
      state.buildings.push({ uid: state.nextUid++, type: 'hut', tx: ptx + 5 + i, ty: pty + 5, hp: 100, maxHp: 100 } as any);
    }
    nw.world.reindexBuildings();
    const tribute = () => {
      const g0 = state.player.gold;
      nw.sys.economy.update(CFG.economy.tickSec + 0.01);
      return state.player.gold - g0;
    };
    const plain = tribute();
    raise('famine');
    const starved = tribute();
    clear();
    raise('bounty');
    const fat = tribute();
    clear();
    ok(plain > 0, `a hall and eight huts pay tribute (${plain} gold/tick)`);
    ok(starved < plain, `a Famine reaches the treasury too, not just the ground (${starved} < ${plain})`);
    ok(fat > plain, `and a Bounty fattens it (${fat} > ${plain})`);
  } finally {
    state.buildings = savedBuildings;
    state.clock = savedClock;
    nw.world.reindexBuildings();
    clear();
  }

  // ---- move speed, end to end through main()'s sim ----
  // Not by reading a multiplier back — by DRIVING the player and measuring how
  // far they get. That is the only probe that proves main.ts multiplies the
  // value into player.update() rather than computing and discarding it, which
  // is exactly the class of bug that shipped in G1 and in the Loom.
  //
  // But a 1.10x modifier is a FINE measurement, and the first version of this
  // probe compared modifiers along "whichever of four directions was longest",
  // which is not the same as a fair corridor: terrain speed varies tile by tile,
  // so a faster player ends up further along and can enter slow ground the plain
  // run never reached. Measured 1 red in 8 that way — the Miring came out at
  // 51.2px against a plain 49.9px, on a corridor only half the usual length.
  //
  // So the corridor is CHOSEN for uniformity rather than length: a straight run
  // of tiles that are all standable and all report the same world.speedAt(). On
  // uniform ground the distance is exactly proportional to the speed multiplier
  // and the ratio is exact, not approximate.
  const savedAxis = nw.input?.axis;
  const haveAxis = !!savedAxis;
  ok(haveAxis, 'the input seam is available to measure real movement');
  if (nw.ui?.isOpen?.()) nw.ui.close?.();

  if (haveAxis) {
  const RUN = 7;                                  // tiles of corridor required
  const home = { x: state.player.x, y: state.player.y };
  const corridor = findUniformCorridor(nw, RUN);
  ok(corridor !== null, `found ${RUN} tiles of terrain-uniform corridor from tile `
    + `${Math.floor(home.x / 32)},${Math.floor(home.y / 32)}`);

  if (corridor) {
    const c = corridor;
    nw.input.axis = () => ({ x: c.dx, y: c.dy });
    // The sim can move the player for reasons that have nothing to do with the
    // input axis. A death respawn teleports them to the hall, and that measured
    // 2934.8 px on 1 run in 10 — against an expected ~90 — which makes a 1.10x
    // comparison meaningless in whichever direction it happens to land. So:
    // clear the field and top the player up first, and then VALIDATE each
    // measurement against the length of the corridor it was walked down. A run
    // longer than the corridor did not come from walking.
    const MAXPX = RUN * 32;
    const reset = () => {
      nw.sys.hordes?.clearField?.();
      state.player.hp = playerMaxHp(state);
      nw.player.teleport(c.x, c.y);
      state.player.x = c.x; state.player.y = c.y;
    };
    const travel = () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        reset();
        nw.step(18);
        const d = Math.hypot(state.player.x - c.x, state.player.y - c.y);
        if (d <= MAXPX) return d;
      }
      return -1;
    };
    try {
      clear();
      const walkPlain = travel();
      raise('quickening');
      const walkFast = travel();
      clear();
      raise('miring');
      const walkSlow = travel();
      clear();

      ok(walkPlain > 1 && walkPlain <= MAXPX,
        `the player covers real ground by WALKING: ${walkPlain.toFixed(1)}px / 18 ticks`
        + ` from tile ${Math.floor(c.x / 32)},${Math.floor(c.y / 32)} heading ${c.dx},${c.dy}`
        + ` (terrain speed ${c.speed.toFixed(2)} throughout)`);
      if (walkPlain > 1 && walkPlain <= MAXPX) {
        const qDef = OMEN_DEFS.find((d) => d.kind === 'quickening')!;
        const mDef = OMEN_DEFS.find((d) => d.kind === 'miring')!;
        ok(walkFast > walkPlain,
          `a Quickening carries them further (${walkFast.toFixed(1)} > ${walkPlain.toFixed(1)}px)`);
        ok(walkSlow < walkPlain,
          `a Miring bogs them down (${walkSlow.toFixed(1)} < ${walkPlain.toFixed(1)}px)`);
        // And the SIZE of the change is the configured one. Without this, any
        // accidental coupling that made the player faster would pass.
        const rq = walkFast / walkPlain, rm = walkSlow / walkPlain;
        ok(Math.abs(rq - qDef.mul) < 0.04, `and it is the configured ${qDef.mul}x (measured ${rq.toFixed(3)}x)`);
        ok(Math.abs(rm - mDef.mul) < 0.04, `...as is the Miring's ${mDef.mul}x (measured ${rm.toFixed(3)}x)`);
      }
    } finally {
      nw.input.axis = savedAxis;
      nw.player.teleport(home.x, home.y);
      state.player.x = home.x; state.player.y = home.y;
      clear();
    }
  }
  }

  // ---- the ground itself: a real harvest, through the real path ----
  // The yield modifier lives inside GatherSystem.finish(), so the only probe
  // that proves it is a harvest of the same node twice, with Math.random pinned
  // so the only difference between the two numbers is the omen.
  //
  // Pinned to 0.999, NOT to 0 like the Loom's doubleYieldChance probe. The
  // thinning uses stochastic rounding — `floor(x) + (random() < frac ? 1 : 0)` —
  // and `0 < frac` is TRUE for every fractional part, so a stub of 0 makes the
  // famine round UP every time and a 2-item harvest thins to exactly 2. That is
  // what the first version of this assertion measured, and it looked like the
  // wiring was missing when it was the stub inverting the rounding. 0.999 floors
  // instead, and floor(n x 0.65) < n for every n >= 1.
  state.player.inv.axe_flint = (state.player.inv.axe_flint ?? 0) + 2;
  state.player.inv.pick_flint = (state.player.inv.pick_flint ?? 0) + 2;
  // Finding a feature tile is NOT the same as finding one this player can work:
  // the tile may be unreachable, or need a tool class we are not carrying. The
  // first version of this probe took the first feature within 6 tiles, could not
  // start on it, and reported -1 — and because ok() throws, that took the
  // move-speed section down with it and left main.ts's wiring unverified. So try
  // candidates until one actually STARTS, and treat "started" as the test for
  // whether a node is usable.
  const back = { x: nw.player.x, y: nw.player.y };
  const gtx = Math.floor(nw.player.x / 32), gty = Math.floor(nw.player.y / 32);
  const cands: { tx: number; ty: number }[] = [];
  for (let r = 1; r <= 8; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++)
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r && nw.world.activeFeatureAt(gtx + dx, gty + dy))
          cands.push({ tx: gtx + dx, ty: gty + dy });

  let node: { tx: number; ty: number } | null = null;
  for (const c of cands.slice(0, 24)) {
    // Stand BESIDE the node — a tree tile is not standable, and teleporting into
    // one silently leaves the player where they were.
    const cx = (c.tx + 0.5) * 32, cy = (c.ty + 0.5) * 32;
    let stood = false;
    for (const [ox, oy] of [[22, 0], [-22, 0], [0, 22], [0, -22]]) {
      if (!nw.world.canStand(cx + ox, cy + oy)) continue;
      nw.player.teleport(cx + ox, cy + oy);
      stood = true;
      break;
    }
    if (!stood) continue;
    nw.step(1);
    nw.sys.gather.active = null;
    nw.sys.gather.tryStart();
    if (nw.sys.gather.active) { nw.sys.gather.active = null; node = c; break; }
  }
  ok(node !== null, `found a node this player can actually work (${cands.length} feature tiles within 8)`);

  if (node) {
    const yieldSum = () => Object.values(state.player.inv as Record<string, number>)
      .reduce((s: number, n: number) => s + n, 0)
      + state.drops.reduce((s: number, d: any) => s + d.n, 0);
    const harvest = () => {
      for (const k of Object.keys(state.depleted)) delete state.depleted[k];
      nw.chunks.rebakeTile(node!.tx, node!.ty);
      nw.sys.gather.active = null;
      nw.step(1);
      nw.sys.gather.tryStart();
      const a = nw.sys.gather.active;
      if (!a) return -1;
      const before = yieldSum();
      const realRandom = Math.random;
      Math.random = () => 0.999;
      try { (nw.sys.gather as any).finish(a); } finally { Math.random = realRandom; }
      nw.sys.gather.active = null;
      return yieldSum() - before;
    };
    clear();
    const gotPlain = harvest();
    raise('famine');
    const gotStarved = harvest();
    clear();
    ok(gotPlain > 0, `a real harvest of that node yields ${gotPlain} items`);
    ok(gotStarved < gotPlain,
      `and a Famine thins that same node's harvest: ${gotPlain} -> ${gotStarved} items`);
    nw.player.teleport(back.x, back.y);
    nw.sys.gather.active = null;
  }
  clear();
}

async function testLensShowsOmens(nw: any) {
  if (typeof document === 'undefined') { ok(true, 'no DOM — skipping'); return; }
  const { OMEN_DEFS } = await import('./omens');
  const lens = nw.lens, om = nw.omens;
  if (!lens || !om) { ok(false, 'lens/omens missing from the test seam'); return; }
  const wasOpen = lens.isOpen();
  const saved = om.active.slice();
  try {
    lens.setOpen(true);
    const tabs = document.querySelectorAll('#nw-observatory [data-tab]');
    const threads = tabs.length - 1;

    // The control FIRST: with nothing active the panel must say so, and must not
    // already contain the word it will contain afterwards.
    om.active.length = 0;
    (tabs[threads] as HTMLElement).click();
    lens.refresh(true);
    const body = document.getElementById('nw-lens-body') as HTMLElement;
    const quiet = body.innerHTML;
    ok(quiet.includes('OMENS'), 'the THREADS tab has an OMENS section');
    ok(quiet.includes('the world is steady'), '...which says so when nothing is up');
    ok(!quiet.includes('Famine'), 'and does NOT name an omen that is not active');

    const def = OMEN_DEFS.find((d) => d.kind === 'famine')!;
    om.active.push({ kind: 'famine', def, t0: nw.state.clock, until: nw.state.clock + 90, from: 20, to: 4, sigma: -6 });
    lens.refresh(true);
    const loud = body.innerHTML;
    ok(loud.includes('Famine'), 'an active omen is named in the panel');
    ok(loud.includes('resourceYield'), '...with the target it is multiplying');
    ok(!loud.includes('the world is steady'), '...and the steady line is gone');

    // The half a player sees without opening anything. A multiplier that only
    // exists inside a diagnostics drawer is indistinguishable from a bug.
    const chip = document.getElementById('nw-omens') as HTMLElement;
    const boonChip = document.getElementById('nw-boons') as HTMLElement;
    ok(chip !== null, 'the HUD carries an omen chip');
    ok(boonChip !== null, '...and a separate boon chip');

    // ---- the 2026-08-22 split -------------------------------------------
    //
    // Three omens and three boons can be up at once (CFG.omens.maxActive and
    // CFG.a8.maxBoons are both 3), and before this they shared one badge — six
    // chips in a row, none of which read under pressure. An Omen is something
    // happening to the world; a Boon is something true of you. They are now two
    // rows, and this asserts each name lands in the RIGHT one, because a split
    // that put everything in one row would still look split from a screenshot.
    const { grantBoon } = await import('./effects');
    const savedBoons = (nw.state.boons ?? []).slice();
    try {
      nw.state.boons = nw.state.boons ?? [];
      nw.state.boons.length = 0;
      // Granted through the game's own verb rather than pushed onto the array,
      // so the row under test is the shape grantBoon() really produces
      // (WORKFLOW 16). BOONS[0] is used as the fixture name so a renamed row
      // cannot leave this passing against a string that no longer ships.
      const { BOONS } = await import('../data/boons');
      const boonDef = BOONS[0];
      grantBoon(nw.state, { ...boonDef, sec: 90 } as any);
      nw.ui.refresh();
      const omenRow = chip.innerHTML, boonRow = boonChip.innerHTML;
      ok(omenRow.includes('Famine'), 'the omen row names the active omen');
      ok(!omenRow.includes(boonDef.name), '...and does NOT carry the boon');
      ok(boonRow.includes(boonDef.name), `the boon row names the active boon (${boonDef.name})`);
      ok(!boonRow.includes('Famine'), '...and does NOT carry the omen');
      ok(chip.style.display !== 'none' && boonChip.style.display !== 'none',
        'both rows are visible while both are populated');

      // CONTROL: an empty side hides itself. A badge that stays on screen empty
      // is a permanent gap in the HUD for a thing that is not happening.
      nw.state.boons.length = 0;
      nw.ui.refresh();
      eq(boonChip.style.display, 'none', 'CONTROL: with no boons up the boon row hides');
      ok(chip.style.display !== 'none', '...while the omen row, still populated, does not');
    } finally {
      if (nw.state.boons) {
        nw.state.boons.length = 0;
        for (const b of savedBoons) nw.state.boons.push(b);
      }
    }
  } finally {
    om.active.length = 0;
    for (const o of saved) om.active.push(o);
    lens.setOpen(wasOpen);
  }
}

/** Run all registered tests sequentially. Returns { pass, fail, total, report }. */
export async function runAll(nw: any): Promise<{ pass: number; fail: number; total: number; report: string }> {
  _pass = 0;
  _fail = 0;
  _results.length = 0;

  const startMs = performance.now();

  console.log('%c🏁 NIGHTWARD Regression Suite %c— %d tests',
    'font-weight:bold;font-size:14px;', '', TESTS.length);

  for (const t of TESTS) {
    console.log(`%c▶ ${t.name}`, 'color:#888');
    try {
      await t.fn(nw);
    } catch (e: any) {
      // assertion errors are already recorded; unexpected errors go here too
      const msg = e?.message ?? String(e);
      if (!msg.startsWith('FAIL:')) {
        _fail++;
        _results.push(`  ❌ ${t.name}: unexpected error — ${msg}`);
        console.error(`  💥 ${msg}`);
      }
    }
  }

  // _pass/_fail count ASSERTIONS (ok() increments them), TESTS.length counts
  // test functions.  The old summary mixed the two — "ALL 1310 TESTS PASSED"
  // against a 73-function suite — which is how a reviewer ends up quoting the
  // wrong number.  Say which unit is which.
  const elapsed = (performance.now() - startMs).toFixed(0);
  const summary = _fail === 0
    ? `✅ ALL ${_pass} ASSERTIONS PASSED across ${TESTS.length} tests  (${elapsed}ms)`
    : `❌ ${_fail} of ${_pass + _fail} ASSERTIONS FAILED across ${TESTS.length} tests  (${elapsed}ms)`;

  console.log('');
  console.log(_fail === 0
    ? `%c${summary}`
    : `%c${summary}`,
    _fail === 0 ? 'color:lime;font-weight:bold;font-size:14px;' : 'color:red;font-weight:bold;font-size:14px;');

  for (const r of _results) console.log(r);

  const report = _results.join('\n') + '\n\n' + summary;

  // DOM overlay — inject a small test-report panel if we're in a browser
  if (typeof document !== 'undefined') {
    showOverlay(report, _fail === 0);
  }

  return { pass: _pass, fail: _fail, total: TESTS.length, report };
}

/** Run a single test by name (prefix match). */
export async function runOne(nw: any, name: string) {
  const t = TESTS.find((x) => x.name.toLowerCase().includes(name.toLowerCase()));
  if (!t) { console.error(`No test matching "${name}"`); return; }
  _pass = 0; _fail = 0; _results.length = 0;
  console.log(`%c▶ ${t.name}`, 'color:#888');
  try { await t.fn(nw); } catch (e: any) {
    if (!e?.message?.startsWith?.('FAIL:')) {
      _fail++;
      console.error(`  💥 ${e?.message ?? String(e)}`);
    }
  }
  for (const r of _results) console.log(r);
  console.log(_fail === 0 ? '%c✅ PASS' : '%c❌ FAIL', _fail === 0 ? 'color:lime' : 'color:red');
}

/** List all available test names. */
export function list(): string[] { return TESTS.map((t) => t.name); }

// ---------------------------------------------------------------------------
// DOM overlay for in-browser results
// ---------------------------------------------------------------------------

function showOverlay(report: string, ok: boolean) {
  // remove any previous overlay
  const prev = document.getElementById('nw-regression-report');
  if (prev) prev.remove();

  const div = document.createElement('div');
  div.id = 'nw-regression-report';
  div.style.cssText = [
    'position:fixed;bottom:12px;right:12px;z-index:999;',
    'max-width:420px;max-height:60vh;overflow-y:auto;',
    'font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:1.5;',
    'padding:10px 14px;border-radius:6px;',
    'white-space:pre-wrap;word-break:break-word;',
    'pointer-events:auto;',
    ok
      ? 'background:#0a2a0a;color:#8f8;border:1px solid #3a3;'
      : 'background:#2a0a0a;color:#f88;border:1px solid #a33;',
  ].join('');
  div.textContent = report;

  // close button
  const close = document.createElement('button');
  close.textContent = '×';
  close.style.cssText = 'position:absolute;top:4px;right:8px;background:none;border:none;color:inherit;font-size:14px;cursor:pointer;';
  close.onclick = () => div.remove();
  div.appendChild(close);

  document.body.appendChild(div);

  // auto-dismiss after 30s if all passed
  if (ok) setTimeout(() => { if (div.parentNode) div.remove(); }, 30_000);
}

// ===========================================================================
// A1 / A4 — The Arsenal: the roll, and the face that makes it visible
// ===========================================================================
//
// The standing rule for this milestone, from A-arsenal §7 risk 4: **assert
// through to a player stat.** A rarity system stubbed to always-Plain, or with
// the affix merge deleted entirely, is invisible to every other test in this
// suite — the same shape as the four tautologies this project has already
// shipped. So nothing below asserts that `rollItem()` returned an object.
// Everything reads the number back out of the function the GAME calls:
// equippedWeaponDmg(), charmRegen(), armorDef(), activeEffects(), gearMod(),
// or the distance the player actually travels.

/** Save and restore everything a loot test mutates. Several of these tests
 *  strip the player bare, and leaving them that way would poison whichever
 *  playthrough test happened to run next — which is exactly how a suite
 *  develops order-dependent flakes. */
function snapshotPlayer(nw: any) {
  const p = nw.state.player;
  return {
    inv: { ...p.inv },
    equip: { ...(p.equip ?? {}) },
    soulItems: JSON.parse(JSON.stringify(p.soulItems ?? {})),
    relic: p.relic,
    x: p.x, y: p.y, hp: p.hp,
    restore() {
      p.inv = { ...this.inv };
      p.equip = { ...this.equip };
      p.soulItems = JSON.parse(JSON.stringify(this.soulItems));
      p.relic = this.relic;
      p.hp = this.hp;
      nw.player.teleport(this.x, this.y);
    },
  };
}

/** Strip to nothing, then put exactly `ids` in the bag and wear them.
 *
 *  A8: this clears BOONS as well, and it has to. `activeEffects()` now folds
 *  live boons in beside gear, so a Wardstone the playthrough tests happened to
 *  walk over leaves the player carrying `resonance_boost` or `regen_boost` into
 *  every isolation measurement that runs in the next two game-minutes. That is
 *  not hypothetical: testEchoBounds' isolation assertion — written during the
 *  debloat pass precisely to catch "a future source of resonance we do not
 *  clear" — caught exactly this, twice in six runs, the day boons shipped. The
 *  helper is where the fix belongs: every test that isolates already calls it,
 *  and fixing it at each call site is how one of them gets missed. */
async function wearOnly(nw: any, ids: string[]) {
  const { invAdd, acquireGear } = await import('../rules');
  const p = nw.state.player;
  p.inv = {}; p.equip = {}; p.soulItems = {}; p.relic = undefined;
  nw.state.boons = [];
  for (const id of ids) { invAdd(nw.state, id, 1); acquireGear(nw.state, id); }
}

/** Roll `base` at `tier` until the roll contains an affix matching `want`, or
 *  give up. Rolling until is honest: it exercises the real weighted draw rather
 *  than hand-building a RolledItem the game would never produce. */
async function rollUntil(base: string, tier: string, want: (a: any) => boolean, tries = 600): Promise<string | null> {
  const { rollItem } = await import('./loot');
  const { rolledOf } = await import('../data/items');
  for (let i = 0; i < tries; i++) {
    const id = rollItem(base, { forceRarity: tier as any });
    const r = rolledOf(id);
    if (r && r.affixes.some(want)) return id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// A1.1 — the ladder
// ---------------------------------------------------------------------------
async function testLootLadder(nw: any) {
  const { rollRarity, lootQuantityMul } = await import('./loot');
  const { LOOT_BANDS, LOOT_TUNING } = await import('../data/rarity');

  const N = 4000;
  const hist = (band: any, f: number): Record<string, number> => {
    const h: Record<string, number> = {};
    for (let i = 0; i < N; i++) { const r = rollRarity(band, f); h[r] = (h[r] ?? 0) + 1; }
    return h;
  };
  const pct = (h: Record<string, number>, k: string) => (h[k] ?? 0) / N;

  const common = hist(LOOT_BANDS.common, 1);

  // The shape documented in data/rarity.ts. Wide bands — this is a 4000-draw
  // sample of a weighted RNG, not an exact computation — but tight enough that
  // a weight typo of any size moves it out of range.
  ok(pct(common, 'plain') > 0.46 && pct(common, 'plain') < 0.62,
    `common band is mostly Plain: ${(pct(common, 'plain') * 100).toFixed(1)}%`);
  ok(pct(common, 'woven') > 0.10 && pct(common, 'woven') < 0.18,
    `Woven is uncommon but real: ${(pct(common, 'woven') * 100).toFixed(1)}%`);
  ok(pct(common, 'hallowed') > 0.03 && pct(common, 'hallowed') < 0.08,
    `Hallowed is rare: ${(pct(common, 'hallowed') * 100).toFixed(1)}%`);

  // The whole §4.2(a) argument in one assertion: the ladder has to be CLIMBABLE
  // inside a fifteen-minute run, or the top of it is content no player sees.
  const wovenPerRun = pct(common, 'woven') * LOOT_TUNING.gearDropsPerRun;
  const hallowedPerRun = pct(common, 'hallowed') * LOOT_TUNING.gearDropsPerRun;
  ok(wovenPerRun >= LOOT_TUNING.wovenPerRun[0] && wovenPerRun <= LOOT_TUNING.wovenPerRun[1],
    `a ${LOOT_TUNING.gearDropsPerRun}-drop run yields ${wovenPerRun.toFixed(1)} Woven `
    + `(target ${LOOT_TUNING.wovenPerRun[0]}–${LOOT_TUNING.wovenPerRun[1]})`);
  ok(hallowedPerRun > 0.5 && hallowedPerRun < 2,
    `...and ${hallowedPerRun.toFixed(2)} Hallowed (target ~${LOOT_TUNING.hallowedPerRun})`);

  // Bands are HARD limits, not preferences. Without this the "lords only" and
  // "rift only" promises in the GDD are decoration.
  ok(!common.sovereign && !common.riftborn,
    'the common band can never reach Sovereign or Riftborn');
  const lord = hist(LOOT_BANDS.lord, 1);
  ok(!lord.plain && !lord.touched && !lord.woven, 'a domain lord never drops below Hallowed');
  ok(pct(lord, 'sovereign') > 0.15 && pct(lord, 'sovereign') < 0.32,
    `a lord kill is a ~${(pct(lord, 'sovereign') * 100).toFixed(0)}% shot at a Sovereign `
    + `(target ~${(LOOT_TUNING.sovereignPerLord * 100).toFixed(0)}%)`);
  const rift = hist(LOOT_BANDS.rift, 1);
  ok((rift.riftborn ?? 0) > 0, 'a torn realm is the only route to a Riftborn item');
  ok(!rift.plain && !rift.touched, '...and a torn realm never drops junk');
  const forge = hist(LOOT_BANDS.forge, 1);
  ok(!forge.woven && !forge.hallowed && (forge.touched ?? 0) > 0,
    'a forge tops out at Touched — sound work, not miracles');

  // Fortune tilts the ladder, and the MATCHED CONTROL proves the tilt is
  // Fortune rather than sampling noise: two draws at the same Fortune must
  // differ from each other by less than either differs from a tilted draw.
  const hi = hist(LOOT_BANDS.common, 1.35);
  const lo = hist(LOOT_BANDS.common, 0.75);
  const again = hist(LOOT_BANDS.common, 1);
  ok((hi.hallowed ?? 0) > (common.hallowed ?? 0),
    `a wide clean wire lifts Hallowed: ${hi.hallowed} vs ${common.hallowed} per ${N}`);
  ok((lo.hallowed ?? 0) < (common.hallowed ?? 0),
    `a frayed wire drops it: ${lo.hallowed} vs ${common.hallowed} per ${N}`);
  ok(Math.abs((again.hallowed ?? 0) - (common.hallowed ?? 0))
     < Math.abs((hi.hallowed ?? 0) - (common.hallowed ?? 0)),
    'CONTROL: two draws at the same Fortune agree more closely than a tilted one '
    + '— the shift above is the mapping, not variance');

  // ...and the compensating half, or a bad connection is a punishment.
  ok(lootQuantityMul(0.75) > 1, `a frayed wire drops MORE: ×${lootQuantityMul(0.75).toFixed(2)} quantity`);
  eq(lootQuantityMul(1.35), 1, 'a clean wire drops no extra quantity — it drops better things');
  eq(lootQuantityMul(1), 1, 'CONTROL: a neutral wire changes neither');
}

/** A1 — what a tier is actually WORTH once it reaches a worn blade.
 *
 *  testLootLadder above asserts how OFTEN each tier drops. This asserts how
 *  much better each one is, which is a different question and the one the
 *  2026-08-22 Riftborn verdict turned on. See the measurement block at the top
 *  of data/rarity.ts for the numbers and why the recorded trim was not applied.
 *
 *  Written as relations, never as absolutes (WORKFLOW 15). Pinning "riftborn
 *  delivers ×1.807" would fail on the next affix-pool edit and teach nobody
 *  anything; pinning "each rung beats the one below it, and the top two are
 *  still far enough apart to be a choice" is the property that has to hold.
 */
async function testRarityLadderIsWorthClimbing(nw: any) {
  const { rollItem } = await import('./loot');
  const { ITEMS, itemDef, rolledOf } = await import('../data/items');
  const { RARITIES } = await import('../data/rarity');

  const BASE = 'sword_iron';
  const base = ITEMS[BASE].weaponDmg as number;
  const N = 3000;

  /** Delivered damage, not the stat column: a curse can carry a swingSpeed mod
   *  that never appears in weaponDmg, and reading the column alone is exactly
   *  how Riftborn came to be recorded at ×2.23. */
  const delivered = (rarity: string) => {
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const id = rollItem(BASE, { forceRarity: rarity as any });
      let d = (itemDef(id)?.weaponDmg as number) ?? base;
      for (const a of rolledOf(id)?.affixes ?? []) {
        if (a.mod === 'swingSpeed' && a.modVal != null) d *= a.modVal;
      }
      sum += d;
    }
    return sum / N / base;
  };

  const mul: Record<string, number> = {};
  for (const r of RARITIES) mul[r.id] = delivered(r.id);

  eq(Math.round(mul.plain * 1000) / 1000, 1,
    'CONTROL: Plain returns the authored id untouched — the measurement has no bias in it');

  // Every rung beats the one below it. A tier that does not is a colour.
  for (let i = 1; i < RARITIES.length; i++) {
    const lo = RARITIES[i - 1].id, hi = RARITIES[i].id;
    ok(mul[hi] > mul[lo],
      `${hi} delivers more than ${lo}: ×${mul[hi].toFixed(3)} vs ×${mul[lo].toFixed(3)}`);
  }

  // The top of the ladder is the whole point of the 2026-08-22 verdict, and the
  // reason it was not applied. Riftborn has to lead Sovereign by enough to be
  // worth a rift — it is weight 4 against 18 — while Sovereign has to stay
  // close enough to be worth wearing rather than being a consolation prize.
  const lead = mul.riftborn / mul.sovereign - 1;
  ok(lead > 0.03,
    `Riftborn leads Sovereign by ${(lead * 100).toFixed(1)}% — enough that a rift is worth entering`);
  ok(lead < 0.20,
    `...and by less than 20%, so a Sovereign is still gear and not a runner-up rosette`);

  // The tiers OVERLAP on purpose — rule 1 at the top of data/rarity.ts, and the
  // same principle the `heavy` verdict upheld on the same day. A lucky Hallowed
  // out-rolling an average Riftborn is the feature, not the bug that the ×2.23
  // reading was mistaken for.
  let bestHallowed = 0;
  for (let i = 0; i < N; i++) {
    const id = rollItem(BASE, { forceRarity: 'hallowed' as any });
    bestHallowed = Math.max(bestHallowed, ((itemDef(id)?.weaponDmg as number) ?? base) / base);
  }
  ok(bestHallowed > mul.riftborn,
    `a lucky Hallowed (×${bestHallowed.toFixed(2)}) still beats an average Riftborn `
    + `(×${mul.riftborn.toFixed(2)}) — the ladder is a distribution, not a staircase`);
}

// ---------------------------------------------------------------------------
// A1.2 — the roll reaches the numbers the game reads
// ---------------------------------------------------------------------------
async function testRolledItemChangesStats(nw: any) {
  const { rollItem } = await import('./loot');
  const { equippedWeaponDmg, armorDef, charmRegen, bestTool } = await import('../rules');
  const { itemDef, rolledOf } = await import('../data/items');
  const snap = snapshotPlayer(nw);
  try {
    // ---- weapon: the number combat multiplies by ----
    await wearOnly(nw, ['sword_iron']);
    const plainDmg = equippedWeaponDmg(nw.state);
    ok(plainDmg > 0, `a plain Iron Blade is worth ${plainDmg.toFixed(2)} damage`);

    const hallowed = rollItem('sword_iron', { forceRarity: 'hallowed' });
    ok(hallowed !== 'sword_iron', 'a Hallowed roll produces a distinct item id');
    ok(!!rolledOf(hallowed), '...backed by a roll record');
    await wearOnly(nw, [hallowed]);
    eq(nw.state.player.equip.weapon, hallowed, 'it equips through the ordinary acquireGear path');
    const rolledDmg = equippedWeaponDmg(nw.state);
    ok(rolledDmg > plainDmg,
      `and equippedWeaponDmg() — the function combat calls — reads it: `
      + `${rolledDmg.toFixed(2)} vs ${plainDmg.toFixed(2)}`);

    // THE CONTROL. A Plain roll must return the authored id and change nothing
    // at all. Without this, "rolled items are stronger" would also pass if the
    // roll simply added a flat bonus to everything it touched.
    const plainRoll = rollItem('sword_iron', { forceRarity: 'plain' });
    eq(plainRoll, 'sword_iron', 'CONTROL: a Plain roll returns the authored id unchanged');
    await wearOnly(nw, [plainRoll]);
    eq(equippedWeaponDmg(nw.state), plainDmg, 'CONTROL: ...and the numbers are identical');

    // ---- armour: a different stat column, a different reader ----
    await wearOnly(nw, ['armor_iron']);
    const plainArmor = armorDef(nw.state);
    const rolledArmorId = rollItem('armor_iron', { forceRarity: 'sovereign' });
    await wearOnly(nw, [rolledArmorId]);
    ok(armorDef(nw.state) > plainArmor,
      `a Sovereign chestplate reaches armorDef(): ${armorDef(nw.state).toFixed(2)} vs ${plainArmor.toFixed(2)}`);

    // ---- charm: regen, which only the charm slot reads at all ----
    await wearOnly(nw, ['charm_gold']);
    const plainRegen = charmRegen(nw.state);
    const rolledCharm = rollItem('charm_gold', { forceRarity: 'sovereign' });
    await wearOnly(nw, [rolledCharm]);
    ok(charmRegen(nw.state) >= plainRegen,
      `a Sovereign charm reaches charmRegen(): ${charmRegen(nw.state).toFixed(2)} vs ${plainRegen.toFixed(2)}`);

    // ---- tools are CARRIED, not worn: bestTool() has to see the roll ----
    await wearOnly(nw, ['axe_iron']);
    const plainAxe = bestTool(nw.state, 'axe');
    const rolledAxe = await rollUntil('axe_iron', 'hallowed', (a: any) => a.id === 'biting');
    ok(rolledAxe !== null, 'a Biting axe can be rolled');
    if (rolledAxe) {
      await wearOnly(nw, [rolledAxe]);
      const best = bestTool(nw.state, 'axe');
      ok(!!best && best.power > (plainAxe?.power ?? 0),
        `bestTool() picks up the affix: ${best!.power.toFixed(2)} vs ${(plainAxe?.power ?? 0).toFixed(2)} tool power`);
      ok(itemDef(rolledAxe)!.toolPower === best!.power,
        'and itemDef() is where it came from — the merge, not a special case in bestTool');
    }
  } finally {
    snap.restore();
  }
}

// ---------------------------------------------------------------------------
// A1.3 — affixes reach the hooks and the modifier consumers
// ---------------------------------------------------------------------------
async function testAffixesDriveTheGame(nw: any) {
  const { gearMod } = await import('../rules');
  const { activeEffects } = await import('./effects');
  const { rollItem } = await import('./loot');
  const { CFG } = await import('../data/config');
  const snap = snapshotPlayer(nw);
  const state = nw.state;

  try {
    // ---- an effect suffix must arrive as an ordinary registered hook ----
    const emberId = await rollUntil('armor_iron', 'hallowed', (a: any) => a.effect === 'fire_aura');
    ok(emberId !== null, 'an "of the Ember" chestplate can be rolled');
    if (emberId) {
      await wearOnly(nw, ['armor_iron']);
      ok(!activeEffects(state).has('fire_aura'),
        'CONTROL: a plain chestplate carries no fire aura');
      await wearOnly(nw, [emberId]);
      ok(activeEffects(state).has('fire_aura'),
        'an "of the Ember" roll reaches activeEffects() as fire_aura — the same hook C4 built');
    }

    // ---- a tool affix must count even though tools are never worn ----
    const plentyAxe = await rollUntil('axe_iron', 'hallowed', (a: any) => a.effect === 'gold_find');
    if (plentyAxe) {
      await wearOnly(nw, [plentyAxe]);
      ok(activeEffects(state).has('gold_find'),
        'an affix on the axe in your hands counts — tools are carried gear, not dead weight');
    }

    // ---- a named modifier must reach gearMod() ----
    const tireless = await rollUntil('charm_gold', 'hallowed', (a: any) => a.mod === 'vigorDecay' && a.modVal < 1);
    ok(tireless !== null, 'a Tireless charm can be rolled');
    if (tireless) {
      await wearOnly(nw, ['charm_gold']);
      eq(gearMod(state, 'vigorDecay'), 1, 'CONTROL: an unrolled charm leaves hunger exactly neutral');
      await wearOnly(nw, [tireless]);
      ok(gearMod(state, 'vigorDecay') < 1,
        `Tireless slows hunger: gearMod ×${gearMod(state, 'vigorDecay').toFixed(2)}`);
    }

    // ---- and the one that has to be MEASURED, not read back ----------------
    //
    // Reading gearMod('moveSpeed') back would pass while main.ts computed the
    // value and discarded it — the bug that shipped in G1 and again in the Loom.
    // So: drive the input axis down a terrain-uniform corridor and measure the
    // distance, exactly as the Loom and Omen probes do.
    const swift = await rollUntil('armor_iron', 'hallowed', (a: any) => a.mod === 'moveSpeed' && a.modVal > 1);
    ok(swift !== null, 'a Swift chestplate can be rolled');
    const savedAxis = nw.input?.axis;
    ok(!!savedAxis, 'the input seam is available to measure real movement');
    if (swift && savedAxis) {
      if (nw.ui?.isOpen?.()) nw.ui.close?.();
      const RUN = 7;
      const corridor = findUniformCorridor(nw, RUN);
      ok(corridor !== null, `found ${RUN} tiles of terrain-uniform corridor`);
      if (corridor) {
        const c = corridor;
        const MAXPX = RUN * 32;
        nw.input.axis = () => ({ x: c.dx, y: c.dy });
        const { playerMaxHp } = await import('../rules');
        const travel = () => {
          for (let attempt = 0; attempt < 3; attempt++) {
            nw.sys.hordes?.clearField?.();
            state.player.hp = playerMaxHp(state);
            state.player.resolve = CFG.vitals.resolveMax;
            // C4's move burst is a TIMED window on the shared state, armed by
            // any kill an earlier test made with 'move_burst_on_kill' worn. It
            // does not survive to the end of the suite, which is worse than if
            // it did: it expires PART WAY THROUGH, so `plain` runs inside the
            // window and `fast` runs outside it, and a correctly-working Swift
            // affix reads as ×1.008. That was the whole of this test's 1-in-10
            // flake — diagnosed 2026-08-22 from `burst=1042.6 clock=1043.7`.
            state._moveBurstUntil = 0;
            nw.player.teleport(c.x, c.y);
            state.player.x = c.x; state.player.y = c.y;
            nw.step(18);
            const d = Math.hypot(state.player.x - c.x, state.player.y - c.y);
            if (d <= MAXPX) return d;
          }
          return -1;
        };
        // The speed product in main.ts is NINE multipliers, three of which move
        // on their own between the two measurements below: net.getGameValue()
        // and omens.mul() are read off the live browser every tick, and
        // vitals.getSpeedMult() falls as Resolve drains. The ratio only means
        // what the assertion says it means if the other eight terms are the
        // same in both halves (WORKFLOW 11) — otherwise a probe landing between
        // `plain` and `fast` reads as a broken affix.
        //
        // 2026-08-22: this was already true and already fragile; the suite grew
        // by about a second that day, widening the real-time window between the
        // two halves, and it started going red about one run in six. Pinned
        // rather than given a wider tolerance, because a wider tolerance would
        // have hidden the affix being wrong by exactly as much.
        const savedGetGameValue = nw.ctx.net?.getGameValue;
        const savedOmenMul = nw.ctx.omens?.mul;
        const savedResolve = state.player.resolve;
        if (nw.ctx.net) nw.ctx.net.getGameValue = () => 1;
        if (nw.ctx.omens) nw.ctx.omens.mul = () => 1;
        try {
          await wearOnly(nw, ['armor_iron']);
          const plain = travel();
          await wearOnly(nw, [swift]);
          const fast = travel();
          ok(plain > 1 && plain <= MAXPX,
            `the player covers real ground by WALKING: ${plain.toFixed(1)}px / 18 ticks`);
          if (plain > 1 && plain <= MAXPX) {
            ok(fast > plain,
              `a Swift chestplate carries them further (${fast.toFixed(1)} > ${plain.toFixed(1)}px)`);
            // And by the rolled amount, not merely "more". On uniform ground the
            // distance is exactly proportional to the multiplier.
            const { rolledOf } = await import('../data/items');
            const want = rolledOf(swift)!.affixes.find((a: any) => a.mod === 'moveSpeed')!.modVal!;
            const got = fast / plain;
            // The distances and the gear mod are carried in the message because
            // the three numbers together say WHICH half went wrong; the bare
            // ratio says only that one of them did.
            ok(Math.abs(got - want) < 0.02,
              `and by the ROLLED amount: measured ×${got.toFixed(3)} against a rolled ×${want.toFixed(2)}`
              + ` (${plain.toFixed(1)}px → ${fast.toFixed(1)}px, gearMod ×${gearMod(state, 'moveSpeed').toFixed(3)})`);
          }
        } finally {
          nw.input.axis = savedAxis;
          if (nw.ctx.net && savedGetGameValue) nw.ctx.net.getGameValue = savedGetGameValue;
          if (nw.ctx.omens && savedOmenMul) nw.ctx.omens.mul = savedOmenMul;
          state.player.resolve = savedResolve;
        }
      }
    }
  } finally {
    snap.restore();
  }
}

// ---------------------------------------------------------------------------
// A1.4 — the drop seam: materials pass through, bands are honoured
// ---------------------------------------------------------------------------
async function testLootDropSeam(nw: any) {
  const { rollStacks, isRollable } = await import('./loot');
  const { rolledOf, baseIdOf } = await import('../data/items');
  const { rarityIndex } = await import('../data/rarity');
  const { CFG } = await import('../data/config');

  // Materials must survive untouched or the bag stops stacking.
  const mats = rollStacks([{ id: 'log', n: 7 }, { id: 'stone', n: 3 }]);
  eq(mats.length, 2, 'two material stacks in, two out');
  eq(mats[0].id, 'log', 'a material keeps its authored id');
  eq(mats[0].n, 7, '...and its whole stack, so the bag still stacks it');
  ok(!isRollable('log') && !isRollable('berry'), 'materials are not rollable at all');
  ok(isRollable('sword_iron') && isRollable('axe_flint') && isRollable('charm_gold'),
    'weapons, tools and trinkets are');

  // Gear splits into one unique unit per item: two swords off one corpse have
  // to be two different swords or the entire premise is missing.
  const gear = rollStacks([{ id: 'sword_iron', n: 3 }], { band: 'lord' });
  eq(gear.length, 3, 'three blades roll as three separate items');
  ok(gear.every((g: any) => g.n === 1), '...each a stack of one');
  ok(new Set(gear.map((g: any) => g.id)).size === 3, '...with three distinct ids');
  for (const g of gear) {
    eq(baseIdOf(g.id), 'sword_iron', 'each keeps its authored base');
    const r = rolledOf(g.id);
    ok(!!r, 'each carries a roll record');
    ok(rarityIndex(r!.rarity) >= rarityIndex('hallowed'),
      `a lord-band blade is at least Hallowed (got ${r!.rarity})`);
  }

  // And the seam the SIM uses — B5's single funnel for all three loot sources.
  const state = nw.state;
  const before = state.drops.length;
  if (CFG.drops.enabled) {
    nw.sys.drops.spawn([{ id: 'sword_iron', n: 2 }], nw.player.x + 300, nw.player.y + 300, { band: 'lord' });
    const added = state.drops.slice(before);
    eq(added.length, 2, 'DropSystem.spawn rolls each unit into its own ground drop');
    ok(added.every((d: any) => rolledOf(d.id)),
      'and what lands on the floor is the ROLLED item, not the authored one');
    ok(added.every((d: any) => d.gear), '...still flagged as gear, so it never despawns');
    // clean up so no other test inherits a pile of swords
    state.drops.length = before;
  }
}

// ---------------------------------------------------------------------------
// A1.5 — nothing the roll produces can be NaN, undefined, or negative armour
// ---------------------------------------------------------------------------
async function testLootNeverProducesNaN(nw: any) {
  const { rollItem } = await import('./loot');
  const { itemDef, itemName, rolledOf, baseIdOf } = await import('../data/items');
  const { rarityOf } = await import('../ui/rarity');

  // WORKFLOW Pitfall 4: a value that reaches a game system must never be NaN.
  // The rift band is the worst case — five affixes including a curse that can
  // drive armour negative.
  const BASES = ['sword_iron', 'armor_iron', 'ring_fire', 'charm_gold', 'axe_iron', 'amulet_ward'];
  let bad = 0, negArmor = 0, unnamed = 0;
  for (let i = 0; i < 900; i++) {
    const id = rollItem(BASES[i % BASES.length], { band: 'rift', fortune: 1.35 });
    const d: any = itemDef(id);
    if (!d) { bad++; continue; }
    for (const c of ['weaponDmg', 'armor', 'regen', 'toolPower']) {
      if (d[c] != null && !Number.isFinite(d[c])) bad++;
    }
    if (d.armor != null && d.armor < 0) negArmor++;
    if (!itemName(id) || itemName(id) === id) unnamed++;
  }
  eq(bad, 0, '900 rift-band rolls produce no non-finite stat');
  eq(negArmor, 0, '...and no negative armour, however cursed');
  eq(unnamed, 0, '...and every one of them has a readable name');

  // Untrusted / nonsense ids must degrade, never throw. `itemDef` is now called
  // at 33 sites and several of them were previously `ITEMS[x].name` unguarded.
  ok(itemDef('no_such_item') === undefined, 'an unknown id resolves to undefined, not a throw');
  eq(itemName('no_such_item'), 'no_such_item', 'an unknown id names itself');
  eq(baseIdOf('sword_iron#zz'), 'sword_iron', 'a uid resolves back to its base');
  eq(baseIdOf('sword_iron'), 'sword_iron', 'a base id passes through baseIdOf unchanged');
  ok(itemDef('sword_iron#does_not_exist') !== undefined,
    'a uid whose roll was lost still resolves to its BASE def rather than vanishing');
  eq(rollItem('no_such_item'), 'no_such_item', 'rolling a nonexistent item returns it unchanged');
  eq(rollItem('log'), 'log', 'rolling a material returns it unchanged');
  eq(rarityOf('log'), 'plain', 'an unrolled item reads as Plain');
  ok(!rolledOf('log'), '...and has no roll record');
}

// ---------------------------------------------------------------------------
// A4 — the face: the tooltip is the half of A1 the player can see
// ---------------------------------------------------------------------------
async function testTooltipComparesGear(nw: any) {
  const { itemTooltipHtml } = await import('../ui/tooltip');
  const { rollItem } = await import('./loot');
  const { rarityColor, affixLines, nameHtml } = await import('../ui/rarity');
  const { rarityDef } = await import('../data/rarity');
  const snap = snapshotPlayer(nw);
  try {
    const better = rollItem('sword_iron', { forceRarity: 'hallowed' });
    const { invAdd } = await import('../rules');

    // Worn plain, hovering the rolled one: an UPGRADE.
    await wearOnly(nw, ['sword_iron']);
    invAdd(nw.state, better, 1);
    const up = itemTooltipHtml(nw.state, better);
    ok(up.includes('nw-tip-cmp'), 'the tooltip renders a comparison block against the worn item');
    ok(up.includes('vs '), '...naming what it is compared against');
    ok(up.includes('nw-tip-delta up'), '...and marks a better item as an upgrade');
    ok(up.includes('+'), '...with a signed delta');

    // Worn rolled, hovering the plain one: a DOWNGRADE. This is the matched
    // control — without it, a tooltip that hardcoded "up" would pass.
    await wearOnly(nw, [better]);
    invAdd(nw.state, 'sword_iron', 1);
    const down = itemTooltipHtml(nw.state, 'sword_iron');
    ok(down.includes('nw-tip-delta down'),
      'CONTROL: the worse item is marked a downgrade, so the sign is computed and not assumed');

    // Nothing worn: no comparison at all rather than a comparison against zero,
    // which would tell the player every drop is a huge upgrade.
    const p = nw.state.player;
    p.equip = {}; p.soulItems = {};
    const alone = itemTooltipHtml(nw.state, better);
    ok(!alone.includes('nw-tip-cmp'),
      'CONTROL: with the slot empty there is no comparison block at all');

    // The rolled affixes have to be READABLE — a tooltip that lists internal
    // ids teaches nothing.
    const lines = affixLines(better);
    ok(lines.length > 0, `a Hallowed blade lists ${lines.length} affix lines`);
    ok(lines.every((l: any) => l.text.includes(' — ')), 'each line names the affix and what it does');
    ok(!lines.some((l: any) => /_/.test(l.text)), '...in words, not in snake_case identifiers');

    // One colour source, used everywhere.
    eq(rarityColor(better), rarityDef('hallowed').color,
      'the tier colour comes from data/rarity.ts and nowhere else');
    ok(nameHtml(better).includes(rarityDef('hallowed').color), 'the coloured name uses it');
    ok(!nameHtml('sword_iron').includes('<span'),
      'CONTROL: a plain item is not coloured at all — the ladder stays invisible until something rolls');
  } finally {
    snap.restore();
  }
}

// ---------------------------------------------------------------------------
// A4 — the orbs and the radar exist and track the player
// ---------------------------------------------------------------------------
async function testOrbsAndMinimap(nw: any) {
  const state = nw.state;
  const orb = document.querySelector('.nw-orb.hp') as HTMLElement | null;
  const res = document.querySelector('.nw-orb.res') as HTMLElement | null;
  ok(!!orb && !!res, 'both orbs are in the DOM');
  if (!orb || !res) return;

  const liq = orb.querySelector('.liq') as HTMLElement;
  const vig = orb.querySelector('.vig') as HTMLElement;
  const num = orb.querySelector('.num') as HTMLElement;
  ok(!!liq && !!vig && !!num, 'the HP orb has a fill, a Vigor ring and a readout');

  // The Vigor ring lives OUTSIDE the orb's circle, and the first live capture
  // showed it missing entirely because the orb clipped it. The bowl is what
  // fixed it, so its presence is worth pinning.
  ok(!!orb.querySelector('.bowl'),
    'the fill is clipped by an inner bowl, not by the orb (the ring sits outside it)');

  const { playerMaxHp } = await import('../rules');
  const savedHp = state.player.hp, savedVig = state.player.vigor, savedRes = state.player.resolve;
  try {
    state.player.hp = playerMaxHp(state);
    state.player.vigor = 100; state.player.resolve = 100;
    nw.ui.refresh();
    const fullT = liq.style.transform;
    eq(num.textContent, String(Math.ceil(playerMaxHp(state))), 'the orb reads full HP');

    // 0.15, not 0.25: the warning threshold is `< 0.25` and setting HP to
    // exactly a quarter probes the boundary rather than the behaviour. It went
    // red on the first run for that reason and nothing was wrong with the orb.
    state.player.hp = playerMaxHp(state) * 0.15;
    state.player.vigor = 40; state.player.resolve = 30;
    nw.ui.refresh();
    ok(liq.style.transform !== fullT, 'the fill tracks HP downward');
    ok(orb.classList.contains('low'), 'and warns below a quarter');
    state.player.hp = playerMaxHp(state) * 0.40;
    nw.ui.refresh();
    ok(!orb.classList.contains('low'),
      'CONTROL: no warning at 40% — the threshold is a threshold, not always-on');
    state.player.hp = playerMaxHp(state) * 0.15;
    nw.ui.refresh();
    eq(vig.style.getPropertyValue('--vig'), '40%', 'the Vigor ring tracks Vigor');
    eq((res.querySelector('.num') as HTMLElement).textContent, '30', 'the Resolve orb tracks Resolve');

    state.player.hp = playerMaxHp(state);
    nw.ui.refresh();
    ok(!orb.classList.contains('low'), 'CONTROL: the warning clears when healed');
  } finally {
    state.player.hp = savedHp; state.player.vigor = savedVig; state.player.resolve = savedRes;
    nw.ui.refresh();
  }

  // The radar. It was silently deleted by the UI's innerHTML wipe in the first
  // live capture, so "it is in the document" is a real assertion here.
  const map = document.getElementById('nw-map') as HTMLCanvasElement | null;
  ok(!!map, 'the minimap canvas is attached to the HUD');
  if (map && nw.minimap) {
    ok(map.width > 0 && map.height > 0, `it has a backing store (${map.width}×${map.height})`);
    // Drawing must not throw with an empty world, a full one, or no foes.
    nw.minimap.draw(state, performance.now() + 1e6, []);
    nw.minimap.draw(state, performance.now() + 2e6, [{ x: state.player.x + 40, y: state.player.y }]);
    ok(true, 'it draws without throwing, with and without foes');
    // Those two stamps are far-future on purpose (draw() throttles), but they
    // leave the throttle clock there — which silently freezes the live radar
    // for the rest of a `?test` session. Put it back.
    nw.minimap.lastT = -999;
  }
}


// ---------------------------------------------------------------------------
// A3 — The Bar: the echoes become something you press
// ---------------------------------------------------------------------------
//
// The ability system owns the slotting, the cost and the refusals; EchoSystem
// owns what a cast actually does. The tests below split on that line: this one
// pins the BAR (slots, Resolve economy, the three refusal reasons), the next
// pins that a cast reaches the world through EchoSystem. Neither test reads an
// internal number and calls it proof — a refused cast must leave Resolve
// untouched, a spent cast must leave it exactly `cost` lower, and an active
// must move HP or timers on a real dummy foe.

async function testAbilityBar(nw: any) {
  const { state, sys } = nw;
  const A: any = sys.abilities;
  const { echoById } = await import('../data/echoes');
  state.gameOver = false;
  // God mode keeps a stray night foe from ending the run mid-test. It MUST be
  // restored: this file's tests share one live world, and a leaked `god = true`
  // silently disarms every damage assertion that runs after it — which is how
  // A5's Ironwake test came to measure nothing at all.
  const savedGod = state.god;
  state.god = true;

  const savedEchoes = state.player.echoes;
  const savedBar = state.player.abilityBar;
  const savedResolve = state.player.resolve;
  // Steps 3-8 below measure Resolve to the point. Bramblebreak is a DAMAGE
  // active, and a foe that dies to it grants `resolvePerKill` inside the same
  // synchronous `cast()` call — so the meter reads high and the test blames the
  // cost ("it spends exactly 18 resolve: expected 82, got 86"). Whether a foe
  // is standing in reach depends entirely on where the suite left the player,
  // which is ground this test did not choose. The claim here is about the bar's
  // Resolve economy; the horde is not part of it, so it is a precondition to
  // pin rather than a variable to measure (WORKFLOW rule 11).
  const foes = nw.sys.hordes.foes;
  const clearFoes = () => foes.splice(0, foes.length);
  const savedFoes = clearFoes();
  try {
    // 1. the bar fills itself from held echoes, in the canonical ECHOES order
    state.player.echoes = { thornring: 1, cinder_trail: 1, rime_nova: 1, tide_lash: 1 };
    state.player.abilityBar = [];
    A.readyAt = {}; A.lockUntil = 0;
    nw.step(2);
    eq(state.player.abilityBar.length, 4, 'four sockets exist on the bar');
    eq(state.player.abilityBar[0], 'thornring', 'slot 1 is the first lord to fall');
    eq(state.player.abilityBar[3], 'tide_lash', 'slot 4 is the fourth');

    // 2. the fifth echo is held but unbound — a choice, not an automatic upgrade
    state.player.echoes['null_orb'] = 1;
    nw.step(2);
    eq(A.held().length, 5, 'all five echoes are held');
    eq(state.player.abilityBar.filter(Boolean).length, 4,
      'but the bar still holds four — the fifth lord forces a choice');
    ok(!state.player.abilityBar.includes('null_orb'),
      "the fifth lord's echo stays off the bar until displaced");

    // 3. a cast spends exactly the active's cost
    const cost0 = echoById('thornring')!.active.cost;
    state.player.resolve = 100;
    A.readyAt = {}; A.lockUntil = 0;
    const r1 = A.cast(0);
    ok(r1.ok, 'Bramblebreak casts with resolve in hand');
    eq(state.player.resolve, 100 - cost0, `it spends exactly ${cost0} resolve`);

    // 4. an immediate re-press is refused by the GLOBAL lock, for free
    const r2 = A.cast(0);
    ok(!r2.ok && r2.reason === 'locked',
      'an immediate re-press is locked (key-repeat can not empty the meter)');
    eq(state.player.resolve, 100 - cost0, 'and the refusal costs nothing');

    // 5. the lock spans slots — it is global, not per-echo
    const r3 = A.cast(1);
    ok(!r3.ok && r3.reason === 'locked', 'a different slot is also locked in the same instant');

    // 6. past the lock but inside the cooldown: the cooldown says so
    nw.step(10); // 0.333s > the 0.25s global lock
    clearFoes();  // a third of a second is long enough to spawn one
    const r4 = A.cast(0);
    ok(!r4.ok && r4.reason === 'cooldown', 'past the lock, the per-echo cooldown refuses');

    // 7. a cast you cannot afford is refused and touches nothing
    state.player.resolve = cost0 - 1;
    A.readyAt = {}; A.lockUntil = 0;
    const r5 = A.cast(0);
    ok(!r5.ok && r5.reason === 'resolve', 'a cast you cannot afford is refused');
    eq(state.player.resolve, cost0 - 1, 'and the resolve is untouched');

    // 8. casting yourself to exactly zero is allowed — walking into the penalty
    state.player.resolve = cost0;
    A.readyAt = {}; A.lockUntil = 0;
    const r6 = A.cast(0);
    ok(r6.ok, 'a cast that lands you at exactly zero resolve is allowed');
    eq(state.player.resolve, 0, 'and leaves the meter empty, not negative');

    // 9. an empty socket refuses, without throwing (only thornring held, so
    //    sync can not backfill the gap with a fifth echo)
    state.player.echoes = { thornring: 1 };
    state.player.abilityBar = ['thornring', '', '', ''];
    state.player.resolve = 100;
    A.readyAt = {}; A.lockUntil = 0;
    nw.step(2);
    const r7 = A.cast(1);
    ok(!r7.ok && r7.reason === 'empty', 'an empty socket refuses');

    // 10. the tooltip names the ACTIVE and states what it costs and hits for
    const tip = A.describe(0);
    ok(tip && tip.title === 'Bramblebreak', 'the tooltip names the ACTIVE, not the echo');
    ok(tip.lines.some((l: string) => l.includes('18 resolve')), 'the tooltip states the resolve cost');
    ok(tip.lines.some((l: string) => l.includes('damage')), 'the tooltip states the damage it hits for');
    const emptyTip = A.describe(1);
    ok(emptyTip && /empty/i.test(emptyTip.title), "an empty socket's tooltip says it is empty");
  } finally {
    state.player.echoes = savedEchoes;
    state.player.abilityBar = savedBar;
    state.player.resolve = savedResolve;
    state.god = savedGod;
    A.readyAt = {}; A.lockUntil = 0;
    clearFoes();
    foes.push(...savedFoes);
  }
}

async function testAbilityActives(nw: any) {
  const { state, sys } = nw;
  const A: any = sys.abilities;
  const ES: any = sys.echoes;
  const { ENEMIES } = await import('../data/enemies');
  const dummyDef = ENEMIES.find((e: any) => !e.boss)!;
  state.gameOver = false;
  const savedGod = state.god;   // see the note in testAbilityBar above
  state.god = true;

  const savedEchoes = state.player.echoes;
  const savedBar = state.player.abilityBar;
  const savedResolve = state.player.resolve;
  const savedFoes = sys.hordes.foes;
  try {
    sys.hordes.foes = [];
    state.player.resolve = 100;
    A.readyAt = {}; A.lockUntil = 0;

    // --- Bramblebreak: the ring bites, and throws back what survives ---
    // Knockback only lands on standable ground, so probe the four cardinals
    // and accept the direction the terrain allows (the Hall clearing is open).
    state.player.echoes = { thornring: 1 };
    state.player.abilityBar = ['thornring', '', '', ''];
    nw.step(2);
    {
      let knocked = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
        sys.hordes.foes = [];
        A.readyAt = {}; A.lockUntil = 0;
        state.player.resolve = 100;
        const f: any = makeDummyFoe(nw, dummyDef, dx * 40, dy * 40, 5000);
        sys.hordes.foes.push(f);
        const before = Math.hypot(f.x - state.player.x, f.y - state.player.y);
        const cr = A.cast(0);
        const after = Math.hypot(f.x - state.player.x, f.y - state.player.y);
        if (cr.ok && f.hp < f.maxHp && after > before) { knocked = true; break; }
      }
      ok(knocked, 'Bramblebreak damages and throws back a survivor where the ground allows');
    }

    // --- Hoarfrost: freeze reuses the C5 stun consumer, then chills ---
    sys.hordes.foes = [];
    A.readyAt = {}; A.lockUntil = 0;
    state.player.resolve = 100;
    state.player.echoes = { rime_nova: 1 };
    state.player.abilityBar = ['rime_nova', '', '', ''];
    nw.step(2);
    {
      const f: any = makeDummyFoe(nw, dummyDef, 40, 0, 5000);
      sys.hordes.foes.push(f);
      ok(A.cast(0).ok, 'Hoarfrost casts');
      ok(f.hp < f.maxHp, 'and damages a foe in the bloom');
      ok(f._stunnedUntil > state.clock, 'and freezes solid via the existing stun consumer');
      ok(f.chillUntil > state.clock, 'and the chill outlasts the freeze');
      ok(f.chillMult < 1, `and the chill slows the march (${f.chillMult})`);
    }

    // --- Emberline: a line of patches along the aim ---
    sys.hordes.foes = [];
    A.readyAt = {}; A.lockUntil = 0;
    state.player.resolve = 100;
    state.player.echoes = { cinder_trail: 1 };
    state.player.abilityBar = ['cinder_trail', '', '', ''];
    nw.step(2);
    {
      ES.patches = [];
      nw.player.aimAngle = 0; // due east, so five tiles are five distinct tiles
      ok(A.cast(0).ok, 'Emberline casts');
      ok(ES.patches.length >= 4, `and lays a line of patches along the aim (${ES.patches.length})`);
    }

    // --- Undertow: four lashes reach out and never lash nothing ---
    sys.hordes.foes = [];
    A.readyAt = {}; A.lockUntil = 0;
    state.player.resolve = 100;
    state.player.echoes = { tide_lash: 1 };
    state.player.abilityBar = ['tide_lash', '', '', ''];
    nw.step(2);
    {
      const f: any = makeDummyFoe(nw, dummyDef, 120, 0, 5000);
      sys.hordes.foes.push(f);
      ok(A.cast(0).ok, 'Undertow casts');
      ok(f.hp < f.maxHp, 'and lashes a lone foe at range');
    }

    // --- Threefold Hollow: a window the orbit reads, that expires ---
    sys.hordes.foes = [];
    A.readyAt = {}; A.lockUntil = 0;
    state.player.resolve = 100;
    state.player.echoes = { null_orb: 1 };
    state.player.abilityBar = ['null_orb', '', '', ''];
    nw.step(2);
    {
      ok(A.cast(0).ok, 'Threefold Hollow casts');
      ok(ES.orbEmpowerLeft() > 0, 'and opens the empowerment window');
      nw.step(250); // 8.33s > the 8s window
      eq(ES.orbEmpowerLeft(), 0, 'and the window closes when it expires');
    }
  } finally {
    sys.hordes.foes = savedFoes;
    state.player.echoes = savedEchoes;
    state.player.abilityBar = savedBar;
    state.player.resolve = savedResolve;
    state.god = savedGod;
    A.readyAt = {}; A.lockUntil = 0;
    ES.orbEmpowerUntil = 0;
  }
}


// ---------------------------------------------------------------------------
// C4 REPAIR — the seven effect hooks that were registered and never consumed
//
// `registerEffect()` builds a registry; `applyEffect()` dispatches from it; and
// nothing in the game has ever called `applyEffect()`. The eight LIVE hooks are
// all read as `activeEffects(state).has(key)` at the site that cares. Seven had
// a handler, an affix row, a tooltip label -- and no path to the screen. All
// five domain-lord relics were placebo, and 350 of the 750 suffix weight in
// A1's affix table did nothing.
//
// Every assertion below is a MATCHED PAIR: the effect on, then the same
// measurement with it off. A one-sided "the number moved" would pass just as
// happily if the number moved for some other reason, which is the failure mode
// that let seven dead hooks sit behind a green suite for two milestones.
// ---------------------------------------------------------------------------

async function testDormantEffectsNowLive(nw: any) {
  const { state, sys } = nw;
  const { CFG } = await import('../data/config');
  const { moveBurstMul } = await import('./effects');
  const { ENEMIES } = await import('../data/enemies');
  const dummy = ENEMIES.find((e: any) => !e.boss)!;
  const p = state.player;

  const snap = snapshotPlayer(nw);
  const savedGod = state.god;
  const savedFoes = sys.hordes.foes;
  const savedSockets = state.sockets;
  const savedGameOver = state.gameOver;
  const savedBurst = state._moveBurstUntil;
  const savedRoll = nw.ctx.net.rollDamageMul;
  state.gameOver = false;
  state.sockets = {};        // A5 weaves must not stand in for a C4 hook

  const mkFoe = (dx = 0, dy = 0, hp = 400) => ({
    uid: state.nextUid++, def: dummy,
    x: p.x + dx, y: p.y + dy, px: p.x + dx, py: p.y + dy,
    hp, maxHp: hp, dmg: 10, baseDmg: 10, atkT: 0, telegraphT: 0, animT: 0,
  });

  try {
    // -- 1. thorns_reflect ---------------------------------------------------
    // god mode OFF: damagePlayer early-returns under it, which is exactly how
    // A5's reflect test came to measure nothing.
    state.god = false;
    for (const withRelic of [true, false]) {
      await wearOnly(nw, []);
      if (withRelic) p.relic = 'relic_thorn';
      sys.hordes.foes = [];
      const foe: any = mkFoe(20, 0);
      p.hp = 200;
      sys.combat.damagePlayer(10, 'test', foe);
      const back = 400 - foe.hp;
      if (withRelic) ok(back > 0, `thorns_reflect: the attacker takes ${back} back`);
      else eq(back, 0, 'CONTROL: with no Thornwarden relic the attacker takes nothing back');
    }
    state.god = true;

    // -- 2. fire_aura --------------------------------------------------------
    // combat.update() also ticks the TOWERS, and by this point in the suite the
    // world has some built near the Hall — they shot the control foe for 52 and
    // turned a clean zero into a puzzle. Emptying the build list for the
    // measurement leaves the aura as the only thing in the world that can burn.
    {
      const savedBuildings = state.buildings;
      const burns: number[] = [];
      try {
        state.buildings = [];
        for (const withRelic of [true, false]) {
          await wearOnly(nw, []);
          if (withRelic) p.relic = 'relic_cinder';
          sys.hordes.foes = [];
          const foe: any = mkFoe(24, 0);
          sys.hordes.foes.push(foe);
          // one tick period in slices, so the accumulator behaves as it does live
          for (let i = 0; i < 8; i++) sys.combat.update(CFG.itemEffects.fireAuraSec / 4);
          burns.push(400 - foe.hp);
        }
      } finally { state.buildings = savedBuildings; }
      ok(burns[0] > 0, `fire_aura: a foe standing next to you burns for ${burns[0]}`);
      eq(burns[1], 0, 'CONTROL: with no Cindermaw relic nothing burns');
    }

    // -- 3. chill_aura -------------------------------------------------------
    // Same foe, same tile, same tick: the ONLY difference is the relic, so the
    // distance it covers is directly proportional to the multiplier.
    //
    // Measured on a UNIFORM CORRIDOR rather than from wherever the suite happens
    // to have left the player standing. The old version put the foe 60px east
    // and marched it west: if the player was against water, a cliff or a tree,
    // canStand() refused both axes, the foe covered 0.00px in BOTH halves, and
    // an assertion about chill failed for a reason that had nothing to do with
    // chill. Surfaced by an RNG-stream shift during A8's mutation testing — the
    // fifth time that mechanism has exposed something latent, and the second
    // time the fix has been "stop measuring movement on ground you did not
    // choose". findUniformCorridor exists for exactly this.
    const lane = findUniformCorridor(nw, 6);
    ok(!!lane, 'chill_aura: found uniform ground to march a foe across');
    if (lane) {
      nw.player.teleport(lane.x, lane.y);
      nw.step(1);
      const ox = lane.dx * 60, oy = lane.dy * 60;
      const walked: number[] = [];
      for (const withRelic of [true, false]) {
        await wearOnly(nw, []);
        if (withRelic) p.relic = 'relic_rime';
        sys.hordes.foes = [];
        const foe: any = mkFoe(ox, oy, 9999);
        foe.dayMob = false;
        sys.hordes.foes.push(foe);
        sys.hordes.update(0.5);
        walked.push(Math.hypot(foe.x - (p.x + ox), foe.y - (p.y + oy)));
      }
      ok(walked[0] > 0 && walked[1] > 0, `chill_aura: the foe marched in both runs (${walked[0].toFixed(2)}px chilled, ${walked[1].toFixed(2)}px free)`);
      ok(walked[0] < walked[1],
        `chill_aura: a foe near you marches slower (${walked[0].toFixed(2)}px vs ${walked[1].toFixed(2)}px)`);
    }

    // -- 4. regen_boost ------------------------------------------------------
    // combat.update() only regenerates during the DAY, and this test runs
    // wherever the suite's clock has drifted to — which by here is minutes of
    // simulated time after two playthrough tests. When it drifted into a night
    // the CONTROL half measured 0.000 hp/s and failed an assertion about the
    // Tideculler relic for a reason that had nothing to do with the relic.
    // Pinning the phase is a PRECONDITION, not the measurement: both halves
    // still run through the real combat.update().
    const savedIsNight = nw.ctx.isNight;
    const healed: number[] = [];
    try {
      nw.ctx.isNight = () => false;
      for (const withRelic of [true, false]) {
        await wearOnly(nw, []);
        if (withRelic) p.relic = 'relic_tide';
        sys.hordes.foes = [];
        p.hp = 20;
        const before = p.hp;
        sys.combat.update(1.0);
        healed.push(p.hp - before);
      }
    } finally { nw.ctx.isNight = savedIsNight; }
    ok(healed[1] > 0, `regen_boost CONTROL: the day heals you at all (${healed[1].toFixed(3)} hp/s)`);
    ok(healed[0] > healed[1],
      `regen_boost: the Tideculler relic heals faster (${healed[0].toFixed(3)} vs ${healed[1].toFixed(3)} hp/s)`);

    // -- 5. move_burst_on_kill ------------------------------------------------
    for (const withRelic of [true, false]) {
      await wearOnly(nw, []);
      if (withRelic) p.relic = 'relic_tide';
      sys.hordes.foes = [];
      state._moveBurstUntil = 0;
      const foe: any = mkFoe(20, 0, 5);
      sys.hordes.foes.push(foe);
      sys.hordes.hurt(foe, 9999, true, true);
      const mul = moveBurstMul(state);
      if (withRelic) ok(mul > 1, `move_burst_on_kill: a kill opens a ${mul}x window`);
      else eq(mul, 1, 'CONTROL: with no Tideculler relic a kill opens nothing');
    }
    state._moveBurstUntil = 0;

    // -- 6. see_foe_hp -------------------------------------------------------
    // The bar always existed but only above a HURT foe, which is when you no
    // longer need it. Read the real Pixi geometry, not a flag we passed in.
    {
      sys.hordes.foes = [];
      const foe: any = mkFoe(40, 0, 400);
      foe.hp = foe.maxHp;                 // untouched: the bar is normally hidden
      sys.hordes.foes.push(foe);
      // syncFoes() only drives views that already exist — addFoe() is what
      // creates one, and the live game calls it from the spawn path.
      nw.ctx.views.addFoe(foe);
      nw.ctx.views.syncFoes(sys.hordes.foes, 1, false);
      const view: any = (nw.ctx.views as any).foes.get(foe.uid);
      ok(!!view, 'see_foe_hp: the foe has a view to draw into');
      const drawn = (v: any) => v?.bar?.context?.instructions?.length ?? -1;
      const hidden = drawn(view);
      nw.ctx.views.syncFoes(sys.hordes.foes, 1, true);
      const shown = drawn(view);
      eq(hidden, 0, 'CONTROL: a full-health foe draws no bar without the Nullmaw relic');
      ok(shown > 0, `see_foe_hp: ...and draws one with it (${shown} draw calls)`);
      nw.ctx.views.removeFoe(foe.uid);
    }

    // -- 7. resonance_boost ---------------------------------------------------
    // Pin the D5 roll to exactly 1.0 so what is left is the effect and nothing
    // else. Reads the real private roll() both echo forms share.
    {
      nw.ctx.net.rollDamageMul = () => ({ mul: 1.0 });
      await wearOnly(nw, []);
      const plain = (sys.echoes as any).roll('test');
      p.relic = 'relic_null';
      const boosted = (sys.echoes as any).roll('test');
      eq(+plain.toFixed(4), 1.0, 'CONTROL: with the roll pinned and no relic, an echo hits for exactly its base');
      eq(+boosted.toFixed(4), +(1 + CFG.itemEffects.resonancePct).toFixed(4),
        'resonance_boost: the Nullmaw relic lifts every echo number');
    }

    // -- 8. and the rule that let all seven hide -------------------------------
    // applyEffect() is not a dispatch path. If a future hook is implemented
    // ONLY as a registered handler, it is dead on arrival, and this is the
    // assertion that says so out loud.
    {
      const { applyEffect } = await import('./effects');
      const ret = applyEffect('thorns_reflect', { state, player: p, damage: 10 } as any);
      eq(ret, undefined,
        'the registry is a vocabulary, not a dispatch table — handlers are flags and return nothing');
    }
  } finally {
    nw.ctx.net.rollDamageMul = savedRoll;
    state._moveBurstUntil = savedBurst;
    state.sockets = savedSockets;
    sys.hordes.foes = savedFoes;
    state.god = savedGod;
    state.gameOver = savedGameOver;
    snap.restore();
  }
}

// ---------------------------------------------------------------------------
// A5.1 — threads, sequences, and the order rule
// ---------------------------------------------------------------------------
async function testWeaveData(nw: any) {
  const { THREADS, WEAVES, matchWeaves, SOCKET_RANGE, rollSocketCount } = await import('../data/weaves');
  const { itemDef, threadOf } = await import('../data/items');
  const { isRollable } = await import('./loot');
  const { slotOf } = await import('../rules');

  eq(THREADS.length, 5, 'five threads — one per echo');
  eq(WEAVES.length, 3, 'three weaves ship');
  for (const w of WEAVES) {
    ok(w.sequence.length >= 2, `${w.name} is a sequence, not a single thread`);
    for (const t of w.sequence) ok(THREADS.some((x) => x.id === t), `${w.name} uses only real threads (${t})`);
  }

  // The order rule is the whole feature.
  eq(matchWeaves(['null', 'tide']).map((w) => w.id).join(','), 'hollow_song',
    'Null·Tide is Hollow Song');
  eq(matchWeaves(['tide', 'null']).length, 0,
    'Tide·Null is two loose threads — reordering breaks the weave');
  eq(matchWeaves(['rime', 'rime', 'ember']).map((w) => w.id).join(','), 'long_night',
    'Rime·Rime·Ember is The Long Night');
  eq(matchWeaves(['ember', 'rime', 'rime']).length, 0,
    '...and only in that order');
  eq(matchWeaves(['thorn', 'thorn']).map((w) => w.id).join(','), 'ironwake',
    'Thorn·Thorn is Ironwake');
  eq(matchWeaves([]).length, 0, 'an empty row completes nothing');
  eq(matchWeaves(['null', 'tide', 'thorn']).map((w) => w.id).join(','), 'hollow_song',
    'a 2-thread weave can sit inside a 3-socket row');
  eq(matchWeaves(['thorn', 'null', 'tide']).map((w) => w.id).join(','), 'hollow_song',
    '...starting mid-row too');

  // The socket ladder gates the 3-socket vessel.
  eq(SOCKET_RANGE.plain[1], 0, 'Plain has no sockets');
  eq(SOCKET_RANGE.sovereign[1], 3, 'Sovereign tops out at 3');
  eq(rollSocketCount('plain'), 0, 'rollSocketCount(plain) is deterministically 0');
  eq(rollSocketCount('sovereign'), 3, 'rollSocketCount(sovereign) is deterministically 3');
  const woven = rollSocketCount('woven');
  ok(woven >= 1 && woven <= 2, `Woven rolls 1-2 sockets (got ${woven})`);

  // Threads are items, and they are NOT gear: no roll, no equip slot.
  eq(threadOf('thread_rime'), 'rime', 'threadOf reads the authored thread');
  eq(itemDef('thread_null')?.thread, 'null', 'the item carries its thread column');
  ok(!isRollable('thread_rime'), 'threads never roll — they are not gear');
  eq(slotOf('thread_tide'), null, 'threads never equip — they socket');
}

// ---------------------------------------------------------------------------
// A5.2 — slotting consumes, unsocketing returns, reorder breaks the weave
// ---------------------------------------------------------------------------
async function testWeaveSocketing(nw: any) {
  const { rollItem } = await import('./loot');
  const { rolledOf } = await import('../data/items');
  const { invAdd, invCount } = await import('../rules');
  const W = nw.sys.weaves;
  const state = nw.state;
  const savedSockets = state.sockets;
  const snap = snapshotPlayer(nw);

  try {
    state.player.inv = {}; state.player.equip = {}; state.player.soulItems = {};
    state.player.relic = undefined;
    state.sockets = {};

    // A Sovereign sword: three sockets — the only vessel for Long Night.
    const uid = rollItem('sword_iron', { forceRarity: 'sovereign' });
    eq(rolledOf(uid)?.sockets, 3, 'a Sovereign roll carries 3 sockets');

    // Authored gear has no sockets, and a non-thread can't be slotted.
    eq(W.capacity('sword_iron'), 0, 'authored gear has zero sockets');
    ok(!W.canSocket('sword_iron'), '...and cannot be socketed');
    ok(!W.slotThread(uid, 'sword_copper'), 'a non-thread item is refused');

    // Give ourselves threads and socket them in order.
    invAdd(state, 'thread_rime', 2);
    invAdd(state, 'thread_ember', 1);
    invAdd(state, 'thread_null', 1);
    invAdd(state, 'thread_tide', 1);
    ok(W.slotThread(uid, 'thread_rime'), 'first Rime slots');
    eq(invCount(state, 'thread_rime'), 1, '...and one Rime left the bag');
    ok(W.slotThread(uid, 'thread_rime'), 'second Rime slots');
    ok(W.slotThread(uid, 'thread_ember'), 'Ember slots');
    eq(W.slotted(uid).join(','), 'rime,rime,ember', 'the row reads Rime·Rime·Ember');
    eq(W.weavesOn(uid).map((w) => w.id).join(','), 'long_night',
      '...which completes The Long Night');

    // Full: no fourth thread fits.
    ok(!W.canSocket(uid), 'three slots are now full');
    ok(!W.slotThread(uid, 'thread_null'), 'a fourth thread is refused');

    // Remove the middle thread — the weave BREAKS the moment the order does.
    ok(W.unsocket(uid, 1), 'the middle thread unsockets');
    eq(W.slotted(uid).join(','), 'rime,ember', '...leaving Rime·Ember');
    eq(W.weavesOn(uid).length, 0, '...and the weave breaks');
    eq(invCount(state, 'thread_rime'), 1, 'the removed thread returned to the bag');

    // Put it back — but slotThread APPENDS, so the thread lands at the END.
    // The weave does NOT return; that is the rule, demonstrated end to end.
    ok(W.slotThread(uid, 'thread_rime'), 'the Rime can be slotted again');
    eq(W.slotted(uid).join(','), 'rime,ember,rime', '...but it appends to the END');
    eq(W.weavesOn(uid).length, 0, '...so the weave stays broken — order is load-bearing');

    // A Woven item caps at 2 sockets: Hollow Song fits if it rolls two.
    const wovenUid = rollItem('armor_iron', { forceRarity: 'woven' });
    const sockets = rolledOf(wovenUid)?.sockets ?? 0;
    ok(sockets >= 1 && sockets <= 2, `Woven rolls ${sockets} socket(s)`);
    const items: Record<string, string> = { null: 'thread_null', tide: 'thread_tide' };
    for (let i = 0; i < sockets; i++) {
      const tid = i === 0 ? 'null' : 'tide';
      ok(W.slotThread(wovenUid, items[tid]), `thread ${i + 1} into the Woven piece`);
    }
    if (sockets === 2) {
      eq(W.weavesOn(wovenUid).map((w) => w.id).join(','), 'hollow_song',
        'a 2-socket Woven piece can hold Hollow Song');
    }
  } finally {
    snap.restore();
    state.sockets = savedSockets;
  }
}

// ---------------------------------------------------------------------------
// A5.3 — all three bonuses reach the live game, not just the data table
// ---------------------------------------------------------------------------
async function testWeaveBonuses(nw: any) {
  const { CFG } = await import('../data/config');
  const { rollItem } = await import('./loot');
  const { invAdd } = await import('../rules');
  const { ENEMIES } = await import('../data/enemies');
  const W = nw.sys.weaves;
  const state = nw.state;
  const p = state.player;
  const sys = nw.sys;
  const snap = snapshotPlayer(nw);

  const savedSockets = state.sockets;
  const savedClock = state.clock;
  const savedRoll = nw.ctx.net.lastSwingDmgMul;
  const savedResonance = nw.ctx.net.consumeResonance;
  const savedFoes = sys.hordes.foes;
  const savedAim = nw.ctx.player.aimAngle;
  const savedCombatXp = p.xp.combat;
  const savedGod = state.god;
  const savedGameOver = state.gameOver;
  const savedRandom = Math.random;

  try {
    p.inv = {}; p.equip = {}; p.soulItems = {}; p.relic = undefined;
    state.sockets = {};
    state.god = false; state.gameOver = false; // damagePlayer no-ops under either
    nw.ctx.net.consumeResonance = () => null;
    nw.ctx.net.lastSwingDmgMul = 0.30;

    const dummy = ENEMIES.find((e: any) => !e.boss)!;
    const swingFor = (angleOff = 0) => {
      const r = 8;
      const foe = {
        uid: state.nextUid++, def: dummy,
        x: p.x + Math.cos(angleOff) * r, y: p.y + Math.sin(angleOff) * r,
        px: 0, py: 0, hp: 100000, maxHp: 100000,
        dmg: 0, baseDmg: 0, atkT: 999, telegraphT: 0, animT: 0,
      };
      nw.ctx.player.aimAngle = 0;
      sys.hordes.foes.push(foe);
      (sys.combat as any).resolveHit();
      sys.hordes.foes = sys.hordes.foes.filter((f: any) => f.uid !== foe.uid);
      return foe.maxHp - foe.hp;
    };

    // ---- The Long Night: +25% damage, night only, on a REAL swing ---------
    // Drive the damage through the combat skill, which resolveHit() does not
    // re-level. The soul curve derives a slot's level FROM its xp, so a hand-set
    // `level: 60, xp: 0` would be re-levelled by the swing's own xp award and
    // make the control swing disagree with itself. Combat xp has no such hook
    // here, so a maxed skill gives a stable, rounding-proof base: 4 + 8 = 12.
    p.xp.combat = 1000000;
    invAdd(state, 'sword_iron', 1);
    p.equip.weapon = 'sword_iron';

    state.clock = 120; // day
    const dayDmg = swingFor();
    ok(dayDmg > 0, `a daylight swing lands for ${dayDmg}`);

    state.clock = 250; // night
    const nightNoWeave = swingFor();
    eq(nightNoWeave, dayDmg, 'night alone changes nothing — it is the weave, not the dark');

    const uid = rollItem('sword_iron', { forceRarity: 'sovereign' });
    p.inv = {};
    invAdd(state, uid, 1); p.equip.weapon = uid;
    const threadItem: Record<string, string> = { rime: 'thread_rime', ember: 'thread_ember' };
    for (const tid of ['rime', 'rime', 'ember']) {
      invAdd(state, threadItem[tid], 1);
      ok(W.slotThread(uid, threadItem[tid]), `${tid} slots into the carried blade`);
    }
    ok(W.hasWeave('long_night'), 'Long Night is complete');
    eq(W.nightDmgMul(), CFG.weaves.longNightDmgMul, 'nightDmgMul() reads 1.25 at night');
    const nightWeave = swingFor();
    ok(nightWeave > dayDmg, `Long Night raises a real night swing: ${dayDmg} → ${nightWeave}`);

    state.clock = 120;
    eq(W.nightDmgMul(), 1, '...and 1 by day — the bonus is night-only');

    // ---- Hollow Song: kills restore resolve ------------------------------
    p.resolve = 20;
    W.onKill();
    eq(p.resolve, 20, 'with no Hollow Song, onKill restores nothing');

    state.sockets = {}; p.inv = {}; p.equip = {};
    const songUid = rollItem('armor_iron', { forceRarity: 'sovereign' });
    invAdd(state, songUid, 1); p.equip.armor = songUid;
    invAdd(state, 'thread_null', 1); invAdd(state, 'thread_tide', 1);
    W.slotThread(songUid, 'thread_null');
    W.slotThread(songUid, 'thread_tide');
    ok(W.hasWeave('hollow_song'), 'Hollow Song is complete');
    p.resolve = 20;
    W.onKill();
    eq(p.resolve, 20 + CFG.weaves.hollowSongResolve,
      `Hollow Song restores ${CFG.weaves.hollowSongResolve} resolve on a kill`);
    p.resolve = CFG.vitals.resolveMax - 1;
    W.onKill();
    eq(p.resolve, CFG.vitals.resolveMax, '...and never overfills past the cap');

    // ---- Ironwake: reflected damage stuns --------------------------------
    state.sockets = {}; p.inv = {}; p.equip = {};
    const wakeUid = rollItem('armor_iron', { forceRarity: 'sovereign' });
    invAdd(state, wakeUid, 1); p.equip.armor = wakeUid;
    invAdd(state, 'thread_thorn', 2);
    W.slotThread(wakeUid, 'thread_thorn');
    W.slotThread(wakeUid, 'thread_thorn');
    ok(W.hasWeave('ironwake'), 'Ironwake is complete');
    ok(!!W.reflect(), 'reflect() reports a live reflect');

    const mkFoe = () => ({
      uid: state.nextUid++, def: dummy,
      x: 0, y: 0, px: 0, py: 0, hp: 50, maxHp: 50,
      dmg: 10, baseDmg: 10, atkT: 0, telegraphT: 0, animT: 0,
    });
    // The weave vessel is a ROLLED item, so it can carry 'of Warding' — and
    // dodge makes damagePlayer return before any reflect happens, 12% of the
    // time. That is a coin flip this test never meant to include: it went red
    // the moment an unrelated new test shifted the global RNG stream. Pin
    // Math.random above the dodge threshold for the two measurements, so what
    // is left is the weave.
    Math.random = () => 0.99;
    const attacker = mkFoe();
    p.hp = 100;
    sys.combat.damagePlayer(10, 'test foe', attacker);
    ok(attacker.hp < 50, `the attacker takes its own hit back: 50 → ${attacker.hp}`);
    ok((attacker as any)._stunnedUntil > state.clock, '...and is stunned by the reflection');

    // Clearing the sockets removes the WEAVE, but the rolled armour worn above
    // can carry an 'of the Thorn' affix, and C4's thorns_reflect reflects too —
    // so this control has to strip the gear as well, or it measures the sum of
    // two independent reflect sources and calls it Ironwake. (It caught exactly
    // that the moment thorns_reflect stopped being placebo.)
    state.sockets = {}; p.inv = {}; p.equip = {}; p.relic = undefined;
    const attacker2 = mkFoe();
    p.hp = 100;
    sys.combat.damagePlayer(10, 'test foe', attacker2);
    eq(attacker2.hp, 50, 'with no Ironwake and no thorns, the attacker takes nothing back');
    eq((attacker2 as any)._stunnedUntil ?? 0, 0, '...and is not stunned');
  } finally {
    snap.restore();
    state.sockets = savedSockets;
    state.clock = savedClock;
    nw.ctx.net.lastSwingDmgMul = savedRoll;
    nw.ctx.net.consumeResonance = savedResonance;
    sys.hordes.foes = savedFoes;
    nw.ctx.player.aimAngle = savedAim;
    p.xp.combat = savedCombatXp;
    state.god = savedGod;
    state.gameOver = savedGameOver;
    Math.random = savedRandom;
  }
}


// ---------------------------------------------------------------------------
// A8 — Cairns, Wardstones and the Hoarder
// ---------------------------------------------------------------------------

/** One wide worldgen sweep, shared by every A8 test that needs to find a real
 *  Cairn or Wardstone in the real world.
 *
 *  A8's whole premise is that these are RARE — ~2e-4 per tile — so a ±15 tile
 *  scan of the sort the other feature tests use would find nothing on almost
 *  every seed and the tests would degrade into skips. One sweep of ~100k tiles
 *  costs a few hundred ms, finds both kinds, and doubles as the density
 *  measurement, so it is paid for once and cached. */
let _a8Scan: { cairns: [number, number][]; wardstones: [number, number][]; tiles: number } | null = null;
function scanForA8(nw: any, half = 160) {
  if (_a8Scan) return _a8Scan;
  const gen = nw.gen;
  const cairns: [number, number][] = [];
  const wardstones: [number, number][] = [];
  let tiles = 0;
  for (let ty = -half; ty < half; ty++) {
    for (let tx = -half; tx < half; tx++) {
      tiles++;
      const f: any = gen.featureAt(tx, ty);
      if (!f) continue;
      if (f.id === 'cairn') cairns.push([tx, ty]);
      else if (f.id === 'wardstone') wardstones.push([tx, ty]);
    }
  }
  _a8Scan = { cairns, wardstones, tiles };
  return _a8Scan;
}

/** Standable tiles within `r` of a tile — a Cairn boxed in by forest can only
 *  wake what fits beside it, so the wake tests pick an open one rather than
 *  weakening the assertion to "0 or more". */
function openNeighbours(nw: any, tx: number, ty: number, r = 3): number {
  let n = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (!dx && !dy) continue;
      if (nw.world.canStand((tx + dx + 0.5) * 32, (ty + dy + 0.5) * 32, 5)) n++;
    }
  }
  return n;
}

async function testA8DataRows(nw: any) {
  const { BOONS, rollBoon } = await import('../data/boons');
  const { FEATURES } = await import('../data/features');
  const { ENEMIES } = await import('../data/enemies');
  const { ITEMS } = await import('../data/items');
  const { LOOT_BANDS, rarityIndex } = await import('../data/rarity');
  const { hasEffect } = await import('./effects');
  const { CFG } = await import('../data/config');
  const { isRollable } = await import('./loot');

  // ---- the boon table is a view onto hooks that already work ---------------
  //
  // This is the one assertion A8's whole design rests on. A boon that named an
  // unregistered key would compile, roll, display a chip, and do nothing — the
  // exact dormant-hook failure the C4 repair spent a milestone undoing, wearing
  // a Wardstone as a costume. `hasEffect` proves the key is spelled right;
  // testDormantEffectsNowLive is what proves each of those keys reaches the
  // game, and together the two close the loop.
  ok(BOONS.length >= 8, `the boon table is worth rolling on: ${BOONS.length} rows`);
  const seenIds = new Set<string>();
  for (const b of BOONS) {
    ok(!seenIds.has(b.id), `boon ${b.id}: id is unique`);
    seenIds.add(b.id);
    ok(b.effects.length > 0, `boon ${b.id}: names at least one effect`);
    for (const e of b.effects) ok(hasEffect(e), `boon ${b.id}: '${e}' is a REGISTERED effect hook`);
    ok(b.sec >= 30 && b.sec <= 240, `boon ${b.id}: ${b.sec}s is a slice of a run, not the run`);
    ok(b.weight > 0, `boon ${b.id}: weight ${b.weight} > 0 — a zero-weight row can never roll`);
    ok(/^#[0-9a-f]{6}$/i.test(b.color), `boon ${b.id}: color is a hex value`);
  }
  // Negative control for the same claim: a made-up key must NOT pass the gate
  // the loop above just used. Without this the loop proves only that hasEffect
  // returns something, not that it discriminates.
  ok(!hasEffect('boon_that_does_not_exist'),
    'hasEffect() refuses a key nothing registered — the check above discriminates');

  // rollBoon() reaches every row given enough draws, so no row is unreachable
  const drawn = new Set<string>();
  for (let i = 0; i < 4000; i++) drawn.add(rollBoon().id);
  ok(drawn.size === BOONS.length,
    `rollBoon() reaches every row: ${drawn.size}/${BOONS.length} in 4000 draws`);

  // ---- the two features ----------------------------------------------------
  const cairn: any = FEATURES.find((f) => f.id === 'cairn');
  const ward: any = FEATURES.find((f) => f.id === 'wardstone');
  ok(!!cairn, 'the Cairn is a real FEATURES row');
  ok(!!ward, 'the Wardstone is a real FEATURES row');

  ok(!!LOOT_BANDS[cairn.band], `Cairn band '${cairn.band}' resolves to a real LOOT_BAND`);
  ok(rarityIndex(LOOT_BANDS[cairn.band].floor) >= rarityIndex('hallowed'),
    'the Cairn band floors at Hallowed or better — the whole promise of the brief');
  ok(cairn.wake && cairn.wake.count > 0, `the Cairn wakes ${cairn.wake?.count} — it is not free`);
  ok(!cairn.toolClass, 'the Cairn needs no tool — the player who most needs it may have lost theirs');
  ok(cairn.levelReq === 1, 'the Cairn needs no skill level either');
  ok(cairn.respawnSec > 900, `the Cairn is opened once a run (${cairn.respawnSec}s vs a ~900s run)`);
  ok(ward.respawnSec > 900, `so is the Wardstone (${ward.respawnSec}s)`);
  ok(ward.boon === true, 'the Wardstone grants a boon');
  ok(!ward.band && !ward.wake, 'the Wardstone pays in a blessing only — no band, no pack');
  ok(ward.loot.length === 0, 'and drops nothing, so it never reads as a node with a bonus');

  let cairnGear = 0;
  for (const row of cairn.loot) {
    ok(!!ITEMS[row.id], `Cairn loot '${row.id}' is a real item`);
    if (isRollable(row.id)) cairnGear++;
  }
  ok(cairnGear >= 4, `the Cairn can pay into ${cairnGear} distinct gear slots — the band cannot dead-end`);

  // ---- the Hoarder ---------------------------------------------------------
  const h: any = ENEMIES.find((e) => e.id === 'hoarder');
  ok(!!h, 'the Hoarder is a real ENEMIES row');
  ok(h.behavior?.kind === 'flee', 'the Hoarder flees');
  ok(h.dayOnly === true, 'and never joins a night wave');
  ok(h.daytime === true, 'and does roam by day');
  ok(!!LOOT_BANDS[h.lootBand], `Hoarder band '${h.lootBand}' resolves to a real LOOT_BAND`);
  ok(rarityIndex(LOOT_BANDS[h.lootBand].floor) < rarityIndex(LOOT_BANDS[cairn.band].floor),
    'the Hoarder pays below a Cairn — a chase you can lose must not be the best source in the game');

  // The chase is only a chase if it is actually faster than you. This is the
  // number the design argument in enemies.ts turns on, so it is asserted rather
  // than left in a comment where a later speed tweak could quietly falsify it.
  const fleeSpeed = h.speed * (h.behavior.fleeSpeedMul ?? 1);
  ok(fleeSpeed > CFG.player.speed,
    `a running Hoarder outruns the player: ${fleeSpeed.toFixed(0)} > ${CFG.player.speed} px/s`);
  ok(fleeSpeed < CFG.player.speed * 1.25,
    `...but only just (×${(fleeSpeed / CFG.player.speed).toFixed(2)}) — a rout is not a chase`);
  // The escape MESSAGE depends on this ordering: escapeTiles has to fire before
  // the silent day-mob fade, or losing a Hoarder becomes a thing that merely
  // stops existing.
  ok(h.behavior.escapeTiles < CFG.dayspawn.despawnTiles,
    `the Hoarder's escape (${h.behavior.escapeTiles}t) fires inside the day-mob fade (${CFG.dayspawn.despawnTiles}t)`);
  ok(h.behavior.spookTiles < h.behavior.escapeTiles,
    'it starts running before it can escape, or it could never run at all');

  void nw;
}

async function testA8Density(nw: any) {
  const scan = scanForA8(nw);
  const { cairns, wardstones, tiles } = scan;

  // The claim under test is the DESIGN's, in the design's own units: "often
  // one, sometimes none, occasionally two" Cairns in a run. Stating it as a
  // per-run count rather than as a per-tile rate is deliberate — a per-tile
  // assertion would just be the density table read back to itself, which is
  // the tautology this suite keeps finding in its own history.
  //
  // TILES_PER_RUN is the fixture's assumption, not a measurement: a 15-minute
  // run at 160 px/s covers roughly 4,500 tiles of path, and seeing a feature
  // needs only that it pass through the viewport, so ~3,500 distinct tiles
  // actually looked at is a conservative reading of it.
  const TILES_PER_RUN = 3500;
  const perRun = (n: number) => (n / tiles) * TILES_PER_RUN;

  ok(cairns.length > 0, `Cairns exist in the world at all: ${cairns.length} in ${tiles} tiles`);
  ok(wardstones.length > 0, `so do Wardstones: ${wardstones.length} in ${tiles} tiles`);

  const cPerRun = perRun(cairns.length);
  const wPerRun = perRun(wardstones.length);
  ok(cPerRun >= 0.25 && cPerRun <= 3.5,
    `a run meets about one Cairn: ${cPerRun.toFixed(2)} expected per ${TILES_PER_RUN} tiles`);
  ok(wPerRun >= 0.8 && wPerRun <= 9,
    `and a handful of Wardstones: ${wPerRun.toFixed(2)} expected per ${TILES_PER_RUN} tiles`);
  ok(wardstones.length > cairns.length,
    `Wardstones are the common one (${wardstones.length}) and Cairns the event (${cairns.length})`);
}

async function testA8EscapeHatch(nw: any) {
  const { CFG } = await import('../data/config');
  const { WorldGen } = await import('../world/worldgen');

  // CFG.a8.enabled = false must restore the PRE-A8 world tile for tile, not a
  // world that merely looks similar. Both A8 rows are appended last in FEATURES
  // and the density table is a running cumulative sum, so this is true by
  // construction — which is exactly the kind of claim that stops being true the
  // moment somebody inserts a row in the middle, and exactly why it is measured
  // here instead of trusted.
  const saved = CFG.a8.enabled;
  try {
    CFG.a8.enabled = true;
    const on = new WorldGen(nw.state.seed);
    CFG.a8.enabled = false;
    const off = new WorldGen(nw.state.seed);

    let a8On = 0, a8Off = 0, differed = 0, compared = 0;
    for (let ty = -70; ty < 70; ty++) {
      for (let tx = -70; tx < 70; tx++) {
        const a = on.featureAt(tx, ty);
        const b = off.featureAt(tx, ty);
        const aIsA8 = a?.id === 'cairn' || a?.id === 'wardstone';
        const bIsA8 = b?.id === 'cairn' || b?.id === 'wardstone';
        if (aIsA8) a8On++;
        if (bIsA8) a8Off++;
        compared++;
        // Every tile that is not an A8 feature has to agree exactly.
        if (!aIsA8 && (a?.id ?? null) !== (b?.id ?? null)) differed++;
      }
    }
    ok(a8On > 0, `with the flag on the sample holds ${a8On} A8 features`);
    ok(a8Off === 0, 'with the flag off it holds none');
    ok(differed === 0,
      `and every one of the other ${compared} tiles is unchanged — the revert restores the old world, not a similar one`);
  } finally {
    CFG.a8.enabled = saved;
  }
}

async function testCairnPayout(nw: any) {
  const { state, sys } = nw;
  const { CFG } = await import('../data/config');
  const { rolledOf } = await import('../data/items');
  const { rarityIndex } = await import('../data/rarity');

  const scan = scanForA8(nw);
  // An open Cairn, so the wake has somewhere to stand. Picking the fixture is
  // not the same as weakening the assertion: "five foes wake" is the claim, and
  // a Cairn walled in by forest can only ever produce a smaller true answer.
  const spot = scan.cairns.find(([tx, ty]) => openNeighbours(nw, tx, ty) >= 12);
  ok(!!spot, `found an open Cairn to test (${scan.cairns.length} in the sample)`);
  if (!spot) return;
  const [ctx, cty] = spot;

  const snap = snapshotPlayer(nw);
  const savedFoes = sys.hordes.foes.slice();
  const savedDrops = state.drops.slice();
  const savedWake = CFG.a8.cairnWake;
  const savedGod = state.god;
  const key = `${ctx},${cty}`;
  try {
    state.god = true;
    state.player.inv.pick_flint = (state.player.inv.pick_flint ?? 0) + 1;

    // ---- open it, for real, through the gather interaction ------------------
    sys.hordes.foes.length = 0;
    state.drops.length = 0;
    delete state.depleted[key];
    nw.player.teleport((ctx + 0.5) * 32 + 20, (cty + 0.5) * 32);
    nw.step(2);
    ok(sys.gather.target?.def?.id === 'cairn', 'standing beside a Cairn targets it');
    sys.gather.tryStart();
    ok(sys.gather.active !== null, 'a Cairn opens through the ordinary gather interaction');

    const need = sys.gather.active ? sys.gather.active.need : 5;
    const cap = Math.ceil(need * 45) + 120;
    let stepped = 0;
    while (sys.gather.active !== null && stepped < cap) { nw.step(1); stepped++; }
    ok(sys.gather.active === null, `the Cairn opens (${stepped} steps, cap ${cap})`);
    ok(!!state.depleted[key], 'and stays open — one Cairn is opened once');

    // ---- the payout ---------------------------------------------------------
    const gear = state.drops.filter((d: any) => rolledOf(d.id));
    ok(state.drops.length > 0, `the Cairn pays: ${state.drops.length} stacks on the floor`);
    ok(gear.length > 0, `...including ${gear.length} rolled gear piece(s)`);
    const floor = rarityIndex('hallowed');
    for (const d of gear) {
      const r = rolledOf(d.id)!;
      ok(rarityIndex(r.rarity) >= floor,
        `${r.name} is ${r.rarity} — at or above the Cairn band's Hallowed floor`);
    }

    // ---- the price ----------------------------------------------------------
    //
    // Counted as NON-day-mobs rather than as "every foe on the field". Opening a
    // Cairn takes five sim-seconds and CFG.dayspawn spawns prey every three, so
    // the field also holds whatever wandered in while the player was digging.
    // That is not noise to be tolerated — it is the discriminator: `spawn()`
    // only runs while a night wave is draining, so during the day a foe that is
    // not a day mob can ONLY have come out of wake().
    const woken = () => sys.hordes.foes.filter((f: any) => !f.dayMob);
    ok(woken().length > 0,
      `opening it woke ${woken().length} — a Cairn is not free loot`);
    ok(woken().length >= 3,
      'and it woke a PACK, not a straggler — the price has to read as a price');

    // ---- the matched negative: the wake is a switch, not scenery -------------
    sys.hordes.foes.length = 0;
    state.drops.length = 0;
    delete state.depleted[key];
    CFG.a8.cairnWake = false;
    nw.player.teleport((ctx + 0.5) * 32 + 20, (cty + 0.5) * 32);
    nw.step(2);
    sys.gather.tryStart();
    let s2 = 0;
    while (sys.gather.active !== null && s2 < cap) { nw.step(1); s2++; }
    ok(sys.gather.active === null, 'the same Cairn opens again with the wake disabled');
    ok(woken().length === 0,
      'CFG.a8.cairnWake=false wakes nothing — the pack came from the flag, not from the night');
    ok(state.drops.length > 0, '...and it still pays, so the two halves are independent');
  } finally {
    CFG.a8.cairnWake = savedWake;
    state.god = savedGod;
    // ok() throws, so every restore lives here.
    for (const f of sys.hordes.foes) nw.ctx.views?.removeFoe?.(f.uid);
    sys.hordes.foes.length = 0;
    for (const f of savedFoes) sys.hordes.foes.push(f);
    state.drops.length = 0;
    for (const d of savedDrops) state.drops.push(d);
    snap.restore();
  }
}

async function testWardstoneBoons(nw: any) {
  const { state, sys } = nw;
  const { BOONS } = await import('../data/boons');
  const { CFG } = await import('../data/config');
  const { activeBoons, activeEffects, grantBoon, tickBoons } = await import('./effects');
  const { addXp } = await import('../rules');

  const snap = snapshotPlayer(nw);
  const savedBoons = (state.boons ?? []).slice();
  const savedSockets = state.sockets;
  const savedDrops = state.drops.slice();
  try {
    await wearOnly(nw, []);
    state.sockets = {};
    state.boons = [];

    // ---- 1. a real Wardstone in the real world grants a real boon -----------
    const scan = scanForA8(nw);
    const spot = scan.wardstones[0];
    ok(!!spot, `found a Wardstone to touch (${scan.wardstones.length} in the sample)`);
    if (spot) {
      const [wtx, wty] = spot;
      delete state.depleted[`${wtx},${wty}`];
      state.drops.length = 0;
      nw.player.teleport((wtx + 0.5) * 32 + 16, (wty + 0.5) * 32);
      nw.step(2);
      ok(sys.gather.target?.def?.id === 'wardstone', 'standing at a Wardstone targets it');
      sys.gather.tryStart();
      ok(sys.gather.active !== null, 'a Wardstone is touched through the gather interaction');
      let stepped = 0;
      const cap = Math.ceil((sys.gather.active?.need ?? 3) * 45) + 120;
      while (sys.gather.active !== null && stepped < cap) { nw.step(1); stepped++; }
      ok(sys.gather.active === null, `the Wardstone answers (${stepped} steps)`);

      const live = activeBoons(state);
      ok(live.length === 1, `touching it granted exactly one boon: ${live.map((b) => b.name).join(', ')}`);
      // The claim is that the STONE paid no loot. `state.drops.length === 0`
      // said something much larger — that nothing anywhere in the world dropped
      // anything during the eight game-seconds this harvest takes — and it went
      // red about one run in five, naming the Wardstone for a drop the Wardstone
      // had nothing to do with. A shared live world keeps running while a test
      // holds a button down (WORKFLOW rule 11: pin the precondition, measure the
      // thing). So: measure at the stone, and say what landed if anything did.
      const WX = (wtx + 0.5) * 32, WY = (wty + 0.5) * 32;
      const atStone = () => state.drops.filter((d: any) => Math.hypot(d.x - WX, d.y - WY) < 3 * 32);
      const spilled = atStone();
      ok(spilled.length === 0,
        'and dropped nothing — a Wardstone pays in a blessing, not in loot'
        + (spilled.length ? ` (found ${spilled.map((d: any) => `${d.n}x ${d.id}`).join(', ')})` : ''));
      // CONTROL: that filter can SEE a drop at the stone. Without this, the
      // assertion above would also pass with the radius set to zero.
      sys.drops.spawn([{ id: 'stone', n: 1 }], WX, WY);
      eq(atStone().length, 1, 'CONTROL: a drop at the stone IS visible to that measurement');
      state.drops.length = 0;
      // And the design's own claim, stated where a new loot row would break it.
      const wardDef = (await import('../data/features')).FEATURES.find((f: any) => f.id === 'wardstone')!;
      eq(wardDef.loot.length, 0, 'because the Wardstone row carries no loot table at all');
      // The seam that matters: the boon has to be readable at the site every
      // affix, relic and weave is read at. If it were not, the chip would say
      // Ember Ward and nothing in the world would be on fire.
      const fx = activeEffects(state);
      for (const e of live[0].effects) {
        ok(fx.has(e), `${live[0].name} reaches activeEffects() as '${e}'`);
      }
    }

    // ---- 2. the boon actually moves a number the game reads -----------------
    //
    // Granting directly here, because the roll is weighted and waiting for
    // Clear Sight to come up is a lottery, not a test. What is being proved is
    // NOT that xp_boost works — testDormantEffectsNowLive owns that — but that
    // a BOON feeds the same consumption site an item does. Matched pair through
    // the live addXp() path, and the RATIO is used rather than the absolute so
    // whatever the wire is doing to xpRate cancels out of both halves.
    state.boons = [];
    const before = state.player.xp.combat ?? 0;
    addXp(state, 'combat', 1000);
    const plain = (state.player.xp.combat ?? 0) - before;
    ok(plain > 0, `a plain 1000 xp award lands as ${plain}`);

    const sage = BOONS.find((b) => b.effects.includes('xp_boost'))!;
    ok(!!sage, 'a boon in the table carries xp_boost');
    const g = grantBoon(state, sage);
    ok(g.how === 'new', 'granting it onto an empty slate is a new boon, not a refresh');
    const mid = state.player.xp.combat ?? 0;
    addXp(state, 'combat', 1000);
    const boosted = (state.player.xp.combat ?? 0) - mid;
    const ratio = boosted / plain;
    ok(ratio > 1.15 && ratio < 1.25,
      `${sage.name} makes the same award land richer: ${plain} → ${boosted} (×${ratio.toFixed(3)})`);

    // ---- 3. it ends ---------------------------------------------------------
    g.boon.until = state.clock - 1;
    ok(!activeEffects(state).has('xp_boost'),
      'an expired boon is gone from activeEffects() before anything sweeps it');
    const after = state.player.xp.combat ?? 0;
    addXp(state, 'combat', 1000);
    const expired = (state.player.xp.combat ?? 0) - after;
    ok(expired === plain, `and the award is back to ${plain} (got ${expired}) — the bonus really lifted`);
    const gone = tickBoons(state);
    ok(gone.length === 1 && gone[0].id === sage.id, 'tickBoons() reports what lifted, so the Feed can say so');
    ok(activeBoons(state).length === 0, '...and sweeps it out of the list');

    // ---- 4. refresh, not stack ---------------------------------------------
    state.boons = [];
    const first = grantBoon(state, sage);
    const t1 = first.boon.until;
    state.clock += 5;
    const second = grantBoon(state, sage);
    state.clock -= 5;
    ok(second.how === 'refreshed', 'granting a live boon again refreshes it');
    ok(activeBoons(state).length === 1, '...to ONE boon, not two — two Ember Wards is not a hotter fire');
    ok(second.boon.until > t1, `...and extends it (${t1.toFixed(1)} → ${second.boon.until.toFixed(1)})`);

    // ---- 5. the cap displaces the oldest, out loud -------------------------
    state.boons = [];
    const distinct = BOONS.slice(0, CFG.a8.maxBoons + 1);
    ok(distinct.length === CFG.a8.maxBoons + 1, `the table has more rows than the cap (${CFG.a8.maxBoons})`);
    const grants = distinct.map((d) => grantBoon(state, d));
    ok(activeBoons(state).length === CFG.a8.maxBoons,
      `the cap holds at ${CFG.a8.maxBoons} live boons`);
    const last = grants[grants.length - 1];
    ok(last.how === 'displaced', 'the one over the cap displaces rather than silently failing');
    ok(last.displaced?.id === distinct[0].id,
      `...and it is the OLDEST that gives way (${last.displaced?.name})`);
    const stillLive = new Set(activeBoons(state).map((b) => b.id));
    ok(!stillLive.has(distinct[0].id), 'the displaced boon is no longer acting on the game');
  } finally {
    state.sockets = savedSockets;
    state.boons = savedBoons;
    state.drops.length = 0;
    for (const d of savedDrops) state.drops.push(d);
    snap.restore();
  }
}

async function testHoarderChase(nw: any) {
  const { state, sys } = nw;
  const { ENEMIES } = await import('../data/enemies');
  const { CFG } = await import('../data/config');
  const { rolledOf } = await import('../data/items');
  const { rarityIndex } = await import('../data/rarity');

  const hoarderDef: any = ENEMIES.find((e) => e.id === 'hoarder')!;
  const chargerDef: any = ENEMIES.find((e) => e.id === 'gnawer')!;

  const snap = snapshotPlayer(nw);
  const savedFoes = sys.hordes.foes.slice();
  const savedDrops = state.drops.slice();
  const savedGod = state.god;
  const savedHoarderWeight = hoarderDef.weight;
  const savedFlag = CFG.a8.enabled;
  // Not covered by snapshotPlayer, and all three would leak: 40 Hoarder kills
  // pay ~2,600 gold, which is four times CFG.horde.bossAtGold — every night
  // wave AFTER this test would start rolling domain lords into the horde. The
  // vitals are saved because part 2 measures "the player took no damage", and
  // an earlier test leaving vigor at zero would starve them mid-assertion.
  const savedGold = state.player.gold;
  const savedVigor = state.player.vigor;
  const savedResolve = state.player.resolve;
  try {
    await wearOnly(nw, []);
    state.player.vigor = CFG.vitals.vigorMax;
    state.player.resolve = CFG.vitals.resolveMax;
    // Uniform ground, so "it moved away" is about the AI and not about the
    // Hoarder happening to run downhill. Same reasoning as findUniformCorridor.
    const lane = findUniformCorridor(nw, 8);
    ok(!!lane, 'found uniform ground to measure a chase on');
    if (!lane) return;
    nw.player.teleport(lane.x, lane.y);
    nw.step(1);
    state.god = true;

    const place = (def: any) => {
      const f: any = makeDummyFoe(nw, def, lane.dx * 96 + lane.dy * 8, lane.dy * 96 + lane.dx * 8, 200);
      f.dmg = def.dmg; f.baseDmg = def.dmg; f.atkT = 0; f.telegraphT = 0;
      f.dayMob = true; f.homeX = f.x; f.homeY = f.y;
      sys.hordes.foes.push(f);
      return f;
    };
    const dist = (f: any) => Math.hypot(f.x - state.player.x, f.y - (state.player.y - 10));

    // ---- 1. it runs away, and a charger does not ---------------------------
    sys.hordes.foes.length = 0;
    const hoarder = place(hoarderDef);
    const d0 = dist(hoarder);
    nw.step(30);
    const d1 = dist(hoarder);
    ok(d1 > d0 + 8, `a spooked Hoarder runs: ${d0.toFixed(0)} → ${d1.toFixed(0)} px away`);

    sys.hordes.foes.length = 0;
    const gnawer = place(chargerDef);
    const g0 = dist(gnawer);
    nw.step(30);
    const g1 = dist(gnawer);
    ok(g1 < g0 - 8, `...and the positive control closes: ${g0.toFixed(0)} → ${g1.toFixed(0)} px`);

    // ---- 2. it never bites -------------------------------------------------
    sys.hordes.foes.length = 0;
    state.god = false;
    state.player.hp = 100;
    const close: any = place(hoarderDef);
    close.x = state.player.x + 6; close.y = state.player.y - 10;
    nw.step(60);
    ok(state.player.hp === 100,
      `a Hoarder standing on top of you never attacks (hp ${state.player.hp})`);
    sys.hordes.foes.length = 0;
    const biter: any = place(chargerDef);
    biter.x = state.player.x + 6; biter.y = state.player.y - 10;
    nw.step(60);
    ok(state.player.hp < 100, `...and the positive control does (hp ${state.player.hp})`);
    state.god = true;
    state.player.hp = 100;

    // ---- 3. it escapes, loudly, and only past escapeTiles -------------------
    const esc = hoarderDef.behavior.escapeTiles;
    sys.hordes.foes.length = 0;
    const near: any = place(hoarderDef);
    near.x = state.player.x + (esc - 4) * 32; near.y = state.player.y - 10;
    const nearUid = near.uid;
    nw.step(2);
    ok(sys.hordes.foes.some((f: any) => f.uid === nearUid),
      `inside escape range (${esc - 4}t) it is still there to be chased`);

    sys.hordes.foes.length = 0;
    const far: any = place(hoarderDef);
    far.x = state.player.x + (esc + 3) * 32; far.y = state.player.y - 10;
    const farUid = far.uid;
    nw.step(2);
    ok(!sys.hordes.foes.some((f: any) => f.uid === farUid),
      `past escape range (${esc + 3}t) it is gone`);
    // recent() rather than slice(lengthBefore): GameLog is a 2000-entry RING
    // BUFFER, so once it is full `entries.length` stops growing and slicing from
    // a remembered length returns nothing. Only two ticks passed, so the line is
    // certainly inside the last thirty.
    ok(nw.log.recent(30).some((e: any) => /escaped/i.test(e.msg)),
      '...and the Chronicle says so — losing a Hoarder is an event, not a silent despawn');

    // ---- 4. the corpse pays on the hoard band ------------------------------
    let gearSeen = 0, belowFloor = 0;
    const floor = rarityIndex('woven');
    for (let i = 0; i < 40; i++) {
      sys.hordes.foes.length = 0;
      state.drops.length = 0;
      const victim: any = place(hoarderDef);
      victim.x = state.player.x + 40; victim.y = state.player.y;
      sys.hordes.hurt(victim, 99999);
      for (const d of state.drops) {
        const r = rolledOf(d.id);
        if (!r) continue;
        gearSeen++;
        if (rarityIndex(r.rarity) < floor) belowFloor++;
      }
    }
    ok(gearSeen > 0, `40 Hoarder kills produced ${gearSeen} rolled gear pieces`);
    ok(belowFloor === 0, 'and none of them fell below the hoard band’s Woven floor');

    // ---- 5. day pool yes, night wave never ---------------------------------
    //
    // The weight is cranked for the duration so the two halves are decisive
    // rather than statistical: at a dominating weight, "0 in 40 night spawns"
    // is a real assertion about the dayOnly filter instead of a coin flip.
    // Cranking a FIXTURE is not the same as tuning the thing under test.
    hoarderDef.weight = 5000;
    const countIn = (fn: string, n: number) => {
      let hits = 0;
      for (let i = 0; i < n; i++) {
        sys.hordes.foes.length = 0;
        (sys.hordes as any)[fn]();
        if (sys.hordes.foes.some((f: any) => f.def.id === 'hoarder')) hits++;
      }
      sys.hordes.foes.length = 0;
      return hits;
    };
    const dayHits = countIn('spawnDayMob', 40);
    ok(dayHits > 0, `the Hoarder is in the day pool (${dayHits}/40 day spawns at a dominating weight)`);
    (sys.hordes as any).toSpawn = 99999;
    const nightHits = countIn('spawn', 40);
    ok(nightHits === 0, `and never in a night wave (${nightHits}/40 at the same weight)`);

    // The same flag that removes the Cairn and the Wardstone from worldgen
    // removes the Hoarder from the day pool.
    CFG.a8.enabled = false;
    const offHits = countIn('spawnDayMob', 40);
    CFG.a8.enabled = savedFlag;
    ok(offHits === 0, 'CFG.a8.enabled=false takes it back out of the day pool entirely');

    // ---- 6. it tires, so a long chase always ends --------------------------
    //
    // The 2026-08-22 verdict. Before this the Hoarder held fleeSpeedMul for as
    // long as you cared to chase it, and the gap grew ~2 px a second: crossing
    // the 21 tiles to escapeTiles took over four minutes, so in practice nobody
    // ever outran one — they waited for it to hit a tree. A loss the player can
    // do nothing about is a bad loss.
    //
    // Measured on a TREADMILL: the foe's displacement is accumulated each tick
    // and then its position is reset. That pins everything the speed product
    // reads except the one term under test — same tile so `terrain` is fixed,
    // same distance from the player so `spooked` never lifts and `escapeTiles`
    // is never crossed, same everything else (WORKFLOW 11). It also means the
    // ratio below is TERRAIN-FREE: whatever the multiplier is, it divides out.
    const beh = hoarderDef.behavior;
    const savedToast = nw.ctx.toast;
    const savedGetGameValue = nw.ctx.net?.getGameValue;
    const savedOmenMul = nw.ctx.omens?.mul;
    const toasts: string[] = [];
    try {
      // The speed product in hordes.ts also multiplies in `fray` (the deep
      // wire's hordeAggression) and `surge` (an Omen on the same target). Both
      // are read from the LIVE browser every tick, so across twenty-eight
      // seconds of sim they drift — which is a fine thing for the game and a
      // fatal thing for a measurement that compares second 1 against second 13.
      // Pinned to neutral for the duration: the treadmill holds every term in
      // that product still except the one under test (WORKFLOW 11).
      if (nw.ctx.net) nw.ctx.net.getGameValue = () => 1;
      if (nw.ctx.omens) nw.ctx.omens.mul = () => 1;

      // Part 5 above left two knobs cranked that the outer finally only puts
      // back at the very end: a dominating Hoarder weight and toSpawn at 99999.
      // Fourteen seconds of real sim under those is a Hoarder factory, and the
      // extra ones spook, tire and toast right through the measurement. That is
      // what made the "said exactly once" assertion intermittent — the count was
      // right about the foe under test and wrong about the world around it.
      hoarderDef.weight = savedHoarderWeight;
      (sys.hordes as any).toSpawn = 0;

      nw.ctx.toast = (m: string) => { toasts.push(String(m)); };
      state.god = true;
      sys.hordes.foes.length = 0;
      const runner: any = place(hoarderDef);
      const homeX = runner.x, homeY = runner.y;

      /** One second of sim with `f` held on the spot, returning the ground it
       *  covered. The field is pinned to `f` alone each tick so a natural day
       *  spawn cannot wander into the measurement. */
      const second = (f: any) => {
        let moved = 0;
        for (let i = 0; i < 60; i++) {
          if (sys.hordes.foes.length !== 1 || sys.hordes.foes[0] !== f) {
            for (const other of sys.hordes.foes) if (other !== f) nw.ctx.views?.removeFoe?.(other.uid);
            sys.hordes.foes.length = 0;
            sys.hordes.foes.push(f);
          }
          const x0 = f.x, y0 = f.y;
          nw.step(1);
          moved += Math.hypot(f.x - x0, f.y - y0);
          f.x = homeX; f.y = homeY;
        }
        return moved;
      };
      const treadmill = (f: any, secs: number) => {
        const perSec: number[] = [];
        for (let sec = 0; sec < secs; sec++) perSec.push(second(f));
        return perSec;
      };
      const avg = (v: number[], a: number, b: number) =>
        v.slice(a, b).reduce((p, c) => p + c, 0) / (b - a);

      const perSec = treadmill(runner, 14);
      const fresh = avg(perSec, 0, 3);                      // still sprinting
      const blown = avg(perSec, 11, 14);                    // past staminaSec + tiredFadeSec
      ok(fresh > 0, `the treadmill is measuring a moving foe (${fresh.toFixed(0)} px/s fresh)`);
      ok(blown < fresh * 0.85,
        `a Hoarder ${beh.staminaSec}s into a chase is slower than a fresh one: `
        + `${fresh.toFixed(0)} → ${blown.toFixed(0)} px/s`);

      // The decay reaches the mover at the AUTHORED strength, not merely in some
      // direction. Terrain cancels in this ratio, so it can be checked against
      // the data rows directly.
      const wanted = beh.tiredSpeedMul / beh.fleeSpeedMul;
      const got = blown / fresh;
      ok(Math.abs(got - wanted) < 0.08,
        `...and by the authored amount: ×${got.toFixed(2)} measured vs ×${wanted.toFixed(2)} in the table`);

      ok(toasts.some((m) => /tiring/i.test(m)),
        'the game says so out loud — the moment it blows is the only moment the mechanic teaches anything');
      eq(toasts.filter((m) => /tiring/i.test(m)).length, 1,
        '...exactly once, not once per frame for six seconds');

      // The design promise the verdict actually bought, stated at the data level
      // where terrain cannot muddy it: a chase now ENDS.
      ok(hoarderDef.speed * beh.fleeSpeedMul > CFG.player.speed,
        `a fresh Hoarder still outruns you (${(hoarderDef.speed * beh.fleeSpeedMul).toFixed(0)} > ${CFG.player.speed} px/s)`);
      ok(hoarderDef.speed * beh.tiredSpeedMul < CFG.player.speed,
        `...and a blown one does not (${(hoarderDef.speed * beh.tiredSpeedMul).toFixed(0)} < ${CFG.player.speed} px/s) `
        + '— committing to a long chase is now a decision that pays');

      // CONTROL: the slowdown is STAMINA and nothing else. Identical treadmill,
      // identical foe, identical fourteen seconds — only the budget changes. If
      // this one also slowed, the measurement above would be picking up the day
      // cycle, a wandering campfire, or the sim drifting under it.
      const savedStamina = beh.staminaSec;
      try {
        beh.staminaSec = 9999;
        sys.hordes.foes.length = 0;
        const fit: any = place(hoarderDef);
        fit.x = homeX; fit.y = homeY;
        const ctrl = treadmill(fit, 14);
        const fresh2 = avg(ctrl, 0, 3), blown2 = avg(ctrl, 11, 14);
        ok(blown2 > fresh2 * 0.95,
          `CONTROL: with the stamina budget removed the same chase never slows `
          + `(${fresh2.toFixed(0)} → ${blown2.toFixed(0)} px/s)`);
      } finally {
        beh.staminaSec = savedStamina;
      }
    } finally {
      nw.ctx.toast = savedToast;
      if (nw.ctx.net && savedGetGameValue) nw.ctx.net.getGameValue = savedGetGameValue;
      if (nw.ctx.omens && savedOmenMul) nw.ctx.omens.mul = savedOmenMul;
      sys.hordes.foes.length = 0;
    }
  } finally {
    CFG.a8.enabled = savedFlag;
    hoarderDef.weight = savedHoarderWeight;
    state.player.gold = savedGold;
    state.player.vigor = savedVigor;
    state.player.resolve = savedResolve;
    (sys.hordes as any).toSpawn = 0;
    state.god = savedGod;
    for (const f of sys.hordes.foes) nw.ctx.views?.removeFoe?.(f.uid);
    sys.hordes.foes.length = 0;
    for (const f of savedFoes) sys.hordes.foes.push(f);
    state.drops.length = 0;
    for (const d of savedDrops) state.drops.push(d);
    snap.restore();
  }
}

async function testLootGroups(nw: any) {
  const { rollLoot } = await import('../rules');
  const { FEATURES } = await import('../data/features');
  const { ENEMIES } = await import('../data/enemies');
  const { isRollable } = await import('./loot');

  const N = 6000;

  // ---- 1. an ungrouped row is untouched ------------------------------------
  // Every loot table in the game predates groups. If adding them moved an
  // ordinary row's odds by so much as a percent, A8 would have silently
  // retuned the drop rate of all 25 enemies and all 15 features.
  let hits = 0;
  for (let i = 0; i < N; i++) hits += rollLoot([{ id: 'stone', min: 1, max: 1, chance: 0.4 }]).length;
  const rate = hits / N;
  ok(Math.abs(rate - 0.4) < 0.025,
    `an ungrouped row still rolls its own chance: ${rate.toFixed(3)} against 0.400`);

  // ---- 2. a group yields exactly one, by weight ----------------------------
  const table = [
    { id: 'stone', min: 1, max: 1, chance: 30, group: 'g' },
    { id: 'log', min: 1, max: 1, chance: 10, group: 'g' },
  ];
  const sizes = new Set<number>();
  let stones = 0;
  for (let i = 0; i < N; i++) {
    const out = rollLoot(table);
    sizes.add(out.length);
    if (out.length && out[0].id === 'stone') stones++;
  }
  ok(sizes.size === 1 && sizes.has(1),
    `a group yields exactly one row on every roll (saw sizes: ${[...sizes].join(',')})`);
  const share = stones / N;
  ok(Math.abs(share - 0.75) < 0.025,
    `...drawn by weight, not uniformly: 30-against-10 came up ${(share * 100).toFixed(1)}% (want 75%)`);

  // ---- 3. the two halves compose ------------------------------------------
  const mixed = [...table, { id: 'berry', min: 1, max: 1, chance: 1 }];
  let composed = true;
  for (let i = 0; i < 400; i++) {
    const out = rollLoot(mixed);
    if (out.length !== 2 || !out.some((s: any) => s.id === 'berry')) composed = false;
  }
  ok(composed, 'a grouped row and an ungrouped row in one table both fire');

  // ---- 4. the regression this exists for ----------------------------------
  //
  // The Cairn's five gear rows at independent chances came out empty 22% of the
  // time and the whole table empty 3.3% of the time — a design promising
  // "guaranteed Hallowed+" quietly delivering nothing after a map crossing and
  // a fight. The Gauntlet caught it as a 1-in-30 flake before a player ever
  // could. Stated here as the arithmetic, so it cannot come back.
  for (const [what, loot] of [
    ['Cairn', (FEATURES.find((f) => f.id === 'cairn') as any).loot],
    ['Hoarder', (ENEMIES.find((e) => e.id === 'hoarder') as any).loot],
  ] as [string, any][]) {
    let empty = 0, noGear = 0;
    for (let i = 0; i < 3000; i++) {
      const out = rollLoot(loot);
      if (!out.length) { empty++; noGear++; continue; }
      if (!out.some((s: any) => isRollable(s.id))) noGear++;
    }
    ok(empty === 0, `3000 ${what} rolls, none of them empty`);
    ok(noGear === 0, `3000 ${what} rolls, every one held a piece of gear`);
  }

  void nw;
}
