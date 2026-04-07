/**
 * Procedural pixel-art via Phaser Graphics → generateTexture (no external assets).
 * Grid: 16×16, each pixel drawn as 2×2 → 32×32 textures.
 */

const PX = 2;

const P = {
  _: null,
  o: 0x1a1020,
  n: 0x2d1b33,
  s: 0xcdbbac,
  S: 0xa88f7e,
  t: 0x4ecdc4,
  T: 0x2d8b84,
  h: 0x8eede4,
  u: 0x6f7cde,
  U: 0x4b56b0,
  H: 0xa9b7ff,
  f: 0x9b6b5c,
  F: 0x6e3b30,
  r: 0xc94c4c,
  R: 0x7a2828,
  e: 0xd89a8f,
  y: 0xf2e24a,
  k: 0x111018,
  g: 0xf2c14e,
  G: 0xc4932a,
  w: 0xfff4bd,
  L: 0x3d2914,
  l: 0x325035,
  m: 0x4a6b3f,
  M: 0x273822,
  b: 0x5b4d68,
  B: 0x3a3144,
  v: 0x5a1891,
  c: 0x00b4d8,
  /** Trees & rocks (extra terrain) */
  i: 0x3e2723,
  I: 0x5d4037,
  j: 0x1b5e20,
  J: 0x2e7d32,
  q: 0x43a047,
  z: 0x9ccc65,
  d: 0x4a4e5c,
  D: 0x6e7488,
  p: 0xb0b8c8,
  /** UI item icons (blade / armor / flask) */
  A: 0xd8dce3,
  C: 0x7d8696,
  Q: 0xc9a227,
  E: 0x6b5344,
  K: 0x3d6b55,
  O: 0x4a7cbe,
  N: 0x2a4a3a,
  V: 0x8b7355,
  W: 0x5c4a3a,
  Y: 0x654b8c,
  Z: 0x4a3d6e,
  x: 0x3d5c78,
};

function paint(scene, key, rows, palette) {
  if (scene.textures.exists(key)) return;
  const gw = rows[0].length * PX;
  const gh = rows.length * PX;
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const col = palette[row[x]];
      if (col == null) continue;
      g.fillStyle(col, 1);
      g.fillRect(x * PX, y * PX, PX, PX);
    }
  }
  g.generateTexture(key, gw, gh);
  g.destroy();
}

const PLAYER_SELF = [
  "____####________",
  "___######_______",
  "__##ssss##______",
  "__#ssssss#______",
  "___ssssss_______",
  "____ssss________",
  "____TTTT________",
  "___TttttT_______",
  "__TthttthT______",
  "__TthttthT______",
  "__TttttttT______",
  "__TTTTTTTT______",
  "____TTTT________",
  "__ll____ll______",
  "_lll____lll_____",
  "________________",
];

const PLAYER_OTHER = [
  "____####________",
  "___######_______",
  "__##ssss##______",
  "__#ssssss#______",
  "___ssssss_______",
  "____ssss________",
  "____UUUU________",
  "___UuuuuU_______",
  "__UuHuuuHU______",
  "__UuuuuuuU______",
  "__UuuuuuuU______",
  "__UUUUUUUU______",
  "____UUUU________",
  "__ll____ll______",
  "_lll____lll_____",
  "________________",
];

/** Green blob — slow starter enemy */
const ENEMY_SLIME = [
  "________________",
  "________________",
  "______jjjj______",
  "____jjjjjjjj____",
  "___jjjjjjjjjj___",
  "__jjjjjjjjjjjj__",
  "__jjjjjjjjjjjj__",
  "__jjjjJJjjjjjj__",
  "___jjjjjjjjjj___",
  "____jjjjjjjj____",
  "______jjjj______",
  "________________",
  "________________",
  "________________",
  "________________",
  "________________",
];

/** Bony humanoid */
const ENEMY_SKELETON = [
  "________________",
  "______pppp______",
  "_____pddddp_____",
  "_____pdDDdp_____",
  "______pDDp______",
  "______pdDp______",
  "_____pddddp_____",
  "____pddddddp____",
  "___pddpddpddp___",
  "___pdDpddpDdp___",
  "____pddppddp____",
  "_____pdppdp_____",
  "______pddp______",
  "________________",
  "________________",
  "________________",
];

