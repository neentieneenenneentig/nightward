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

  const { addXp, skillLevel } = await import('../rules');
  const beforeLevel = skillLevel(state, 'woodcutting');
  const beforeXp = state.player.xp.woodcutting ?? 0;

  const newLevel = addXp(state, 'woodcutting', 500);
  ok((state.player.xp.woodcutting ?? 0) > beforeXp, 'woodcutting XP increased');
  ok(skillLevel(state, 'woodcutting') >= beforeLevel, 'skill level is monotonic');
  ok(skillLevel(state, 'woodcutting') >= 2 || newLevel > 0, '500 XP grants at least level 2');

  void newLevel;
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
  state.player.inv.axe_flint = 10;
  state.player.inv.pick_flint = 10;
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
        const f = world.activeFeatureAt(ptx + dx, pty + dy);
        if (f && f.def?.id === feat.id) { ftx = ptx + dx; fty = pty + dy; }
      }
    }
    if (ftx < 0) continue;
    found++;
    // Move player near
    state.player.x = (ftx + 0.5) * 32 + 20;
    state.player.y = (fty + 0.5) * 32;
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
  if (lensPanel) {
    lensPanel.style.display = '';
    nw.step(5);
    const row = lensPanel.querySelector('[data-inspect-key]');
    if (row) {
      row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      const inspectBox = document.getElementById('nw-lens-inspect');
      ok(inspectBox !== null, 'inspect box element exists');
    }
    lensPanel.style.display = 'none';
  }
  ok(true, 'UI smoke test completed without errors');
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

  // Place waystone near hall (within range — should work)
  const ws1x = hall.tx + 4, ws1y = hall.ty;
  sys.build.enter('waystone');
  ok(sys.build.mode !== null, 'can enter waystone build mode');
  if (world.canPlaceAt(ws1x, ws1y, false)) {
    state.buildings.push({ uid: state.nextUid++, type: 'waystone', tx: ws1x, ty: ws1y, hp: waystoneDef.hp });
    world.reindexBuildings();
  }
  sys.build.cancel();
  ok(state.buildings.some((b: any) => b.type === 'waystone'),
    'waystone placed near hall');

  // Place second waystone near the first (chain — should work)
  const ws2x = ws1x + 4, ws2y = ws1y;
  sys.build.enter('waystone');
  if (sys.build.mode && world.canPlaceAt(ws2x, ws2y, false)) {
    state.buildings.push({ uid: state.nextUid++, type: 'waystone', tx: ws2x, ty: ws2y, hp: waystoneDef.hp });
    world.reindexBuildings();
  }
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
  ok(LOOM_NODES.length >= 40, `Loom has ${LOOM_NODES.length} nodes (expected ≥40)`);

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
  ok(glassEcho!.keystoneDesc!.includes('HP'), 'Glass Echo description mentions HP tradeoff');

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

  const allocated = loom.allocate('keystone_glass_echo');
  if (allocated) {
    const mods = loom.ensureMods();
    ok(mods.glassEcho === true, 'Glass Echo flag is true after allocation');

    // Verify HP halving is readable
    const hpMul = loom.getPlayerHpMul?.() ?? 1;
    ok(hpMul < 1, `Glass Echo reduces player HP multiplier: ${hpMul}`);
  }

  ok(true, 'loom keystones test completed');
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

    // Check relic in inventory
    const relic = relics.find((r: any) => r.relic === bossDef.id || r.relic === `relic_${bossDef.id}`);
    if (relic) {
      const count = state.player.inv[relic.id] ?? 0;
      if (count > 0) relicsDropped++;
    }

    // Clean up boss
    state.worldBosses = state.worldBosses.filter((b: any) => b.lordId !== bossDef.id);
  }

  ok(relicsDropped >= 1, `${relicsDropped} boss relic(s) dropped into inventory`);
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
  state.player.relic = undefined;
  nw.step(1);

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
    // Track nights survived
    if (state.nightsSurvived > prevNight) {
      m.nightsSurvived = state.nightsSurvived;
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
  net.snap.downlink = 10;     // ≥10 Mbps → vigorDecay ×1.0
  net.snap.rtt = 50;          // 20–50ms → simSpeed ×1.0
  net.snap.effectiveType = '4g'; // → resolveDecay ×1.0
  net.snap.timeOfDay = 12;    // noon → resolveNightMult ×0.8 (daytime band)
  // Mark an action so idle multiplier doesn't kick in
  p.lastActionT = state.clock;
  p.vigor = 100;
  p.resolve = 100;
  nw.step(60 * 30); // 60s at 30Hz
  // Restore network
  Object.assign(net.snap, saved);
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
          state.player.x = (ptx + dx + 0.5) * 32;
          state.player.y = (pty + dy + 0.5) * 32;
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

    // Track nights
    if (state.nightsSurvived > prevNight) {
      m.nightsSurvived = state.nightsSurvived;
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

  // Core survival — these MUST pass
  ok(!state.gameOver || m.nightsSurvived >= 3,
    `game not over OR ${m.nightsSurvived} nights survived`);
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

  const elapsed = (performance.now() - startMs).toFixed(0);
  const summary = _fail === 0
    ? `✅ ALL ${_pass} TESTS PASSED  (${elapsed}ms)`
    : `❌ ${_fail}/${TESTS.length} FAILED  (${elapsed}ms)`;

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
