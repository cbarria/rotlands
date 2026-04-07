import { BASE_MELEE_DAMAGE, MAX_HP, MAX_SLOTS } from "./inventory.js";
import { normalizeEquipment, recalculateCombatStats } from "./equipment.js";
import { getEnemyDef } from "./enemyTypes.js";
import { rollLootDropFromEnemy } from "./loot.js";
import { SHOPKEEPER } from "./shop.js";

/** @typedef {"up"|"down"|"left"|"right"} Dir */

export const TILE = {
  GRASS: 0,
  WALL: 1,
  PORTAL: 2,
  /** Solid — blocks movement (treated like wall for pathing). */
  TREE: 3,
  ROCK: 4,
  /** Walkable tall grass / flowers — visual variety only. */
  GRASS_PATCH: 5,
};
export const MAP_W = 24;
export const MAP_H = 18;

/** Shown in client HUD for progression feel. */
export const MAP_LABELS = {
  town: "Town",
  forest: "Forest",
  dungeon1: "Dungeon I",
  dungeon2: "Dungeon II",
};

/** @param {string | undefined} mapId */
export function normalizeStoredMapId(mapId) {
  if (!mapId || typeof mapId !== "string") return "town";
  if (mapId === "dungeon") return "dungeon1";
  return mapId;
}

const SPAWN_ZONE_FILL_COOLDOWN_MS = 2800;
const SPAWN_JOB_DEFER_MS = 400;

/**
 * Region on a map that spawns specific enemy types up to `maxEnemies`.
 *
 * @typedef {{
 *   id: string,
 *   enemyTypes: string[],
 *   maxEnemies: number,
 *   cells: Array<[number, number]>,
 * }} SpawnZone
 *
 * Live enemy (server-authoritative). On death it is removed from `zone.enemies` and a
 * `PendingEnemyRespawn` job is queued.
 *
 * @typedef {{
 *   id: number,
 *   mapId: string,
 *   kind: "enemy",
 *   enemyType: string,
 *   x: number,
 *   y: number,
 *   spawnX: number,
 *   spawnY: number,
 *   spawnZoneId: string,
 *   hp: number,
 *   maxHp: number,
 *   moveCd: number,
 *   attackCd: number,
 *   respawnDelayMs: number,
 * }} LiveEnemy
 *
 * @typedef {{
 *   mapId: string,
 *   spawnZoneId: string,
 *   spawnAt: number,
 * }} PendingEnemyRespawn
 *
 * @typedef {{
 *   id: string,
 *   combatAllowed: boolean,
 *   tiles: number[][],
 *   portals: Array<{ x: number, y: number, toMap: string, toX: number, toY: number }>,
 *   enemies: Map<number, LiveEnemy>,
 *   groundItems: Map<number, any>,
 *   spawnZones: SpawnZone[],
 * }} MapZone
 */

/** @returns {number} delay in [5000, 10000) ms */
export function rollRespawnDelayMs() {
  return 5000 + Math.floor(Math.random() * 5000);
}

/** @template T @param {T[]} arr */
function pickRandom(arr) {
  return arr[(Math.random() * arr.length) | 0];
}

/** @param {Array<[number, number]>} coords */
function shuffleCoords(coords) {
  const a = coords.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/**
 * @param {number} id
 * @param {string} mapId
 * @param {string} enemyType
 * @param {number} x
 * @param {number} y
 * @param {string} spawnZoneId
 * @param {{ maxHp: number }} def
 * @returns {LiveEnemy}
 */
function makeEnemyEntity(id, mapId, enemyType, x, y, spawnZoneId, def) {
  return {
    id,
    mapId,
    kind: "enemy",
    enemyType,
    x,
    y,
    spawnX: x,
    spawnY: y,
    spawnZoneId,
    hp: def.maxHp,
    maxHp: def.maxHp,
    moveCd: 0,
    attackCd: 0,
    respawnDelayMs: rollRespawnDelayMs(),
  };
}

/**
 * Place up to each zone's `maxEnemies` on free cells (used at map init).
 * @param {MapZone} zone
 * @param {() => number} allocId
 */
function seedSpawnZones(zone, allocId) {
  for (const sz of zone.spawnZones || []) {
    const cells = shuffleCoords(sz.cells);
    let placed = 0;
    for (const [cx, cy] of cells) {
      if (placed >= sz.maxEnemies) break;
      if (!walkable(zone.tiles, cx, cy)) continue;
      let occupied = false;
      for (const e of zone.enemies.values()) {
        if (e.x === cx && e.y === cy) {
          occupied = true;
          break;
        }
      }
      if (occupied) continue;
      const type = pickRandom(sz.enemyTypes);
      const def = getEnemyDef(type);
      const id = allocId();
      zone.enemies.set(id, makeEnemyEntity(id, zone.id, type, cx, cy, sz.id, def));
      placed++;
    }
  }
}

export function walkable(tiles, x, y) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
  const t = tiles[y][x];
  return t === TILE.GRASS || t === TILE.PORTAL || t === TILE.GRASS_PATCH;
}