/** Shambler — bulky rotting flesh */
const ENEMY_ZOMBIE = [
  "________________",
  "______mmmm______",
  "_____mMMmm_____",
  "____mMmssMmm____",
  "____mMssssMm____",
  "____mmssssmm____",
  "_____mssssm_____",
  "____mmMMMMmm____",
  "___mMmMMmmMmm___",
  "___mMmmmmmmMm___",
  "____mMmMMmMm____",
  "_____mm__mm_____",
  "______m__m______",
  "________________",
  "________________",
  "________________",
];

/** Fast glass-cannon striker */
const ENEMY_DEMON = [
  "________________",
  "______RR________",
  "_____RrrRR_____",
  "____RrRRrrR____",
  "____RRrrRRRR____",
  "___RrrrkkrRRR___",
  "___RrkkkkkrrR___",
  "___RrrrkkrrRR___",
  "____RRrrrrRR____",
  "____RrrrrrrR____",
  "____RRRRRRRR____",
  "_____R____R_____",
  "________________",
  "________________",
  "________________",
  "________________",
];

/** Friendly shopkeeper: apron + pack */
const NPC_SHOP = [
  "________________",
  "______ww________",
  "_____wwww_______",
  "____wwssww______",
  "___wwssssww_____",
  "__wwssssssww____",
  "_wwLLssLLssww___",
  "_wLLLLLLLLLLw___",
  "_wLLggggggLLw___",
  "_wLLgGggGgLLw___",
  "_wLLggggggLLw___",
  "_wLLLLLLLLLLw___",
  "__wwLLLLLLww____",
  "___wwwwwwww_____",
  "____bbbbbb______",
  "________________",
];

const ITEM_COIN = [
  "________________",
  "________________",
  "_______gg_______",
  "______gwG_______",
  "_____gwwGG______",
  "_____Gwggg______",
  "_____GgwGg______",
  "_____Ggwwg______",
  "______GwwG______",
  "______gwG_______",
  "_______LL_______",
  "________________",
  "________________",
  "________________",
  "________________",
  "________________",
];

/** Sword — readable blade + gold guard */
const UI_ITEM_SWORD = [
  "________________",
  "____________CC__",
  "___________CAAC_",
  "__________CAAAC_",
  "_________QCQCCC_",
  "________QCQQCCC_",
  "_______QCC______",
  "______EKKE______",
  "_____EKKKKE_____",
  "_____KKooKK_____",
  "______KooK______",
  "_______KK_______",
  "________________",
  "________________",
  "________________",
  "________________",
];

/** Closed helm */
const UI_ITEM_HELM = [
  "________________",
  "_______VVVV_____",
  "______VAAAAV____",
  "_____VAAooAAV___",
  "_____VAooooAV___",
  "_____VoooooV___",
  "_____V_oooo_V___",
  "______VooooV____",
  "______VWWWWV____",
  "_______VWWV_____",
  "________VV______",
  "________________",
  "________________",
  "________________",
  "________________",
  "________________",
];

/** Tunic / chest */
const UI_ITEM_CHEST = [
  "________________",
  "________YY______",
  "_______YYYY_____",
  "______YYYYYY____",
  "_____YYooooYY___",
  "_____YooooooY___",
  "_____YooooooY___",
  "_____YYYYYYYY___",
  "_______YYYY_____",
  "______YYYYYY____",
  "_____YY____YY___",
  "________________",
  "________________",
  "________________",
  "________________",
  "________________",
];

/** Pair of boots */
const UI_ITEM_BOOTS = [
  "________________",
  "________________",
  "_______NN_NN____",
  "______Nxx_Nxx___",
  "______Nxx_Nxx___",
  "______NNN_NNN___",
  "_____Wxx_Wxx____",
  "_____WWW_WWW____",
  "______WW___WW___",
  "________________",
  "________________",
  "________________",
  "________________",
  "________________",
  "________________",
  "________________",
];

