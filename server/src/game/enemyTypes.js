/**
 * Server-authoritative enemy definitions: stats, cooldowns, aggro, loot profile.
 * Loot kinds: `coin`, `bread`, or `gear` (weapon / armor / potion with rarity via `loot.js`).
 * @typedef {{ kind?: "coin"|"bread"|"gear", item?: string, w: number }} LootEntry
 * @typedef {{
 *   maxHp: number,
 *   damage: number,
 *   moveIntervalMs: number,
 *   attackCooldownMs: number,
 *   aggroRange: number,
 *   loot: LootEntry[],
 * }} EnemyDef
 */

/** @type {Record<string, EnemyDef>} */
export const ENEMY_DEFS = {
  slime: {
    maxHp: 16,
    damage: 2,
    moveIntervalMs: 720,
    attackCooldownMs: 780,
    aggroRange: 8,
    loot: [
      { kind: "coin", w: 42 },
      { kind: "bread", w: 28 },
      { kind: "gear", w: 30 },
    ],
  },
  skeleton: {
    maxHp: 42,
    damage: 7,
    moveIntervalMs: 400,
    attackCooldownMs: 480,
    aggroRange: 11,
    loot: [
      { kind: "coin", w: 22 },
      { kind: "bread", w: 18 },
      { kind: "gear", w: 55 },
    ],
  },
  zombie: {
    maxHp: 92,
    damage: 6,
    moveIntervalMs: 680,
    attackCooldownMs: 750,
    aggroRange: 9,
    loot: [
      { kind: "bread", w: 20 },
      { kind: "coin", w: 18 },
      { kind: "gear", w: 62 },
    ],
  },
  demon: {
    maxHp: 38,
    damage: 16,
    moveIntervalMs: 230,
    attackCooldownMs: 340,
    aggroRange: 14,
    loot: [
      { kind: "gear", w: 68 },
      { kind: "coin", w: 18 },
      { kind: "bread", w: 14 },
    ],
  },
};

/** @param {string} type */
export function getEnemyDef(type) {
  const d = ENEMY_DEFS[type];
  if (d) return d;
  return ENEMY_DEFS.skeleton;
}
