// 前端入口：App（舞台 / 世界 / 月亮 / 运行时）+ 输入（倾斜）+ 调试面板 + 无头验收工具。
// ?scene=<名字> 打开某个画面状态；?brain=off 不连服务端；?panel=off 收起面板。

import { ACTIONS, type Action } from "../shared/protocol";
import { App } from "./app/app";
import { Panel } from "./app/panel";
import { applyScene, SCENES } from "./app/scenes";
import { CHARACTER_NAME } from "./config";
import { Behaviors } from "./moon/behaviors";
import { EXPR_LABELS, EXPR_NAMES } from "./moon/expressions";
import { MoonInteraction } from "./moon/interact";
import { params } from "./moon/params";

const q = new URLSearchParams(location.search);
const BRAIN = q.get("brain") !== "off";
document.title = `Moonbao · ${CHARACTER_NAME}`;

const canvas = document.getElementById("moonCanvas") as HTMLCanvasElement;
const app = new App(canvas);

// ---------- 不聊天也好玩：手势 + 小日子 ----------
const interact = new MoonInteraction(app.moon, app.stage.cam, canvas, {
  onPoke: () => life.notifyActivity(),
  onGrab: () => life.notifyActivity(),
  onBounce: () => life.notifyActivity(),
  onTapSky: () => life.notifyActivity(),
});
const life = new Behaviors(app.moon, app.world, app.stage.cam, interact, () => app.stage.pixelRatio);
app.stage.back.add(life.star.points);
app.onTick((dt) => {
  interact.update(dt);
  life.update(dt);
});

const sceneName = applyScene(app, q.get("scene") ?? "real");
if (!q.has("scene") || sceneName === "real") life.playOpening();
if (q.has("hour")) app.world.hourOverride = Number(q.get("hour"));
if (q.has("phase")) params.light.phaseDeg = Number(q.get("phase"));
app.start();

