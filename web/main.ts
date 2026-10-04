// 前端入口：App（舞台 / 世界 / 月亮 / 运行时）+ 输入（倾斜）+ 调试面板 + 无头验收工具。
// ?scene=<名字> 打开某个画面状态；?brain=off 不连服务端；?panel=off 收起面板。

import "lxgw-wenkai-screen-webfont/lxgwwenkaigbscreen.css";
import "@fontsource/dancing-script/400.css";
import "@fontsource/sacramento/400.css";
import "@fontsource/caveat/400.css";
import "@fontsource/ms-madi/400.css";
import * as THREE from "three";
import { ACTIONS, type Action } from "../shared/protocol";
import { App } from "./app/app";
import { Panel } from "./app/panel";
import { applyScene, SCENES, type SceneCtx } from "./app/scenes";
import { Mic, toBase64 } from "./audio/mic";
import { SoundEngine } from "./audio/synth";
import { ChatView } from "./chat/chatview";
import { DemoBrain } from "./chat/demo";
import { FONT_CANDIDATES, fontState, type FontName } from "./chat/glyphs";
import { Onboarding } from "./ui/onboarding";
import { loadProfile, loadUserSettings, SettingsSheet, uiLang } from "./ui/settings";
import { GlassUI } from "./ui/ui";
import { loadLocation } from "./astro/location";
import { CHARACTER_NAME } from "./config";
import { Behaviors } from "./moon/behaviors";
import { EXPR_LABELS, EXPR_NAMES } from "./moon/expressions";
import { MoonInteraction } from "./moon/interact";
import { params } from "./moon/params";
import { EGG_CATALOG } from "./eggs/catalog";
import { EggStage, playEgg, type EggCtx, type EggOpts } from "./eggs/registry";
import { SymbolFX } from "./eggs/symbols";
import "./eggs/batch-a";
import "./eggs/batch-b";
import "./eggs/batch-c";
import "./eggs/batch-d";
import { Gestures } from "./moon/gestures";

const q = new URLSearchParams(location.search);
// 用户在设置里调过的偏好（声音、画面）先盖到 params 上，再建场景
loadUserSettings();
const profile = loadProfile();
const BRAIN = q.get("brain") !== "off";
document.title = `Moonbao · ${CHARACTER_NAME}`;

const canvas = document.getElementById("moonCanvas") as HTMLCanvasElement;
const app = new App(canvas);
// 声音：浏览器要求第一次触碰后才能出声
const sound = new SoundEngine();
const unlock = () => void sound.unlock();
addEventListener("pointerdown", unlock, { once: true });
addEventListener("keydown", unlock, { once: true });

// ---------- 彩蛋（PLAN V9）：符号管线（手势要用它冒星尘，先建） ----------
const symbols = new SymbolFX();
app.stage.front.add(symbols.group);

// 小动作（V9-C）：伸懒腰、抖落星尘、打喷嚏、摇头、耸肩、摇摆、鼓脸、吹口哨、发呆、共同注意
const gestures = new Gestures(app.moon, {
  dust: (p, v, life) => symbols.dust(p, v, life),
  gust: (from, k, dir) => symbols.gust(from, k, dir),
  note: () => {
    symbols.note();
    sound.glyph();
  },
  sound: { sneeze: () => sound.gust(0.9), pfft: () => sound.release(3), shake: () => sound.tick(), stretch: () => sound.grab() },
});