/** @returns damage actually applied after armor */
function damagePlayerFromEnemy(pl, rawDamage) {
  const reduced = Math.max(1, rawDamage - (pl.armorDefense | 0));
  pl.hp -= reduced;
  return reduced;
}

function emptyTiles() {
  return Array.from({ length: MAP_H }, () => Array(MAP_W).fill(TILE.GRASS));
}

function borderWalls(tiles) {
  for (let x = 0; x < MAP_W; x++) {
    tiles[0][x] = TILE.WALL;
    tiles[MAP_H - 1][x] = TILE.WALL;
  }
  for (let y = 0; y < MAP_H; y++) {
    tiles[y][0] = TILE.WALL;
    tiles[y][MAP_W - 1] = TILE.WALL;
  }
}

/** @param {number} x @param {number} y */
function cellHash(x, y) {
  let n = (x * 374761393 + y * 668265263) >>> 0;
  n = (n ^ (n >>> 13)) >>> 0;
  n = (n * 1274126177) >>> 0;
  return n >>> 0;
}

/**
 * Scatter trees (clustered), rocks, and walkable grass patches on plain grass.
 * @param {number[][]} tiles
 * @param {Array<[number, number]>} forbidden no props on these cells
 */
function decorateLandscape(tiles, forbidden) {
  const ban = new Set(forbidden.map(([a, b]) => `${a},${b}`));
  const key = (x, y) => `${x},${y}`;
  const isGrass = (x, y) =>
    x >= 0 &&
    y >= 0 &&
    x < MAP_W &&
    y < MAP_H &&
    tiles[y][x] === TILE.GRASS;

  for (let y = 1; y < MAP_H - 1; y++) {
    for (let x = 1; x < MAP_W - 1; x++) {
      if (!isGrass(x, y) || ban.has(key(x, y))) continue;
      const r = (cellHash(x, y) % 1000) / 1000;
      const nearTree =
        tiles[y][x - 1] === TILE.TREE ||
        tiles[y][x + 1] === TILE.TREE ||
        tiles[y - 1][x] === TILE.TREE ||
        tiles[y + 1][x] === TILE.TREE;
      const pTree = nearTree ? 0.19 : 0.045;
      if (r < pTree) tiles[y][x] = TILE.TREE;
    }
  }

  for (let y = 1; y < MAP_H - 1; y++) {
    for (let x = 1; x < MAP_W - 1; x++) {
      if (tiles[y][x] !== TILE.GRASS || ban.has(key(x, y))) continue;
      const r = (cellHash(x + 911, y + 503) % 1000) / 1000;
      if (r < 0.052) tiles[y][x] = TILE.ROCK;
    }
  }

  for (let y = 1; y < MAP_H - 1; y++) {
    for (let x = 1; x < MAP_W - 1; x++) {
      if (tiles[y][x] !== TILE.GRASS || ban.has(key(x, y))) continue;
      const r = (cellHash(x * 17 + 3, y * 31 + 7) % 1000) / 1000;
      if (r < 0.17) tiles[y][x] = TILE.GRASS_PATCH;
    }
  }
}

function makeTownZone() {
  const tiles = emptyTiles();
  borderWalls(tiles);
  for (let x = 6; x < 12; x++) tiles[6][x] = TILE.WALL;
  for (let y = 10; y < 14; y++) tiles[y][8] = TILE.WALL;

  const portals = [{ x: 21, y: 9, toMap: "forest", toX: 2, toY: 9 }];
  tiles[9][21] = TILE.PORTAL;

  const townNoProps = [
    [21, 9],
    [20, 9],
    [22, 9],
    [21, 8],
    [21, 10],
    [4, 8],
    [3, 8],
    [5, 8],
    [4, 7],
    [4, 9],
    [5, 5],
    [3, 3],
    [4, 3],
    [3, 4],
  ];
  decorateLandscape(tiles, townNoProps);

  /** @type {MapZone} */
  const zone = {
    id: "town",
    combatAllowed: false,
    tiles,
    portals,
    enemies: new Map(),
    groundItems: new Map(),
    spawnZones: [],
  };

  return zone;
}

