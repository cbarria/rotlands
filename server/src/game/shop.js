import { MAX_SLOTS, POTION_HEAL, addItemToSlots } from "./inventory.js";
import { clearEquipmentReferencingSlot } from "./equipment.js";

export const SHOPKEEPER = {
  id: 900001,
  mapId: "town",
  x: 4,
  y: 8,
  name: "Trader",
  npcType: "shopkeeper",
};

/** Server-side gold granted per ground `coin` pickup (not inventory). */
export const GOLD_PER_COIN_PICKUP = 3;

export const POTION_BUY_PRICE = 15;
export const WEAPON_BUY_PRICE = 40;

/** @param {string} t */
function baseSellForType(t) {
  switch (t) {
    case "potion":
      return 5;
    case "weapon":
      return 12;
    case "armor_helmet":
      return 8;
    case "armor_chest":
      return 11;
    case "armor_boots":
      return 7;
    case "bread":
      return 2;
    case "coin":
      return 1;
    default:
      return 0;
  }
}

/**
 * @param {null | { type: string, qty?: number, meta?: any }} s
 * @returns {number}
 */
export function sellPriceForCell(s) {
  if (!s || s.qty < 1) return 0;
  const base = baseSellForType(s.type);
  if (base <= 0) return 0;
  const r = s.meta?.rarity;
  const mult = r === "epic" ? 4 : r === "rare" ? 2.2 : 1;
  return Math.max(1, Math.floor(base * mult));
}

/** @deprecated use sellPriceForCell */
export function sellPriceForItemType(itemType) {
  return baseSellForType(itemType);
}

/**
 * @param {{ gold: number, slots: any[], weaponBonus: number }} p
 * @returns {boolean}
 */
export function tryBuyPotion(p) {
  if (p.gold < POTION_BUY_PRICE) return false;
  const meta = { rarity: "common", heal: POTION_HEAL, dmg: 0, def: 0, hp: 0 };
  if (!addItemToSlots(p.slots, "potion", meta)) return false;
  p.gold -= POTION_BUY_PRICE;
  return true;
}

/**
 * @param {{ gold: number, slots: any[], weaponBonus: number }} p
 * @returns {boolean}
 */
export function tryBuyWeapon(p) {
  if (p.gold < WEAPON_BUY_PRICE) return false;
  const meta = { rarity: "common", dmg: 6, def: 0, hp: 1 };
  if (!addItemToSlots(p.slots, "weapon", meta)) return false;
  p.gold -= WEAPON_BUY_PRICE;
  return true;
}

/**
 * @param {{ gold: number, slots: any[], weaponBonus: number, equipment: import("./equipment.js").EquipmentSlots }} p
 * @param {number} slotIndex
 * @returns {boolean}
 */
export function trySellSlot(p, slotIndex) {
  if (slotIndex < 0 || slotIndex >= MAX_SLOTS) return false;
  const s = p.slots[slotIndex];
  if (!s || s.qty < 1) return false;
  const unit = sellPriceForCell(s);
  if (unit <= 0) return false;
  clearEquipmentReferencingSlot(p, slotIndex);
  p.gold += unit;
  s.qty -= 1;
  if (s.qty <= 0) p.slots[slotIndex] = null;
  return true;
}

/**
 * @param {{ mapId: string, x: number, y: number }} p
 * @returns {boolean}
 */
export function isAdjacentToShopkeeper(p) {
  if (p.mapId !== SHOPKEEPER.mapId) return false;
  return Math.abs(p.x - SHOPKEEPER.x) + Math.abs(p.y - SHOPKEEPER.y) === 1;
}
