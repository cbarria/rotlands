/**
 * Procedural tile maps — numeric tile ids MUST stay in sync with `World.TILE`.
 */
import { makeProcEnemyTypesForZone } from "./enemyProc.js";

// Sync with server/src/game/World.js export TILE
const T = {
  GRASS: 0,
  WALL: 1,
  PORTAL: 2,
  TREE: 3,
  ROCK: 4,
  GRASS_PATCH: 5,
  LAVA: 6,
  WATER: 7,
  SAND: 8,
  SNOW: 9,
  STONE: 10,
};

const MAP_W = 24;
const MAP_H = 18;

function hash(n) {
  let h = n >>> 0;
  h ^= h << 13;
  h ^= h >>> 17;
  h ^= h << 5;
  return h >>> 0;
}

function emptyBase(floor) {
  const tiles = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(floor));
  for (let x = 0; x < MAP_W; x++) {
    tiles[0][x] = T.WALL;
    tiles[MAP_H - 1][x] = T.WALL;
  }
  for (let y = 0; y < MAP_H; y++) {
    tiles[y][0] = T.WALL;
    tiles[y][MAP_W - 1] = T.WALL;
  }
  return tiles;
}

function walkableForGen(t) {
  return (
    t === T.GRASS ||
    t === T.PORTAL ||
    t === T.GRASS_PATCH ||
    t === T.SAND ||
    t === T.SNOW ||
    t === T.STONE ||
    t === T.WATER
  );
}

function scatter(
  tiles,
  floor,
  floorRoll,
  /** @type {(x:number,y:number,h:number)=>number|null} */ obstacle,
  ban,
) {
  const key = (x, y) => `${x},${y}`;
  for (let y = 1; y < MAP_H - 1; y++) {
    for (let x = 1; x < MAP_W - 1; x++) {
      if (ban.has(key(x, y))) continue;
      const h = hash(x * 997 + y * 683 + floorRoll);
      if (tiles[y][x] !== floor) continue;
      const o = obstacle(x, y, h);
      if (o != null) tiles[y][x] = o;
    }
  }
}

/**
 * @param {{
 *   id: string,
 *   biome: string,
 *   seed: number,
 *   portalRed: { toMap: string, toX: number, toY: number },
 *   portalBlue?: { toMap: string, toX: number, toY: number } | null,
 *   combatAllowed?: boolean,
 * }} opts
 * @returns {Omit<MapZone, "enemies"|"groundItems"> & { tiles: number[][], portals: any[], spawnZones: any[] }}
 */