/** Potion flask */
const UI_ITEM_POTION = [
  "________________",
  "________KK______",
  "________oo______",
  "_______oooo_____",
  "_______KNNK_____",
  "______KNKKKN____",
  "_____KNKKKKN____",
  "_____NKKKKKN____",
  "_____NKKKKKN____",
  "______NKKKN_____",
  "_______NNN______",
  "________________",
  "________________",
  "________________",
  "________________",
  "________________",
];

/** Loaf */
const UI_ITEM_BREAD = [
  "________________",
  "________________",
  "________________",
  "_______QQQ______",
  "______QQwQQ_____",
  "_____QwwwwwQ____",
  "_____QwwwwwQ____",
  "______QQQQQ_____",
  "________________",
  "________________",
  "________________",
  "________________",
  "________________",
  "________________",
  "________________",
  "________________",
];

/** Empty inventory slot */
const UI_SLOT_EMPTY = [
  "________________",
  "________________",
  "____oooooooo____",
  "____o______o____",
  "____o______o____",
  "____o______o____",
  "____o______o____",
  "____o______o____",
  "____oooooooo____",
  "________________",
  "________________",
  "________________",
  "________________",
  "________________",
  "________________",
  "________________",
];

const TILE_GRASS = [
  "lmlmlmlmlmlmlmlm",
  "mlmlmlmlmlmymlym",
  "lmlmymlmlmlmlmlm",
  "mlmlmlmylylmlmlml",
  "lmlymlymlmlmlmlm",
  "mlmlmlmlmlmlmlml",
  "lmlmlmlmlmlmlmlm",
  "mlmymlmlmlmymlml",
  "lmlmlmymlmlmlmlm",
  "mlmlmlmlmlmlmlml",
  "lmlmlmlmlmlmlmlm",
  "mlmlmlmymlmlmlml",
  "lmlmlmymlylmlmlm",
  "mlmlmlmlmlmlmlml",
  "lmlmlmlmlmlmlmlm",
  "mlmlmlmlmlmlmlml",
];

const TILE_PORTAL = [
  "vvvvvvvvvvvvvvvv",
  "vcvvvvvvvvvcvvvv",
  "vccvvccccvvccvvv",
  "vccvvccccvvccvvv",
  "vcvvvvvvvvvcvvvv",
  "vvvvvvvvvvvvvvvv",
  "vccccccccccccvvv",
  "vccccccccccccvvv",
  "vvvvvvvvvvvvvvvv",
  "vcvvvvvvvvvcvvvv",
  "vccvvccccvvccvvv",
  "vccvvccccvvccvvv",
  "vcvvvvvvvvvcvvvv",
  "vvvvvvvvvvvvvvvv",
  "vccccccccccccvvv",
  "vvvvvvvvvvvvvvvv",
];

const TILE_WALL = [
  "BBBBBBBBBBBBBBBB",
  "BoBBBBBBBBBBBBBB",
  "BBoBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBB",
  "BBBBBBBBBBBBBBBB",
];

/** Zelda-ish evergreen: layered canopy + trunk + highlight */
const TILE_TREE = [
  "________________",
  "_______zz_______",
  "______zzJz______",
  "_____zzqJJz_____",
  "_____zJJJJz_____",
  "____zqJJJJqz____",
  "____zJJJJJJz____",
  "____zzJJJJzz____",
  "_____qJJJJq_____",
  "______JqqJ______",
  "______IIII______",
  "______IIii______",
  "______IIII______",
  "_____iIIIi_____",
  "_____iiiii_____",
  "________________",
];

const TILE_ROCK = [
  "________________",
  "________________",
  "_______dd_______",
  "______dDDdp_____",
  "_____dDDDDD_____",
  "_____DDDDDD_____",
  "______pDDDp_____",
  "_______dp_______",
  "________________",
  "________________",
  "________________",
  "________________",
  "________________",
  "________________",
  "________________",
  "________________",
];

