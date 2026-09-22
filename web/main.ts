// 前端入口：角色运行时（总线 / 节拍器 / Tier 0 反射）+ 对话壳 + 调试面板。
// 渲染层现在是 DOM 占位（PlaceholderRenderer）；P0 落地 three.js 月亮后换成同一接口的 MoonRenderer。

import { ACTIONS, type Action } from "../shared/protocol";
import { SpeechAudio } from "./audio";
import { CHARACTER_NAME } from "./config";
import { Bus } from "./runtime/bus";
import { installChat } from "./runtime/chat";
import { EngineClient } from "./runtime/client";
import { installPacer } from "./runtime/pacer";
import { FanoutRenderer, PlaceholderRenderer, StubRenderer } from "./runtime/renderer";
import { installRuntime } from "./runtime/runtime";

document.title = `Moonbao · ${CHARACTER_NAME}`;
(document.getElementById("chatInput") as HTMLInputElement).placeholder = `跟${CHARACTER_NAME}说点什么……`;

// ---------- 角色运行时 ----------
const bus = new Bus();
const placeholder = new PlaceholderRenderer(
  document.getElementById("moon")!,
  document.getElementById("moonBadge")
);
const stub = new StubRenderer(document.getElementById("rlog"));
const character = new FanoutRenderer([placeholder, stub]);
installPacer(bus); // 先装节拍器：engine:* → paced:*
installRuntime(bus, character);

// 真人声（TTS_PROVIDER≠none 时服务端才会发音频）；AudioContext 需用户手势后 resume
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
client.connect();

function fmtMs(v?: number) {
  return v == null ? "—" : v < 1000 ? `${Math.round(v)}ms` : `${(v / 1000).toFixed(1)}s`;
}

// ---------- 更新循环：永不静止 ----------
let last = performance.now();
function tick(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  character.update(dt);
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

const bindSlider = (id: string, outId: string, fn: (v: number) => void) => {
  const el = document.getElementById(id) as HTMLInputElement;
  const out = document.getElementById(outId)!;
  el.addEventListener("input", () => {
    out.textContent = Number(el.value).toFixed(1);
    fn(Number(el.value));
  });
};
let sv = 0.2;
let sa = 0.5;
bindSlider("valence", "valenceOut", (v) => character.setEmotion((sv = v), sa));
bindSlider("arousal", "arousalOut", (v) => character.setEmotion(sv, (sa = v)));

(document.getElementById("proactive") as HTMLButtonElement).onclick = () =>
  client.send({ type: "hello", force: true });
(document.getElementById("resetChat") as HTMLButtonElement).onclick = () => client.send({ type: "reset" });

const panel = document.getElementById("panel")!;
(document.getElementById("panelToggle") as HTMLButtonElement).onclick = () =>
  panel.classList.toggle("collapsed");

// ---------- 开发调试入口 ----------
declare global {
  interface Window {
    __bus: Bus;
    __client: EngineClient;
    __say: (text: string) => void;
    __act: (name: Action, intensity?: number) => void;
    __step: (seconds?: number) => void;
  }
}
window.__bus = bus;
window.__client = client;
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
