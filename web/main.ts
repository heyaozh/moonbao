// 前端入口：角色运行时（总线 / 节拍器 / Tier 0 反射）+ 对话壳 + 调试面板。
// 渲染层：three.js 月亮（MoonRenderer）。?brain=off 时不连服务端，只看月亮。

import { ACTIONS, type Action } from "../shared/protocol";
import { SpeechAudio } from "./audio";
import { CHARACTER_NAME } from "./config";
import { params } from "./moon/params";
import { MoonRenderer } from "./moon/renderer";
import { Bus } from "./runtime/bus";
import { installChat } from "./runtime/chat";
import { EngineClient } from "./runtime/client";
import { installPacer } from "./runtime/pacer";
import { FanoutRenderer, StubRenderer } from "./runtime/renderer";
import { installRuntime } from "./runtime/runtime";

const q = new URLSearchParams(location.search);
const BRAIN = q.get("brain") !== "off";
if (!BRAIN) document.body.classList.add("nobrain");

document.title = `Moonbao · ${CHARACTER_NAME}`;
(document.getElementById("chatInput") as HTMLInputElement).placeholder = `跟${CHARACTER_NAME}说点什么……`;

// ---------- 渲染层 ----------
const moon = new MoonRenderer({
  canvas: document.getElementById("moonCanvas") as HTMLCanvasElement,
  stage: document.getElementById("stage")!,
  vignette: document.getElementById("vignette")!,
  glint: document.getElementById("glint")!,
});
const stub = new StubRenderer(document.getElementById("rlog"));
const character = new FanoutRenderer([moon, stub]);

// ---------- 倾斜输入：鼠标（桌面模拟）/ 陀螺仪（真机） ----------
addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse") return;
  moon.cam.setPointer((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
});
const gyroBtn = document.getElementById("gyro") as HTMLButtonElement;
const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
function startGyro() {
  addEventListener("deviceorientation", (e) => moon.cam.setOrientation(e.beta, e.gamma));
}
if (matchMedia("(pointer: coarse)").matches && "DeviceOrientationEvent" in window) {
  if (typeof DOE.requestPermission === "function") {
    gyroBtn.hidden = false; // iOS：必须用户手势
    gyroBtn.onclick = async () => {
      try {
        if ((await DOE.requestPermission!()) === "granted") startGyro();
      } finally {
        gyroBtn.hidden = true;
      }
    };
  } else {
    startGyro();
  }
}

// ---------- 角色运行时 ----------
const bus = new Bus();
installPacer(bus);
installRuntime(bus, character);

const audio = new SpeechAudio();
addEventListener("pointerdown", () => void audio.resume(), { once: true });
addEventListener("keydown", () => void audio.resume(), { once: true });

const client = new EngineClient(bus, audio);
const latencyEl = document.getElementById("latency")!;
const lat: Record<string, number> = {};
installChat(bus, client, {
  onLatency: (kind, ms) => {
    lat[kind] = ms;
    latencyEl.textContent = `表情 ${fmtMs(lat.first_emotion)} · 文字 ${fmtMs(lat.first_text)} · 完成 ${fmtMs(lat.done)}`;
  },
});
if (BRAIN) client.connect();
else document.getElementById("panelSub")!.textContent = "只看月亮（?brain=off）";

function fmtMs(v?: number) {
  return v == null ? "—" : v < 1000 ? `${Math.round(v)}ms` : `${(v / 1000).toFixed(1)}s`;
}