// ---------- 倾斜输入：鼠标（桌面模拟）/ 陀螺仪（真机） ----------
addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse" || interact.isGrabbed) return;
  app.stage.cam.setPointer((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
});
const gyroBtn = document.getElementById("gyroBtn") as HTMLButtonElement;
const DOE = (window as any).DeviceOrientationEvent as { requestPermission?: () => Promise<string> } | undefined;
function startGyro() {
  addEventListener("deviceorientation", (e) => app.stage.cam.setOrientation(e.beta, e.gamma));
}
if (matchMedia("(pointer: coarse)").matches && DOE) {
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

// ---------- 大脑（服务端）：先探再连，避免没起服务端时刷错误 ----------
if (BRAIN) {
  const probe = async () => {
    try {
      const r = await fetch("/api/health", { cache: "no-store" });
      if (r.ok) {
        app.client.connect();
        return;
      }
    } catch {
      /* 服务端没起 */
    }
    setTimeout(probe, 15_000);
  };
  void probe();
}

// ---------- 调试面板 ----------
const panel = new Panel();
if (q.get("panel") === "off") panel.root.hidden = true;
{
  const s = panel.section("场景", true);
  panel.buttons(
    s,
    Object.entries(SCENES).map(([k, v]) => [v.label, () => {
      applyScene(app, k);
      panel.refresh();
      history.replaceState(null, "", `?scene=${k}`);
    }]),
    true
  );
  panel.slider(s, "钟点", -1, 24, 0.25, () => app.world.hourOverride ?? -1, (v) => {
    app.world.hourOverride = v < 0 ? null : v;
    app.world.sunAltOverride = null;
  }, (v) => (v < 0 ? "实时" : `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, "0")}`));
  panel.slider(s, "太阳高度", -30, 60, 0.5, () => app.world.sunAltOverride ?? -99, (v) => (app.world.sunAltOverride = v), (v) => (v < -90 ? "实时" : `${v.toFixed(1)}°`));
  panel.param(s, "月相°(-1实时)", "light.phaseDeg", -1, 359, 1);
  panel.param(s, "亮边方向°", "light.limbDeg", -180, 180, 1);
  panel.checkbox(s, "永远是夜晚", () => params.sky.alwaysNight, (v) => (params.sky.alwaysNight = v));
  panel.checkbox(s, "星空左右镜像", () => params.sky.mirrorEastWest, (v) => (params.sky.mirrorEastWest = v));
}
{
  const s = panel.section("表情");
  panel.buttons(s, [["自动", () => (app.moon.exprOverride = null)], ...EXPR_NAMES.map((n) => [EXPR_LABELS[n], () => (app.moon.exprOverride = n)] as [string, () => void])], true);
  const a = panel.section("动作");
  panel.buttons(a, ACTIONS.filter((x) => x !== "idle_drift").map((n) => [n, () => app.moon.playAction(n as Action, 0.7, "manual")]));
  panel.buttons(a, [["特写", () => app.moon.playAction("lean_in", 1, "manual")], ["飞远", () => app.moon.playAction("drift_away", 1, "manual")], ["聊天位", () => (app.moon.chatMode = !app.moon.chatMode)]]);
  let v = 0.2;
  let ar = 0.5;
  panel.slider(a, "心情", -1, 1, 0.01, () => v, (x) => app.moon.setEmotion((v = x), ar));
  panel.slider(a, "活力", 0, 1, 0.01, () => ar, (x) => app.moon.setEmotion(v, (ar = x)));
}
{
  const s = panel.section("月亮");
  panel.param(s, "半径", "moon.radius", 0.2, 1.2);
  panel.param(s, "深度", "moon.home.depth", 0.4, 4);
  panel.param(s, "高度", "moon.home.y", -1.5, 1.5);
  panel.param(s, "亮度", "moon.brightness", 0.4, 2);
  panel.param(s, "交界柔和", "moon.terminatorSoftness", 0.02, 0.6);
  panel.param(s, "包裹光", "moon.wrap", 0, 0.8);
  panel.param(s, "暖透光", "moon.sss", 0, 1.5);
  panel.param(s, "边缘光", "moon.rim", 0, 1.5);
  panel.param(s, "自发光", "moon.selfGlow", 0, 0.2);
  panel.param(s, "贴图", "moon.surfaceRealism", 0, 1);
  panel.param(s, "贴图对比", "moon.textureContrast", 0, 1.5);
  panel.param(s, "凹凸", "moon.bumpStrength", 0, 1.2);
  panel.param(s, "小坑", "moon.craterDetail", 0, 1.5);
  panel.param(s, "体积感", "moon.volume", 0, 1);
  panel.param(s, "边缘暗", "moon.limbDarkening", 0, 0.8);
  panel.param(s, "光晕", "light.haloOpacity", 0, 1.5);
  panel.param(s, "光晕大小", "light.haloScale", 1, 6);
  panel.param(s, "地照下限", "light.earthshineMin", 0, 0.6);
  panel.param(s, "地照上限", "light.earthshineMax", 0, 0.8);
  panel.param(s, "脸经度", "moon.faceLon", -180, 180, 1);
  panel.param(s, "脸纬度", "moon.faceLat", -60, 60, 1);
}
{
  const s = panel.section("脸");
  panel.param(s, "眼距", "face.eyeSpacing", 0.3, 0.9);
  panel.param(s, "眼高", "face.eyeY", -0.3, 0.3);
  panel.param(s, "眼宽", "face.eyeW", 0.02, 0.14);
  panel.param(s, "眼高度", "face.eyeH", 0.02, 0.16);
  panel.param(s, "高光", "face.highlight", 0, 1.5);
  panel.param(s, "嘴下移", "face.mouthBelow", 0.08, 0.4);
  panel.param(s, "嘴宽", "face.mouthWidth", 0.08, 0.4);
  panel.param(s, "微笑深", "face.smileDepth", 0.01, 0.12);
  panel.param(s, "腮红", "face.blushBase", 0, 1);
  panel.param(s, "腮红大小", "face.blushRadius", 0.04, 0.2);
}
{
  const s = panel.section("银河与星星");
  panel.param(s, "银河亮度", "sky.milkyWay.gain", 0, 4);
  panel.param(s, "黑位", "sky.milkyWay.black", 0, 0.2);
  panel.param(s, "对比", "sky.milkyWay.contrast", 0.5, 3);
  panel.param(s, "原色", "sky.milkyWay.saturation", 0, 1.5);
  panel.param(s, "星云", "sky.milkyWay.nebula", 0, 2);
  panel.param(s, "银河视差", "sky.milkyWay.parallax", 0, 1);
  panel.param(s, "亮星大小", "sky.stars.sizeBright", 1, 16);
  panel.param(s, "暗星大小", "sky.stars.sizeFaint", 0.3, 4);
  panel.param(s, "亮星亮度", "sky.stars.brightBright", 0.5, 12);
  panel.param(s, "暗星亮度", "sky.stars.brightFaint", 0, 1.5);
  panel.param(s, "闪烁", "sky.stars.twinkle", 0, 1);
  panel.param(s, "星表视差", "sky.stars.parallax", 0, 1);
  params.sky.fill.forEach((_, i) => {
    panel.param(s, `补星${i + 1}亮度`, `sky.fill.${i}.brightness`, 0, 3);
    panel.param(s, `补星${i + 1}视差`, `sky.fill.${i}.parallax`, 0, 1);
  });
}
{
  const s = panel.section("空间 · 光斑 · 流星 · 地照");
  panel.param(s, "眼距屏幕", "space.eyeDistance", 1, 4);
  panel.param(s, "倾斜横移", "space.shiftAt20deg", 0, 1.2);
  panel.param(s, "视差强度", "space.parallaxStrength", 0, 1.5);
  panel.param(s, "重量感", "motion.swayGain", 0, 0.6);
  panel.param(s, "光斑亮", "bokeh.opacityMax", 0, 0.6);
  panel.param(s, "流星间隔", "meteors.interval", 2, 40);
  panel.param(s, "流星亮度", "meteors.brightness", 0.5, 8);
  panel.param(s, "地照", "earthglow.strength", 0, 2);
  panel.buttons(s, [["放一颗流星", () => app.world.meteors.spawn(app.stage.cam)], ["自动摇", () => (app.stage.cam.autoShake = !app.stage.cam.autoShake)]]);
}
{
  const s = panel.section("后期");
  panel.param(s, "曝光", "post.exposure", 0.3, 2.5);
  panel.param(s, "辉光", "post.bloomStrength", 0, 2);
  panel.param(s, "辉光半径", "post.bloomRadius", 0, 1);
  panel.param(s, "辉光阈值", "post.bloomThreshold", 0, 2);
  panel.param(s, "暗角", "post.vignette", 0, 1);
  panel.param(s, "颗粒", "post.grain", 0, 0.06);
}
{
  const s = panel.section("工具", true);
  const status = document.createElement("div");
  status.style.color = "#8e97b8";
  panel.buttons(s, [
    ["存为默认", async () => (status.textContent = await panel.saveDefaults())],
    ["截图", async () => (status.textContent = await snapSave())],
    ["对照页", () => open(`/compare.html?scene=${new URLSearchParams(location.search).get("scene") ?? "idle"}`, "_blank")],
  ]);
  s.appendChild(status);
}
const fpsEl = document.getElementById("fps")!;
setInterval(() => {
  const c = app.stage.cam;
  const st = app.world.state;
  fpsEl.textContent = `fps ${app.fps.toFixed(0)} · 倾斜 ${c.tilt.x.toFixed(0)}°/${c.tilt.y.toFixed(0)}° · 太阳 ${st.tone.sunAltDeg.toFixed(1)}° · 月相 ${(st.phase.illuminated * 100).toFixed(0)}% · ${app.world.location.label}`;
}, 500);

// ---------- 无头验收工具 ----------
async function snapSave(dir = "", name = `snap-${Date.now()}`): Promise<string> {
  const dataUrl = app.stage.snapshot();
  const r = await fetch(`/__snap?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}`, { method: "POST", body: dataUrl });
  return r.text();
}

/** 逐帧录制：固定时钟，每帧截图 POST 到 /__snap?dir=<seq>；然后 `python3 scripts/make-gif.py <seq>` 合成。 */
async function recordGif(seq = "clip", opts: { fps?: number; seconds?: number; w?: number; h?: number; shake?: boolean; script?: (t: number) => void } = {}) {
  const fps = opts.fps ?? 15;
  const seconds = opts.seconds ?? 8;
  app.stage.setFixedSize({ w: opts.w ?? 540, h: opts.h ?? 960, pr: 1 });
  app.stage.cam.autoShake = opts.shake ?? true;
  const dt = 1 / fps;
  const n = Math.round(seconds * fps);
  let t = 0;
  for (let i = 0; i < n; i++) {
    opts.script?.(t);
    const sub = Math.max(1, Math.round(60 / fps));
    for (let k = 0; k < sub; k++) app.step(dt / sub);
    t += dt;
    await snapSave(seq, `frame-${String(i + 1).padStart(4, "0")}`);
  }
  app.stage.cam.autoShake = false;
  app.stage.setFixedSize(null);
  return `snaps/${seq}/ ${n} 帧 → python3 scripts/make-gif.py ${seq}`;
}

declare global {
  interface Window {
    __app: App;
    __params: typeof params;
    __scene: (name: string) => void;
    __act: (name: Action, intensity?: number) => void;
    __step: (seconds?: number) => void;
    __snapSave: typeof snapSave;
    __recordGif: typeof recordGif;
    __tilt: (xDeg: number, yDeg: number) => void;
    __interact: MoonInteraction;
    __life: Behaviors;
  }
}
window.__interact = interact;
window.__life = life;
window.__app = app;
window.__params = params;
window.__scene = (name) => void applyScene(app, name);
window.__act = (name, intensity = 0.7) => app.moon.playAction(name, intensity, "manual");
window.__step = (seconds = 1) => {
  const n = Math.ceil(seconds * 60);
  for (let i = 0; i < n; i++) app.step(1 / 60);
};
window.__snapSave = snapSave;
window.__recordGif = recordGif;
window.__tilt = (x, y) => app.stage.cam.setTilt(x, y);
