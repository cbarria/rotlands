import { getEnemyDef } from "./enemyTypes.js";
import { POTION_HEAL } from "./inventory.js";
import { iconHueFromMeta, rollDisplayName } from "./procedural/itemNames.js";

/** @typedef {"common"|"rare"|"epic"} Rarity */
/** @typedef {"coin"|"bread"|"gear"} LootKind */

/**
 * @typedef {{
 *   rarity: Rarity,
 *   dmg?: number,
 *   def?: number,
 *   hp?: number,
 *   heal?: number,
 * }} ItemMeta
 */

const R_COMMON = "common";
const R_RARE = "rare";
const R_EPIC = "epic";

/** Rarity roll weights [common, rare, epic] by enemy type (total need not be 100). */
const RARITY_BY_ENEMY = {
  slime: [72, 22, 6],
  skeleton: [55, 32, 13],
  zombie: [48, 34, 18],
  demon: [34, 38, 28],
};

/**
 * @param {string} enemyType
 * @returns {Rarity}
 */
export function rollRarityForEnemy(enemyType) {
  if (typeof enemyType === "string" && enemyType.startsWith("pe:")) {
    const tier = enemyType.split(":")[2] || "common";
    if (tier === "boss") {
      const r = Math.random() * 100;
      if (r < 48) return R_EPIC;
      if (r < 88) return R_RARE;
      return R_COMMON;
    }
    if (tier === "elite") {
      const w = [38, 42, 20];
      const total = w[0] + w[1] + w[2];
      let r = Math.random() * total;
      if (r < w[0]) return R_COMMON;
      r -= w[0];
      if (r < w[1]) return R_RARE;
      return R_EPIC;
    }
    return R_COMMON;
  }
  const w = RARITY_BY_ENEMY[enemyType] || [58, 30, 12];
  const total = w[0] + w[1] + w[2];
  let r = Math.random() * total;
  if (r < w[0]) return R_COMMON;
  r -= w[0];
  if (r < w[1]) return R_RARE;
  return R_EPIC;
}

/** Stat budget (total points split across stats) by rarity. */
function statBudget(rarity) {
  switch (rarity) {
    case R_EPIC:
      return 12 + ((Math.random() * 5) | 0);
    case R_RARE:
      return 6 + ((Math.random() * 5) | 0);
    default:
      return 2 + ((Math.random() * 4) | 0);
  }
}

function allocWeaponStats(budgetPts, rarity) {
  const dmg = Math.max(1, Math.round(budgetPts * (0.55 + Math.random() * 0.2)));
  let rest = budgetPts - dmg;
  const def = Math.max(0, Math.min(rest, Math.round(rest * (0.25 + Math.random() * 0.2))));
  rest -= def;
  const hp = Math.max(0, rest);
  if (rarity === R_EPIC && dmg < 6) return { dmg: dmg + 2, def, hp: Math.max(0, hp - 2) };
  return { dmg, def, hp };
}

function allocArmorStats(slot, budgetPts, rarity) {
  const defW = slot === "chest" ? 0.55 : slot === "helmet" ? 0.4 : 0.35;
  const def = Math.max(1, Math.round(budgetPts * (defW + Math.random() * 0.15)));
  let rest = budgetPts - def;
  const hp = Math.max(0, Math.round(rest * (0.65 + Math.random() * 0.25)));
  const dmg = Math.max(0, rest - hp);
  if (rarity === R_EPIC && def < 4) return { def: def + 2, hp, dmg: Math.max(0, dmg - 2) };
  return { dmg, def, hp };
}

/** @param {Rarity} rarity */
function potionHealAmount(rarity) {
  switch (rarity) {
    case R_EPIC:
      return POTION_HEAL + 35 + ((Math.random() * 16) | 0);
    case R_RARE:
      return POTION_HEAL + 15 + ((Math.random() * 11) | 0);
    default:
      return POTION_HEAL + ((Math.random() * 8) | 0);
  }
}

/**
 * Gear category weights by enemy — ids: weapon, helmet, chest, boots, potion (rolled as consumable drop).
 * @param {string} enemyType
 * @returns {"weapon"|"armor_helmet"|"armor_chest"|"armor_boots"|"potion"}
 */
