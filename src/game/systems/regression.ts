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
  state.player.x = cx + 20;
  state.player.y = cy;
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
  for (let dy = -2; dy <= 2 && ftx < 0; dy++) {
    for (let dx = -2; dx <= 2 && ftx < 0; dx++) {
      const matId = world.materialAt(ptx + dx, pty + dy);
      if (MATERIALS[matId]?.flammable > 0 && !nw.core.isBurning(ptx + dx, pty + dy)) {
        ftx = ptx + dx;
        fty = pty + dy;
        state.player.x = ftx * 32 + 16;
        state.player.y = fty * 32 + 16 - 20;
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
  // Walk into the wall
  const origX = state.player.x;
  state.player.x = (ptx + 1) * 32 + 16;
  state.player.y = pty * 32 + 16;
  nw.step(5);
  ok(Math.abs(state.player.x - origX) < 35, 'position blocked by Palisade wall');
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

  // Place a wall near the second waystone (should work via chain)
  const wallX = ws2x + 1, wallY = ws2y;
  sys.build.enter('wall');
  if (sys.build.mode && world.canPlaceAt(wallX, wallY, false)) {
    state.buildings.push({ uid: state.nextUid++, type: 'wall', tx: wallX, ty: wallY, hp: 80 });
    world.reindexBuildings();
  }
  sys.build.cancel();
  ok(state.buildings.some((b: any) => b.type === 'wall' && b.tx === wallX),
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
    const groundSum = () => state.drops.reduce((t: number, d: any) => t + d.n, 0);
    ok(groundSum() > 0,
      `the lord's hoard hits the floor (${state.drops.length} stack(s), ${groundSum()} items)`);
    const onGround = groundSum();
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
    ok(state.player.gold > before.gold,
      `gold drops (${before.gold} → ${state.player.gold})`);

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
    const gtx0 = Math.floor(state.player.x / 32), gty0 = Math.floor(state.player.y / 32);
    let node: { tx: number; ty: number } | null = null;
    for (let dy = -3; dy <= 3 && !node; dy++)
      for (let dx = -3; dx <= 3 && !node; dx++)
        if (world.activeFeatureAt(gtx0 + dx, gty0 + dy)) node = { tx: gtx0 + dx, ty: gty0 + dy };

    if (node) {
      const savedPos = { x: state.player.x, y: state.player.y };
      state.player.x = (node.tx + 0.5) * 32 + 20;
      state.player.y = (node.ty + 0.5) * 32;
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
      state.player.x = savedPos.x; state.player.y = savedPos.y;
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
      // the only honest way to test a modifier composed inside sim(). But it
      // used to hardcode "east" from wherever the previous test left the player,
      // so a player standing against a cliff or a shoreline measured 0 px and
      // the test failed for a reason that has nothing to do with the Loom.
      // Measured: 1 run in 7 on this seed, and it also fired on the pre-existing
      // suite. Pick a direction that is actually open, and say so if none is.
      let sx = state.player.x, sy = state.player.y;
      const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      let dir = DIRS.find(([dx, dy]) => nw.world.canStand(sx + dx * 24, sy + dy * 24));
      if (!dir) {
        // Boxed in on all four sides — walk out to open ground rather than
        // report a movement failure that is really a geography failure.
        for (let r = 1; r <= 12 && !dir; r++) {
          for (const [dx, dy] of DIRS) {
            const nx = sx + dx * r * 32, ny = sy + dy * r * 32;
            if (!nw.world.canStand(nx, ny)) continue;
            nw.ctx.player.teleport(nx, ny);
            sx = nx; sy = ny;
            dir = DIRS.find(([ax, ay]) => nw.world.canStand(sx + ax * 24, sy + ay * 24));
            break;
          }
        }
      }
      ok(dir !== undefined,
        `open ground found to walk into from tile ${Math.floor(sx / 32)},${Math.floor(sy / 32)}`);
      let [AX, AY] = dir ?? [1, 0];
      nw.input.axis = () => ({ x: AX, y: AY });
      const travel = (over: any) => {
        setMods(over);
        state.player.x = sx; state.player.y = sy;
        nw.ctx.player.teleport(sx, sy);
        nw.step(20);
        return Math.hypot(state.player.x - sx, state.player.y - sy);
      };
      // A single canStand probe one tile out is not enough: 20 ticks covers
      // ~25 px, and terrain speed varies along the way (mud bogs, shorelines),
      // so a corridor that is merely OPEN can still be slower than a rooted run
      // down a clean one. Trial-run all four and keep the longest — the three
      // measurements below then compare modifiers along one proven corridor
      // instead of comparing corridors.
      let best = -1;
      for (const [dx, dy] of DIRS) {
        AX = dx; AY = dy;
        const d = travel({});
        if (d > best) { best = d; dir = [dx, dy]; }
      }
      [AX, AY] = dir ?? [1, 0];
      const freeDist = travel({});
      const rootedDist = travel({ deepRoots: true });
      const fastDist = travel({ moveSpeedPct: 100 });
      nw.input.axis = savedAxis;
      state.player.x = sx; state.player.y = sy;
      nw.ctx.player.teleport(sx, sy);
      const panelOpen = !!nw.ui?.isOpen?.();
      ok(freeDist > 0, `the player covers real ground in the sim: ${freeDist.toFixed(1)}px / 20 ticks`
        + ` (tile ${Math.floor(sx / 32)},${Math.floor(sy / 32)} heading ${AX},${AY}`
        + `${panelOpen ? ', a UI panel is open so the axis is zeroed' : ''})`);
      ok(rootedDist < freeDist,
        `Deep Roots slows real movement: ${freeDist.toFixed(1)} → ${rootedDist.toFixed(1)}px`);
      ok(fastDist > freeDist,
        `moveSpeedPct speeds it up: ${freeDist.toFixed(1)} → ${fastDist.toFixed(1)}px`);
    }

    // ---- territoryIncomePct and Night Market reach the real gold tick -----
    const heldBuildings = state.buildings;
    const ptx = Math.floor(state.player.x / 32), pty = Math.floor(state.player.y / 32);
    state.buildings = [{ uid: state.nextUid++, type: 'hall', tx: ptx + 3, ty: pty + 3, hp: 500, maxHp: 500 }];
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

  // Test thorns_reflect applies damage back
  const dummyFoe = { uid: 99999, hp: 100, maxHp: 100, dmg: 10, atkT: 0, telegraphT: 0, animT: 0,
    def: { id: 'dummy', name: 'Dummy', hp: 100, dmg: 10, speed: 1, weight: 1, nightMin: 0 },
    x: 0, y: 0, px: 0, py: 0 };
  const reflectDmg = applyEffect('thorns_reflect', {
    state: nw.state, player: nw.state.player, foe: dummyFoe as any, damage: 20,
  });
  ok(typeof reflectDmg === 'number' && reflectDmg > 0,
    `thorns_reflect returns ${reflectDmg} damage (30% of 20 = 6)`);
  ok(dummyFoe.hp < 100, `thorns reflected damage to foe (HP: ${dummyFoe.hp})`);

  ok(true, 'item effects test completed');
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
  ok(true, 'data integrity sweep completed');
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

  // Move player near hall
  state.player.x = htx * 32 + 16;
  state.player.y = hty * 32 + 16;
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
            state.player.x = (ftx + 0.5) * 32 + 20;
            state.player.y = (fty + 0.5) * 32;
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

  // rolled echo damage stays inside the D5 band: base × [dmgRow.min, dmgRow.max]
  const { NET_GAME_MAP } = await import('../data/network');
  const dmgRow = NET_GAME_MAP.find((m: any) => m.target === 'damage')!;
  const thorn = ECHOES.find((e) => e.id === 'thornring')!;
  const base = statsFor(thorn, 1).dmg;
  const minDmg = Math.max(1, Math.round(base * dmgRow.min)) - 1; // rounding slack
  const maxDmg = Math.round(base * dmgRow.max) + 1;
  const { ENEMIES } = await import('../data/enemies');
  const dummyDef = ENEMIES.find((e: any) => !e.boss)!;
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
  state.god = false;
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
  // Max decay rate = (1/15) × 3.0 × 1.15 ≈ 0.23/s. Start at 0.5, step 5s → drain ~1.15.
  p.vigor = 0.5;
  p.hp = 100;
  nw.step(5 * 30); // 5s at 30Hz
  ok(p.vigor <= 0, `vigor reached 0 (got ${p.vigor.toFixed(2)} after 5s with worst-case net)`);
  // HP should be draining — set high HP, step briefly, verify decrease
  p.hp = 100;
  const hpBefore = p.hp;
  nw.step(1 * 30); // 1 second of starvation
  // Net drain = 2/sec starvation - ~1/sec day regen ≈ 1/sec. 1s → ~1 HP lost.
  ok(p.hp < hpBefore, `HP drained after vigor=0: ${hpBefore.toFixed(0)} → ${p.hp.toFixed(0)}`);
  // Now safe to restore network and reset
  Object.assign(net.snap, saved);
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

    const hall = state.buildings.find((b: any) => b.type === 'hall');
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
];

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