function defaultSpawnForMap(mapId) {
  switch (mapId) {
    case "forest":
      return [10, 9];
    case "dungeon1":
      return [10, 10];
    case "dungeon2":
      return [10, 12];
    case "town":
    default:
      return [4, 8];
  }
}

/** @param {MapZone} zone */
function clampPlayerSpawn(zone, x, y) {
  const xi = Number.isFinite(x) ? Math.trunc(x) : NaN;
  const yi = Number.isFinite(y) ? Math.trunc(y) : NaN;
  if (Number.isFinite(xi) && Number.isFinite(yi) && walkable(zone.tiles, xi, yi)) {
    return [xi, yi];
  }
  const [sx, sy] = defaultSpawnForMap(zone.id);
  if (walkable(zone.tiles, sx, sy)) return [sx, sy];
  for (let yy = 1; yy < MAP_H - 1; yy++) {
    for (let xx = 1; xx < MAP_W - 1; xx++) {
      if (walkable(zone.tiles, xx, yy)) return [xx, yy];
    }
  }
  return [4, 8];
}

function makeForestZone(allocId) {
  const tiles = emptyTiles();
  borderWalls(tiles);
  for (let x = 5; x < 11; x++) tiles[12][x] = TILE.WALL;
  for (let y = 5; y < 10; y++) tiles[y][14] = TILE.WALL;

  const portals = [
    { x: 2, y: 9, toMap: "town", toX: 20, toY: 9 },
    { x: 21, y: 9, toMap: "dungeon1", toX: 3, toY: 3 },
  ];
  tiles[9][2] = TILE.PORTAL;
  tiles[9][21] = TILE.PORTAL;

  const noProps = [
    [2, 9],
    [3, 9],
    [1, 9],
    [2, 8],
    [2, 10],
    [21, 9],
    [20, 9],
    [22, 9],
    [21, 8],
    [21, 10],
    [13, 7],
    [14, 7],
    [13, 8],
    [14, 8],
    [6, 6],
    [11, 14],
  ];
  decorateLandscape(tiles, noProps);

  /** @type {MapZone} */
  const zone = {
    id: "forest",
    combatAllowed: true,
    tiles,
    portals,
    enemies: new Map(),
    groundItems: new Map(),
    spawnZones: [
      {
        id: "forest_west",
        enemyTypes: ["slime"],
        maxEnemies: 3,
        cells: [
          [11, 7],
          [13, 8],
          [9, 11],
          [7, 7],
          [10, 14],
          [8, 10],
        ],
      },
      {
        id: "forest_east",
        enemyTypes: ["slime"],
        maxEnemies: 2,
        cells: [
          [18, 8],
          [19, 11],
          [17, 12],
          [18, 6],
        ],
      },
    ],
  };

  seedSpawnZones(zone, allocId);

  const coinId = allocId();
  zone.groundItems.set(coinId, {
    id: coinId,
    mapId: "forest",
    kind: "item",
    itemType: "coin",
    x: 6,
    y: 6,
  });

  const breadId = allocId();
  zone.groundItems.set(breadId, {
    id: breadId,
    mapId: "forest",
    kind: "item",
    itemType: "bread",
    x: 11,
    y: 14,
  });

  return zone;
}