// ---------- 不聊天也好玩：手势 + 小日子 ----------
const vibrate = (ms: number) => {
  if (params.eggs.vibrate.enabled) navigator.vibrate?.(ms);
};
const interact = new MoonInteraction(app.moon, app.stage.cam, canvas, {
  onPoke: () => {
    life.notifyActivity();
    sound.poke();
    vibrate(params.eggs.vibrate.poke);
  },
  onGrab: () => {
    life.notifyActivity();
    sound.grab();
  },
  onRelease: (v) => sound.release(v),
  onBounce: (v) => {
    life.notifyActivity();
    sound.bounce(v);
    if (v > 1.5) vibrate(params.eggs.vibrate.bounce);
  },
  // ── V9-B ──
  onTickle: () => {
    life.notifyActivity();
    sound.giggle();
  },
  onRub: () => sound.grab(),
  onHug: () => {
    life.notifyActivity();
    sound.shimmer();
  },
  onZone: () => sound.tick(),
  onSleep: (on) => symbols.zzz(on),
  onWake: () => sound.shimmer(),
  onBlow: (k, from) => {
    sound.gust(k);
    symbols.gust(from, k);
  },
  onSkyTrail: (p) => symbols.dust(p),
  // ── V9-C ──
  onPout: () => {
    if (params.eggs.puff.enabled) gestures.puff();
  },
  onSettled: (spin) => {
    if (params.eggs.shakeoff.enabled && spin > params.eggs.shakeoff.afterSpin) gestures.shakeOff();
  },
  onBlown: () => {
    if (params.eggs.sneeze.enabled && Math.random() < params.eggs.sneeze.afterBlow) gestures.sneeze();
  },
  onDizzy: () => sound.dizzy(),
  // 点空白处：躲猫猫时点中它躲的那一边 = 找到；否则只是打断小日子
  onTapSky: (nx, ny) => {
    if (!life.foundMe(nx, ny)) life.notifyActivity();
  },
  // 在星空上往下拖 = 把远处（更早）的对话拉近
  onSkyDrag: (dy) => chat.scrollBy(dy / 260),
});
const life = new Behaviors(app.moon, app.world, app.stage.cam, interact, () => app.stage.pixelRatio);
app.stage.back.add(life.star.points);
life.hooks = {
  zzz: (on) => symbols.zzz(on),
  note: () => {
    symbols.note();
    sound.glyph();
  },
  bang: () => {
    symbols.bang();
    sound.shimmer();
  },
  dilate: () => gestures.dilate(),
  sneeze: () => gestures.sneeze(),
  stretch: () => gestures.stretch(),
  blank: (s) => gestures.blankStare(s),
  sway: (s) => gestures.sway(s),
  // ── V9-D ──
  lazy: (on) => gestures.lazy(on),
  whistle: (s) => gestures.whistle(s),
  rollOver: (hold) => gestures.rollOver(hold),
  count: (pts) => gestures.countStars(pts),
  hide: (side, edge) => gestures.hide(side, edge),
  peek: () => gestures.peek(),
  unhide: (found) => {
    gestures.unhide(found);
    if (found) sound.giggle();
  },
  cloud: (s) => gestures.cloudWatch(s),
  doodle: () => {
    const ch = (profile.userName?.trim()[0] ?? "☾").toUpperCase();
    app.moon.flashExpr("focused", 2.5);
    symbols.pop(ch, { anchor: "right", offset: { x: 0.2, y: 0.1, z: 0 }, size: 0.55, life: 4.8, rise: 0.03, sway: 0.2 });
    sound.shimmer();
  },
  bump: (t) => gestures.bump(t),
  burst: (p) => {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      symbols.dust(p, new THREE.Vector3(Math.cos(a) * 1.6, Math.sin(a) * 1.6, (Math.random() - 0.5) * 0.4));
    }
    sound.shimmer();
  },
};

