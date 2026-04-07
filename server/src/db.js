import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { MAX_SLOTS } from "./game/inventory.js";
import { EMPTY_EQUIPMENT, normalizeEquipment } from "./game/equipment.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  return new pg.Pool({ connectionString, max: 10 });
}

export async function initDb(pool) {
  const schemaPath = path.join(__dirname, "..", "schema.sql");
  const seedPath = path.join(__dirname, "..", "seed.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  await pool.query(schema);
  if (fs.existsSync(seedPath)) {
    const seed = fs.readFileSync(seedPath, "utf8").trim();
    if (seed) await pool.query(seed);
  }
}

/** @returns {{ slots: (null | { type: string, qty: number, meta?: any })[], weaponBonus: number, gold: number, equipment: import("./game/equipment.js").EquipmentSlots }} */
export async function loadCharacterInventory(pool, characterId) {
  const ch = await pool.query(
    `SELECT weapon_bonus, gold, equipment FROM characters WHERE id = $1`,
    [characterId],
  );
  const weaponBonus = ch.rows[0]?.weapon_bonus ?? 0;
  const gold = ch.rows[0]?.gold ?? 0;
  const equipment = normalizeEquipment(ch.rows[0]?.equipment);

  const { rows } = await pool.query(
    `SELECT slot, item_type, quantity, item_meta FROM inventory_slots WHERE character_id = $1 ORDER BY slot ASC`,
    [characterId],
  );

  /** @type {(null | { type: string, qty: number, meta?: any })[]} */
  const slots = Array(MAX_SLOTS).fill(null);
  for (const r of rows) {
    if (r.slot >= 0 && r.slot < MAX_SLOTS) {
      const cell = { type: r.item_type, qty: r.quantity };
      if (r.item_meta != null) cell.meta = r.item_meta;
      slots[r.slot] = cell;
    }
  }
  return { slots, weaponBonus, gold, equipment };
}

export async function replaceInventorySlots(pool, characterId, slots) {
  await pool.query(`DELETE FROM inventory_slots WHERE character_id = $1`, [characterId]);
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (!s || s.qty <= 0) continue;
    await pool.query(
      `INSERT INTO inventory_slots (character_id, slot, item_type, quantity, item_meta) VALUES ($1, $2, $3, $4, $5)`,
      [characterId, i, s.type, s.qty, s.meta ?? null],
    );
  }
}

export async function saveCharacter(
  pool,
  { id, x, y, hp, current_map, weapon_bonus, gold, equipment },
) {
  await pool.query(
    `UPDATE characters SET x = $2, y = $3, hp = $4, current_map = COALESCE($5, current_map),
     weapon_bonus = COALESCE($6, weapon_bonus), gold = COALESCE($7, gold),
     equipment = COALESCE($8::jsonb, equipment),
     updated_at = NOW() WHERE id = $1`,
    [
      id,
      x,
      y,
      hp,
      current_map ?? null,
      weapon_bonus ?? null,
      gold ?? null,
      equipment != null ? JSON.stringify(equipment) : null,
    ],
  );
}

export async function findOrCreateCharacter(pool, name) {
  const found = await pool.query(
    `SELECT id, name, x, y, hp, current_map, weapon_bonus, gold, equipment FROM characters WHERE name = $1`,
    [name],
  );
  if (found.rows.length) return found.rows[0];
  const ins = await pool.query(
    `INSERT INTO characters (name, x, y, hp, current_map, weapon_bonus, gold, equipment) VALUES ($1, $2, $3, $4, $5, 0, 50, $6::jsonb)
     RETURNING id, name, x, y, hp, current_map, weapon_bonus, gold, equipment`,
    [name, 3, 3, 100, "town", JSON.stringify(EMPTY_EQUIPMENT)],
  );
  return ins.rows[0];
}