function makeDungeon1Zone(allocId) {
  const tiles = emptyTiles();
  borderWalls(tiles);
  for (let x = 8; x < 14; x++) tiles[9][x] = TILE.WALL;
  for (let y = 4; y < 9; y++) tiles[y][12] = TILE.WALL;

  const portals = [
    { x: 2, y: 2, toMap: "forest", toX: 20, toY: 9 },
    { x: 21, y: 15, toMap: "dungeon2", toX: 3, toY: 3 },
  ];
  tiles[2][2] = TILE.PORTAL;
  tiles[15][21] = TILE.PORTAL;

  const noProps = [
    [2, 2],
    [3, 2],
    [2, 3],
    [3, 3],
    [21, 15],
    [20, 15],
    [22, 15],
    [21, 14],
    [21, 16],
    [7, 7],
    [10, 8],
    [14, 11],
    [16, 10],
    [15, 10],
    [17, 10],
    [16, 9],
    [16, 11],
  ];
  decorateLandscape(tiles, noProps);

  /** @type {MapZone} */
  const zone = {
    id: "dungeon1",
    combatAllowed: true,
    tiles,
    portals,
    enemies: new Map(),
    groundItems: new Map(),
    spawnZones: [
      {
        id: "d1_hall",
        enemyTypes: ["skeleton"],
        maxEnemies: 4,
        cells: [
          [16, 10],
          [14, 7],
          [11, 5],
          [18, 12],
          [13, 14],
          [10, 14],
          [7, 5],
        ],
      },
    ],
  };

  seedSpawnZones(zone, allocId);

  const coinId = allocId();
  zone.groundItems.set(coinId, {
    id: coinId,
    mapId: "dungeon1",
    kind: "item",
    itemType: "coin",
    x: 7,
    y: 7,
  });

  const potionId = allocId();
  zone.groundItems.set(potionId, {
    id: potionId,
    mapId: "dungeon1",
    kind: "item",
    itemType: "potion",
    meta: { rarity: "common", heal: 28, dmg: 0, def: 0, hp: 0 },
    x: 10,
    y: 8,
  });

  const weaponId = allocId();
  zone.groundItems.set(weaponId, {
    id: weaponId,
    mapId: "dungeon1",
    kind: "item",
    itemType: "weapon",
    meta: { rarity: "rare", dmg: 8, def: 1, hp: 2 },
    x: 14,
    y: 11,
  });

  return zone;
}

function makeDungeon2Zone(allocId) {
  const tiles = emptyTiles();
  borderWalls(tiles);
  for (let y = 6; y < 12; y++) tiles[y][10] = TILE.WALL;
  for (let x = 14; x < 19; x++) tiles[14][x] = TILE.WALL;

  const portals = [{ x: 2, y: 2, toMap: "dungeon1", toX: 20, toY: 15 }];
  tiles[2][2] = TILE.PORTAL;

  const noProps = [
    [2, 2],
    [3, 2],
    [2, 3],
    [3, 3],
    [17, 8],
    [8, 14],
    [12, 16],
    [18, 5],
    [6, 4],
    [15, 11],
  ];
  decorateLandscape(tiles, noProps);

  /** @type {MapZone} */
  const zone = {
    id: "dungeon2",
    combatAllowed: true,
    tiles,
    portals,
    enemies: new Map(),
    groundItems: new Map(),
    spawnZones: [
      {
        id: "d2_undead",
        enemyTypes: ["zombie"],
        maxEnemies: 2,
        cells: [
          [17, 8],
          [15, 9],
          [16, 6],
        ],
      },
      {
        id: "d2_fiend",
        enemyTypes: ["demon"],
        maxEnemies: 2,
        cells: [
          [8, 14],
          [9, 11],
          [6, 12],
          [11, 6],
        ],
      },
    ],
  };

  seedSpawnZones(zone, allocId);

  const potionId = allocId();
  zone.groundItems.set(potionId, {
    id: potionId,
    mapId: "dungeon2",
    kind: "item",
    itemType: "potion",
    meta: { rarity: "rare", heal: 48, dmg: 0, def: 0, hp: 1 },
    x: 12,
    y: 16,
  });

  const weaponId = allocId();
  zone.groundItems.set(weaponId, {
    id: weaponId,
    mapId: "dungeon2",
    kind: "item",
    itemType: "weapon",
    meta: { rarity: "epic", dmg: 12, def: 2, hp: 4 },
    x: 18,
    y: 5,
  });

  const coinId = allocId();
  zone.groundItems.set(coinId, {
    id: coinId,
    mapId: "dungeon2",
    kind: "item",
    itemType: "coin",
    x: 6,
    y: 4,
  });

  return zone;
}