/** Hot floor — props on lava use this as underlay when neighbors include lava */
const TILE_LAVA = [
  "rrrrrrrrrrrrrrrr",
  "rrRRrrRRrrRRrrrr",
  "rRRRrrRRRRrrRRrr",
  "rrrRrrrrRRrrrrrr",
  "rRRRRrrrrRRRRrrr",
  "rrrRrrRRrrrrRRrr",
  "rRRrrrRRRRrrrrrr",
  "rrRRrrrrRRRRrrrr",
  "rRRRrrRRrrRRrrrr",
  "rrrrRRrrrrrrrrrr",
  "rRRRRrrRRRRrRRrr",
  "rrrRrrrrRRrrrrrr",
  "rRRrrrRRrrRRrrrr",
  "rrRRrrRRrrrrrrrr",
  "rrrrrrrrrrrrrrrr",
  "rrrrrrrrrrrrrrrr",
];

/** Walkable meadow: extra flowers & taller blades */
const TILE_GRASS_PATCH = [
  "lmlmymymlmlmlmlm",
  "mlmymlmlmlmlmyml",
  "lmlmlmymlylmlmlm",
  "mlmlmlmlmlmlmlml",
  "lmlymlymlmlmlmlm",
  "mlmlmlmlmymlymml",
  "lmlmlmymlmlmlmlm",
  "mlmymlmlmlmlmlml",
  "lmlmlmlmlylmlmlm",
  "mlmlmlmlmlmlmlml",
  "lmlmlmlmymlmlmlm",
  "mlmlymylylmlmlml",
  "lmlmlmlmlmlmlmlm",
  "mlmlmlmlmymlymml",
  "lmlmymlmlmlmlmlm",
  "mlmlmlmlmlmlmlml",
];

/** Texture key for inventory / gear UI (Phaser Image). */
export function uiItemTextureKey(type) {
  switch (String(type || "")) {
    case "weapon":
      return "px_ui_item_sword";
    case "armor_helmet":
      return "px_ui_item_helm";
    case "armor_chest":
      return "px_ui_item_chest";
    case "armor_boots":
      return "px_ui_item_boots";
    case "potion":
      return "px_ui_item_potion";
    case "bread":
      return "px_ui_item_bread";
    case "coin":
      return "px_item_coin";
    default:
      return "px_ui_slot_empty";
  }
}

export function registerProceduralTextures(scene) {
  paint(scene, "px_player_self", PLAYER_SELF, P);
  paint(scene, "px_player_other", PLAYER_OTHER, P);
  paint(scene, "px_enemy_slime", ENEMY_SLIME, P);
  paint(scene, "px_enemy_skeleton", ENEMY_SKELETON, P);
  paint(scene, "px_enemy_zombie", ENEMY_ZOMBIE, P);
  paint(scene, "px_enemy_demon", ENEMY_DEMON, P);
  paint(scene, "px_npc_shop", NPC_SHOP, P);
  paint(scene, "px_item_coin", ITEM_COIN, P);
  paint(scene, "px_ui_item_sword", UI_ITEM_SWORD, P);
  paint(scene, "px_ui_item_helm", UI_ITEM_HELM, P);
  paint(scene, "px_ui_item_chest", UI_ITEM_CHEST, P);
  paint(scene, "px_ui_item_boots", UI_ITEM_BOOTS, P);
  paint(scene, "px_ui_item_potion", UI_ITEM_POTION, P);
  paint(scene, "px_ui_item_bread", UI_ITEM_BREAD, P);
  paint(scene, "px_ui_slot_empty", UI_SLOT_EMPTY, P);
  paint(scene, "px_tile_grass", TILE_GRASS, P);
  paint(scene, "px_tile_wall", TILE_WALL, P);
  paint(scene, "px_tile_portal", TILE_PORTAL, P);
  paint(scene, "px_tile_tree", TILE_TREE, P);
  paint(scene, "px_tile_rock", TILE_ROCK, P);
  paint(scene, "px_tile_grass_patch", TILE_GRASS_PATCH, P);
  paint(scene, "px_tile_lava", TILE_LAVA, P);
}