// ---------- 更新循环：永不静止（标签页隐藏时暂停） ----------
let last = performance.now();
const fpsEl = document.getElementById("fps")!;
let fpsTick = 0;
function tick(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!(params.perf.pauseWhenHidden && document.hidden)) character.update(dt);
  if ((fpsTick += dt) > 0.5) {
    fpsTick = 0;
    fpsEl.textContent = `fps ${moon.fps.toFixed(0)} · 倾斜 ${moon.cam.tilt.x.toFixed(0)}°/${moon.cam.tilt.y.toFixed(0)}°`;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------- 调试面板 ----------
const ACTION_LABELS: Record<Action, string> = {
  idle_drift: "待机",
  lean_in: "飘近",
  think_tilt: "想想",
  bounce: "弹一下",
  roll: "转过去",
  spin: "转一圈",
  hide_edge: "躲边边",
  nod: "点头",
  dim: "变暗",
  brighten: "亮起",
  shiver: "发抖",
  drift_away: "飘远",
};
const actionsEl = document.getElementById("actions")!;
for (const name of ACTIONS) {
  if (name === "idle_drift") continue;
  const b = document.createElement("button");
  b.textContent = ACTION_LABELS[name];
  b.onclick = () => character.playAction(name, 0.7);
  actionsEl.appendChild(b);
}
(document.getElementById("closeup") as HTMLButtonElement).onclick = () => character.playAction("lean_in", 1);
(document.getElementById("farAway") as HTMLButtonElement).onclick = () => character.playAction("drift_away", 1);

const bindSlider = (id: string, fn: (v: number) => void, fmt: (v: number) => string = (v) => String(v)) => {
  const el = document.getElementById(id) as HTMLInputElement;
  const out = document.getElementById(id + "Out")!;
  el.addEventListener("input", () => {
    const v = Number(el.value);
    out.textContent = fmt(v);
    fn(v);
  });
};
let sv = 0.2;
let sa = 0.5;
bindSlider("valence", (v) => character.setEmotion((sv = v), sa), (v) => v.toFixed(2));
bindSlider("arousal", (v) => character.setEmotion(sv, (sa = v)), (v) => v.toFixed(2));
bindSlider("phase", (v) => (params.light.phaseDeg = v), (v) => `${v}°`);
bindSlider("hour", (v) => (moon.hourOverride = v < 0 ? null : v), (v) => (v < 0 ? "实时" : `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, "0")}`));
bindSlider("eyeH", (v) => (params.eyes.height = v), (v) => v.toFixed(2));
bindSlider("eyeS", (v) => (params.eyes.spacing = v), (v) => v.toFixed(2));
bindSlider("eyeZ", (v) => (params.eyes.size = v), (v) => v.toFixed(3));
bindSlider("depth", (v) => (params.space.moonDepth = v), (v) => v.toFixed(2));
bindSlider("shift", (v) => (params.space.shiftAt20deg = v), (v) => v.toFixed(2));
bindSlider("sway", (v) => (params.space.moonSwayGain = v), (v) => v.toFixed(2));
bindSlider("zeta", (v) => (params.motion.posZeta = params.motion.rotZeta = v), (v) => v.toFixed(2));

bindSlider("blush", (v) => (params.blush.opacityBase = v), (v) => v.toFixed(2));
bindSlider("realism", (v) => (params.moon.surfaceRealism = v), (v) => v.toFixed(2));
bindSlider("bump", (v) => (params.moon.bumpStrength = v), (v) => v.toFixed(2));
bindSlider("selfGlow", (v) => (params.moon.selfGlow = v), (v) => v.toFixed(2));
bindSlider("halo", (v) => (params.light.haloOpacity = v), (v) => v.toFixed(2));
const mouthBtns: Array<[string, "smile" | "o" | "flat" | null]> = [["mouthAuto", null], ["mouthSmile", "smile"], ["mouthO", "o"], ["mouthFlat", "flat"]];
for (const [id, shape] of mouthBtns) {
  (document.getElementById(id) as HTMLButtonElement).onclick = () => {
    moon.mouthOverride = shape;
    for (const [id2] of mouthBtns) document.getElementById(id2)!.classList.toggle("on", id2 === id);
  };
}

const autoBtn = document.getElementById("autoShake") as HTMLButtonElement;
autoBtn.onclick = () => {
  moon.cam.autoShake = !moon.cam.autoShake;
  autoBtn.classList.toggle("on", moon.cam.autoShake);
};

/** 10 秒演示序列（CHECKPOINT 0 的 GIF 用）：待机眨眼 → 飘近 → 弹 → 想想 → 转过去 → 亮起，全程自动摇镜头。
 *  时间轴（秒, 动作, 强度）；实时播放与逐帧录制共用同一张表。 */
const DEMO: Array<[number, Action, number]> = [
  [1.5, "lean_in", 0.6],
  [3.2, "bounce", 0.8],
  [4.6, "think_tilt", 0.7],
  [6.6, "roll", 0.7],
  [8.4, "brighten", 0.8],
];
const DEMO_SECONDS = 10.5;
function runDemo() {
  moon.cam.autoShake = true;
  autoBtn.classList.add("on");
  for (const [at, name, k] of DEMO) setTimeout(() => character.playAction(name, k), at * 1000);
  setTimeout(() => {
    moon.cam.autoShake = false;
    autoBtn.classList.remove("on");
  }, DEMO_SECONDS * 1000);
}
(document.getElementById("demoSeq") as HTMLButtonElement).onclick = runDemo;

/** 逐帧录制：固定时钟走 DEMO 表，每帧截图 POST 到 /__snap?dir=<seq>；然后 `python3 scripts/make-gif.py <seq>` 合成。
 *  默认竖屏 540×960、15fps、夜里 22 点。窗口隐藏时也能跑（不依赖 rAF）。 */
async function recordGif(seq = "cp0", opts: { fps?: number; seconds?: number; w?: number; h?: number; hour?: number } = {}) {
  const fps = opts.fps ?? 15;
  const seconds = opts.seconds ?? DEMO_SECONDS;
  const prevHour = moon.hourOverride;
  moon.hourOverride = opts.hour ?? 22;
  moon.setFixedSize({ w: opts.w ?? 540, h: opts.h ?? 960, pr: 1 });
  moon.cam.autoShake = true;
  const dt = 1 / fps;
  let next = 0;
  let t = 0;
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) {
    while (next < DEMO.length && DEMO[next][0] <= t) {
      character.playAction(DEMO[next][1], DEMO[next][2]);
      next++;
    }
    // 每帧内部按 60Hz 细分，弹簧更稳
    const sub = Math.max(1, Math.round(60 / fps));
    for (let s = 0; s < sub; s++) character.update(dt / sub);
    t += dt;
    const dataUrl = moon.snapshot(0.9);
    await fetch(`/__snap?dir=${encodeURIComponent(seq)}&name=frame-${String(i + 1).padStart(4, "0")}`, { method: "POST", body: dataUrl });
  }
  moon.cam.autoShake = false;
  moon.setFixedSize(null);
  moon.hourOverride = prevHour;
  return `snaps/${seq}/ ${n} 帧 → python3 scripts/make-gif.py ${seq}`;
}