export class World {
  constructor() {
    this.nextEntityId = 1;
    /** @type {Map<string, MapZone>} */
    this.mapZones = new Map();
    const town = makeTownZone();
    const forest = makeForestZone(() => this._allocId());
    const dungeon1 = makeDungeon1Zone(() => this._allocId());
    const dungeon2 = makeDungeon2Zone(() => this._allocId());
    this.mapZones.set(town.id, town);
    this.mapZones.set(forest.id, forest);
    this.mapZones.set(dungeon1.id, dungeon1);
    this.mapZones.set(dungeon2.id, dungeon2);

    this._spawnTownItems();

    /** @type {Map<string, any>} */
    this.players = new Map();

    /** @type {PendingEnemyRespawn[]} */
    this._pendingEnemyRespawns = [];

    /** @type {Map<string, number>} key `${mapId}:${spawnZoneId}` → last fill enqueue time */
    this._spawnZoneFillAt = new Map();

    if (this.nextEntityId >= SHOPKEEPER.id) this.nextEntityId = SHOPKEEPER.id + 1;
  }

  /**
   * @param {string} mapId
   * @param {number} now
   * @param {{ spawnZoneId: string, respawnDelayMs: number }} spec
   */
  _queueEnemyRespawn(mapId, now, spec) {
    this._pendingEnemyRespawns.push({
      mapId,
      spawnZoneId: spec.spawnZoneId,
      spawnAt: now + spec.respawnDelayMs,
    });
  }

  /** @param {MapZone} zone @param {string} spawnZoneId */
  _liveCountForSpawnZone(zone, spawnZoneId) {
    let n = 0;
    for (const e of zone.enemies.values()) {
      if (e.hp > 0 && e.spawnZoneId === spawnZoneId) n++;
    }
    return n;
  }

  /** @param {string} mapId @param {string} spawnZoneId */
  _pendingCountForSpawnZone(mapId, spawnZoneId) {
    let n = 0;
    for (const j of this._pendingEnemyRespawns) {
      if (j.mapId === mapId && j.spawnZoneId === spawnZoneId) n++;
    }
    return n;
  }

  /**
   * @param {number} now
   * @param {PendingEnemyRespawn} job
   * @returns {boolean} true if job completed (spawned or dropped), false if deferred
   */
  _tryConsumeSpawnJob(now, job) {
    const zone = this.mapZones.get(job.mapId);
    if (!zone?.combatAllowed) return true;
    const sz = zone.spawnZones?.find((s) => s.id === job.spawnZoneId);
    if (!sz) return true;

    if (this._liveCountForSpawnZone(zone, sz.id) >= sz.maxEnemies) return false;

    const cells = shuffleCoords(sz.cells);
    let cell = null;
    for (const [x, y] of cells) {
      if (this._canSpawnEnemyAt(zone, x, y)) {
        cell = [x, y];
        break;
      }
    }
    if (!cell) return false;

    const type = pickRandom(sz.enemyTypes);
    const def = getEnemyDef(type);
    const id = this._allocId();
    zone.enemies.set(id, makeEnemyEntity(id, zone.id, type, cell[0], cell[1], sz.id, def));
    return true;
  }

  /** @param {number} now */
  _maybeEnqueueSpawnZoneFills(now) {
    for (const zone of this.mapZones.values()) {
      if (!zone.combatAllowed || !zone.spawnZones?.length) continue;
      for (const sz of zone.spawnZones) {
        const live = this._liveCountForSpawnZone(zone, sz.id);
        const pend = this._pendingCountForSpawnZone(zone.id, sz.id);
        if (live + pend >= sz.maxEnemies) continue;

        const key = `${zone.id}:${sz.id}`;
        const last = this._spawnZoneFillAt.get(key) ?? 0;
        if (now - last < SPAWN_ZONE_FILL_COOLDOWN_MS) continue;

        this._spawnZoneFillAt.set(key, now);
        this._pendingEnemyRespawns.push({
          mapId: zone.id,
          spawnZoneId: sz.id,
          spawnAt: now + 600 + Math.floor(Math.random() * 1400),
        });
      }
    }
  }

  /** @param {MapZone} zone */
  _canSpawnEnemyAt(zone, x, y) {
    if (!walkable(zone.tiles, x, y)) return false;
    for (const p of this.players.values()) {
      if (p.mapId === zone.id && p.hp > 0 && p.x === x && p.y === y) return false;
    }
    for (const o of zone.enemies.values()) {
      if (o.hp > 0 && o.x === x && o.y === y) return false;
    }
    return true;
  }