// ---------- 对话画面 + 演示大脑 + 玻璃界面 ----------
if (q.has("font") && q.get("font")! in FONT_CANDIDATES) fontState.en = q.get("font") as FontName;
const chat = new ChatView(app);
chat.onGlyph = () => sound.glyph();
app.world.meteors.onSpawn = () => sound.meteor();
const demo = new DemoBrain(app.bus);
const mic = new Mic();
const ui = new GlassUI(app.bus, chat, app.stage.cam, {
  send(text) {
    life.notifyActivity();
    sound.send();
    sound.resetGlyphs();
    if (onboarding.handleInput(text)) return;
    if (app.client.connected) app.client.send({ type: "text", text });
    else demo.reply(text);
  },
  async voiceStart() {
    const ok = await mic.start();
    if (ok) sound.holeStart();
    return ok;
  },
  async voiceStop() {
    sound.holeStop();
    const rec = await mic.stop();
    if (rec) sound.shimmer();
    if (!rec) return null;
    if (app.client.connected && voiceOnServer) {
      // 真识别：交给服务端（本机 whisper）；识别结果经 engine:transcript 回来
      app.client.send({ type: "utterance", wavBase64: toBase64(rec.wav) });
      return pendingTranscript();
    }
    // 没有识别服务：演示里用一句示例话
    return ["Will you stay with me?", "Long day.", "I'm a bit nervous today."][Math.floor(Math.random() * 3)];
  },
  voiceLevel: () => {
    const v = mic.level();
    sound.holeLevelSet(v);
    return v;
  },
  openSettings: () => {
    sound.tick();
    settings.toggle();
  },
});
// ---------- 设置 + 首次见面 ----------
const sendProfile = () => {
  if (app.client.connected) app.client.send({ type: "profile", userName: profile.userName || undefined, moonName: profile.moonName || undefined });
};
const settings = new SettingsSheet(profile, () => app.world.location.label);
/** 界面文字跟着设置里的语言走（默认跟系统语言；用户主要是英文） */
function applyLang() {
  const zh = uiLang(profile) === "zh";
  if (!onboarding?.active) ui.input.placeholder = zh ? "想和月亮说些什么…" : "Say something to the moon…";
  ui.voiceBtn.setAttribute("aria-label", zh ? "按住说话" : "Hold to talk");
  ui.settingsBtn.setAttribute("aria-label", zh ? "设置" : "Settings");
  const g = document.querySelector("#gyroBtn span");
  if (g) g.textContent = zh ? "倾斜手机，看看盒子里面" : "Tilt your phone to look inside";
  document.documentElement.lang = zh ? "zh-CN" : "en";
}
settings.onChange = (what) => {
  if (what === "sound") sound.applyVolumes();
  if (what === "profile") sendProfile();
  if (what === "sky") app.world.location = loadLocation();
  if (what === "lang") applyLang();
};
const onboarding = new Onboarding(app, chat, demo, interact, life, profile, ui.input);
onboarding.onDone = sendProfile;
applyLang();
app.bus.on("engine:hello", sendProfile);
let voiceOnServer = false;
let transcriptWaiter: ((t: string | null) => void) | null = null;
function pendingTranscript() {
  return new Promise<string | null>((resolve) => {
    transcriptWaiter = resolve;
    setTimeout(() => {
      if (transcriptWaiter === resolve) {
        transcriptWaiter = null;
        resolve(null);
      }
    }, 15000);
  });
}
app.bus.on("engine:hello", ({ voice }) => (voiceOnServer = voice));
app.bus.on("engine:transcript", ({ role, text }) => {
  if (role === "user" && transcriptWaiter) {
    const w = transcriptWaiter;
    transcriptWaiter = null;
    w(text);
  }
});
// ---------- 彩蛋（PLAN V9）：注册表 ----------
const eggStage = new EggStage();
const eggCtx = (scripted: boolean): EggCtx => ({ app, chat, demo, life, interact, symbols, sound, gestures, stage: eggStage, scripted });
const egg = (name: string, opts: EggOpts = {}, scripted = false) => playEgg(name, eggCtx(scripted), opts);
// 秘密彩蛋命中（服务端）：先预告回复的长度（短句写得大）、这一轮走隆重档，再演
app.bus.on("engine:egg", (ev) => {
  chat.hint([...ev.words].length, ev.words);
  chat.markGrand();
  egg("secret", { expr: ev.expr, action: ev.action, intensity: ev.intensity });
});

