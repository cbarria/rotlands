import http from "http";
import fs from "fs";
import path from "path";
import express from "express";
import { Server } from "socket.io";
import { createClient } from "redis";
import {
  createPool,
  initDb,
  findOrCreateCharacter,
  loadCharacterInventory,
  saveCharacter,
  replaceInventorySlots,
} from "./db.js";
import { addItemToSlots } from "./game/inventory.js";
import {
  recalculateCombatStats,
  tryEquipInventoryToSlot,
  tryInteractInventorySlot,
  tryUnequipSlot,
} from "./game/equipment.js";
import {
  GOLD_PER_COIN_PICKUP,
  isAdjacentToShopkeeper,
  tryBuyPotion,
  tryBuyWeapon,
  trySellSlot,
} from "./game/shop.js";
import { World } from "./game/World.js";
import { partyInvite, partyAccept, partyLeave, onPlayerDisconnect } from "./game/party.js";

const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const MOVE_DELAY_MS = 140;
const ATTACK_COOLDOWN_MS = 450;
const TICK_MS = 100;

const app = express();
app.set("trust proxy", 1);
app.disable("etag");

const publicDir = path.join(process.cwd(), "public");
/** Written at Docker image build time; helps verify you are running a fresh image */
let publicBuildStamp = "unknown";
try {
  const p = path.join(publicDir, "build.txt");
  if (fs.existsSync(p)) publicBuildStamp = fs.readFileSync(p, "utf8").trim();
} catch {
  /* ignore */
}

if (fs.existsSync(publicDir)) {
  app.use(
    express.static(publicDir, {
      etag: false,
      lastModified: false,
      setHeaders(res, filePath) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      },
    }),
  );
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, env: NODE_ENV, build: publicBuildStamp });
});

app.get("/ready", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    if (redisClient) await redisClient.ping();
    res.json({ ready: true });
  } catch (e) {
    res.status(503).json({ ready: false, error: String(e?.message || e) });
  }
});

const pool = createPool();
let redisClient = null;

async function connectRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  const client = createClient({ url });
  client.on("error", (e) => console.error("redis_error", e));
  await client.connect();
  return client;
}

await initDb(pool);
redisClient = await connectRedis().catch((e) => {
  console.warn("Redis optional:", e?.message || e);
  return null;
});

const world = new World();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true },
});

function broadcastMap(mapId) {
  io.to(`map:${mapId}`).emit("state", world.snapshot(mapId));
}

setInterval(() => {
  for (const socketId of world.players.keys()) {
    persistPlayer(socketId);
  }
}, 4000);

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = now - lastTick;
  lastTick = now;
  world.processRespawns(now);
  const events = world.tickEnemies(now, dt);
  for (const ev of events) {
    if (ev.type === "enemyHitPlayer") {
      const p = [...world.players.values()].find((x) => x.dbId === ev.targetDbId);
      if (p) io.to(p.socketId).emit("combat", ev);
    }
  }
  for (const mapId of world.allMapIds()) {
    broadcastMap(mapId);
  }
}, TICK_MS);

async function persistPlayer(socketId) {
  const p = world.players.get(socketId);
  if (!p) return;
  try {
    await saveCharacter(pool, {
      id: p.dbId,
      x: p.x,
      y: p.y,
      hp: p.hp,
      current_map: p.mapId,
      weapon_bonus: p.weaponBonus,
      gold: p.gold,
      equipment: p.equipment,
    });
    await replaceInventorySlots(pool, p.dbId, p.slots);
  } catch (e) {
    console.error("persist_error", e);
  }
}