  /** @param {number} now */
  processRespawns(now) {
    /** @type {PendingEnemyRespawn[]} */
    const next = [];
    for (const job of this._pendingEnemyRespawns) {
      if (job.spawnAt > now) {
        next.push(job);
        continue;
      }
      const ok = this._tryConsumeSpawnJob(now, job);
      if (!ok) {
        job.spawnAt = now + SPAWN_JOB_DEFER_MS;
        next.push(job);
      }
    }
    this._pendingEnemyRespawns = next;
    this._maybeEnqueueSpawnZoneFills(now);
  }

  _spawnTownItems() {
    const town = this.mapZones.get("town");
    const id = this._allocId();
    town.groundItems.set(id, {
      id,
      mapId: "town",
      kind: "item",
      itemType: "bread",
      x: 5,
      y: 5,
    });
  }

  _allocId() {
    return this.nextEntityId++;
  }

  /** @param {MapZone} zone @param {number} x @param {number} y */
  _cellFreeForGroundItem(zone, x, y) {
    if (!walkable(zone.tiles, x, y)) return false;
    for (const it of zone.groundItems.values()) {
      if (it.x === x && it.y === y) return false;
    }
    return true;
  }

  /**
   * @param {MapZone} zone
   * @param {number} x
   * @param {number} y
   * @returns {null | [number, number]}
   */
  _pickLootDropCell(zone, x, y) {
    const order = [
      [x, y],
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
      [x + 1, y + 1],
      [x - 1, y - 1],
      [x + 1, y - 1],
      [x - 1, y + 1],
    ];
    for (const [cx, cy] of order) {
      if (this._cellFreeForGroundItem(zone, cx, cy)) return [cx, cy];
    }
    return null;
  }

  /**
   * @param {MapZone} zone
   * @param {{ x: number, y: number, enemyType: string }} enemy
   */
  _dropEnemyLoot(zone, enemy) {
    const drop = rollLootDropFromEnemy(enemy.enemyType);
    const cell = this._pickLootDropCell(zone, enemy.x, enemy.y);
    if (!cell) return;
    const id = this._allocId();
    /** @type {any} */
    const ent = {
      id,
      mapId: zone.id,
      kind: "item",
      itemType: drop.itemType,
      x: cell[0],
      y: cell[1],
    };
    if (drop.meta) ent.meta = drop.meta;
    zone.groundItems.set(id, ent);
  }

  /** @returns {string[]} */
  allMapIds() {
    return [...this.mapZones.keys()];
  }

  /** @param {string} mapId */
  getZone(mapId) {
    const z = this.mapZones.get(mapId);
    if (!z) throw new Error(`unknown_map:${mapId}`);
    return z;
  }

  removePlayer(socketId) {
    this.players.delete(socketId);
  }

  addPlayer(socketId, rec) {
    let startMap = normalizeStoredMapId(rec.current_map);
    if (!this.mapZones.has(startMap)) startMap = "town";
    const zone0 = this.getZone(startMap);
    const [sx, sy] = clampPlayerSpawn(zone0, rec.x, rec.y);
    const id = this._allocId();
    /** @type {(null | { type: string, qty: number, meta?: any })[]} */
    const slots = Array.isArray(rec.slots)
      ? rec.slots.map((s) =>
          s ? { type: s.type, qty: s.qty, ...(s.meta != null ? { meta: s.meta } : {}) } : null,
        )
      : Array(MAX_SLOTS).fill(null);
    while (slots.length < MAX_SLOTS) slots.push(null);
    if (slots.length > MAX_SLOTS) slots.length = MAX_SLOTS;
    const p = {
      id,
      socketId,
      kind: "player",
      dbId: rec.id,
      name: rec.name,
      mapId: startMap,
      x: sx,
      y: sy,
      hp: rec.hp,
      slots,
      equipment: normalizeEquipment(rec.equipment),
      weaponBonus: 0,
      armorDefense: 0,
      gearMaxHpBonus: 0,
      gold: Math.max(0, (rec.gold ?? 0) | 0),
      lastMove: 0,
      attackCd: 0,
    };
    recalculateCombatStats(p);
    this.players.set(socketId, p);
    return p;
  }

  playersOnMap(mapId) {
    return [...this.players.values()].filter((p) => p.mapId === mapId && p.hp > 0);
  }