// 大脑 → 画面
app.bus.on("paced:text", ({ text }) => chat.moonSay(text, false));
app.bus.on("paced:done", ({ text }) => {
  if (text) chat.moonSay(text, true);
});
app.bus.on("engine:state", ({ value }) => chat.setThinking(value === "thinking"));
app.bus.on("moon:hint", ({ length, text }) => chat.hint(length, text));
// 快反应（Jev）：LLM 回话之前先做的表情与动作；难懂的问题冒 3D 问号，直到开始写字
let sentAt = 0;
const lat: Record<string, number[]> = { reflex: [], emotion: [], text: [], done: [] };
const pushLat = (k: string, v: number) => {
  lat[k].push(v);
  if (lat[k].length > 10) lat[k].shift();
};
app.bus.on("user:send", () => (sentAt = performance.now()));
// 你一抢话，它没说完的那句就停（已写出的留在上一轮）：演示大脑作废剩下的拍子，真大脑作废这一轮生成
app.bus.on("user:barge", () => {
  demo.interrupt();
  if (app.client.connected) app.client.send({ type: "interrupt" });
});
app.bus.on("engine:reflex", (r) => {
  if (sentAt) pushLat("reflex", performance.now() - sentAt);
  app.moon.setEmotion(r.valence, r.arousal);
  // 难懂的问题：一滴汗 + 3D 问号（V9-C）
  app.moon.flashExpr(r.confused && params.eggs.sweat.enabled ? "sweat" : (r.expr as any), 2.4);
  app.moon.playAction(r.action, r.intensity, "brain");
  if (r.confused) chat.thinking.showQuestion(true);
});
// 它主动开口前光闪两下（V9-C）；你发长句它眯眼认真看（V9-C）
app.bus.on("engine:proactive", () => app.moon.blinkLight());
app.bus.on("user:send", ({ text }) => {
  const E = params.eggs.reading;
  if (E.enabled && [...text].length >= E.minChars) {
    app.moon.flashExpr("reading", 1.8);
    app.moon.playAction("lean_in", 0.45, "reflex");
  }
  // 被你刚发的气泡拽一下（V9-D）；问完歪头等的头也放下
  gestures.tiltRelease();
  const b = chat.current?.bubble;
  if (b) interact.tug(b.mesh.getWorldPosition(new THREE.Vector3()));
});
// 它的话里出现 star / 星 就抬头看天（V9-D）；问完歪头等你打字（V9-D）
let kwSeen = 0;
let kwAt = -1e9;
app.bus.on("paced:text", ({ text }) => {
  const E = params.eggs.lookup;
  if (!E.enabled) return;
  const re = /star|星/gi;
  let n = 0;
  while (re.exec(text)) n++;
  if (n > kwSeen && performance.now() - kwAt > E.cooldown * 1000) {
    kwAt = performance.now();
    interact.lookAtScreen(0.35, 0.85, 0.9);
    app.moon.flashExpr("starry", 0.8);
  }
  kwSeen = n;
});
app.bus.on("paced:done", ({ text }) => {
  kwSeen = 0;
  const E = params.eggs.tiltwait;
  if (E.enabled && /[?？]["'”’)）]*\s*$/.test(text)) {
    gestures.tiltWait();
    setTimeout(() => gestures.tiltRelease(), E.maxWait * 1000);
  }
});
app.bus.on("user:typing", ({ active }) => {
  if (active) gestures.tiltRelease();
});
// 久别归来（V9-D）：离开 ≥3 天，先演身体序列，话随后由服务端的主动开口接上
app.bus.on("engine:hello", ({ absentDays }) => {
  const E = params.eggs.longreturn;
  if (E.enabled && absentDays >= E.days) gestures.longReturn();
});
let firstText = true;
let gotEmotion = false;
app.bus.on("engine:emotion", () => {
  if (sentAt && !gotEmotion) {
    pushLat("emotion", performance.now() - sentAt);
    gotEmotion = true;
  }
});
app.bus.on("engine:reply_delta", () => {
  if (sentAt && firstText) {
    pushLat("text", performance.now() - sentAt);
    firstText = false;
  }
});
app.bus.on("paced:text", () => chat.thinking.showQuestion(false));
app.bus.on("engine:reply_done", () => {
  if (sentAt) pushLat("done", performance.now() - sentAt);
  sentAt = 0;
  firstText = true;
  gotEmotion = false;
});
const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);
app.bus.on("user:typing", () => life.notifyActivity());
app.onTick((dt) => {
  onboarding.update(dt);
  sound.night = app.world.state.night;
  sound.mood = app.moon.emotion.valence;
  sound.update(dt);
  interact.update(dt);
  demo.update(dt);
  chat.update(dt);
  ui.update();
  eggStage.now = app.moon.time;
  gestures.update(dt);
  symbols.update(dt, app.moon.center, app.moon.radius, app.stage.pixelRatio);
  // 聊天时、演彩蛋时不自己玩
  life.paused = app.moon.chatMode || eggStage.active;
  life.update(dt);
});
const sceneCtx: SceneCtx = { chat, demo, life, onboarding, interact, egg: (name) => egg(name, {}, true) };

