/**
 * Procedural gear display names (extends loot — stats unchanged).
 * @typedef {"common"|"rare"|"epic"} Rarity
 */

const PREFIX = {
  common: ["Worn", "Plain", "Sturdy", "Simple", "Traveler's"],
  rare: ["Fine", "Tempered", "Runed", "Veteran's", "Moonlit"],
  epic: ["Ancient", "Sovereign", "Doomforged", "Celestial", "Worldbreaker"],
};

const MATERIAL = {
  weapon: ["Iron", "Steel", "Silver", "Obsidian", "Ashwood"],
  armor_helmet: ["Leather", "Chain", "Iron", "Scale", "Spiritbone"],
  armor_chest: ["Hide", "Brigandine", "Plate", "Silksteel", "Runic Mail"],
  armor_boots: ["Wool", "Leather", "Ironclad", "Windtread", "Frostwalk"],
  potion: ["Herbal", "Crystal", "Star", "Blood", "Mist"],
};

const SUFFIX = {
  weapon: ["Blade", "Sword", "Edge", "Cleaver", "Fang"],
  armor_helmet: ["Crown", "Cap", "Helm", "Hood", "Visor"],
  armor_chest: ["Vest", "Guard", "Shell", "Robes", "Aegis"],
  armor_boots: ["Striders", "Treads", "Greaves", "Boots", "Sandals"],
  potion: ["Draught", "Elixir", "Tonic", "Brew", "Serum"],
};

/**
 * @param {string} s
 * @returns {number}
 */
export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * @param {number} h
 * @param {string[]} arr
 */
function pick(h, arr) {
  return arr[h % arr.length];
}

/**
 * @param {Rarity} rarity
 * @param {"weapon"|"armor_helmet"|"armor_chest"|"armor_boots"|"potion"} cat
 * @param {number} [salt]
 */
export function rollDisplayName(rarity, cat, salt = 0) {
  const h = hashString(`${rarity}:${cat}:${salt}`);
  const pre = pick(h, PREFIX[rarity] || PREFIX.common);
  const mat = pick(h >>> 3, MATERIAL[cat] || MATERIAL.weapon);
  const suf = pick(h >>> 7, SUFFIX[cat] || SUFFIX.weapon);
  if (cat === "potion") return `${pre} ${mat} ${suf}`;
  return `${pre} ${mat} ${suf.replace(/^\s/, "")}`;
}

/**
 * Icon hue 0–359 for client color tint (from stats snapshot).
 * @param {Rarity} rarity
 * @param {"weapon"|"armor_helmet"|"armor_chest"|"armor_boots"|"potion"} cat
 * @param {{ dmg?: number, def?: number, hp?: number }} stats
 */
export function iconHueFromMeta(rarity, cat, stats) {
  const d = stats?.dmg ?? 0;
  const f = stats?.def ?? 0;
  const hp = stats?.hp ?? 0;
  const base =
    cat === "weapon" ? 12 : cat === "armor_helmet" ? 200 : cat === "armor_chest" ? 280 : cat === "armor_boots" ? 140 : 120;
  const bump = (d + f * 2 + hp + (rarity === "epic" ? 60 : rarity === "rare" ? 30 : 0)) % 80;
  return (base + bump) % 360;
}