  /** @param {string} socketId @param {Dir} dir */
  tryMovePlayer(socketId, dir, now, moveDelayMs) {
    const p = this.players.get(socketId);
    if (!p || p.hp <= 0) return { moved: false };
    if (now - p.lastMove < moveDelayMs) return { moved: false };

    const zone = this.getZone(p.mapId);
    let nx = p.x;
    let ny = p.y;
    if (dir === "up") ny -= 1;
    if (dir === "down") ny += 1;
    if (dir === "left") nx -= 1;
    if (dir === "right") nx += 1;
    if (!walkable(zone.tiles, nx, ny)) return { moved: false };

    for (const q of this.players.values()) {
      if (q.mapId !== p.mapId || q.socketId === socketId || q.hp <= 0) continue;
      if (q.x === nx && q.y === ny) return { moved: false };
    }
    for (const e of zone.enemies.values()) {
      if (e.hp > 0 && e.x === nx && e.y === ny) return { moved: false };
    }
    if (zone.id === SHOPKEEPER.mapId && nx === SHOPKEEPER.x && ny === SHOPKEEPER.y) return { moved: false };

    p.x = nx;
    p.y = ny;
    p.lastMove = now;

    const portal = zone.portals.find((pr) => pr.x === p.x && pr.y === p.y);
    if (portal && this.mapZones.has(portal.toMap)) {
      const fromMap = p.mapId;
      p.mapId = portal.toMap;
      p.x = portal.toX;
      p.y = portal.toY;
      return { moved: true, teleported: true, fromMap, toMap: p.mapId };
    }

    return { moved: true, teleported: false };
  }

  tryPickup(socketId) {
    const pl = this.players.get(socketId);
    if (!pl || pl.hp <= 0) return null;
    const zone = this.getZone(pl.mapId);
    for (const it of zone.groundItems.values()) {
      if (it.mapId !== pl.mapId) continue;
      const adx = Math.abs(it.x - pl.x);
      const ady = Math.abs(it.y - pl.y);
      if (adx <= 1 && ady <= 1 && adx + ady > 0) return it;
    }
    for (const it of zone.groundItems.values()) {
      if (it.mapId === pl.mapId && it.x === pl.x && it.y === pl.y) return it;
    }
    return null;
  }

  removeGroundItem(mapId, itemId) {
    const zone = this.getZone(mapId);
    zone.groundItems.delete(itemId);
  }

  tryAttack(socketId, targetId, now, cooldownMs, dmgPlayer = 10) {
    const p = this.players.get(socketId);
    if (!p || p.hp <= 0) return null;
    const zone = this.getZone(p.mapId);
    if (!zone.combatAllowed) return null;
    if (now - p.attackCd < cooldownMs) return null;
    const dmgEnemy = BASE_MELEE_DAMAGE + (p.weaponBonus | 0);

    const e = zone.enemies.get(targetId);
    if (e && e.hp > 0 && e.mapId === p.mapId) {
      const adx = Math.abs(p.x - e.x);
      const ady = Math.abs(p.y - e.y);
      if (adx + ady !== 1) return null;
      e.hp -= dmgEnemy;
      p.attackCd = now;
      const killed = e.hp <= 0;
      if (killed) {
        this._dropEnemyLoot(zone, e);
        this._queueEnemyRespawn(zone.id, now, {
          spawnZoneId: e.spawnZoneId || zone.spawnZones?.[0]?.id || "orphan",
          respawnDelayMs: e.respawnDelayMs,
        });
        zone.enemies.delete(targetId);
      }
      return {
        type: "hitEnemy",
        targetId,
        hp: killed ? 0 : e.hp,
        damage: dmgEnemy,
        mapId: p.mapId,
        killed,
      };
    }

    const op = [...this.players.values()].find((q) => q.id === targetId && q.socketId !== socketId);
    if (op && op.hp > 0 && op.mapId === p.mapId) {
      const adx = Math.abs(p.x - op.x);
      const ady = Math.abs(p.y - op.y);
      if (adx + ady !== 1) return null;
      op.hp -= dmgPlayer;
      p.attackCd = now;
      return { type: "hitPlayer", targetId, hp: op.hp, damage: dmgPlayer, mapId: p.mapId };
    }

    return null;
  }