const sceneName = applyScene(app, q.get("scene") ?? "real", sceneCtx);
// 第一次打开：首次见面；以后打开：它正在做自己的事，被你发现
if (!q.has("scene") && !profile.onboarded) onboarding.start();
else if (!q.has("scene") || sceneName === "real") life.playOpening();
if (q.has("hour")) app.world.hourOverride = Number(q.get("hour"));
if (q.has("phase")) params.light.phaseDeg = Number(q.get("phase"));
app.start();
// 满月 / 新月的小仪式（V9-D）：当天第一次打开，转一圈看看自己亮的那一面（每天一次）
if (params.eggs.ritual.enabled && !q.has("scene")) {
  setTimeout(() => {
    const ill = app.world.state.phase.illuminated;
    const key = `moonbao.ritual.${new Date().toDateString()}`;
    let done = false;
    try {
      done = localStorage.getItem(key) === "1";
    } catch {
      /* 私密模式 */
    }
    if (!done && (ill > 0.985 || ill < 0.015) && !app.moon.chatMode) {
      try {
        localStorage.setItem(key, "1");
      } catch {
        /* ignore */
      }
      gestures.ritual();
    }
  }, 6000);
}

// ---------- 切回来发现你（V9-B）：离开够久再回来，它正在做自己的事、发现你 ----------
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    hiddenAt = performance.now();
    return;
  }
  const E = params.eggs.return;
  if (E.enabled && hiddenAt && (performance.now() - hiddenAt) / 1000 >= E.after && !app.moon.chatMode) {
    life.playOpening();
    app.moon.playAction("brighten", 0.4, "reflex");
  }
  hiddenAt = 0;
});

