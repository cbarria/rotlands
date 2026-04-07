import { MAX_HP, MAX_SLOTS, POTION_HEAL, WEAPON_DAMAGE_BONUS } from "./inventory.js";

/**
 * @typedef {{
 *   weapon: null | number,
 *   helmet: null | number,
 *   chest: null | number,
 *   boots: null | number,
 * }} EquipmentSlots
 */

export const EMPTY_EQUIPMENT = Object.freeze({
  weapon: null,
  helmet: null,
  chest: null,
  boots: null,
});

/**
 * Inventory indices in equipment JSON sometimes arrive as strings from DB/clients.
 * @param {any} v
 * @returns {null | number}
 */
export function normalizeEquipSlotRef(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isInteger(v)) {
    return v >= 0 && v < MAX_SLOTS ? v : null;
  }
  if (typeof v === "string") {
    const n = Number(v.trim());
    if (Number.isInteger(n) && n >= 0 && n < MAX_SLOTS) return n;
  }
  return null;
}

/** @param {any} raw */
export function normalizeEquipment(raw) {
  const e = raw && typeof raw === "object" ? raw : {};
  return {
    weapon: normalizeEquipSlotRef(e.weapon),
    helmet: normalizeEquipSlotRef(e.helmet),
    chest: normalizeEquipSlotRef(e.chest),
    boots: normalizeEquipSlotRef(e.boots),
  };
}

/**
 * Clear equipment keys that point at `slotIndex`.
 * @param {{ equipment: EquipmentSlots }} p
 * @param {number} slotIndex
 */
export function clearEquipmentReferencingSlot(p, slotIndex) {
  const eq = p.equipment;
  for (const k of /** @type {(keyof EquipmentSlots)[]} */ (["weapon", "helmet", "chest", "boots"])) {
    if (normalizeEquipSlotRef(eq[k]) === slotIndex) eq[k] = null;
  }
}

/**
 * @param {{ equipment: EquipmentSlots }} p
 * @param {number} slotIndex
 */
export function isInventorySlotEquipped(p, slotIndex) {
  const eq = p.equipment;
  if (!eq || !Number.isInteger(slotIndex)) return false;
  for (const k of /** @type {(keyof EquipmentSlots)[]} */ (["weapon", "helmet", "chest", "boots"])) {
    if (normalizeEquipSlotRef(eq[k]) === slotIndex) return true;
  }
  return false;
}

/**
 * @param {{ slots: any[], equipment: EquipmentSlots, hp: number, weaponBonus?: number, armorDefense?: number, gearMaxHpBonus?: number }} p
 */
export function recalculateCombatStats(p) {
  const eq = p.equipment;
  let dmg = 0;
  let def = 0;
  let hpB = 0;

  const wIdx = normalizeEquipSlotRef(eq.weapon);
  eq.weapon = wIdx;
  if (wIdx != null) {
    const c = p.slots[wIdx];
    if (c?.type === "weapon" && c.qty > 0) {
      const m = c.meta && typeof c.meta === "object" ? c.meta : {};
      const md = Number(m.dmg);
      dmg += Number.isFinite(md) ? md : WEAPON_DAMAGE_BONUS;
      def += Number(m.def) || 0;
      hpB += Number(m.hp) || 0;
    } else {
      eq.weapon = null;
    }
  }

  const addArmor = (/** @type {"helmet"|"chest"|"boots"} */ key, /** @type {string} */ typ) => {
    const idx = normalizeEquipSlotRef(eq[key]);
    eq[key] = idx;
    if (idx == null) return;
    const c = p.slots[idx];
    if (c?.type !== typ || c.qty < 1) {
      eq[key] = null;
      return;
    }
    const m = c.meta && typeof c.meta === "object" ? c.meta : {};
    dmg += Number(m.dmg) || 0;
    def += Number(m.def) || 0;
    hpB += Number(m.hp) || 0;
  };

  addArmor("helmet", "armor_helmet");
  addArmor("chest", "armor_chest");
  addArmor("boots", "armor_boots");

  p.weaponBonus = dmg;
  p.armorDefense = def;
  p.gearMaxHpBonus = hpB;
  const cap = MAX_HP + hpB;
  if (p.hp > cap) p.hp = cap;
}

/**
 * Use / equip from inventory slot (potions consume; gear toggles equip).
 * @param {{ slots: any[], hp: number, equipment: EquipmentSlots, weaponBonus?: number, armorDefense?: number, gearMaxHpBonus?: number }} p
 * @param {number} slotIndex
 * @returns {boolean}
 */
export function tryInteractInventorySlot(p, slotIndex) {
  const cell = p.slots[slotIndex];
  if (!cell || cell.qty < 1) return false;
  const t = cell.type;

  if (t === "potion") {
    const cap = MAX_HP + (p.gearMaxHpBonus | 0);
    const heal = cell.meta?.heal != null ? Number(cell.meta.heal) : POTION_HEAL;
    if (p.hp >= cap) return false;
    cell.qty -= 1;
    if (cell.qty <= 0) p.slots[slotIndex] = null;
    p.hp = Math.min(cap, p.hp + heal);
    return true;
  }

  if (t === "weapon") {
    const cur = normalizeEquipSlotRef(p.equipment.weapon);
    if (cur === slotIndex) p.equipment.weapon = null;
    else p.equipment.weapon = slotIndex;
    recalculateCombatStats(p);
    return true;
  }

  if (t === "armor_helmet") {
    const cur = normalizeEquipSlotRef(p.equipment.helmet);
    if (cur === slotIndex) p.equipment.helmet = null;
    else p.equipment.helmet = slotIndex;
    recalculateCombatStats(p);
    return true;
  }
  if (t === "armor_chest") {
    const cur = normalizeEquipSlotRef(p.equipment.chest);
    if (cur === slotIndex) p.equipment.chest = null;
    else p.equipment.chest = slotIndex;
    recalculateCombatStats(p);
    return true;
  }
  if (t === "armor_boots") {
    const cur = normalizeEquipSlotRef(p.equipment.boots);
    if (cur === slotIndex) p.equipment.boots = null;
    else p.equipment.boots = slotIndex;
    recalculateCombatStats(p);
    return true;
  }

  return false;
}

/** Expected inventory `type` for each equipment slot key. */
export const EQUIP_KIND_TO_ITEM_TYPE = {
  weapon: "weapon",
  helmet: "armor_helmet",
  chest: "armor_chest",
  boots: "armor_boots",
};

/** @param {keyof EquipmentSlots} kind */
export function tryUnequipSlot(p, kind) {
  if (kind !== "weapon" && kind !== "helmet" && kind !== "chest" && kind !== "boots") return false;
  if (p.equipment[kind] == null) return false;
  p.equipment[kind] = null;
  recalculateCombatStats(p);
  return true;
}

/**
 * Equip inventory slot into a specific gear slot (replaces previous).
 * @param {{ slots: any[], equipment: EquipmentSlots, hp: number, weaponBonus?: number, armorDefense?: number, gearMaxHpBonus?: number }} p
 * @param {number} invSlot
 * @param {keyof EquipmentSlots} kind
 */
export function tryEquipInventoryToSlot(p, invSlot, kind) {
  if (invSlot < 0 || invSlot >= p.slots.length) return false;
  const cell = p.slots[invSlot];
  if (!cell || cell.qty < 1) return false;
  const expect = EQUIP_KIND_TO_ITEM_TYPE[kind];
  if (!expect || cell.type !== expect) return false;
  p.equipment[kind] = invSlot;
  recalculateCombatStats(p);
  return true;
}