  tickEnemies(now, tickMs) {
    const out = [];
    for (const zone of this.mapZones.values()) {
      if (!zone.combatAllowed) continue;
      const plList = this.playersOnMap(zone.id);
      for (const e of zone.enemies.values()) {
        if (e.hp <= 0) continue;
        const def = getEnemyDef(e.enemyType);
        e.moveCd -= tickMs;
        e.attackCd = Math.max(0, (e.attackCd ?? 0) - tickMs);

        let target = null;
        let best = 999;
        for (const pl of plList) {
          const d = Math.abs(pl.x - e.x) + Math.abs(pl.y - e.y);
          if (d < best) {
            best = d;
            target = pl;
          }
        }

        if (target && best === 1 && e.attackCd <= 0) {
          const applied = damagePlayerFromEnemy(target, def.damage);
          e.attackCd = def.attackCooldownMs;
          out.push({
            type: "enemyHitPlayer",
            enemyId: e.id,
            targetDbId: target.dbId,
            hp: target.hp,
            damage: applied,
            mapId: zone.id,
          });
          continue;
        }

        if (e.moveCd > 0) continue;
        e.moveCd = def.moveIntervalMs;

        const dirs = ["up", "down", "left", "right"];
        let dir = dirs[(Math.random() * 4) | 0];
        if (target && best <= def.aggroRange) {
          const dx = target.x - e.x;
          const dy = target.y - e.y;
          if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? "right" : "left";
          else if (dy !== 0) dir = dy > 0 ? "down" : "up";
        }
        let nx = e.x;
        let ny = e.y;
        if (dir === "up") ny -= 1;
        if (dir === "down") ny += 1;
        if (dir === "left") nx -= 1;
        if (dir === "right") nx += 1;
        if (!walkable(zone.tiles, nx, ny)) continue;
        let blocked = false;
        for (const pl of plList) {
          if (pl.x === nx && pl.y === ny) {
            if (e.attackCd <= 0) {
              const applied = damagePlayerFromEnemy(pl, def.damage);
              e.attackCd = def.attackCooldownMs;
              out.push({
                type: "enemyHitPlayer",
                enemyId: e.id,
                targetDbId: pl.dbId,
                hp: pl.hp,
                damage: applied,
                mapId: zone.id,
              });
            }
            blocked = true;
            break;
          }
        }
        if (blocked) continue;
        for (const o of zone.enemies.values()) {
          if (o.id !== e.id && o.hp > 0 && o.x === nx && o.y === ny) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;
        e.x = nx;
        e.y = ny;
      }
    }
    return out;
  }

  /** @param {string} mapId */
  snapshot(mapId) {
    const zone = this.getZone(mapId);
    const entities = [];
    for (const p of this.players.values()) {
      if (p.mapId !== mapId) continue;
      const slotSnap = p.slots.map((s) =>
        s ? { type: s.type, qty: s.qty, ...(s.meta != null ? { meta: s.meta } : {}) } : null,
      );
      entities.push({
        id: p.id,
        kind: "player",
        name: p.name,
        x: Math.trunc(p.x),
        y: Math.trunc(p.y),
        hp: Math.trunc(p.hp),
        inventory: {
          slots: slotSnap,
          weaponBonus: p.weaponBonus | 0,
          armorDefense: p.armorDefense | 0,
          maxHp: MAX_HP + (p.gearMaxHpBonus | 0),
          equipment: {
            weapon: p.equipment.weapon,
            helmet: p.equipment.helmet,
            chest: p.equipment.chest,
            boots: p.equipment.boots,
          },
        },
        gold: p.gold | 0,
      });
    }
    if (mapId === SHOPKEEPER.mapId) {
      entities.push({
        id: SHOPKEEPER.id,
        kind: "npc",
        npcType: SHOPKEEPER.npcType,
        name: SHOPKEEPER.name,
        x: SHOPKEEPER.x,
        y: SHOPKEEPER.y,
      });
    }
    for (const e of zone.enemies.values()) {
      entities.push({
        id: e.id,
        kind: "enemy",
        enemyType: e.enemyType,
        x: Math.trunc(e.x),
        y: Math.trunc(e.y),
        hp: Math.trunc(e.hp),
        maxHp: Math.trunc(e.maxHp ?? e.hp),
      });
    }
    for (const it of zone.groundItems.values()) {
      entities.push({
        id: it.id,
        kind: "item",
        itemType: it.itemType,
        x: Math.trunc(it.x),
        y: Math.trunc(it.y),
        ...(it.meta != null ? { meta: it.meta } : {}),
      });
    }
    return {
      mapId,
      zoneLabel: MAP_LABELS[mapId] || mapId,
      combatAllowed: zone.combatAllowed,
      map: { w: MAP_W, h: MAP_H, tiles: zone.tiles },
      entities,
    };
  }
}