// ---------- 倾斜输入：鼠标（桌面模拟）/ 陀螺仪（真机） ----------
let hoverAt = 0;
addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse" || interact.isGrabbed) return;
  const nx = (e.clientX / innerWidth) * 2 - 1;
  const ny = (e.clientY / innerHeight) * 2 - 1;
  app.stage.cam.setPointer(nx, ny);
  // 桌面光标视线（V9-B）：光标靠近它，眼神跟着走
  const H = params.eggs.hover;
  if (H.enabled && performance.now() - hoverAt > 80) {
    const cam = app.stage.cam;
    const m = cam.project(app.moon.center);
    const dx = (nx - m.x) * cam.halfW;
    const dy = (-ny - m.y) * cam.halfH;
    const rWin = (app.moon.radius * cam.eyeZ) / (cam.eyeZ - app.moon.center.z);
    if (Math.hypot(dx, dy) < H.within * rWin) {
      hoverAt = performance.now();
      interact.lookAtScreen(nx, -ny, 0.5);
    }
  }
});
const gyroBtn = document.getElementById("gyroBtn") as HTMLButtonElement;
const DOE = (window as any).DeviceOrientationEvent as { requestPermission?: () => Promise<string> } | undefined;
function startGyro() {
  addEventListener("deviceorientation", (e) => {
    app.stage.cam.setOrientation(e.beta, e.gamma);
    // 扣下手机（屏幕朝下）= 睡觉（V9-B）
    if (e.beta != null) interact.setFaceDown(Math.abs(e.beta) > 150);
  });
}
// 吹气（V9-B）：常开麦克风只量音量（不录），一阵持续的大音量 = 吹气。默认关（面板打开），设置里的开关以后再做
const blowMic = new Mic();
blowMic.levelOnly = true;
let blowSince = 0;
let blowCool = 0;
setInterval(() => {
  const B = params.eggs.blow;
  if (!B.enabled || !B.listen) {
    if (blowMic.active) void blowMic.stop();
    return;
  }
  if (!blowMic.active) {
    void blowMic.start();
    return;
  }
  if (ui.isRecording) return;
  const now = performance.now();
  const lv = blowMic.level();
  if (lv > B.threshold) {
    if (!blowSince) blowSince = now;
    if (now - blowSince > B.holdMs && now > blowCool) {
      blowCool = now + 1500;
      blowSince = 0;
      interact.blow(Math.min(1, lv * 1.5));
    }
  } else blowSince = 0;
}, 50);
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
      applyScene(app, k, sceneCtx);
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
  const s = panel.section("彩蛋（V9）");
  panel.buttons(s, EGG_CATALOG.map((e) => [`${e.group} · ${e.label}`, () => egg(e.name, {}, true)]));
  panel.checkbox(s, "吹气：常开麦克风听", () => params.eggs.blow.listen, (v) => (params.eggs.blow.listen = v));
}
{
  const s = panel.section("字");
  panel.buttons(s, (Object.keys(FONT_CANDIDATES) as FontName[]).map((f) => [f, () => (fontState.en = f)]), true);
  panel.param(s, "英文字号", "writer.enPx", 18, 48, 1);
  panel.param(s, "中文字号", "writer.zhPx", 16, 40, 1);
  panel.param(s, "光点/字", "writer.perChar", 10, 120, 1);
  panel.param(s, "光点粗细", "writer.particleSize", 0.4, 3);
  panel.param(s, "日常飞行", "writer.dailyDur", 0.2, 2);
  panel.param(s, "隆重飞行", "writer.grandDur", 0.5, 3);
  panel.param(s, "字后暗底", "writer.backing", 0, 0.8);
  panel.param(s, "透镜", "bubble.lens", 0, 3);
  panel.param(s, "透镜范围", "bubble.margin", 0.05, 0.5);
  panel.param(s, "往后退深", "chat.stepDepth", 0.3, 2.5);
  panel.param(s, "往上挪", "chat.stepUp", 0, 2);
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
  const s = panel.section("声音");
  panel.checkbox(s, "静音", () => params.sound.muted, (v) => {
    params.sound.muted = v;
    sound.applyVolumes();
  });
  panel.slider(s, "氛围", 0, 1, 0.01, () => params.sound.ambient, (v) => {
    params.sound.ambient = v;
    sound.applyVolumes();
  });
  panel.slider(s, "音效", 0, 1, 0.01, () => params.sound.sfx, (v) => {
    params.sound.sfx = v;
    sound.applyVolumes();
  });
  panel.param(s, "根音 MIDI", "sound.rootMidi", 48, 74, 1);
  panel.param(s, "钟声最短", "sound.chimeMin", 1, 30, 0.5);
  panel.param(s, "钟声最长", "sound.chimeMax", 2, 60, 0.5);
  panel.buttons(s, [["试：流星", () => sound.meteor()], ["试：戳", () => sound.poke()], ["试：撞", () => sound.bounce(4)], ["试：写字", () => sound.glyph()], ["试：发送", () => sound.send()], ["试：闪光", () => sound.shimmer()]]);
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
  const ms = (v: number) => (Number.isFinite(v) ? `${Math.round(v)}` : "—");
  fpsEl.textContent = `延迟 p50（ms）反应 ${ms(median(lat.reflex))} · 表情 ${ms(median(lat.emotion))} · 首字 ${ms(median(lat.text))} · 完 ${ms(median(lat.done))} ｜ fps ${app.fps.toFixed(0)} · 画质 ${app.stage.quality} 档 · 倾斜 ${c.tilt.x.toFixed(0)}°/${c.tilt.y.toFixed(0)}° · 太阳 ${st.tone.sunAltDeg.toFixed(1)}° · 月相 ${(st.phase.illuminated * 100).toFixed(0)}% · ${app.world.location.label}`;
}, 500);

