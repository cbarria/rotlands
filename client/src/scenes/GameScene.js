import Phaser from "phaser";
import { io } from "socket.io-client";
import { registerProceduralTextures, uiItemTextureKey } from "../art/proceduralPixels.js";

const TILE = 32;
/** Match server `server/src/game/shop.js` */
const SHOP_POTION_PRICE = 15;
const SHOP_WEAPON_PRICE = 40;
/** Match server `sellPriceForCell` — gold per unit when selling */
function baseSellTypeGold(type) {
  switch (String(type || "")) {
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

/** @param {null | { type?: string, qty?: number, meta?: { rarity?: string } }} cell */
function shopSellUnitGold(cell) {
  if (!cell || (cell.qty ?? 0) < 1) return 0;
  const base = baseSellTypeGold(cell.type);
  if (base <= 0) return 0;
  const r = cell.meta?.rarity;
  const mult = r === "epic" ? 4 : r === "rare" ? 2.2 : 1;
  return Math.max(1, Math.floor(base * mult));
}

const EQ_KINDS = /** @type {const} */ (["weapon", "helmet", "chest", "boots"]);
const EQ_LABEL = { weapon: "Weapon", helmet: "Helmet", chest: "Chest", boots: "Boots" };
/** @param {string} kind @param {string} invType */
function invTypeMatchesEquipKind(kind, invType) {
  const need =
    kind === "weapon"
      ? "weapon"
      : kind === "helmet"
        ? "armor_helmet"
        : kind === "chest"
          ? "armor_chest"
          : "armor_boots";
  return need === invType;
}

/** @param {string | undefined} t */
function isGearInvType(t) {
  return (
    t === "weapon" || t === "armor_helmet" || t === "armor_chest" || t === "armor_boots"
  );
}

/** @param {string | undefined} type */
function itemShortName(type) {
  const m = {
    weapon: "Sword",
    armor_helmet: "Helmet",
    armor_chest: "Chest",
    armor_boots: "Boots",
    potion: "Potion",
    bread: "Bread",
    coin: "Coin",
  };
  return m[/** @type {keyof typeof m} */ (type)] || String(type || "").slice(0, 8) || "—";
}

/** @param {any} meta */
function formatGearStatsReadable(meta) {
  if (!meta || typeof meta !== "object") return "";
  const parts = [];
  if (meta.dmg != null) parts.push(`ATK +${meta.dmg}`);
  if (meta.def != null) parts.push(`DEF +${meta.def}`);
  if (meta.hp != null) parts.push(`HP +${meta.hp}`);
  if (meta.heal != null) parts.push(`Heal ${meta.heal}`);
  const r = meta.rarity ? String(meta.rarity).toLowerCase() : "";
  const tag = r === "epic" ? "Epic  " : r === "rare" ? "Rare  " : "";
  return (tag + parts.join("  ")).trim();
}
const SHOP_MENU_LINES = 12;

const GAME_W = 960;
const GAME_H = 540;
/** HUD HP bar — also used to anchor incoming damage numbers. */
const HUD_HP_BAR_X = 14;
const HUD_HP_BAR_Y = 20;
const HUD_HP_BAR_W = 256;
const HUD_HP_BAR_H = 22;
const OVERHEAD_HP_BAR_W = 30;
const OVERHEAD_HP_BAR_H = 4;
const OVERHEAD_HP_BAR_Y = -20;
/** Inventory is a centered modal; world view uses full height below HUD. */
const INV_PANEL_TOP = GAME_H;
/** World camera starts below HUD; playfield extends to bottom of screen. */
const WORLD_CAMERA_TOP = 94;
const WORLD_CAMERA_HEIGHT = INV_PANEL_TOP - WORLD_CAMERA_TOP;
/** Modal “ITEMS” panel (below equipment so Esc closes topmost). */
const INV_MODAL_DEPTH = 3010;
/** Objects with depth ≥ this render only on the full-screen UI camera. */
const UI_CAMERA_DEPTH_MIN = 600;
/** Playfield width matches server MAP_W (24) × tile. Right side is UI gutter. */
const PLAYFIELD_W = 24 * TILE;
const CHAT_GUTTER_W = GAME_W - PLAYFIELD_W;
const HUD_DEPTH = 1400;
const TOUCH_DEPTH = 2500;
const SHOP_UI_DEPTH = 3100;
const EQ_PANEL_DEPTH = 3040;
const CHAT_DEPTH = 3050;
const CHAT_MAX_LINES = 6;
/** Same right inset as `createChatUi` chat panel. */
const CHAT_MARGIN_R = 8;
/** DOM chat input: below CHAT/Msg header, inside panel (game pixels). */
const CHAT_INPUT_ROW_GAME_TOP = 36 + 40;
const CHAT_INPUT_ROW_GAME_H = 28;

/** Terrain codes aligned with server `World.TILE` (6 = lava reserved for maps that use it). */
const T_GRASS = 0;
const T_WALL = 1;
const T_PORTAL = 2;
const T_TREE = 3;
const T_ROCK = 4;
const T_GRASS_PATCH = 5;
const T_LAVA = 6;

/**
 * Guess ground under a tree/rock from orthogonal neighbors so the underlay matches nearby tiles.
 * @param {number[][]} tiles
 */
function inferUnderlayTerrain(tiles, x, y, w, h) {
  let nGrass = 0;
  let nWall = 0;
  let nPortal = 0;
  let nPatch = 0;
  let nLava = 0;
  const dirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  for (const [dx, dy] of dirs) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const n = tiles[ny][nx];
    if (n === T_GRASS) nGrass++;
    else if (n === T_WALL) nWall++;
    else if (n === T_PORTAL) nPortal++;
    else if (n === T_GRASS_PATCH) nPatch++;
    else if (n === T_LAVA) nLava++;
  }
  if (nLava >= 1) return T_LAVA;
  if (nPatch >= 1) return T_GRASS_PATCH;
  if (nPortal >= 1) return T_PORTAL;
  if (nWall >= 2 || (nWall >= 1 && nGrass + nPatch === 0)) return T_WALL;
  return T_GRASS;
}

/** @param {number} t */
function textureForTerrainTile(t) {
  switch (t) {
    case T_WALL:
      return "px_tile_wall";
    case T_PORTAL:
      return "px_tile_portal";
    case T_GRASS_PATCH:
      return "px_tile_grass_patch";
    case T_LAVA:
      return "px_tile_lava";
    default:
      return "px_tile_grass";
  }
}

/** @param {number} hp @param {number} maxHp */
function hpFillColor(hp, maxHp) {
  const r = maxHp > 0 ? hp / maxHp : 0;
  if (r < 0.28) return 0xc62828;
  if (r < 0.52) return 0xf9a825;
  return 0x43a047;
}

export class GameScene extends Phaser.Scene {
  constructor() {
    super("GameScene");
    this.socket = null;
    this.selfId = null;
    /** @type {number|null} */
    this.selfDbId = null;
    /** @type {string | null} */
    this.currentMapId = null;
    this.sprites = new Map();
    this.mapData = null;
    /** Dark red “missing HP” track behind the green fill */
    /** @type {Phaser.GameObjects.Rectangle | null} */
    this._hpBarTrack = null;
    /** @type {Phaser.GameObjects.Rectangle | null} */
    this._hpBarFill = null;
    /** @type {number} */
    this._hpFillMaxW = 1;
    /** @type {Phaser.GameObjects.Text | null} */
    this._hpText = null;
    /** @type {Phaser.GameObjects.Text | null} */
    this._hudGoldText = null;
    /** @type {Phaser.GameObjects.Text | null} */
    this._hudAtkText = null;
    /** @type {Phaser.GameObjects.Text | null} */
    this._hudDefText = null;
    /** @type {Phaser.GameObjects.Text | null} */
    this._hudZoneText = null;
    /** @type {Phaser.GameObjects.Text | null} */
    this._hudHintText = null;
    /** @type {Phaser.GameObjects.Rectangle[]} */
    this._invSlotBgs = [];
    /** @type {Phaser.GameObjects.Image[]} */
    this._invSlotIcons = [];
    /** @type {Phaser.GameObjects.Text[]} */
    this._invSlotLabels = [];
    /** @type {Phaser.GameObjects.Text[]} */
    this._invSlotQty = [];
    /** @type {Phaser.GameObjects.Text[]} */
    this._invSlotHotkeys = [];
    /** @type {Phaser.GameObjects.Zone[]} */
    this._invSlotZones = [];
    /** @type {number} */
    this.selectedSlotIndex = 0;
    /** @type {Phaser.GameObjects.Image[]} */
    this._tileImgs = null;
    /** @type {string | null} */
    this._tileCacheKey = null;
    /** Coarse pointer, narrow viewport, or ?touch=1 */
    this.showTouchUi = false;
    /** @type {{ up: boolean, down: boolean, left: boolean, right: boolean }} */
    this._padHeld = { up: false, down: false, left: false, right: false };
    /** @type {Phaser.GameObjects.GameObject[]} */
    this._touchUiNodes = [];
    /** Shop modal */
    this._shopPopupOpen = false;
    /** Equipment panel (keyboard I) */
    this._equipmentPanelOpen = false;
    /** Inventory modal (keyboard Tab) */
    this._inventoryPanelOpen = false;
    this._invUiBuilt = false;
    /** @type {Phaser.GameObjects.GameObject[]} */
    this._invUiNodes = [];
    this._eqUiBuilt = false;
    /** @type {Phaser.GameObjects.GameObject[]} */
    this._eqUiNodes = [];
    /** @type {null | number} */
    this._eqDragInvIndex = null;
    /** @type {Record<string, Phaser.GameObjects.Zone>} */
    this._eqDropZones = {};
    /** @type {Record<string, Phaser.GameObjects.Image>} */
    this._eqIconImages = {};
    /** @type {Record<string, Phaser.GameObjects.Text>} */
    this._eqNameTexts = {};
    /** @type {Record<string, Phaser.GameObjects.Text>} */
    this._eqStatTexts = {};
    /** @type {(() => void) | null} */
    this._eqGlobalPointerUp = null;
    /** @type {"main" | "buy" | "sell"} */
    this._shopPanelMode = "main";
    this._shopMenuIndex = 0;
    this._shopMenuLineCount = 0;
    /** @type {number[]} */
    this._shopSellSlotIndices = [];
    this._shopUiBuilt = false;
    /** @type {Phaser.GameObjects.GameObject[]} */
    this._shopUiNodes = [];
    /** @type {Phaser.GameObjects.Text | null} */
    this._shopInstructionText = null;
    /** @type {Phaser.GameObjects.Text[]} */
    this._shopLineTexts = [];
    /** @type {Phaser.GameObjects.Zone[]} */
    this._shopLineZones = [];
    /** Enemies playing death fade — do not destroy until tween ends */
    this._enemyDeathFadeActive = new Set();
    /** @type {string[]} */
    this._chatLines = [];
    /** @type {Phaser.GameObjects.Rectangle | null} */
    this._chatPanelBg = null;
    /** @type {Phaser.GameObjects.Text | null} */
    this._chatLogText = null;
    /** @type {Phaser.GameObjects.GameObject[]} */
    this._chatUiExtra = [];
    /** @type {HTMLInputElement | null} */
    this._chatInputEl = null;
    this._chatInputOpen = false;
    /** Game-space rect for fixed chat `<input>` (synced to scaled canvas). */
    /** @type {{ left: number, top: number, width: number, height: number } | null} */
    this._chatDomLayout = null;
    /** ms since epoch — ignore Phaser Enter until after DOM chat closes */
    this._chatEnterSuppressUntil = 0;
    /** On-screen stamp from GET /build.txt (written in Docker image) */
    /** @type {Phaser.GameObjects.Text | null} */
    this._buildStampText = null;
    /** Full-screen UI camera (HUD, chat, inv); main camera shows only the playable band. */
    /** @type {Phaser.Cameras.Scene2D.Camera | null} */
    this.uiCamera = null;
    this._socketEverConnected = false;
    /** @type {Phaser.Time.TimerEvent | null} */
    this._joinWatchPending = null;
    /** Visible until map + entities sync (debug “black screen” without console errors). */
    /** @type {Phaser.GameObjects.Text | null} */
    this._loadHintText = null;
  }

  /** Split world vs UI so map sprites are never occluded by HUD strips. */
  _initWorldUiCameras() {
    if (this.uiCamera) return;
    const world = this.cameras.main;
    world.setViewport(0, WORLD_CAMERA_TOP, GAME_W, WORLD_CAMERA_HEIGHT);
    world.setSize(GAME_W, WORLD_CAMERA_HEIGHT);
    world.setRoundPixels(true);
    this.uiCamera = this.cameras.add(0, 0, GAME_W, GAME_H);
    this.uiCamera.setRoundPixels(true);
    /** Must stay transparent so the world camera band is visible underneath the UI layer. */
    this.uiCamera.transparent = true;
  }

  _updateLoadHint(message) {
    if (!this._loadHintText) {
      this._loadHintText = this.add
        .text(GAME_W / 2, INV_PANEL_TOP - 78, message, {
          fontSize: "12px",
          color: "#e8e4f0",
          fontFamily: "monospace",
          align: "center",
          wordWrap: { width: GAME_W - 24 },
          backgroundColor: "#0a0816e6",
          padding: { x: 12, y: 8 },
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(15000);
      this._syncCameraLayers();
      return;
    }
    this._loadHintText.setText(message);
  }

  /** @returns {void} */
  _tryDismissLoadHintAfterMerge() {
    if (!this._loadHintText) return;
    const hasTiles = (this._tileImgs?.length ?? 0) > 0;
    const hasEnt =
      this.selfId != null &&
      Array.isArray(this._lastSnap?.entities) &&
      this._lastSnap.entities.some((e) => e.id === this.selfId);
    if (hasTiles && hasEnt) {
      this._loadHintText.destroy();
      this._loadHintText = null;
      this._syncCameraLayers();
      return;
    }
    if (!this.socket?.connected) {
      this._loadHintText.setText("Sin conexión al servidor.");
    } else if (this.selfId == null) {
      this._loadHintText.setText("Conectado — esperando confirmación (joined)…");
    } else if (!hasTiles) {
      this._loadHintText.setText(
        "Sin mapa dibujado. En el host abrí /ready y /health · misma URL que usás para jugar.",
      );
    }
  }

  /**
   * Phaser 3.90+ has no `Camera.clearIgnore()`; `ignore()` ORs `cameraFilter` bits on GameObjects.
   * Reset split-render state by clearing those bits for our two cameras, then re-applying ignores.
   */
  _clearSplitCameraBits(go, worldId, uiId) {
    if (!go) return;
    if (typeof go.cameraFilter === "number") {
      go.cameraFilter &= ~worldId;
      go.cameraFilter &= ~uiId;
    }
    const list = /** @type {any} */ (go).list;
    if (list && typeof list.length === "number") {
      for (let i = 0; i < list.length; i++) {
        this._clearSplitCameraBits(list[i], worldId, uiId);
      }
    }
  }

  _syncCameraLayers() {
    const ui = this.uiCamera;
    const world = this.cameras.main;
    if (!ui) return;
    const wid = world.id;
    const uid = ui.id;
    const roots = this.children.list;
    for (let i = 0; i < roots.length; i++) {
      this._clearSplitCameraBits(roots[i], wid, uid);
    }
    for (let i = 0; i < roots.length; i++) {
      const ch = /** @type {any} */ (roots[i]);
      if (!ch || ch.scene !== this) continue;
      const d = typeof ch.depth === "number" ? ch.depth : 0;
      if (d >= UI_CAMERA_DEPTH_MIN) world.ignore(ch);
      else ui.ignore(ch);
    }
  }

  _updateWorldCameraScroll() {
    const cam = this.cameras.main;
    const me = this._selfEntity();
    const md = this.mapData;
    if (!cam || !me || !md?.w) return;
    const mapW = md.w * TILE;
    const mapH = md.h * TILE;
    const halfW = cam.width * 0.5;
    const halfH = cam.height * 0.5;
    let sx = me.x * TILE + TILE / 2 - halfW;
    let sy = me.y * TILE + TILE / 2 - halfH;
    sx = Phaser.Math.Clamp(sx, 0, Math.max(0, mapW - cam.width));
    sy = Phaser.Math.Clamp(sy, 0, Math.max(0, mapH - cam.height));
    cam.setScroll(sx, sy);
  }

  create() {
    registerProceduralTextures(this);
    this._initWorldUiCameras();
    try {
      const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;
      const narrow = typeof window !== "undefined" && window.innerWidth < 768;
      const forceTouch =
        typeof window !== "undefined" && new URLSearchParams(window.location.search).has("touch");
      this.showTouchUi = Boolean(forceTouch || coarse || narrow);
    } catch {
      this.showTouchUi = false;
    }

    this.createRightGutterBackdrop();
    this.createRpgHud();
    this.createInventoryPanel();
    this.createChatUi();
    this.createEquipmentPanel();
    this.createDockerBuildStamp();

    const url = import.meta.env.DEV ? undefined : undefined;
    this.socket = io(url || window.location.origin, {
      transports: ["websocket", "polling"],
    });

    /** @type {Phaser.GameObjects.Text | null} */
    this._netStatusText = null;

    const showNetError = (line1, line2 = "") => {
      if (!this._netStatusText) {
        this._netStatusText = this.add
          .text(GAME_W / 2, GAME_H / 2, "", {
            fontSize: "14px",
            color: "#ff9580",
            fontFamily: "monospace",
            align: "center",
            wordWrap: { width: GAME_W - 48 },
            backgroundColor: "#0a0814",
            padding: { x: 12, y: 10 },
          })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setDepth(12000);
        this._syncCameraLayers();
      }
      this._netStatusText.setText([line1, line2].filter(Boolean).join("\n"));
    };

    const clearNetError = () => {
      if (this._netStatusText) {
        this._netStatusText.destroy();
        this._netStatusText = null;
        this._syncCameraLayers();
      }
    };

    const name = `hero_${(Math.random() * 10000) | 0}`;

    this._updateLoadHint("Conectando al servidor…");

    this.socket.on("connect", () => {
      this._socketEverConnected = true;
      clearNetError();
      this._updateLoadHint("Conectado — registrando personaje…");
      this.socket.emit("join", { name }, (ack) => {
        if (ack && ack.ok === false) {
          showNetError(
            "El servidor rechazó el join (base de datos / error interno).",
            "En el PC host: revisá logs de Docker y GET /ready",
          );
        }
      });
      if (this._joinWatchPending) {
        this._joinWatchPending.remove(false);
        this._joinWatchPending = null;
      }
      this._joinWatchPending = this.time.delayedCall(15000, () => {
        this._joinWatchPending = null;
        if (this.selfId != null || !this.socket?.connected) return;
        showNetError(
          "El servidor no completó la entrada (join).",
          `En el PC host abrí http://${window.location.host}/ready — debe decir ready:true (Docker/Postgres).`,
        );
      });
    });

    this.socket.on("connect_error", (err) => {
      const msg = err?.message || String(err || "connect_error");
      this._updateLoadHint(`Fallo de socket: ${msg}`);
      showNetError(
        "No se pudo conectar al servidor (Socket).",
        `${msg}\nFirewall · misma Wi‑Fi · http (no https) · ${window.location.origin}`,
      );
    });

    this.socket.on("disconnect", (reason) => {
      if (reason === "io client disconnect") return;
      if (!this._socketEverConnected) return;
      showNetError("Desconectado del servidor.", String(reason || ""));
    });

    this.socket.on("joined", (msg) => {
      this._updateLoadHint("Sincronizando mapa…");
      if (this._joinWatchPending) {
        this._joinWatchPending.remove(false);
        this._joinWatchPending = null;
      }
      this.selfId = msg.selfId;
      this.selfDbId = msg.dbId ?? null;
      if (msg.mapId) this.currentMapId = msg.mapId;
      this.pushChatLine("Game", "Enter: chat · Space: attack (next to enemy in dungeon).");
    });

    this.socket.on("mapTransition", (snap) => this.runMapTransition(snap));
    this.socket.on("state", (snap) => this.applyState(snap));
    this.socket.on("combat", (ev) => this.handleCombatEvent(ev));
    this.socket.on("chat", (msg) => {
      if (msg?.name != null && msg?.text != null) this.pushChatLine(msg.name, msg.text);
    });

    this.socket.on("error_msg", (payload) => {
      const m = String(payload?.message || "join_failed");
      showNetError("Error al entrar al juego (join).", m);
    });

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyPickup = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.keyAttack = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keyShopBuy = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    this.keyEsc = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.keyEquipPanel = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.I);
    this.keyInvPanel = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TAB);
    this.input.keyboard.addCapture(Phaser.Input.Keyboard.KeyCodes.TAB);
    this.keyEnter = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);

    const slotCodes = [
      Phaser.Input.Keyboard.KeyCodes.ONE,
      Phaser.Input.Keyboard.KeyCodes.TWO,
      Phaser.Input.Keyboard.KeyCodes.THREE,
      Phaser.Input.Keyboard.KeyCodes.FOUR,
      Phaser.Input.Keyboard.KeyCodes.FIVE,
      Phaser.Input.Keyboard.KeyCodes.SIX,
      Phaser.Input.Keyboard.KeyCodes.SEVEN,
      Phaser.Input.Keyboard.KeyCodes.EIGHT,
      Phaser.Input.Keyboard.KeyCodes.NINE,
      Phaser.Input.Keyboard.KeyCodes.ZERO,
    ];
    /** @type {Phaser.Input.Keyboard.Key[]} */
    this.slotKeys = slotCodes.map((c) => this.input.keyboard.addKey(c));

    this.lastMoveSent = 0;

    if (this.showTouchUi) this.createTouchUi();
    this.updateSelectionHighlight();
    this._syncCameraLayers();

    this.events.once("shutdown", () => {
      if (this._eqGlobalPointerUp) this.input?.off("pointerup", this._eqGlobalPointerUp);
      this._eqGlobalPointerUp = null;
      this.scale?.off("resize", this._syncChatInputDomLayout, this);
      if (this._joinWatchPending) {
        this._joinWatchPending.remove(false);
        this._joinWatchPending = null;
      }
      if (this._loadHintText) {
        this._loadHintText.destroy();
        this._loadHintText = null;
      }
      if (this._chatInputEl?.parentNode) this._chatInputEl.remove();
      this._chatInputEl = null;
      this._chatDomLayout = null;
    });
  }

  /** Dim panel in the letterbox gutter so UI (chat, zone) reads as intentional. */
  createRightGutterBackdrop() {
    if (CHAT_GUTTER_W < 12) return;
    this.add
      .rectangle(PLAYFIELD_W + CHAT_GUTTER_W / 2, GAME_H / 2, CHAT_GUTTER_W, GAME_H, 0x040308, 0.5)
      .setScrollFactor(0)
      .setDepth(620);
  }

  /** Confirms the browser hit the Express bundle (Docker writes public/build.txt). */
  createDockerBuildStamp() {
    const d = 5000;
    /** Bottom-right, clear of chat gutter. */
    const stampY = GAME_H - 14;
    this._buildStampText = this.add
      .text(GAME_W - CHAT_MARGIN_R, stampY, "build …", {
        fontSize: "10px",
        fontFamily: "monospace",
        color: "#5cff9d",
        backgroundColor: "#0a0812ee",
        padding: { x: 6, y: 3 },
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(d);

    const bust = Date.now();
    fetch(`/build.txt?bust=${bust}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((raw) => {
        const s = String(raw || "").trim();
        if (this._buildStampText) this._buildStampText.setText(s ? `build ${s}` : "build (empty)");
      })
      .catch(() => {
        if (this._buildStampText) {
          this._buildStampText.setText("no build.txt — use http://localhost:3000 (Docker)");
          this._buildStampText.setColor("#ff9580");
        }
      });
  }

  /** Map game (960×540) coords to screen pixels so the chat `<input>` sits inside the gutter panel. */
  _syncChatInputDomLayout() {
    const el = this._chatInputEl;
    const L = this._chatDomLayout;
    if (!el || !L || !this.game?.canvas) return;
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const sx = rect.width / GAME_W;
    const sy = rect.height / GAME_H;
    el.style.position = "fixed";
    el.style.left = `${Math.round(rect.left + L.left * sx)}px`;
    el.style.top = `${Math.round(rect.top + L.top * sy)}px`;
    el.style.width = `${Math.max(44, Math.round(L.width * sx))}px`;
    el.style.height = `${Math.max(24, Math.round(L.height * sy))}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
  }

  createChatUi() {
    const d = CHAT_DEPTH;
    const panelW = this.showTouchUi
      ? Math.min(106, CHAT_GUTTER_W - 12)
      : Math.min(182, CHAT_GUTTER_W - CHAT_MARGIN_R * 2);
    const panelTopY = 36;
    const panelH = INV_PANEL_TOP - panelTopY - 12;
    const px = GAME_W - CHAT_MARGIN_R - panelW / 2;
    const py = panelTopY + panelH / 2;
    const leftX = px - panelW / 2;

    this._chatDomLayout = {
      left: leftX + 8,
      top: CHAT_INPUT_ROW_GAME_TOP,
      width: panelW - 16,
      height: CHAT_INPUT_ROW_GAME_H,
    };

    this._chatPanelBg = this.add
      .rectangle(px, py, panelW, panelH, 0x080a12, 0.88)
      .setStrokeStyle(2, 0x507868)
      .setScrollFactor(0)
      .setDepth(d);

    const title = this.add
      .text(leftX + 10, panelTopY + 16, "CHAT", {
        fontSize: "11px",
        color: "#9ae8b0",
        fontFamily: "monospace",
        stroke: "#050808",
        strokeThickness: 3,
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(d + 1);
    this._chatUiExtra.push(title);

    this._chatLogText = this.add
      .text(leftX + 10, py + panelH / 2 - 8, "", {
        fontSize: "10px",
        color: "#e6e2f8",
        fontFamily: "monospace",
        stroke: "#0a0812",
        strokeThickness: 3,
        wordWrap: { width: panelW - 18 },
        lineSpacing: 2,
      })
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(d + 1);

    const btnW = 50;
    const btnH = 24;
    const btnX = leftX + panelW - btnW / 2 - 8;
    const btnY = panelTopY + 16;
    const btnBg = this.add
      .rectangle(btnX, btnY, btnW, btnH, 0x14221a, 0.98)
      .setStrokeStyle(2, 0x5cb878)
      .setScrollFactor(0)
      .setDepth(d + 2);
    const btnLab = this.add
      .text(btnX, btnY, "Msg", {
        fontSize: "9px",
        color: "#e8fff0",
        fontFamily: "monospace",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(d + 3);
    const btnZ = this.add
      .zone(btnX, btnY, btnW + 10, btnH + 10)
      .setScrollFactor(0)
      .setDepth(d + 4)
      .setInteractive({ useHandCursor: true });
    btnZ.on("pointerdown", (p) => {
      p.event?.preventDefault?.();
      if (!this._shopPopupOpen) this.openChatInput();
    });
    this._chatUiExtra.push(btnBg, btnLab, btnZ);

    const el = document.createElement("input");
    el.type = "text";
    el.autocomplete = "off";
    el.maxLength = 200;
    el.placeholder = "Message · Enter send · Esc cancel";
    Object.assign(el.style, {
      zIndex: "99999",
      display: "none",
      boxSizing: "border-box",
      fontFamily: "monospace",
      fontSize: "11px",
      padding: "3px 7px",
      border: "2px solid #5cb878",
      background: "#0c0812",
      color: "#f2eeff",
      borderRadius: "4px",
      outline: "none",
    });
    document.body.appendChild(el);
    this._chatInputEl = el;
    this._syncChatInputDomLayout();
    this.scale.on("resize", this._syncChatInputDomLayout, this);

    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const t = el.value.trim();
        if (t && this.socket?.connected) this.socket.emit("chat", { text: t });
        el.value = "";
        el.style.display = "none";
        this._chatInputOpen = false;
        el.blur();
        this._chatEnterSuppressUntil = performance.now() + 200;
      } else if (e.key === "Escape") {
        e.preventDefault();
        el.value = "";
        el.style.display = "none";
        this._chatInputOpen = false;
        el.blur();
        this._chatEnterSuppressUntil = performance.now() + 200;
      }
    });
  }

  openChatInput() {
    const el = this._chatInputEl;
    if (!el) return;
    this._syncChatInputDomLayout();
    el.style.display = "block";
    this._chatInputOpen = true;
    el.focus();
  }

  /**
   * @param {string} name
   * @param {string} text
   */
  pushChatLine(name, text) {
    const safeName = String(name || "?").replace(/[\x00-\x1f\x7f]/g, "").slice(0, 24);
    const safeText = String(text || "").replace(/[\x00-\x1f\x7f]/g, "").slice(0, 200);
    this._chatLines.push(`${safeName}: ${safeText}`);
    while (this._chatLines.length > CHAT_MAX_LINES) this._chatLines.shift();
    if (this._chatLogText) this._chatLogText.setText(this._chatLines.join("\n"));
  }

  createRpgHud() {
    const d = HUD_DEPTH;
    const barX = HUD_HP_BAR_X;
    const barY = HUD_HP_BAR_Y;
    const barW = HUD_HP_BAR_W;
    const barH = HUD_HP_BAR_H;
    const inner = 3;
    this._hpFillMaxW = barW - inner * 2;

    this.add
      .text(barX, 6, "HP", {
        fontSize: "11px",
        color: "#7d7890",
        fontFamily: "monospace",
      })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(d + 2);

    this.add
      .rectangle(barX + barW / 2, barY + barH / 2, barW, barH, 0x080610, 1)
      .setStrokeStyle(2, 0x3d3558)
      .setScrollFactor(0)
      .setDepth(d);

    this._hpBarTrack = this.add
      .rectangle(barX + inner, barY + barH / 2, this._hpFillMaxW, barH - inner * 2, 0x4a1818, 1)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(d + 1);

    this._hpBarFill = this.add
      .rectangle(barX + inner, barY + barH / 2, this._hpFillMaxW, barH - inner * 2, 0x43a047, 1)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(d + 2);

    this._hpText = this.add
      .text(barX + barW + 12, barY + barH / 2, "— / —", {
        fontSize: "13px",
        color: "#e8e4f8",
        fontFamily: "monospace",
        stroke: "#0a0610",
        strokeThickness: 3,
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(d + 2);

    const statPadX = 8;
    const statPadY = 6;
    const statBoxX = barX;
    const statBoxY = barY + barH + 4;
    const statBoxW = Math.min(398, PLAYFIELD_W - statBoxX - 10);
    const statBoxH = 46;
    this.add
      .rectangle(statBoxX + statBoxW / 2, statBoxY + statBoxH / 2, statBoxW, statBoxH, 0x0c0814, 0.94)
      .setStrokeStyle(2, 0x4a4080)
      .setScrollFactor(0)
      .setDepth(d + 1);

    this._hudGoldText = this.add
      .text(statBoxX + statPadX, statBoxY + statPadY, "0 g", {
        fontSize: "14px",
        color: "#ffd866",
        fontFamily: "monospace",
        stroke: "#1f1404",
        strokeThickness: 4,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(d + 3);

    this._hudAtkText = this.add
      .text(statBoxX + statPadX + 118, statBoxY + statPadY, "+0 ATK", {
        fontSize: "14px",
        color: "#8fdaff",
        fontFamily: "monospace",
        stroke: "#081018",
        strokeThickness: 4,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(d + 3);

    this._hudDefText = this.add
      .text(statBoxX + statPadX + 228, statBoxY + statPadY, "+0 DEF", {
        fontSize: "14px",
        color: "#c4f0b4",
        fontFamily: "monospace",
        stroke: "#081008",
        strokeThickness: 4,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(d + 3);

    this._hudZoneText = this.add
      .text(PLAYFIELD_W + 12, 10, "", {
        fontSize: "12px",
        color: "#dce4ff",
        fontFamily: "monospace",
        stroke: "#080610",
        strokeThickness: 4,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(d + 3);

    this._hudHintText = this.add
      .text(statBoxX + statPadX, statBoxY + statPadY + 22, "", {
        fontSize: "11px",
        color: "#eef2ff",
        fontFamily: "monospace",
        stroke: "#080612",
        strokeThickness: 5,
        wordWrap: { width: statBoxW - statPadX * 2 },
        lineSpacing: 2,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(d + 3);
  }

  /**
   * Centered ITEMS window: 5×2 grid, Zelda-like flat panels (no external assets).
   */
  createInventoryPanel() {
    if (this._invUiBuilt) return;
    this._invUiBuilt = true;
    const d = INV_MODAL_DEPTH;
    const push = (o) => {
      this._invUiNodes.push(o);
      return o;
    };

    const cx = GAME_W / 2;
    const cy = GAME_H / 2;
    const panelW = 430;
    const panelH = 248;
    const ZFrame = 0x1a4a22;
    const ZCream = 0xe8dcc4;
    const ZInner = 0xd4c4a8;
    const ZInk = "#2a1810";

    push(
      this.add
        .rectangle(cx + 4, cy + 5, panelW + 28, panelH + 28, 0x040806, 0.45)
        .setScrollFactor(0)
        .setDepth(d),
    );

    push(
      this.add
        .rectangle(cx, cy, panelW + 22, panelH + 22, ZCream, 1)
        .setStrokeStyle(5, ZFrame)
        .setScrollFactor(0)
        .setDepth(d + 1),
    );
    push(
      this.add
        .rectangle(cx, cy, panelW + 8, panelH + 8, ZInner, 1)
        .setStrokeStyle(2, 0x4a7a55)
        .setScrollFactor(0)
        .setDepth(d + 2),
    );

    push(
      this.add
        .text(cx, cy - panelH / 2 + 16, "ITEMS", {
          fontSize: "20px",
          color: ZInk,
          fontFamily: "monospace",
          stroke: "#e8dcc4",
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(d + 4),
    );
    push(
      this.add
        .text(cx, cy - panelH / 2 + 38, "Tab · 1–0 select slot · click = use / toggle gear · gold frame = equipped", {
          fontSize: "9px",
          color: "#4a3830",
          fontFamily: "monospace",
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(d + 4),
    );

    const cols = 5;
    const slotSize = 42;
    const gap = 8;
    const gridW = cols * slotSize + (cols - 1) * gap;
    const gridTop = cy - panelH / 2 + 56;
    const startX = cx - gridW / 2 + slotSize / 2;

    this._invSlotBgs = [];
    this._invSlotIcons = [];
    this._invSlotLabels = [];
    this._invSlotQty = [];
    this._invSlotHotkeys = [];
    this._invSlotZones = [];

    for (let i = 0; i < 10; i++) {
      const col = i % cols;
      const row = (i / cols) | 0;
      const sx = startX + col * (slotSize + gap);
      const sy = gridTop + row * (slotSize + gap) + slotSize / 2;

      const bg = this.add
        .rectangle(sx, sy, slotSize, slotSize, ZInner, 1)
        .setStrokeStyle(2, 0x3d6c48)
        .setScrollFactor(0)
        .setDepth(d + 6);

      const icon = this.add
        .image(sx, sy - 7, "px_ui_slot_empty")
        .setScrollFactor(0)
        .setDepth(d + 7)
        .setDisplaySize(34, 34);

      const caption = this.add
        .text(sx, sy + slotSize / 2 - 10, "", {
          fontSize: "8px",
          color: "#3a3028",
          fontFamily: "monospace",
          align: "center",
        })
        .setOrigin(0.5, 0.5)
        .setScrollFactor(0)
        .setDepth(d + 8);

      const lab = i === 9 ? "0" : String(i + 1);
      const hotkey = this.add
        .text(sx - slotSize / 2 + 4, sy - slotSize / 2 + 3, lab, {
          fontSize: "10px",
          color: "#5a4840",
          fontFamily: "monospace",
        })
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(d + 9);

      const qty = this.add
        .text(sx + slotSize / 2 - 4, sy + slotSize / 2 - 5, "", {
          fontSize: "10px",
          color: "#6b1818",
          fontFamily: "monospace",
        })
        .setOrigin(1, 1)
        .setScrollFactor(0)
        .setDepth(d + 9);

      push(bg);
      push(icon);
      push(caption);
      push(hotkey);
      push(qty);
      this._invSlotBgs.push(bg);
      this._invSlotIcons.push(icon);
      this._invSlotLabels.push(caption);
      this._invSlotHotkeys.push(hotkey);
      this._invSlotQty.push(qty);

      const z = this.add
        .zone(sx, sy, slotSize + 8, slotSize + 10)
        .setScrollFactor(0)
        .setDepth(d + 12)
        .setInteractive();
      push(z);
      this._invSlotZones.push(z);
      let armed = false;
      z.on("pointerdown", (p) => {
        p.event?.preventDefault?.();
        armed = true;
        if (this._equipmentPanelOpen) {
          const me = this._selfEntity();
          const cell = me?.inventory?.slots?.[i];
          if (cell && isGearInvType(cell.type)) this._eqDragInvIndex = i;
        }
      });
      z.on("pointerup", () => {
        if (!armed) return;
        armed = false;
        this.onInventorySlotInput(i);
      });
      z.on("pointerout", () => {
        armed = false;
      });
    }

    this.setInventoryPanelVisible(false);
  }

  setInventoryPanelVisible(v) {
    for (const o of this._invUiNodes) {
      if (o && o.setVisible) o.setVisible(v);
    }
  }

  openInventoryPanel() {
    this._inventoryPanelOpen = true;
    this.setInventoryPanelVisible(true);
    this.updateSelectionHighlight();
  }

  closeInventoryPanel() {
    this._inventoryPanelOpen = false;
    this.setInventoryPanelVisible(false);
  }

  toggleInventoryPanel() {
    if (this._inventoryPanelOpen) this.closeInventoryPanel();
    else this.openInventoryPanel();
  }

  updateSelectionHighlight() {
    const me = this._selfEntity();
    const eq = me?.inventory?.equipment || {};
    /** @type {Set<number>} */
    const worn = new Set();
    for (const k of ["weapon", "helmet", "chest", "boots"]) {
      const ix = eq[k];
      if (Number.isInteger(ix)) worn.add(ix);
    }
    const ZInner = 0xd4c4a8;
    for (let i = 0; i < 10; i++) {
      const bg = this._invSlotBgs[i];
      if (!bg) continue;
      const sel = i === this.selectedSlotIndex;
      const onBody = worn.has(i);
      if (sel) {
        bg.setStrokeStyle(4, 0xf0c84a, 1);
        bg.setFillStyle(0xf0e8d8, 1);
      } else if (onBody) {
        bg.setStrokeStyle(3, 0xc9a227, 1);
        bg.setFillStyle(0xe4d8b8, 1);
      } else {
        bg.setStrokeStyle(2, 0x3d6c48, 1);
        bg.setFillStyle(ZInner, 1);
      }
    }
  }

  /**
   * @param {number} i
   * @param {{ fromKeyboard?: boolean }} [opts]
   */
  onInventorySlotInput(i, opts = {}) {
    const fromKeyboard = Boolean(opts.fromKeyboard);
    this.selectedSlotIndex = i;
    this.updateSelectionHighlight();
    if (!this.socket) return;
    if (this._equipmentPanelOpen) {
      this.refreshEquipmentPanel();
      return;
    }
    if (this._inventoryPanelOpen && fromKeyboard) return;
    this.socket.emit("interactSlot", { slot: i });
  }

  /**
   * @param {Phaser.GameObjects.Image} img
   * @param {null | { type: string, qty: number, meta?: any }} s
   */
  applyItemIconImage(img, s) {
    if (!img || !img.setTexture) return;
    img.clearTint();
    if (!s || s.qty < 1) {
      img.setTexture("px_ui_slot_empty");
      img.setAlpha(0.55);
      return;
    }
    img.setAlpha(1);
    img.setTexture(uiItemTextureKey(s.type));
    const r = s.meta?.rarity;
    if (s.type === "weapon" || s.type === "potion") {
      if (r === "rare") img.setTint(0x9cd3ff);
      else if (r === "epic") img.setTint(0xffe08a);
    }
  }

  /**
   * @param {any} me
   * @param {any} snap
   */
  refreshRpgHud(me, snap) {
    const inv = me.inventory || {};
    const slots = inv.slots || [];
    const maxHp = inv.maxHp ?? 100;
    const hp = Math.min(maxHp, Math.max(0, me.hp | 0));
    const ratio = maxHp > 0 ? hp / maxHp : 0;

    if (this._hpBarFill) {
      const rw = Math.max(2, ratio * this._hpFillMaxW);
      this._hpBarFill.setSize(rw, this._hpBarFill.height);
      this._hpBarFill.setFillStyle(hpFillColor(hp, maxHp), 1);
    }
    if (this._hpText) this._hpText.setText(`${hp} / ${maxHp}`);

    const g = me.gold ?? 0;
    const wb = inv.weaponBonus ?? 0;
    const defv = inv.armorDefense ?? 0;
    if (this._hudGoldText) this._hudGoldText.setText(`${g} g`);
    if (this._hudAtkText) this._hudAtkText.setText(`+${wb} ATK`);
    if (this._hudDefText) this._hudDefText.setText(`+${defv} DEF`);

    const zl = snap.zoneLabel || (snap.combatAllowed ? "Wild" : "Town");
    if (this._hudZoneText) this._hudZoneText.setText(String(zl).toUpperCase());

    let hint = "";
    if (snap.combatAllowed) hint = "Move · Space atk · E loot · Tab items · I gear";
    else hint = "Move · E loot · Tab items · I gear";
    if (this.isAdjacentToShopkeeper(snap, me)) {
      hint += " · Shop E/F · menu: ↑↓ Enter · Esc";
    }
    if (this.showTouchUi) hint += " · Touch UI";
    hint += " · Enter: chat";
    if (this._hudHintText) this._hudHintText.setText(hint);

    for (let i = 0; i < 10; i++) {
      const s = slots[i] || null;
      const icon = this._invSlotIcons[i];
      const qty = this._invSlotQty[i];
      const cap = this._invSlotLabels[i];
      if (icon) this.applyItemIconImage(icon, s);
      if (cap) cap.setText(s && s.qty >= 1 ? itemShortName(s.type) : "");
      if (qty) qty.setText(s && s.qty > 1 ? `${s.qty}` : "");
    }
    this.updateSelectionHighlight();
    if (this._equipmentPanelOpen) this.refreshEquipmentPanel();
  }

  /**
   * @param {any} ev
   */
  handleCombatEvent(ev) {
    const dmg = ev?.damage != null ? Number(ev.damage) : 0;

    if (ev?.type === "hitEnemy" && ev.targetId != null) {
      const cont = this.sprites.get(ev.targetId);
      if (cont && dmg > 0) {
        this.spawnWorldDamagePopup(cont.x + TILE / 2, cont.y + 2, `-${dmg}`, "#ffd080", "#3a2010");
      }
      if (cont) {
        if (ev.killed) {
          this.runEnemyDeathFade(cont, ev.targetId);
        } else {
          const me = this._lastSnap?.entities?.find((e) => e.id === this.selfId && e.kind === "player");
          const tgt = this._lastSnap?.entities?.find((e) => e.id === ev.targetId);
          let dx = 0;
          let dy = 0;
          if (me && tgt) {
            dx = Math.sign(tgt.x - me.x);
            dy = Math.sign(tgt.y - me.y);
            if (dx !== 0 && dy !== 0) {
              if (Math.abs(tgt.x - me.x) >= Math.abs(tgt.y - me.y)) dy = 0;
              else dx = 0;
            }
          }
          this.runEnemyHitVfx(cont, dx, dy);
        }
      }
    }

    if (ev?.type === "hitPlayer" && dmg > 0) {
      if (ev.targetId === this.selfId) {
        this.spawnHudDamagePopup(`-${dmg}`);
      } else {
        const cont = this.sprites.get(ev.targetId);
        if (cont) {
          const wx = cont.x + TILE / 2;
          const wy = cont.y + 2;
          this.spawnWorldDamagePopup(wx, wy, `-${dmg}`, "#ff7070", "#301010");
        }
      }
    }

    if (ev?.type === "hitPlayer" && ev.targetId === this.selfId) {
      const cont = this.sprites.get(this.selfId);
      if (cont) this.runPlayerHurtVfx(cont);
    }

    if (ev?.type === "enemyHitPlayer" && this.selfDbId != null && ev.targetDbId === this.selfDbId) {
      const d = dmg > 0 ? dmg : 5;
      this.spawnHudDamagePopup(`-${d}`);
      const cont = this.sprites.get(this.selfId);
      if (cont) this.runPlayerHurtVfx(cont);
    }
  }

  /**
   * @param {Phaser.GameObjects.Image} img
   * @param {number} ms
   */
  setImgVfxLock(img, ms) {
    if (!img) return;
    img.setData("vfxLock", true);
    this.time.delayedCall(ms, () => {
      img.setData("vfxLock", false);
    });
  }

  runPlayerAttackVfx() {
    const cont = this.selfId != null ? this.sprites.get(this.selfId) : null;
    if (!cont) return;
    const img = cont.getData("img");
    if (!img) return;

    const me = this._selfEntity();
    const target = this.findAdjacentEnemy();
    let ang = -Math.PI / 2;
    if (me && target) {
      const dx = target.x - me.x;
      const dy = target.y - me.y;
      if (dx === 1) ang = 0;
      else if (dx === -1) ang = Math.PI;
      else if (dy === 1) ang = Math.PI / 2;
      else if (dy === -1) ang = -Math.PI / 2;
    }

    const slash = this.add.rectangle(cont.x, cont.y, 40, 11, 0xfff5e0, 0.95);
    slash.setStrokeStyle(1, 0xffffff, 0.85);
    slash.setRotation(ang);
    slash.setDepth(48);
    this.tweens.add({
      targets: slash,
      alpha: 0,
      scaleX: 1.85,
      scaleY: 0.45,
      duration: 100,
      ease: "Cubic.easeOut",
      onComplete: () => slash.destroy(),
    });

    this.tweens.killTweensOf(cont);
    this.tweens.killTweensOf(img);
    this.setImgVfxLock(img, 240);
    cont.setScale(1);
    img.setPosition(TILE / 2, TILE / 2);
    img.setScale(1);
    img.setAlpha(1);
    img.setTint(0xffffff);

    this.tweens.add({
      targets: cont,
      scaleX: { from: 1, to: 1.16 },
      scaleY: { from: 1, to: 1.16 },
      duration: 52,
      ease: "Quad.easeOut",
      yoyo: true,
      onComplete: () => cont.setScale(1),
    });

    this.tweens.add({
      targets: img,
      scaleX: { from: 1, to: 1.12 },
      scaleY: { from: 1, to: 1.12 },
      duration: 48,
      ease: "Quad.easeOut",
      yoyo: true,
      onComplete: () => {
        img.setScale(1);
        img.clearTint();
        img.setAlpha(1);
      },
    });
  }

  /**
   * @param {Phaser.GameObjects.Container} cont
   * @param {number} gridDx
   * @param {number} gridDy
   */
  runEnemyHitVfx(cont, gridDx, gridDy) {
    const img = cont.getData("img");
    if (!img) return;

    const ox = TILE / 2;
    const oy = TILE / 2;
    const kx = gridDx * 9;
    const ky = gridDy * 9;

    this.tweens.killTweensOf(cont);
    this.tweens.killTweensOf(img);
    this.setImgVfxLock(img, 240);
    cont.setScale(1);
    img.setPosition(ox, oy);
    img.setScale(1);
    img.setAlpha(1);
    img.setTint(0xff2020);

    this.tweens.add({
      targets: cont,
      scaleX: { from: 1, to: 1.22 },
      scaleY: { from: 1, to: 1.22 },
      duration: 70,
      ease: "Quad.easeOut",
      yoyo: true,
      onComplete: () => cont.setScale(1),
    });

    this.tweens.add({
      targets: img,
      x: ox + kx,
      y: oy + ky,
      alpha: { from: 1, to: 0.38 },
      duration: 65,
      ease: "Quad.easeOut",
      yoyo: true,
      onYoyo: () => {
        img.setTint(0xff6b6b);
      },
      onComplete: () => {
        img.setPosition(ox, oy);
        img.clearTint();
        img.setScale(1);
        img.setAlpha(1);
      },
    });
  }

  /**
   * @param {Phaser.GameObjects.Container} cont
   */
  runPlayerHurtVfx(cont) {
    const img = cont.getData("img");
    if (!img) return;

    this.tweens.killTweensOf(cont);
    this.tweens.killTweensOf(img);
    this.setImgVfxLock(img, 420);
    cont.setScale(1);
    img.setPosition(TILE / 2, TILE / 2);
    img.setAlpha(1);
    img.setTint(0xff1515);

    this.tweens.add({
      targets: cont,
      scaleX: { from: 1, to: 0.9 },
      scaleY: { from: 1, to: 0.9 },
      duration: 70,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: 1,
      onComplete: () => cont.setScale(1),
    });

    this.tweens.add({
      targets: img,
      scaleX: { from: 1, to: 0.82 },
      scaleY: { from: 1, to: 0.82 },
      alpha: { from: 1, to: 0.35 },
      duration: 75,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: 1,
      onYoyo: () => {
        img.setTint(0xff5555);
      },
      onComplete: () => {
        img.setScale(1);
        img.setAlpha(1);
        img.clearTint();
      },
    });
  }

  /**
   * @param {Phaser.GameObjects.Container} cont
   * @param {number} id
   */
  runEnemyDeathFade(cont, id) {
    if (cont.getData("dying")) return;
    cont.setData("dying", true);
    this._enemyDeathFadeActive.add(id);
    const img = cont.getData("img");
    const label = cont.getData("label");
    if (img) {
      this.tweens.killTweensOf(img);
      img.setData("vfxLock", true);
      img.setTint(0xdd2222);
      img.setAlpha(1);
      img.setPosition(TILE / 2, TILE / 2);
      img.setScale(1);
    }
    if (label) {
      this.tweens.killTweensOf(label);
      label.setAlpha(1);
    }
    this.tweens.killTweensOf(cont);
    cont.setAlpha(1);
    cont.setScale(1);
    this.tweens.add({
      targets: cont,
      alpha: 0,
      scaleX: 0.82,
      scaleY: 0.82,
      duration: 480,
      ease: "Cubic.easeIn",
      onComplete: () => {
        this._enemyDeathFadeActive.delete(id);
        if (this.sprites.get(id) === cont) this.sprites.delete(id);
        cont.destroy();
      },
    });
  }

  clearEntitySprites() {
    this._enemyDeathFadeActive.clear();
    for (const spr of this.sprites.values()) spr.destroy();
    this.sprites.clear();
  }

  clearTileLayer() {
    if (this._tileImgs) {
      for (const im of this._tileImgs) im.destroy();
      this._tileImgs = null;
    }
    this._tileCacheKey = null;
  }

  renderTiles() {
    if (!this.mapData?.tiles?.length || !this.currentMapId) return;
    const tiles = this.mapData.tiles;
    const w = tiles[0].length;
    const h = tiles.length;
    let sig = 0;
    for (let yy = 0; yy < h; yy++) {
      const row = tiles[yy];
      for (let xx = 0; xx < w; xx++) sig = (sig * 33 + (row[xx] | 0)) | 0;
    }
    const cacheKey = `${this.currentMapId}:${w}x${h}:${sig}`;
    if (this._tileCacheKey === cacheKey && this._tileImgs?.length) return;

    this.clearTileLayer();
    this._tileCacheKey = cacheKey;
    this._tileImgs = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = tiles[y][x];
        const cx = x * TILE + TILE / 2;
        const cy = y * TILE + TILE / 2;
        if (v === T_TREE || v === T_ROCK) {
          const baseTex = textureForTerrainTile(inferUnderlayTerrain(tiles, x, y, w, h));
          const baseIm = this.add.image(cx, cy, baseTex);
          baseIm.setDisplaySize(TILE, TILE);
          baseIm.setDepth(-200);
          this._tileImgs.push(baseIm);
          const overTex = v === T_TREE ? "px_tile_tree" : "px_tile_rock";
          const overIm = this.add.image(cx, cy, overTex);
          overIm.setDisplaySize(TILE, TILE);
          overIm.setDepth(-199);
          this._tileImgs.push(overIm);
        } else {
          const tex = textureForTerrainTile(v);
          const im = this.add.image(cx, cy, tex);
          im.setDisplaySize(TILE, TILE);
          im.setDepth(-200);
          this._tileImgs.push(im);
        }
      }
    }
  }

  textureKeyFor(ent) {
    if (ent.kind === "player") {
      return ent.id === this.selfId ? "px_player_self" : "px_player_other";
    }
    if (ent.kind === "npc") {
      return "px_npc_shop";
    }
    if (ent.kind === "enemy") {
      switch (ent.enemyType) {
        case "slime":
          return "px_enemy_slime";
        case "skeleton":
          return "px_enemy_skeleton";
        case "zombie":
          return "px_enemy_zombie";
        case "demon":
          return "px_enemy_demon";
        default:
          return "px_enemy_skeleton";
      }
    }
    return "px_item_coin";
  }

  applyState(snap) {
    if (!snap?.mapId) return;
    if (this.currentMapId != null && snap.mapId !== this.currentMapId) {
      this.runMapTransition(snap);
      return;
    }
    this.mergeState(snap);
  }

  runMapTransition(snap) {
    if (!snap?.mapId) return;
    const cam = this.cameras?.main;
    if (!cam) {
      this.mergeState(snap);
      return;
    }

    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.clearEntitySprites();
      this.clearTileLayer();
      this.mergeState(snap);
      cam.fadeIn(50, 0, 0, 0);
    });
    cam.fadeOut(40, 0, 0, 0);
  }

  mergeState(snap) {
    const prevMap = this.currentMapId;
    this._lastSnap = snap;
    this.currentMapId = snap.mapId;
    if (prevMap != null && snap.mapId !== prevMap) {
      this._chatLines = [];
      if (this._chatLogText) this._chatLogText.setText("");
    }
    this.mapData = snap.map;
    this.renderTiles();
    if (!snap.entities) {
      this._syncCameraLayers();
      this._tryDismissLoadHintAfterMerge();
      return;
    }

    const seen = new Set();
    for (const ent of snap.entities) {
      seen.add(ent.id);
      let spr = this.sprites.get(ent.id);
      if (!spr) {
        spr = this.makeSprite(ent);
        this.sprites.set(ent.id, spr);
      } else {
        this.updateSprite(spr, ent);
      }
    }

    for (const [id, spr] of this.sprites) {
      if (!seen.has(id)) {
        if (this._enemyDeathFadeActive.has(id)) continue;
        spr.destroy();
        this.sprites.delete(id);
      }
    }

    const me = snap.entities.find((e) => e.id === this.selfId && e.kind === "player");
    if (me) {
      if (
        this._shopPopupOpen &&
        (snap.mapId !== "town" || !this.isAdjacentToShopkeeper(snap, me))
      ) {
        this.closeShopPopup();
      }
      this.refreshRpgHud(me, snap);
    }
    this._syncCameraLayers();
    if (this._shopPopupOpen) this.refreshShopMenuLayout();
    if (this._equipmentPanelOpen) this.refreshEquipmentPanel();
    if (this._inventoryPanelOpen) this.updateSelectionHighlight();
    this._tryDismissLoadHintAfterMerge();
  }

  makeSprite(ent) {
    const cont = this.add.container(ent.x * TILE, ent.y * TILE);
    const key = this.textureKeyFor(ent);
    /** @type {Phaser.GameObjects.Image} */
    const img = this.add.image(TILE / 2, TILE / 2, key);
    img.setDisplaySize(28, 28);

    const label = this.add.text(Math.floor(TILE / 2), -2, "", {
      fontSize: "8px",
      color: "#f5f0e6",
      fontFamily: "monospace",
      stroke: "#1a1020",
      strokeThickness: 2,
    });
    label.setOrigin(0.5, 1);

    /** @type {Phaser.GameObjects.Rectangle | null} */
    let hpBg = null;
    /** @type {Phaser.GameObjects.Rectangle | null} */
    let hpFill = null;
    if (ent.kind === "player" || ent.kind === "enemy") {
      const bx = TILE / 2;
      const by = OVERHEAD_HP_BAR_Y;
      const bw = OVERHEAD_HP_BAR_W;
      const bh = OVERHEAD_HP_BAR_H;
      hpBg = this.add.rectangle(bx, by, bw, bh, 0x1a141c, 1).setOrigin(0.5);
      hpBg.setStrokeStyle(1, 0x2e2838, 1);
      hpFill = this.add
        .rectangle(bx - bw / 2 + 1, by, bw - 2, bh - 2, 0x43a047, 1)
        .setOrigin(0, 0.5);
      cont.add([hpBg, hpFill, img, label]);
      cont.setData("hpBg", hpBg);
      cont.setData("hpFill", hpFill);
    } else {
      cont.add([img, label]);
    }

    img.setTexture(key);
    cont.setData("img", img);
    cont.setData("label", label);
    this.updateSprite(cont, ent);
    return cont;
  }

  /**
   * @param {Phaser.GameObjects.Container} cont
   * @param {any} ent
   */
  _updateEntityHpBar(cont, ent) {
    const hpBg = cont.getData("hpBg");
    const hpFill = cont.getData("hpFill");
    if (!hpBg || !hpFill || (ent.kind !== "player" && ent.kind !== "enemy")) return;
    if (ent.kind === "enemy" && cont.getData("dying")) {
      hpBg.setVisible(false);
      hpFill.setVisible(false);
      return;
    }
    hpBg.setVisible(true);
    hpFill.setVisible(true);
    const maxHp =
      ent.kind === "player"
        ? ent.inventory?.maxHp ?? 100
        : Math.max(1, ent.maxHp ?? ent.hp ?? 1);
    const hp = Math.max(0, ent.hp | 0);
    const ratio = maxHp > 0 ? Phaser.Math.Clamp(hp / maxHp, 0, 1) : 0;
    const bw = OVERHEAD_HP_BAR_W;
    const bh = OVERHEAD_HP_BAR_H;
    const innerW = Math.max(0, ratio * (bw - 2));
    hpFill.setSize(innerW, bh - 2);
    hpFill.setFillStyle(hpFillColor(hp, maxHp), 1);
  }

  /** Incoming damage — fixed near HUD HP bar. */
  spawnHudDamagePopup(text) {
    const t = this.add
      .text(HUD_HP_BAR_X + HUD_HP_BAR_W + 8, HUD_HP_BAR_Y + HUD_HP_BAR_H / 2, text, {
        fontSize: "16px",
        color: "#ff5c5c",
        fontFamily: "monospace",
        stroke: "#180404",
        strokeThickness: 4,
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(1680);
    this.tweens.add({
      targets: t,
      alpha: 0,
      x: t.x + 14,
      duration: 640,
      ease: "Cubic.easeOut",
      onComplete: () => t.destroy(),
    });
    this._syncCameraLayers();
  }

  /** Outgoing / ambient combat numbers in world space (scrolls with the map). */
  spawnWorldDamagePopup(wx, wy, text, color, stroke = "#1a1010") {
    const t = this.add
      .text(wx, wy, text, {
        fontSize: "14px",
        color,
        fontFamily: "monospace",
        stroke,
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(125);
    this.tweens.add({
      targets: t,
      alpha: 0,
      y: wy - 26,
      duration: 560,
      ease: "Cubic.easeOut",
      onComplete: () => t.destroy(),
    });
    this._syncCameraLayers();
  }

  updateSprite(cont, ent) {
    const img = cont.getData("img");
    const label = cont.getData("label");
    cont.setPosition(ent.x * TILE, ent.y * TILE);

    const key = this.textureKeyFor(ent);
    if (img.texture.key !== key) {
      img.setTexture(key);
    }

    const vfxLock = img.getData("vfxLock");
    if (!vfxLock) {
      img.setPosition(TILE / 2, TILE / 2);
      img.setScale(1);
      if (ent.kind === "player" || ent.kind === "enemy") cont.setScale(1);
    }

    this._updateEntityHpBar(cont, ent);

    if (ent.kind === "player") {
      cont.setDepth(30);
      if (!vfxLock) {
        img.setAlpha(1);
        img.setTint(0xffffff);
      }
      label.setText(this.shortName(ent.name, 8));
    } else if (ent.kind === "npc") {
      cont.setDepth(25);
      if (!vfxLock) {
        img.setAlpha(1);
        img.clearTint();
      }
      label.setText(ent.npcType === "shopkeeper" ? "shop" : ent.name || "npc");
    } else if (ent.kind === "enemy") {
      if (cont.getData("dying")) return;
      cont.setDepth(20);
      const dead = ent.hp <= 0;
      if (!vfxLock) {
        img.setAlpha(dead ? 0.35 : 1);
        img.setTint(dead ? 0x888888 : 0xffffff);
      }
      label.setText(
        ent.enemyType === "slime"
          ? "slime"
          : ent.enemyType === "skeleton"
            ? "skel"
            : ent.enemyType === "zombie"
              ? "zombie"
              : ent.enemyType === "demon"
                ? "demon"
                : "foe",
      );
    } else if (ent.kind === "item") {
      cont.setDepth(10);
      img.setAlpha(1);
      const rarity = ent.meta?.rarity;
      if (ent.itemType === "bread") {
        img.setTint(0xd49a5c);
      } else if (ent.itemType === "potion") {
        img.setTint(rarity === "epic" ? 0xcc88ff : rarity === "rare" ? 0x55dd99 : 0x44cc77);
      } else if (ent.itemType === "weapon") {
        img.setTint(rarity === "epic" ? 0xffcc66 : rarity === "rare" ? 0xaaccff : 0x99aadd);
      } else if (ent.itemType === "armor_helmet") {
        img.setTint(0xc4b090);
      } else if (ent.itemType === "armor_chest") {
        img.setTint(0x9888bb);
      } else if (ent.itemType === "armor_boots") {
        img.setTint(0x8899aa);
      } else {
        img.clearTint();
      }
      let short = ent.itemType || "";
      if (short === "armor_helmet") short = "helm";
      else if (short === "armor_chest") short = "body";
      else if (short === "armor_boots") short = "boot";
      const tag =
        rarity === "epic" ? "[E]" : rarity === "rare" ? "[R]" : rarity === "common" ? "[C]" : "";
      label.setText(tag ? `${tag}${short}` : short);
    }
  }

  shortName(name, max) {
    const s = String(name || "?");
    return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
  }

  /**
   * @param {any} me
   * @returns {number[]}
   */
  collectSellableSlots(me) {
    const slots = me?.inventory?.slots || [];
    const out = [];
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s || s.qty < 1) continue;
      if (shopSellUnitGold(s) > 0) out.push(i);
    }
    return out;
  }

  refreshShopMenuLayout() {
    if (!this._shopLineTexts?.length) return;
    const me = this._selfEntity();
    /** @type {string[]} */
    const labels = [];
    const mode = this._shopPanelMode;
    if (mode === "main") {
      labels.push("Buy", "Sell", "Close");
    } else if (mode === "buy") {
      labels.push(`Potion  —  ${SHOP_POTION_PRICE}g`, `Weapon  —  ${SHOP_WEAPON_PRICE}g`, "Back");
    } else {
      const slotIdxs = this.collectSellableSlots(me);
      this._shopSellSlotIndices = slotIdxs;
      if (slotIdxs.length === 0) {
        labels.push("(nothing to sell)", "Back");
      } else {
        for (const si of slotIdxs) {
          const s = me.inventory.slots[si];
          const u = shopSellUnitGold(s);
          labels.push(`Slot ${si + 1}: ${s.type} x${s.qty}  (+${u}g ea)`);
        }
        labels.push("Back");
      }
    }

    const n = labels.length;
    this._shopMenuLineCount = n;
    if (this._shopMenuIndex >= n) this._shopMenuIndex = Math.max(0, n - 1);

    const lineBaseY = GAME_H / 2 - 264 / 2 + 76;
    const lineStep = 26;
    const cx = GAME_W / 2;

    for (let i = 0; i < SHOP_MENU_LINES; i++) {
      const t = this._shopLineTexts[i];
      const z = this._shopLineZones[i];
      if (i < n) {
        const sel = i === this._shopMenuIndex;
        const mark = sel ? "\u203a " : "  ";
        t.setText(mark + labels[i]);
        t.setColor(sel ? "#e8c547" : "#c4c0d8");
        t.setY(lineBaseY + i * lineStep);
        z.setY(lineBaseY + i * lineStep);
        t.setVisible(true);
        z.setVisible(true);
        if (z.input) z.input.enabled = true;
      } else {
        t.setVisible(false);
        z.setVisible(false);
        if (z.input) z.input.enabled = false;
      }
    }

    if (this._shopInstructionText) {
      let sub = "↑↓ choose · Enter confirm";
      if (mode !== "main") sub += " · Esc: back";
      else sub += " · Esc: close";
      this._shopInstructionText.setText(sub);
      this._shopInstructionText.setY(GAME_H / 2 - 264 / 2 + 54);
      this._shopInstructionText.setX(cx);
    }
  }

  shopMenuConfirm() {
    if (!this.socket?.connected || !this._shopPopupOpen) return;
    const mode = this._shopPanelMode;
    const idx = this._shopMenuIndex;
    if (mode === "main") {
      if (idx === 0) {
        this._shopPanelMode = "buy";
        this._shopMenuIndex = 0;
      } else if (idx === 1) {
        this._shopPanelMode = "sell";
        this._shopMenuIndex = 0;
      } else {
        this.closeShopPopup();
        return;
      }
      this.refreshShopMenuLayout();
      return;
    }
    if (mode === "buy") {
      if (idx === 0) this.requestShopBuy("potion");
      else if (idx === 1) this.requestShopBuy("weapon");
      else {
        this._shopPanelMode = "main";
        this._shopMenuIndex = 0;
      }
      this.refreshShopMenuLayout();
      return;
    }
    const slots = this._shopSellSlotIndices;
    if (slots.length === 0) {
      if (idx === 1) {
        this._shopPanelMode = "main";
        this._shopMenuIndex = 0;
      }
      this.refreshShopMenuLayout();
      return;
    }
    if (idx < slots.length) {
      this.socket.emit("shop", { action: "sell", slot: slots[idx] });
    } else {
      this._shopPanelMode = "main";
      this._shopMenuIndex = 0;
    }
    this.refreshShopMenuLayout();
  }

  buildShopPopup() {
    if (this._shopUiBuilt) return;
    const d = SHOP_UI_DEPTH;
    /** @type {Phaser.GameObjects.GameObject[]} */
    const nodes = [];
    const add = (/** @type {Phaser.GameObjects.GameObject} */ o) => {
      o.setScrollFactor(0).setDepth(d);
      nodes.push(o);
      return o;
    };

    this._shopLineTexts = [];
    this._shopLineZones = [];

    const cx = GAME_W / 2;
    const cy = GAME_H / 2;
    const pw = 344;
    const ph = 264;

    const overlay = add(
      this.add
        .rectangle(cx, cy, GAME_W + 4, GAME_H + 4, 0x06040c, 0.58)
        .setInteractive(),
    );
    overlay.on("pointerdown", (p) => {
      p.event?.preventDefault?.();
    });

    add(this.add.rectangle(cx, cy, pw + 10, ph + 10, 0x3a3650, 1).setStrokeStyle(2, 0x9a92b8));
    add(this.add.rectangle(cx, cy, pw + 4, ph + 4, 0x201c2c, 1).setStrokeStyle(1, 0x524868));
    add(this.add.rectangle(cx, cy, pw, ph, 0x14111c, 1).setStrokeStyle(2, 0x5a5470));

    add(
      this.add
        .text(cx, cy - ph / 2 + 28, "Shop", {
          fontSize: "20px",
          color: "#eee8ff",
          fontFamily: "monospace",
        })
        .setOrigin(0.5),
    );

    this._shopInstructionText = add(
      this.add
        .text(cx, cy - ph / 2 + 54, "", {
          fontSize: "11px",
          color: "#7a7690",
          fontFamily: "monospace",
        })
        .setOrigin(0.5),
    );

    const lineW = 300;
    const lineH = 24;
    const lineBaseY = cy - ph / 2 + 76;
    const lineStep = 26;

    for (let i = 0; i < SHOP_MENU_LINES; i++) {
      const y = lineBaseY + i * lineStep;
      const t = add(
        this.add
          .text(cx - lineW / 2 + 8, y, "", {
            fontSize: "14px",
            color: "#c4c0d8",
            fontFamily: "monospace",
          })
          .setOrigin(0, 0.5),
      );
      this._shopLineTexts.push(t);
      const zi = i;
      const z = add(this.add.zone(cx, y, lineW + 20, lineH + 10).setInteractive());
      let armed = false;
      z.on("pointerdown", (p) => {
        p.event?.preventDefault?.();
        armed = true;
      });
      z.on("pointerup", () => {
        if (!armed || !this._shopPopupOpen) return;
        armed = false;
        this._shopMenuIndex = zi;
        this.refreshShopMenuLayout();
        this.shopMenuConfirm();
      });
      z.on("pointerout", () => {
        armed = false;
      });
      this._shopLineZones.push(z);
    }

    this._shopUiNodes = nodes;
    for (const o of this._shopUiNodes) o.setVisible(false);
    this._shopUiBuilt = true;
    this._syncCameraLayers();
  }

  openShopPopup() {
    const me = this._selfEntity();
    if (!me || !this.isAdjacentToShopkeeper(this._lastSnap, me)) return;
    if (this._inventoryPanelOpen) this.closeInventoryPanel();
    if (this._equipmentPanelOpen) this.closeEquipmentPanel();
    this.buildShopPopup();
    this._shopPopupOpen = true;
    this._shopPanelMode = "main";
    this._shopMenuIndex = 0;
    for (const o of this._shopUiNodes) o.setVisible(true);
    this.refreshShopMenuLayout();
    this._padHeld.up = this._padHeld.down = this._padHeld.left = this._padHeld.right = false;
  }

  closeShopPopup() {
    this._shopPopupOpen = false;
    this._shopPanelMode = "main";
    this._shopMenuIndex = 0;
    if (this._shopUiNodes) for (const o of this._shopUiNodes) o.setVisible(false);
  }

  /** @param {"potion" | "weapon"} item */
  requestShopBuy(item) {
    if (!this.socket || !this._shopPopupOpen) return;
    this.socket.emit("shop", { action: "buy", item });
  }

  createTouchUi() {
    const depth = TOUCH_DEPTH;
    const padHeld = this._padHeld;

    const addNode = (o) => {
      this._touchUiNodes.push(o);
      return o;
    };

    const mkPad = (x, y, dir, label) => {
      const w = 46;
      const h = 46;
      addNode(
        this.add
          .rectangle(x, y, w, h, 0x14121c, 0.88)
          .setStrokeStyle(2, 0x3d6a8c)
          .setScrollFactor(0)
          .setDepth(depth - 1),
      );
      addNode(
        this.add
          .text(x, y, label, { fontSize: "20px", color: "#c8e8ff", fontFamily: "monospace" })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setDepth(depth),
      );
      const z = addNode(
        this.add.zone(x, y, w + 6, h + 6).setScrollFactor(0).setDepth(depth + 1).setInteractive(),
      );
      z.on("pointerdown", (p) => {
        p.event?.preventDefault?.();
        if (dir === "up") padHeld.up = true;
        if (dir === "down") padHeld.down = true;
        if (dir === "left") padHeld.left = true;
        if (dir === "right") padHeld.right = true;
      });
      z.on("pointerup", () => {
        if (dir === "up") padHeld.up = false;
        if (dir === "down") padHeld.down = false;
        if (dir === "left") padHeld.left = false;
        if (dir === "right") padHeld.right = false;
      });
      z.on("pointerout", () => {
        if (dir === "up") padHeld.up = false;
        if (dir === "down") padHeld.down = false;
        if (dir === "left") padHeld.left = false;
        if (dir === "right") padHeld.right = false;
      });
    };

    const padCy = INV_PANEL_TOP - 102;
    const cx = 74;
    const cy = padCy;
    const step = 52;
    mkPad(cx, cy - step, "up", "↑");
    mkPad(cx, cy + step, "down", "↓");
    mkPad(cx - step, cy, "left", "←");
    mkPad(cx + step, cy, "right", "→");

    addNode(
      this.add
        .text(cx, cy - step - 22, "MOVE", {
          fontSize: "9px",
          color: "#5c7a90",
          fontFamily: "monospace",
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(depth),
    );

    const mkAction = (x, y, w, h, label, sub, stroke, fill, onRelease) => {
      addNode(
        this.add
          .rectangle(x, y, w, h, fill, 0.9)
          .setStrokeStyle(2, stroke)
          .setScrollFactor(0)
          .setDepth(depth - 1),
      );
      addNode(
        this.add
          .text(x, y - (sub ? 6 : 0), label, {
            fontSize: "11px",
            color: "#f0ecff",
            fontFamily: "monospace",
          })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setDepth(depth),
      );
      if (sub) {
        addNode(
          this.add
            .text(x, y + 8, sub, {
              fontSize: "8px",
              color: "#7d7895",
              fontFamily: "monospace",
            })
            .setOrigin(0.5)
            .setScrollFactor(0)
            .setDepth(depth),
        );
      }
      const z = addNode(
        this.add.zone(x, y, w + 8, h + 8).setScrollFactor(0).setDepth(depth + 1).setInteractive(),
      );
      let armed = false;
      z.on("pointerdown", (p) => {
        p.event?.preventDefault?.();
        armed = true;
      });
      z.on("pointerup", () => {
        if (armed) onRelease();
        armed = false;
      });
      z.on("pointerout", () => {
        armed = false;
      });
    };

    const rx = this.showTouchUi ? 728 : 798;
    addNode(
      this.add
        .rectangle(rx, 332, 88, 208, 0x040308, 0.45)
        .setStrokeStyle(1, 0x2a2838)
        .setScrollFactor(0)
        .setDepth(depth - 2),
    );
    addNode(
      this.add
        .text(rx, 208, "ACTIONS", {
          fontSize: "9px",
          color: "#5c586e",
          fontFamily: "monospace",
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(depth),
    );

    mkAction(rx, 252, 84, 30, "LOOT", "pick up", 0x4a6d8c, 0x151822, () => this.socket?.emit("pickup"));
    mkAction(rx, 292, 84, 30, "ATK", "melee", 0xd4a03a, 0x201610, () => {
      if (this._lastSnap?.combatAllowed === false) return;
      const target = this.findAdjacentEnemy();
      if (target && this.socket) {
        this.runPlayerAttackVfx();
        this.socket.emit("attack", { targetId: target.id });
      }
    });
    mkAction(rx, 332, 84, 30, "SHOP", "near NPC", 0x6b5a8c, 0x151020, () => {
      const me = this._selfEntity();
      if (me && this.isAdjacentToShopkeeper(this._lastSnap, me)) {
        this.openShopPopup();
      }
    });
    mkAction(rx, 372, 84, 30, "ITEMS", "bag Tab", 0x3d6a48, 0x101812, () => {
      if (!this._shopPopupOpen) this.toggleInventoryPanel();
    });
    mkAction(rx, 412, 84, 30, "CHAT", "message", 0x4a8c62, 0x101812, () => {
      if (!this._shopPopupOpen) this.openChatInput();
    });
  }

  touchMovementDir() {
    if (
      this._shopPopupOpen ||
      this._equipmentPanelOpen ||
      this._inventoryPanelOpen ||
      this._chatInputOpen
    ) {
      return null;
    }
    if (!this.showTouchUi) return null;
    const p = this._padHeld;
    if (p.up) return "up";
    if (p.down) return "down";
    if (p.left) return "left";
    if (p.right) return "right";
    return null;
  }

  update(time) {
    if (!this.socket?.connected) return;

    this._updateWorldCameraScroll();

    if (Phaser.Input.Keyboard.JustDown(this.keyEsc)) {
      if (this._chatInputOpen && this._chatInputEl) {
        this._chatInputEl.value = "";
        this._chatInputEl.style.display = "none";
        this._chatInputOpen = false;
        this._chatInputEl.blur();
        this._chatEnterSuppressUntil = performance.now() + 200;
      } else if (this._equipmentPanelOpen) {
        this.closeEquipmentPanel();
      } else if (this._inventoryPanelOpen) {
        this.closeInventoryPanel();
      } else if (this._shopPopupOpen) {
        if (this._shopPanelMode !== "main") {
          this._shopPanelMode = "main";
          this._shopMenuIndex = 0;
          this.refreshShopMenuLayout();
        } else {
          this.closeShopPopup();
        }
      }
    }

    if (Phaser.Input.Keyboard.JustDown(this.keyInvPanel)) {
      if (this._chatInputOpen) return;
      if (this._shopPopupOpen) return;
      this.toggleInventoryPanel();
    }

    if (Phaser.Input.Keyboard.JustDown(this.keyEquipPanel)) {
      if (this._chatInputOpen) return;
      if (this._shopPopupOpen) return;
      this.toggleEquipmentPanel();
    }

    if (this._shopPopupOpen && !this._chatInputOpen) {
      const n = this._shopMenuLineCount;
      if (n > 0) {
        if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) {
          this._shopMenuIndex = (this._shopMenuIndex - 1 + n) % n;
          this.refreshShopMenuLayout();
        } else if (Phaser.Input.Keyboard.JustDown(this.cursors.down)) {
          this._shopMenuIndex = (this._shopMenuIndex + 1) % n;
          this.refreshShopMenuLayout();
        }
      }
    }

    if (Phaser.Input.Keyboard.JustDown(this.keyEnter)) {
      if (performance.now() < this._chatEnterSuppressUntil) return;
      if (this._chatInputOpen || document.activeElement === this._chatInputEl) return;
      if (this._shopPopupOpen) {
        this.shopMenuConfirm();
        return;
      }
      if (this._equipmentPanelOpen || this._inventoryPanelOpen) return;
      this.openChatInput();
      return;
    }

    let dir = null;
    if (
      !this._shopPopupOpen &&
      !this._equipmentPanelOpen &&
      !this._inventoryPanelOpen &&
      !this._chatInputOpen
    ) {
      if (this.cursors.left.isDown) dir = "left";
      else if (this.cursors.right.isDown) dir = "right";
      else if (this.cursors.up.isDown) dir = "up";
      else if (this.cursors.down.isDown) dir = "down";
      if (!dir) dir = this.touchMovementDir();
    }

    if (
      !this._shopPopupOpen &&
      !this._equipmentPanelOpen &&
      !this._inventoryPanelOpen &&
      !this._chatInputOpen &&
      dir &&
      time - this.lastMoveSent > 110
    ) {
      this.socket.emit("move", { dir });
      this.lastMoveSent = time;
    }

    if (Phaser.Input.Keyboard.JustDown(this.keyPickup)) {
      if (
        this._shopPopupOpen ||
        this._equipmentPanelOpen ||
        this._inventoryPanelOpen ||
        this._chatInputOpen
      ) {
        return;
      }
      const me = this._selfEntity();
      if (me && this.isAdjacentToShopkeeper(this._lastSnap, me)) {
        this.openShopPopup();
        return;
      }
      this.socket.emit("pickup");
    }

    if (Phaser.Input.Keyboard.JustDown(this.keyShopBuy)) {
      if (
        this._shopPopupOpen ||
        this._equipmentPanelOpen ||
        this._inventoryPanelOpen ||
        this._chatInputOpen
      ) {
        return;
      }
      const me = this._selfEntity();
      if (me && this.isAdjacentToShopkeeper(this._lastSnap, me)) {
        this.openShopPopup();
      }
    }

    const allowAtk = this._lastSnap?.combatAllowed !== false;
    if (
      allowAtk &&
      !this._chatInputOpen &&
      !this._equipmentPanelOpen &&
      !this._inventoryPanelOpen &&
      Phaser.Input.Keyboard.JustDown(this.keyAttack)
    ) {
      const target = this.findAdjacentEnemy();
      if (target) {
        this.runPlayerAttackVfx();
        this.socket.emit("attack", { targetId: target.id });
      }
    }

    if (this.slotKeys && !this._chatInputOpen && !this._shopPopupOpen) {
      for (let i = 0; i < this.slotKeys.length; i++) {
        if (Phaser.Input.Keyboard.JustDown(this.slotKeys[i])) {
          this.onInventorySlotInput(i, { fromKeyboard: this._inventoryPanelOpen });
          break;
        }
      }
    }
  }

  createEquipmentPanel() {
    if (this._eqUiBuilt) return;
    this._eqUiBuilt = true;
    const d = EQ_PANEL_DEPTH;
    const w = 548;
    const h = 332;
    const cx = GAME_W / 2;
    const cy = GAME_H / 2;
    const push = (o) => {
      this._eqUiNodes.push(o);
      return o;
    };

    const ZFrame = 0x1a4a22;
    const ZCream = 0xe8dcc4;
    const ZInner = 0xd4c4a8;

    const backdrop = this.add
      .rectangle(GAME_W / 2, GAME_H / 2, GAME_W + 8, GAME_H + 8, 0x040806, 0.55)
      .setScrollFactor(0)
      .setDepth(d)
      .setInteractive();
    push(backdrop);

    push(
      this.add
        .rectangle(cx + 3, cy + 4, w + 24, h + 24, 0x040806, 0.4)
        .setScrollFactor(0)
        .setDepth(d + 1),
    );
    push(
      this.add
        .rectangle(cx, cy, w + 18, h + 18, ZCream, 1)
        .setStrokeStyle(5, ZFrame)
        .setScrollFactor(0)
        .setDepth(d + 2),
    );
    push(
      this.add
        .rectangle(cx, cy, w + 4, h + 4, ZInner, 1)
        .setStrokeStyle(2, 0x4a7a55)
        .setScrollFactor(0)
        .setDepth(d + 3),
    );

    push(
      this.add
        .text(cx, cy - h / 2 + 26, "GEAR", {
          fontSize: "22px",
          color: "#2a1810",
          fontFamily: "monospace",
          stroke: "#e8dcc4",
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(d + 4),
    );
    push(
      this.add
        .text(
          cx,
          cy - h / 2 + 50,
          "I / Esc  ·  Tab = bag  ·  drag item here or choose # + Equip",
          {
            fontSize: "9px",
            color: "#4a3830",
            fontFamily: "monospace",
          },
        )
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(d + 4),
    );

    const rowY0 = cy - h / 2 + 84;
    const rowStep = 56;
    const leftX = cx - w / 2 + 16;
    let ri = 0;
    for (const eqKind of EQ_KINDS) {
      const ry = rowY0 + ri * rowStep;
      ri++;

      push(
        this.add
          .rectangle(leftX, ry, w - 32, 48, 0xcfc0a8, 0.35)
          .setStrokeStyle(1, 0x5a8a5a)
          .setScrollFactor(0)
          .setDepth(d + 5),
      );

      push(
        this.add
          .text(leftX + 6, ry, EQ_LABEL[eqKind], {
            fontSize: "11px",
            color: "#1a3018",
            fontFamily: "monospace",
          })
          .setOrigin(0, 0.5)
          .setScrollFactor(0)
          .setDepth(d + 7),
      );

      const iconX = leftX + 78;
      const iconFrame = this.add
        .rectangle(iconX, ry, 46, 46, ZInner, 1)
        .setStrokeStyle(2, 0x3d6c48)
        .setScrollFactor(0)
        .setDepth(d + 6);
      push(iconFrame);
      const icon = this.add
        .image(iconX, ry, "px_ui_slot_empty")
        .setScrollFactor(0)
        .setDepth(d + 8)
        .setDisplaySize(40, 40);
      push(icon);
      this._eqIconImages[eqKind] = icon;

      const textX = leftX + 118;
      const nameLine = this.add
        .text(textX, ry - 12, "(empty slot)", {
          fontSize: "12px",
          color: "#2a1810",
          fontFamily: "monospace",
        })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(d + 7);
      push(nameLine);
      this._eqNameTexts[eqKind] = nameLine;

      const statLine = this.add
        .text(textX, ry + 12, "—", {
          fontSize: "10px",
          color: "#4a4038",
          fontFamily: "monospace",
          wordWrap: { width: 260 },
        })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(d + 7);
      push(statLine);
      this._eqStatTexts[eqKind] = statLine;

      const btnY = ry;
      const clearW = 56;
      const clearH = 28;
      const clearCx = cx + w / 2 - 130;
      push(
        this.add
          .rectangle(clearCx, btnY, clearW, clearH, 0x6b3830, 1)
          .setStrokeStyle(2, 0x4a2018)
          .setScrollFactor(0)
          .setDepth(d + 6),
      );
      push(
        this.add
          .text(clearCx, btnY, "Clear", {
            fontSize: "9px",
            color: "#f5e0dc",
            fontFamily: "monospace",
          })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setDepth(d + 7),
      );
      const stripZ = this.add
        .zone(clearCx, btnY, clearW + 6, clearH + 6)
        .setScrollFactor(0)
        .setDepth(d + 9)
        .setInteractive({ useHandCursor: true });
      push(stripZ);
      stripZ.on("pointerup", () => this.stripEquipKind(eqKind));

      const dropW = 96;
      const dropH = 30;
      const equipCx = cx + w / 2 - 48;
      push(
        this.add
          .rectangle(equipCx, btnY, dropW, dropH, 0x284830, 1)
          .setStrokeStyle(2, 0x3d6c48)
          .setScrollFactor(0)
          .setDepth(d + 6),
      );
      push(
        this.add
          .text(equipCx, btnY, "Equip", {
            fontSize: "10px",
            color: "#e8f8e8",
            fontFamily: "monospace",
          })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setDepth(d + 7),
      );
      const dropZ = this.add
        .zone(equipCx, btnY, dropW + 10, dropH + 10)
        .setScrollFactor(0)
        .setDepth(d + 9)
        .setInteractive({ useHandCursor: true });
      push(dropZ);
      dropZ.on("pointerup", () => this.tryEquipSelectionToKind(eqKind));
      this._eqDropZones[eqKind] = dropZ;
    }

    this.setEquipmentPanelVisible(false);

    this._eqGlobalPointerUp = () => {
      if (!this._equipmentPanelOpen) return;
      if (this._eqDragInvIndex == null) return;
      const ptr = this.input.activePointer;
      for (const k of EQ_KINDS) {
        const z = this._eqDropZones[k];
        if (!z || !z.input || !z.active) continue;
        const b = z.getBounds();
        if (b.contains(ptr.x, ptr.y)) {
          this.tryEquipDragToKind(k);
          return;
        }
      }
      this._eqDragInvIndex = null;
    };
    this.input.on("pointerup", this._eqGlobalPointerUp);
  }

  setEquipmentPanelVisible(v) {
    for (const o of this._eqUiNodes) {
      if (o && o.setVisible) o.setVisible(v);
    }
  }

  openEquipmentPanel() {
    this._equipmentPanelOpen = true;
    this.setEquipmentPanelVisible(true);
    this.refreshEquipmentPanel();
  }

  closeEquipmentPanel() {
    this._equipmentPanelOpen = false;
    this._eqDragInvIndex = null;
    this.setEquipmentPanelVisible(false);
  }

  toggleEquipmentPanel() {
    if (this._equipmentPanelOpen) this.closeEquipmentPanel();
    else this.openEquipmentPanel();
  }

  refreshEquipmentPanel() {
    if (!this._eqUiBuilt) return;
    const me = this._selfEntity();
    const inv = me?.inventory;
    const slots = inv?.slots || [];
    const eq = inv?.equipment || {};
    for (const kind of EQ_KINDS) {
      const idx = eq[kind];
      const icon = this._eqIconImages[kind];
      const nameT = this._eqNameTexts[kind];
      const statT = this._eqStatTexts[kind];
      if (!nameT || !statT || !icon) continue;
      const cell = Number.isInteger(idx) ? slots[idx] : null;
      if (cell && cell.qty > 0 && invTypeMatchesEquipKind(kind, cell.type)) {
        this.applyItemIconImage(icon, cell);
        nameT.setText(`${itemShortName(cell.type)}  ·  bag slot ${(idx ?? 0) + 1}`);
        nameT.setColor("#1a1810");
        const st = formatGearStatsReadable(cell.meta);
        statT.setText(st || "—");
        statT.setColor("#3d3028");
      } else {
        this.applyItemIconImage(icon, null);
        nameT.setText("(empty slot)");
        nameT.setColor("#5a5048");
        statT.setText("Use Equip after selecting matching gear in bag");
        statT.setColor("#6a6058");
      }
    }
  }

  tryEquipSelectionToKind(kind) {
    if (!this.socket?.connected) return;
    const src = this._eqDragInvIndex != null ? this._eqDragInvIndex : this.selectedSlotIndex;
    this._eqDragInvIndex = null;
    const me = this._selfEntity();
    const s = me?.inventory?.slots?.[src];
    if (!s || s.qty < 1 || !invTypeMatchesEquipKind(kind, s.type)) return;
    this.socket.emit("equipGear", { inventorySlot: src, slot: kind });
  }

  tryEquipDragToKind(kind) {
    if (this._eqDragInvIndex == null) return;
    if (!this.socket?.connected) return;
    const src = this._eqDragInvIndex;
    this._eqDragInvIndex = null;
    const me = this._selfEntity();
    const s = me?.inventory?.slots?.[src];
    if (!s || s.qty < 1 || !invTypeMatchesEquipKind(kind, s.type)) return;
    this.socket.emit("equipGear", { inventorySlot: src, slot: kind });
  }

  stripEquipKind(kind) {
    if (!this.socket?.connected) return;
    this.socket.emit("unequipGear", { slot: kind });
  }

  _selfEntity() {
    const snap = this._lastSnap;
    if (!snap?.entities || this.selfId == null) return null;
    return snap.entities.find((e) => e.id === this.selfId && e.kind === "player") ?? null;
  }

  /**
   * @param {any} snap
   * @param {any} me
   */
  isAdjacentToShopkeeper(snap, me) {
    if (!snap || snap.mapId !== "town" || !me) return false;
    const sk = snap.entities?.find((e) => e.kind === "npc" && e.npcType === "shopkeeper");
    if (!sk) return false;
    return Math.abs(me.x - sk.x) + Math.abs(me.y - sk.y) === 1;
  }

  findAdjacentEnemy() {
    if (!this.mapData || this.selfId == null) return null;
    const snap = this._lastSnap;
    if (!snap) return null;
    const me = snap.entities.find((e) => e.id === this.selfId && e.kind === "player");
    if (!me) return null;
    let best = null;
    let bestD = 9;
    for (const e of snap.entities) {
      if (e.kind !== "enemy" || e.hp <= 0) continue;
      const d = Math.abs(e.x - me.x) + Math.abs(e.y - me.y);
      if (d === 1 && d < bestD) {
        best = e;
        bestD = d;
      }
    }
    return best;
  }
}
