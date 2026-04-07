/**
 * Lightweight in-memory parties (max 4). Not persisted.
 */
import { hashString } from "./procedural/itemNames.js";

const MAX_PARTY = 4;

/** @type {Map<string, { leader: string, members: Set<string> }>} */
const parties = new Map();

/** @param {string} partyId */
function hueForParty(partyId) {
  return hashString(partyId) % 360;
}

/** @param {import("./World.js").World} world @param {string} name */
function socketByName(world, name) {
  const want = String(name || "").toLowerCase();
  for (const [sid, pl] of world.players) {
    if (String(pl.name || "").toLowerCase() === want) return sid;
  }
  return null;
}

/** @param {import("./World.js").World} world */
function applyPartyHue(world, partyId) {
  const pt = parties.get(partyId);
  if (!pt) return;
  const h = hueForParty(partyId);
  for (const sid of pt.members) {
    const pl = world.players.get(sid);
    if (pl) {
      pl.partyId = partyId;
      pl.partyHue = h;
    }
  }
}

/** @param {import("./World.js").World} world @param {string} socketId */
function removeFromParty(world, socketId) {
  const pl = world.players.get(socketId);
  const pid = pl?.partyId;
  if (!pid) return;
  const pt = parties.get(pid);
  if (!pt) {
    if (pl) {
      pl.partyId = null;
      pl.partyHue = null;
    }
    return;
  }
  pt.members.delete(socketId);
  if (pl) {
    pl.partyId = null;
    pl.partyHue = null;
  }
  if (pt.members.size === 0) parties.delete(pid);
  else applyPartyHue(world, pid);
}

/**
 * @param {import("./World.js").World} world
 * @param {string} fromSid
 * @param {string} targetName
 * @returns {{ ok: boolean, reason?: string, targetSid?: string }}
 */
export function partyInvite(world, fromSid, targetName) {
  const inv = world.players.get(fromSid);
  if (!inv) return { ok: false, reason: "no_player" };
  const tgt = socketByName(world, targetName);
  if (!tgt || tgt === fromSid) return { ok: false, reason: "no_target" };
  return { ok: true, targetSid: tgt };
}

/**
 * @param {import("./World.js").World} world
 * @param {string} accepterSid
 * @param {string} inviterName
 * @returns {boolean}
 */
export function partyAccept(world, accepterSid, inviterName) {
  const ac = world.players.get(accepterSid);
  const invSid = socketByName(world, inviterName);
  if (!ac || !invSid) return false;
  const inv = world.players.get(invSid);
  if (!inv) return false;

  let partyId = inv.partyId || ac.partyId;
  if (!partyId) {
    partyId = `pty_${Date.now().toString(36)}_${(Math.random() * 1e6) | 0}`;
    parties.set(partyId, { leader: invSid, members: new Set([invSid]) });
    inv.partyId = partyId;
    inv.partyHue = hueForParty(partyId);
  }

  const pt = parties.get(partyId);
  if (!pt) return false;
  if (ac.partyId && ac.partyId !== partyId) return false;
  if (pt.members.has(accepterSid)) return false;
  if (pt.members.size >= MAX_PARTY) return false;

  pt.members.add(accepterSid);
  ac.partyId = partyId;
  ac.partyHue = hueForParty(partyId);
  applyPartyHue(world, partyId);
  return true;
}

/** @param {import("./World.js").World} world @param {string} sid */
export function partyLeave(world, sid) {
  removeFromParty(world, sid);
}

/** @param {import("./World.js").World} world @param {string} sid */
export function onPlayerDisconnect(world, sid) {
  removeFromParty(world, sid);
}
