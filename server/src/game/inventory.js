export const MAX_SLOTS = 10;
export const MAX_HP = 100;
export const POTION_HEAL = 25;
/** Fallback melee bonus when an old `weapon` has no meta */
export const WEAPON_DAMAGE_BONUS = 5;
export const BASE_MELEE_DAMAGE = 10;

/**
 * @param {any} a
 * @param {any} b
 */
function metaEquals(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * @param {(null | { type: string, qty: number, meta?: any })[]} slots
 * @param {string} itemType
 * @param {any} [meta]
 * @returns {boolean}
 */
export function addItemToSlots(slots, itemType, meta = undefined) {
  const stackable =
    itemType === "potion" || itemType === "coin" || itemType === "bread";
  if (stackable) {
    for (let i = 0; i < MAX_SLOTS; i++) {
      const c = slots[i];
      if (c && c.type === itemType && metaEquals(c.meta, meta)) {
        c.qty += 1;
        return true;
      }
    }
  }
  for (let i = 0; i < MAX_SLOTS; i++) {
    if (slots[i] === null) {
      if (meta !== undefined) slots[i] = { type: itemType, qty: 1, meta };
      else slots[i] = { type: itemType, qty: 1 };
      return true;
    }
  }
  return false;
}

/** @deprecated use tryInteractInventorySlot — kept for tests */
export function tryUsePotion(p, slotIndex) {
  if (slotIndex < 0 || slotIndex >= MAX_SLOTS) return false;
  const s = p.slots[slotIndex];
  if (!s || s.type !== "potion" || s.qty < 1) return false;
  const heal = s.meta?.heal != null ? Number(s.meta.heal) : POTION_HEAL;
  const cap = MAX_HP + (p.gearMaxHpBonus | 0);
  if (p.hp >= cap) return false;
  p.hp = Math.min(cap, p.hp + heal);
  s.qty -= 1;
  if (s.qty <= 0) p.slots[slotIndex] = null;
  return true;
}

/** @deprecated use tryInteractInventorySlot */
export function tryEquipWeapon(_p, _slotIndex) {
  return false;
}