io.on("connection", (socket) => {
  socket.on("join", async (payload, ack) => {
    const name = String(payload?.name || "traveler").slice(0, 24);
    try {
      const rec = await findOrCreateCharacter(pool, name);
      const { slots, gold, equipment } = await loadCharacterInventory(pool, rec.id);
      const p = world.addPlayer(socket.id, {
        id: rec.id,
        name: rec.name,
        x: rec.x,
        y: rec.y,
        hp: rec.hp,
        current_map: rec.current_map,
        slots,
        equipment,
        gold: gold ?? rec.gold ?? 0,
      });
      await socket.join(`map:${p.mapId}`);
      socket.emit("joined", { selfId: p.id, dbId: p.dbId, mapId: p.mapId });
      broadcastMap(p.mapId);
      if (typeof ack === "function") ack({ ok: true });
    } catch (e) {
      console.error(e);
      socket.emit("error_msg", { message: "join_failed" });
      if (typeof ack === "function") ack({ ok: false });
    }
  });

  socket.on("move", (payload) => {
    const dir = payload?.dir;
    if (!["up", "down", "left", "right"].includes(dir)) return;
    const now = Date.now();
    const p = world.players.get(socket.id);
    const mapBefore = p?.mapId;
    const r = world.tryMovePlayer(socket.id, dir, now, MOVE_DELAY_MS);
    if (!r.moved) return;

    if (r.teleported) {
      socket.leave(`map:${r.fromMap}`);
      socket.join(`map:${r.toMap}`);
      broadcastMap(r.fromMap);
      broadcastMap(r.toMap);
      socket.emit("mapTransition", world.snapshot(r.toMap));
    } else if (mapBefore) {
      broadcastMap(mapBefore);
    }
  });

  socket.on("attack", (payload) => {
    const targetId = Number(payload?.targetId);
    if (!Number.isFinite(targetId)) return;
    const now = Date.now();
    const res = world.tryAttack(socket.id, targetId, now, ATTACK_COOLDOWN_MS);
    if (res?.mapId) {
      io.to(`map:${res.mapId}`).emit("combat", res);
      broadcastMap(res.mapId);
    }
  });

  socket.on("pickup", async () => {
    const p = world.players.get(socket.id);
    if (!p || p.hp <= 0) return;
    const it = world.tryPickup(socket.id);
    if (!it) return;

    if (it.itemType === "coin") {
      p.gold += GOLD_PER_COIN_PICKUP;
      world.removeGroundItem(p.mapId, it.id);
      try {
        await saveCharacter(pool, {
          id: p.dbId,
          x: p.x,
          y: p.y,
          hp: p.hp,
          current_map: p.mapId,
          weapon_bonus: p.weaponBonus,
          gold: p.gold,
          equipment: p.equipment,
        });
      } catch (e) {
        console.error(e);
      }
      broadcastMap(p.mapId);
      return;
    }

    if (!addItemToSlots(p.slots, it.itemType, it.meta)) {
      socket.emit("error_msg", { message: "inventory_full" });
      return;
    }
    world.removeGroundItem(p.mapId, it.id);
    try {
      await replaceInventorySlots(pool, p.dbId, p.slots);
    } catch (e) {
      console.error(e);
    }
    broadcastMap(p.mapId);
  });

  socket.on("interactSlot", async (payload) => {
    const p = world.players.get(socket.id);
    if (!p || p.hp <= 0) return;
    const slot = Number(payload?.slot);
    if (!Number.isInteger(slot) || slot < 0 || slot > 9) return;

    const ok = tryInteractInventorySlot(p, slot);

    if (!ok) return;

    try {
      await saveCharacter(pool, {
        id: p.dbId,
        x: p.x,
        y: p.y,
        hp: p.hp,
        current_map: p.mapId,
        weapon_bonus: p.weaponBonus,
        gold: p.gold,
        equipment: p.equipment,
      });
      await replaceInventorySlots(pool, p.dbId, p.slots);
    } catch (e) {
      console.error(e);
    }
    broadcastMap(p.mapId);
  });

  socket.on("equipGear", async (payload) => {
    const p = world.players.get(socket.id);
    if (!p || p.hp <= 0) return;
    const invSlot = Number(payload?.inventorySlot);
    const kind = String(payload?.slot || "");
    if (!Number.isInteger(invSlot) || invSlot < 0 || invSlot > 9) return;
    if (!["weapon", "helmet", "chest", "boots"].includes(kind)) return;
    if (!tryEquipInventoryToSlot(p, invSlot, /** @type {"weapon"|"helmet"|"chest"|"boots"} */ (kind))) return;
    try {
      await saveCharacter(pool, {
        id: p.dbId,
        x: p.x,
        y: p.y,
        hp: p.hp,
        current_map: p.mapId,
        weapon_bonus: p.weaponBonus,
        gold: p.gold,
        equipment: p.equipment,
      });
      await replaceInventorySlots(pool, p.dbId, p.slots);
    } catch (e) {
      console.error(e);
    }
    broadcastMap(p.mapId);
  });

  socket.on("unequipGear", async (payload) => {
    const p = world.players.get(socket.id);
    if (!p || p.hp <= 0) return;
    const kind = String(payload?.slot || "");
    if (!["weapon", "helmet", "chest", "boots"].includes(kind)) return;
    if (!tryUnequipSlot(p, /** @type {"weapon"|"helmet"|"chest"|"boots"} */ (kind))) return;
    try {
      await saveCharacter(pool, {
        id: p.dbId,
        x: p.x,
        y: p.y,
        hp: p.hp,
        current_map: p.mapId,
        weapon_bonus: p.weaponBonus,
        gold: p.gold,
        equipment: p.equipment,
      });
      await replaceInventorySlots(pool, p.dbId, p.slots);
    } catch (e) {
      console.error(e);
    }
    broadcastMap(p.mapId);
  });

  socket.on("shop", async (payload) => {
    const p = world.players.get(socket.id);
    if (!p || p.hp <= 0) return;
    if (!isAdjacentToShopkeeper(p)) return;

    const action = String(payload?.action || "");
    let ok = false;
    if (action === "buy") {
      const item = String(payload?.item || "");
      if (item === "potion") ok = tryBuyPotion(p);
      else if (item === "weapon") ok = tryBuyWeapon(p);
    } else if (action === "buyPotion") ok = tryBuyPotion(p);
    else if (action === "sell") {
      const slot = Number(payload?.slot);
      if (Number.isInteger(slot) && slot >= 0 && slot <= 9) ok = trySellSlot(p, slot);
    }
    if (!ok) return;

    recalculateCombatStats(p);

    try {
      await saveCharacter(pool, {
        id: p.dbId,
        x: p.x,
        y: p.y,
        hp: p.hp,
        current_map: p.mapId,
        weapon_bonus: p.weaponBonus,
        gold: p.gold,
        equipment: p.equipment,
      });
      await replaceInventorySlots(pool, p.dbId, p.slots);
    } catch (e) {
      console.error(e);
    }
    broadcastMap(p.mapId);
  });

  socket.on("chat", (payload) => {
    const p = world.players.get(socket.id);
    if (!p || p.hp <= 0) return;
    const text = String(payload?.text ?? "")
      .trim()
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
      .slice(0, 200);
    if (!text) return;
    const name = String(p.name || "traveler").slice(0, 24);
    io.to(`map:${p.mapId}`).emit("chat", { name, text });
  });

  socket.on("party_invite", (payload) => {
    const p = world.players.get(socket.id);
    if (!p || p.hp <= 0) return;
    const targetName = String(payload?.targetName || "").trim();
    if (!targetName) return;
    const r = partyInvite(world, socket.id, targetName);
    if (!r.ok) {
      socket.emit("party_notice", { message: r.reason === "no_target" ? "player_not_found" : "invite_failed" });
      return;
    }
    const inv = world.players.get(socket.id);
    const nm = String(inv?.name || "traveler").slice(0, 24);
    io.to(r.targetSid).emit("party_invited", { from: nm });
    socket.emit("party_notice", { message: "invite_sent" });
  });

  socket.on("party_accept", (payload) => {
    const p = world.players.get(socket.id);
    if (!p || p.hp <= 0) return;
    const inviterName = String(payload?.inviterName || "").trim();
    if (!inviterName) return;
    const ok = partyAccept(world, socket.id, inviterName);
    if (!ok) {
      socket.emit("party_notice", { message: "party_accept_failed" });
      return;
    }
    for (const mid of world.allMapIds()) broadcastMap(mid);
    socket.emit("party_notice", { message: "joined_party" });
  });

  socket.on("party_leave", () => {
    if (!world.players.get(socket.id)) return;
    partyLeave(world, socket.id);
    for (const mid of world.allMapIds()) broadcastMap(mid);
    socket.emit("party_notice", { message: "left_party" });
  });

  socket.on("disconnect", async () => {
    onPlayerDisconnect(world, socket.id);
    const p = world.players.get(socket.id);
    const mapId = p?.mapId;
    await persistPlayer(socket.id);
    world.removePlayer(socket.id);
    if (mapId) broadcastMap(mapId);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Rotlands listening on http://0.0.0.0:${PORT} (all interfaces — use your LAN IP for other devices)`);
});