export function buildGeneratedZone(opts) {
  const { id, biome, seed, portalRed, portalBlue, combatAllowed = true } = opts;
  const ban = new Set();
  const addBan = (x, y, r = 1) => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        ban.add(`${x + dx},${y + dy}`);
      }
    }
  };

  let floor = T.GRASS;
  if (biome === "desert") floor = T.SAND;
  if (biome === "ice") floor = T.SNOW;
  if (biome === "dungeon") floor = T.STONE;
  if (biome === "lava") floor = T.STONE;
  if (biome === "water") floor = T.WATER;

  const tiles = emptyBase(floor);

  /** @type {any[]} */
  const portals = [];

  const rx = 2,
    ry = 2;
  tiles[ry][rx] = T.PORTAL;
  portals.push({ x: rx, y: ry, toMap: portalRed.toMap, toX: portalRed.toX, toY: portalRed.toY, kind: "red" });
  addBan(rx, ry, 2);

  let bx = 21,
    by = 9;
  if (portalBlue) {
    if (biome === "dungeon") {
      bx = 21;
      by = 15;
    }
    tiles[by][bx] = T.PORTAL;
    portals.push({
      x: bx,
      y: by,
      toMap: portalBlue.toMap,
      toX: portalBlue.toX,
      toY: portalBlue.toY,
      kind: "blue",
    });
    addBan(bx, by, 2);
  }

  const rnd = (x, y) => hash(seed + x * 4099 + y * 6571);

  if (biome === "water") {
    for (let y = 1; y < MAP_H - 1; y++) {
      for (let x = 1; x < MAP_W - 1; x++) {
        if (ban.has(`${x},${y}`)) continue;
        const isle = rnd(x, y) % 5 !== 0;
        tiles[y][x] = isle ? T.GRASS : T.WATER;
      }
    }
    for (let y = 1; y < MAP_H - 1; y++) {
      for (let x = 1; x < MAP_W - 1; x++) {
        if (tiles[y][x] !== T.GRASS) continue;
        if (ban.has(`${x},${y}`)) continue;
        if (rnd(x + 3, y + 2) % 7 === 0) tiles[y][x] = T.GRASS_PATCH;
      }
    }
  }

  if (biome === "lava") {
    scatter(
      tiles,
      T.STONE,
      seed,
      (x, y, h) => {
        if (h % 17 === 0) return T.LAVA;
        if (h % 31 === 0) return T.ROCK;
        return null;
      },
      ban,
    );
  } else if (biome === "mountains") {
    scatter(
      tiles,
      floor,
      seed,
      (x, y, h) => {
        if (h % 11 === 0) return T.ROCK;
        if (h % 19 === 0) return T.TREE;
        return null;
      },
      ban,
    );
  } else if (biome === "forest" || biome === "grassland") {
    scatter(
      tiles,
      T.GRASS,
      seed,
      (x, y, h) => {
        const dense = biome === "forest" ? 9 : 14;
        if (h % dense === 0) return T.TREE;
        if (h % 37 === 0) return T.ROCK;
        if (h % 23 === 0) return T.GRASS_PATCH;
        return null;
      },
      ban,
    );
  } else if (biome === "desert") {
    scatter(
      tiles,
      T.SAND,
      seed,
      (x, y, h) => {
        if (h % 13 === 0) return T.ROCK;
        if (h % 29 === 0) return T.GRASS_PATCH;
        return null;
      },
      ban,
    );
  } else if (biome === "ice") {
    scatter(
      tiles,
      T.SNOW,
      seed,
      (x, y, h) => {
        if (h % 15 === 0) return T.ROCK;
        if (h % 21 === 0) return T.TREE;
        return null;
      },
      ban,
    );
  } else if (biome === "dungeon") {
    for (let y = 4; y < MAP_H - 4; y++) {
      for (let x = 4; x < MAP_W - 4; x++) {
        if (ban.has(`${x},${y}`)) continue;
        const h = rnd(x, y);
        if (h % 9 === 0) {
          for (let dx = 0; dx < 2 && x + dx < MAP_W - 1; dx++) tiles[y][x + dx] = T.WALL;
        }
      }
    }
  }

  /** @type {Array<[number, number]>} */
  const spawnCells = [];
  for (let y = 1; y < MAP_H - 1; y++) {
    for (let x = 1; x < MAP_W - 1; x++) {
      if (ban.has(`${x},${y}`)) continue;
      if (walkableForGen(tiles[y][x])) spawnCells.push([x, y]);
    }
  }
  shuffle(spawnCells, seed);

  const tierList =
    biome === "dungeon" || biome === "lava"
      ? ["common", "common", "elite"]
      : biome === "mountains"
        ? ["common", "elite"]
        : ["common"];
  const types = [];
  for (const tier of tierList) {
    types.push(...makeProcEnemyTypesForZone(biome, tier, 2));
  }

  const spawnZones = [
    {
      id: `${id}_main`,
      enemyTypes: types.length ? types : ["slime"],
      maxEnemies: combatAllowed ? 5 : 0,
      cells: spawnCells.slice(0, 12),
    },
  ];

  return {
    id,
    combatAllowed,
    tiles,
    portals,
    spawnZones,
    biome,
  };
}

/** @param {Array<[number, number]>} arr @param {number} seed */
function shuffle(arr, seed) {
  let h = hash(seed + 99991);
  for (let i = arr.length - 1; i > 0; i--) {
    h = hash(h + i * 131);
    const j = h % (i + 1);
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
}
