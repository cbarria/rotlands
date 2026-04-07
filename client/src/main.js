import Phaser from "phaser";
import { GameScene } from "./scenes/GameScene.js";

function removeBootBanner() {
  document.getElementById("boot-fallback")?.remove();
}

function showFatal(msg) {
  let el = document.getElementById("boot-fallback");
  if (!el) {
    el = document.createElement("div");
    el.id = "boot-fallback";
    el.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483000",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "background:#111",
      "color:#f88",
      "font-family:monospace",
      "font-size:13px",
      "padding:20px",
      "text-align:center",
      "white-space:pre-wrap",
      "box-sizing:border-box",
    ].join(";");
    document.body.appendChild(el);
  }
  el.textContent = msg;
}

window.addEventListener("unhandledrejection", (ev) => {
  const r = ev.reason;
  const m = r?.stack || r?.message || String(r);
  showFatal("Error (promesa):\n" + m);
});

const config = {
  type: Phaser.AUTO,
  parent: "game",
  width: 960,
  height: 540,
  backgroundColor: "#1a1a2e",
  input: {
    activePointers: 6,
    touch: true,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [GameScene],
  callbacks: {
    postBoot: () => removeBootBanner(),
  },
};

try {
  new Phaser.Game(config);
} catch (e) {
  showFatal("Phaser no arrancó:\n" + (e?.stack || e?.message || String(e)));
  console.error(e);
}