async function snapSave(): Promise<string> {
  const dataUrl = moon.snapshot();
  const r = await fetch("/__snap", { method: "POST", body: dataUrl });
  return r.text();
}
(document.getElementById("snap") as HTMLButtonElement).onclick = () => void snapSave().then((f) => console.log("snap →", f));

(document.getElementById("proactive") as HTMLButtonElement).onclick = () =>
  client.send({ type: "hello", force: true });
(document.getElementById("resetChat") as HTMLButtonElement).onclick = () => client.send({ type: "reset" });

const panel = document.getElementById("panel")!;
(document.getElementById("panelToggle") as HTMLButtonElement).onclick = () =>
  panel.classList.toggle("collapsed");
if (q.get("panel") === "off") panel.classList.add("collapsed");

// ---------- 开发调试入口 ----------
declare global {
  interface Window {
    __bus: Bus;
    __client: EngineClient;
    __moon: MoonRenderer;
    __params: typeof params;
    __say: (text: string) => void;
    __act: (name: Action, intensity?: number) => void;
    __step: (seconds?: number) => void;
    __snapSave: () => Promise<string>;
    __demo: () => void;
    __recordGif: typeof recordGif;
    __tilt: (xDeg: number, yDeg: number) => void;
  }
}
window.__bus = bus;
window.__client = client;
window.__moon = moon;
window.__params = params;
window.__say = (text) => {
  bus.emit("user:send", { text });
  client.send({ type: "text", text });
};
window.__act = (name, intensity = 0.7) => character.playAction(name, intensity);
// 隐藏标签页里 rAF 不跑：手动把时钟往前拨（无头验收用）
window.__step = (seconds = 1) => {
  const n = Math.ceil(seconds * 60);
  for (let i = 0; i < n; i++) character.update(1 / 60);
};
window.__snapSave = snapSave;
window.__demo = runDemo;
window.__recordGif = recordGif;
window.__tilt = (x, y) => moon.cam.setTilt(x, y);
