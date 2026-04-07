/**
 * Procedural enemy definitions: id format `pe:<biome>:<tier>:<n>`
 * Tier: common | elite | boss
 */
import { hashString } from "./itemNames.js";

/** @typedef {import("../enemyTypes.js").EnemyDef} EnemyDef */

/** @param {string} type */
export function isProceduralEnemyType(type) {
  return typeof type === "string" && type.startsWith("pe:") && type.split(":").length === 4;
}

/**
 * @param {string} type pe:forest:elite:2
 * @returns {{ biome: string, tier: string, slot: number } | null}
 */
export function parseProcEnemyId(type) {
  const parts = String(type).split(":");
  if (parts.length !== 4 || parts[0] !== "pe") return null;
  const biome = parts[1] || "grassland";
  const tier = parts[2] || "common";
  const slot = Number(parts[3]);
  return { biome, tier, slot: Number.isInteger(slot) ? slot : 0 };
}

const BIOME_WEIGHT_BEHAVIOR = {
  grassland: { chaser: 0.55, flanking: 0.25, brute: 0.2 },
  forest: { chaser: 0.35, flanking: 0.45, brute: 0.2 },
  desert: { chaser: 0.4, flanking: 0.2, brute: 0.4 },
  lava: { chaser: 0.25, flanking: 0.25, brute: 0.5 },
  ice: { chaser: 0.5, flanking: 0.35, brute: 0.15 },
  water: { chaser: 0.6, flanking: 0.3, brute: 0.1 },
  mountains: { chaser: 0.3, flanking: 0.2, brute: 0.5 },
  dungeon: { chaser: 0.45, flanking: 0.35, brute: 0.2 },
};

/**
 * @param {string} biome
 * @param {number} h
 * @returns {"chaser"|"flanking"|"brute"}
 */
function rollBehavior(biome, h) {
  const w = BIOME_WEIGHT_BEHAVIOR[biome] || BIOME_WEIGHT_BEHAVIOR.grassland;
  const r = (h % 1000) / 1000;
  let t = r;
  if (t < w.chaser) return "chaser";
  t -= w.chaser;
  if (t < w.flanking) return "flanking";
  return "brute";
}

/** @param {string} tier */
function tierMult(tier) {
  if (tier === "boss") return { hp: 3.1, dmg: 2.0, speed: 1.15 };
  if (tier === "elite") return { hp: 1.7, dmg: 1.4, speed: 1.08 };
  return { hp: 1, dmg: 1, speed: 1 };
}

/** @param {string} biome @param {string} tier @param {number} slot */
function baseStats(biome, tier, slot) {
  const h = hashString(`pestats:${biome}:${tier}:${slot}`);
  const tm = tierMult(tier);
  let maxHp = 14 + (h % 18);
  let damage = 2 + ((h >>> 5) % 10);
  let moveIntervalMs = 520 + ((h >>> 9) % 380);
  const armorBias = ["grassland", "forest", "water"].includes(biome) ? 0 : biome === "lava" || biome === "mountains" ? 1 : 0;
  maxHp += armorBias * 6;
  damage += armorBias * 2;
  if (biome === "ice") moveIntervalMs += 80;

  maxHp = Math.max(8, Math.round(maxHp * tm.hp));
  damage = Math.max(1, Math.round(damage * tm.dmg));
  moveIntervalMs = Math.max(180, Math.round(moveIntervalMs / tm.speed));

  const attackCooldownMs = Math.min(900, Math.max(280, Math.round(moveIntervalMs * 0.95)));
  const aggroRange = 6 + ((h >>> 13) % (tier === "boss" ? 8 : tier === "elite" ? 5 : 4));

  return { maxHp, damage, moveIntervalMs, attackCooldownMs, aggroRange };
}

/**
 * @param {string} type full pe:... id
 * @returns {EnemyDef}
 */
export function buildProceduralEnemyDef(type) {
  const parsed = parseProcEnemyId(type);
  if (!parsed) {
    return {
      maxHp: 20,
      damage: 3,
      moveIntervalMs: 600,
      attackCooldownMs: 700,
      aggroRange: 8,
      loot: [
        { kind: "coin", w: 40 },
        { kind: "bread", w: 25 },
        { kind: "gear", w: 35 },
      ],
    };
  }
  const { biome, tier, slot } = parsed;
  const h = hashString(type);
  const st = baseStats(biome, tier, slot);
  const behavior = rollBehavior(biome, h);
  /** Loot weight shift by tier */
  const gearW = tier === "boss" ? 72 : tier === "elite" ? 58 : 42;

  return {
    maxHp: st.maxHp,
    damage: st.damage,
    moveIntervalMs: st.moveIntervalMs,
    attackCooldownMs: st.attackCooldownMs,
    aggroRange: st.aggroRange,
    loot: [
      { kind: "gear", w: gearW },
      { kind: "coin", w: Math.round((100 - gearW) * 0.45) },
      { kind: "bread", w: Math.round((100 - gearW) * 0.35) },
    ],
    /** @type {any} */
    proc: { biome, tier, behavior, paletteId: h % 6, procName: makeProcName(biome, tier, behavior, h) },
  };
}

/**
 * @param {string} biome
 * @param {string} tier
 * @param {number} count
 */
export function makeProcEnemyTypesForZone(biome, tier, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(`pe:${biome}:${tier}:${i}`);
  }
  return out;
}

/** @param {string} biome @param {string} tier */
function makeProcName(biome, tier, behavior, h) {
  const adj = pickAdj(tier, h);
  const noun = biomeNoun(biome, behavior);
  return `${adj} ${noun}`;
}

function pickAdj(tier, h) {
  const C = ["Gnarl", "Cinder", "Frost", "Murk", "Shard", "Ash", "Bog", "Dusk"];
  const E = ["Grim", "High", "Elder", "Razor", "Deep", "Corrupted", "Iron", "Savage"];
  const B = ["World", "Crown", "Ancient", "Titan", "Hollow", "Eclipse", "Storm", "Dread"];
  const arr = tier === "boss" ? B : tier === "elite" ? E : C;
  return arr[h % arr.length];
}

/**
 * @param {string} biome
 * @param {"chaser"|"flanking"|"brute"} behavior
 */
function biomeNoun(biome, behavior) {
  const m = {
    grassland: { chaser: "Wolf", flanking: "Stalker", brute: "Bison" },
    forest: { chaser: "Dryad", flanking: "Sprite", brute: "Treant" },
    desert: { chaser: "Cobra", flanking: "Jackal", brute: "Golem" },
    lava: { chaser: "Salamander", flanking: "Cinderling", brute: "Magma Hulk" },
    ice: { chaser: "Wraith", flanking: "Frost Bat", brute: "Yeti" },
    water: { chaser: "Piranha Swarm", flanking: "Kelpie", brute: "Crusher Crab" },
    mountains: { chaser: "Harpy", flanking: "Roc", brute: "Troll" },
    dungeon: { chaser: "Shade", flanking: "Skulk", brute: "Juggernaut" },
  };
  const row = m[biome] || m.grassland;
  return row[behavior] || "Wanderer";
}

const _procDefCache = new Map();

/** @param {string} type */
export function getProceduralEnemyDef(type) {
  if (!_procDefCache.has(type)) _procDefCache.set(type, buildProceduralEnemyDef(type));
  return /** @type {EnemyDef} */ (_procDefCache.get(type));
}