// ---------- 无头验收工具 ----------
async function snapSave(dir = "", name = `snap-${Date.now()}`): Promise<string> {
  const dataUrl = app.stage.snapshot();
  const r = await fetch(`/__snap?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}`, { method: "POST", body: dataUrl });
  return r.text();
}

/** 逐帧录制：固定时钟，每帧截图 POST 到 /__snap?dir=<seq>；然后 `python3 scripts/make-gif.py <seq>` 合成。 */
async function recordGif(seq = "clip", opts: { fps?: number; seconds?: number; w?: number; h?: number; shake?: boolean; grain?: number; realtime?: boolean; script?: (t: number) => void | Promise<void> } = {}) {
  const fps = opts.fps ?? 15;
  const seconds = opts.seconds ?? 8;
  // 胶片颗粒每帧都不一样，GIF / 视频压不动（24 MB → 几 MB）：录制时默认关掉，画面本身不受影响
  const grain = params.post.grain;
  params.post.grain = opts.grain ?? 0;
  app.stage.setFixedSize({ w: opts.w ?? 540, h: opts.h ?? 960, pr: 1 });
  app.stage.cam.autoShake = opts.shake ?? true;
  const dt = 1 / fps;
  const n = Math.round(seconds * fps);
  let t = 0;
  // 按真实时间走（默认）：有些反应用的是真实时间的计时器（戳完 460ms 变开心），录得太快节奏会走样
  const start = performance.now();
  for (let i = 0; i < n; i++) {
    await opts.script?.(t);
    const sub = Math.max(1, Math.round(60 / fps));
    for (let k = 0; k < sub; k++) app.step(dt / sub);
    t += dt;
    await snapSave(seq, `frame-${String(i + 1).padStart(4, "0")}`);
    const ahead = t * 1000 - (performance.now() - start);
    if ((opts.realtime ?? true) && ahead > 1) await new Promise((r) => setTimeout(r, ahead));
  }
  app.stage.cam.autoShake = false;
  app.stage.setFixedSize(null);
  params.post.grain = grain;
  return `snaps/${seq}/ ${n} 帧 → python3 scripts/make-gif.py ${seq}`;
}

declare global {
  interface Window {
    __app: App;
    __params: typeof params;
    __scene: (name: string) => void;
    __act: (name: Action, intensity?: number) => void;
    __step: (seconds?: number) => void;
    __pause: (on?: boolean) => boolean;
    __settle: (seconds?: number) => Promise<void>;
    __snapSave: typeof snapSave;
    __recordGif: typeof recordGif;
    __tilt: (xDeg: number, yDeg: number) => void;
    __interact: MoonInteraction;
    __life: Behaviors;
    __egg: (name: string, opts?: EggOpts) => boolean;
    __eggs: typeof EGG_CATALOG;
    __symbols: SymbolFX;
    __chat: ChatView;
    __demo: DemoBrain;
    __sound: SoundEngine;
  }
}
window.__sound = sound;
window.__chat = chat;
window.__demo = demo;
window.__interact = interact;
window.__life = life;
window.__egg = (name, opts = {}) => egg(name, opts, true);
window.__eggs = EGG_CATALOG;
window.__symbols = symbols;
window.__app = app;
window.__params = params;
window.__scene = (name) => void applyScene(app, name, sceneCtx);
window.__act = (name, intensity = 0.7) => app.moon.playAction(name, intensity, "manual");
window.__pause = (on = true) => (app.paused = on);
/** 快进到某一刻并渲染一帧（对照页「定格」、截图用）：分小步推进，让异步的字形排版跟得上 */
window.__settle = async (seconds = 1) => {
  app.paused = true;
  const n = Math.ceil(seconds / 0.1);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 6; k++) app.step(1 / 60);
    await new Promise((r) => setTimeout(r, 4));
  }
  app.stage.render(0);
};
window.__step = (seconds = 1) => {
  const n = Math.ceil(seconds * 60);
  for (let i = 0; i < n; i++) app.step(1 / 60);
};
window.__snapSave = snapSave;
window.__recordGif = recordGif;
window.__tilt = (x, y) => app.stage.cam.setTilt(x, y);