function rollGearCategory(enemyType) {
  if (typeof enemyType === "string" && enemyType.startsWith("pe:")) {
    const biome = enemyType.split(":")[1] || "grassland";
    /** @type {Record<string, [number, number, number, number, number]>} */
    const b = {
      grassland: [18, 22, 22, 28, 10],
      forest: [12, 20, 22, 36, 10],
      desert: [26, 18, 26, 20, 10],
      lava: [34, 14, 20, 22, 10],
      ice: [16, 24, 30, 20, 10],
      water: [14, 18, 24, 34, 10],
      mountains: [32, 20, 22, 16, 10],
      dungeon: [30, 22, 22, 16, 10],
    };
    const w = b[biome] || [28, 22, 22, 18, 10];
    const tot = w[0] + w[1] + w[2] + w[3] + w[4];
    let r = Math.random() * tot;
    const cats = /** @type {const} */ (["weapon", "armor_helmet", "armor_chest", "armor_boots", "potion"]);
    for (let i = 0; i < 5; i++) {
      r -= w[i];
      if (r <= 0) return cats[i];
    }
    return "weapon";
  }
  /** @type {Record<string, [number, number, number, number, number]>} weights weapon,helmet,chest,boots,potion */
  const t = {
    slime: [15, 25, 20, 30, 10],
    skeleton: [30, 22, 22, 16, 10],
    zombie: [18, 18, 28, 26, 10],
    demon: [40, 14, 18, 18, 10],
  };
  const w = t[enemyType] || [28, 22, 22, 18, 10];
  const tot = w[0] + w[1] + w[2] + w[3] + w[4];
  let r = Math.random() * tot;
  const cats = /** @type {const} */ (["weapon", "armor_helmet", "armor_chest", "armor_boots", "potion"]);
  for (let i = 0; i < 5; i++) {
    r -= w[i];
    if (r <= 0) return cats[i];
  }
  return "weapon";
}

/**
 * @param {Rarity} rarity
 * @param {"weapon"|"armor_helmet"|"armor_chest"|"armor_boots"|"potion"} cat
 * @returns {{ itemType: string, meta: ItemMeta }}
 */
function makeRolledGear(rarity, cat) {
  const nameSalt = (Math.random() * 1e9) | 0;
  if (cat === "potion") {
    const heal = potionHealAmount(rarity);
    const extra = statBudget(rarity);
    const meta = {
      rarity,
      heal,
      dmg: 0,
      def: 0,
      hp: Math.max(0, Math.min(8, (extra / 3) | 0)),
      displayName: rollDisplayName(rarity, "potion", nameSalt),
      iconHue: iconHueFromMeta(rarity, "potion", { dmg: 0, def: 0, hp: heal }),
    };
    return {
      itemType: "potion",
      meta,
    };
  }
  const b = statBudget(rarity);
  if (cat === "weapon") {
    const s = allocWeaponStats(b, rarity);
    const meta = {
      rarity,
      ...s,
      displayName: rollDisplayName(rarity, "weapon", nameSalt),
      iconHue: iconHueFromMeta(rarity, "weapon", s),
    };
    return { itemType: "weapon", meta };
  }
  const slot = cat === "armor_helmet" ? "helmet" : cat === "armor_chest" ? "chest" : "boots";
  const s = allocArmorStats(slot, b, rarity);
  const meta = {
    rarity,
    ...s,
    displayName: rollDisplayName(rarity, cat, nameSalt),
    iconHue: iconHueFromMeta(rarity, cat, s),
  };
  return { itemType: cat, meta };
}

/**
 * Weighted roll: coin / bread / gear bundle (typed+rarity item).
 * Uses `enemyTypes` loot table `kind` + `w`.
 *
 * @param {string} enemyType
 * @returns {{ itemType: string, meta?: ItemMeta }}
 */
export function rollLootDropFromEnemy(enemyType) {
  const def = getEnemyDef(enemyType);
  /** @type {{ kind: LootKind, w: number }[]} */
  const table = [];
  for (const row of def.loot) {
    /** @type {LootKind | undefined} */
    let k = row.kind;
    if (!k && row.item) {
      if (row.item === "weapon" || row.item === "potion") k = "gear";
      else if (row.item === "coin" || row.item === "bread") k = /** @type {LootKind} */ (row.item);
    }
    if (!k) k = "gear";
    const weight = row.w;
    if (k === "coin" || k === "bread" || k === "gear") table.push({ kind: k, w: weight });
  }
  if (!table.length) table.push({ kind: "gear", w: 40 }, { kind: "coin", w: 30 }, { kind: "bread", w: 30 });

  const tot = table.reduce((s, x) => s + x.w, 0);
  let r = Math.random() * tot;
  /** @type {LootKind} */
  let pick = "gear";
  for (const row of table) {
    r -= row.w;
    if (r <= 0) {
      pick = row.kind;
      break;
    }
  }

  if (pick === "coin") return { itemType: "coin" };
  if (pick === "bread") return { itemType: "bread" };

  const rarity = rollRarityForEnemy(enemyType);
  const cat = rollGearCategory(enemyType);
  const g = makeRolledGear(rarity, cat);
  return { itemType: g.itemType, meta: g.meta };
}
