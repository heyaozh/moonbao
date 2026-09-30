// 对照页：左边真在跑的场景，右边概念图（assets/ui-concept，经开发服务器的 /__concept 读）。
// 「定格」：带 ?freeze 打开场景，快进到这个场景「好看的那一刻」（Scene.settle）再渲染一帧——每次看到的是同一刻。

import { SCENES } from "./app/scenes";

type SettleWindow = Window & { __settle?: (seconds?: number) => Promise<void> };

const names = Object.keys(SCENES);
const q = new URLSearchParams(location.search);
let cur = q.get("scene") && SCENES[q.get("scene")!] ? q.get("scene")! : "idle";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const chips = $("chips");
const live = $<HTMLIFrameElement>("live");
const frame = $("conceptFrame");
const freeze = $<HTMLInputElement>("freeze");
const capLive = $("liveCap");
const capConcept = $("conceptCap");

const sceneUrl = (name: string, frozen = freeze.checked) => `/?scene=${name}&panel=off&brain=off&q=0${frozen ? "&freeze" : ""}`;

function renderChips() {
  chips.innerHTML = "";
  for (const n of names) {
    const s = SCENES[n];
    const b = document.createElement("button");
    b.className = "chip" + (n === cur ? " on" : "");
    b.title = `?scene=${n}${s.ref ? ` · ${s.ref}` : ""}`;
    b.innerHTML = `${s.label}${s.ref ? '<span class="ref" aria-label="有概念图">◐</span>' : ""}`;
    b.onclick = () => go(n);
    chips.appendChild(b);
  }
}

function go(n: string) {
  cur = n;
  history.replaceState(null, "", `?scene=${n}`);
  renderChips();
  const s = SCENES[n];
  live.src = sceneUrl(n);
  frame.innerHTML = s.ref
    ? `<img src="/__concept/${encodeURIComponent(s.ref)}" alt="概念图 ${s.ref}" />`
    : `<div class="empty">这个场景没有对应的概念图<br />（概念图之外新加的画面）</div>`;
  capLive.textContent = `实时 · ${s.label}（?scene=${n}）`;
  capConcept.textContent = s.ref ? `概念图 · ${s.ref}` : "概念图 · 无";
}

live.addEventListener("load", async () => {
  if (!freeze.checked) return;
  const w = live.contentWindow as SettleWindow | null;
  if (!w) return;
  try {
    await w.document.fonts.ready;
  } catch {
    /* 跨源或没有 fonts：忽略 */
  }
  for (let i = 0; i < 60 && !w.__settle; i++) await new Promise((r) => setTimeout(r, 100));
  await w.__settle?.(SCENES[cur].settle ?? 3);
});

freeze.onchange = () => go(cur);
$("reload").onclick = () => go(cur);
$("open").onclick = () => open(sceneUrl(cur, false), "_blank");
addEventListener("keydown", (e) => {
  const i = names.indexOf(cur);
  if (e.key === "ArrowRight") go(names[(i + 1) % names.length]);
  if (e.key === "ArrowLeft") go(names[(i - 1 + names.length) % names.length]);
});

go(cur);
