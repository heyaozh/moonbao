// V9-D：小日子与世界（12 条）。真实触发在 behaviors.ts / gestures.ts / main.ts；这里是录片 / 面板用的脚本化版本。

import * as THREE from "three";
import type { App } from "../app/app";
import { params } from "../moon/params";
import { defineEgg } from "./registry";

function onFace(app: App, dx: number, dy: number) {
  const r = app.moon.radius;
  const local = new THREE.Vector3(dx * r, dy * r, Math.sqrt(Math.max(0.1, 1 - dx * dx - dy * dy)) * r);
  return local.applyQuaternion(app.moon.body.mesh.quaternion).add(app.moon.center);
}

defineEgg("lazy", {
  play(x) {
    x.life.locked = false;
    x.life.play("lazy");
    // 四秒后戳它：被抓到，吹口哨飘回来
    x.demo.schedule(4.6, () => x.interact.poke(onFace(x.app, 0.1, 0.2)));
  },
});

defineEgg("chase", {
  play(x) {
    x.life.locked = false;
    x.life.play("chase");
  },
});

defineEgg("count", {
  play(x) {
    x.life.locked = false;
    x.life.play("count");
  },
});

defineEgg("hide", {
  play(x) {
    x.life.locked = false;
    x.life.play("hide");
    // 四秒后你点中它躲的那一边：找到了
    x.demo.schedule(4.2, () => x.life.foundMe(0.9 * (x.life.hideSide || 1), 0));
  },
});

defineEgg("rollover", {
  play(x) {
    x.app.moon.flashExpr("sleeping", 9.5);
    x.symbols.zzz(true);
    x.demo.schedule(0.6, () => x.gestures.rollOver(2.2));
    x.demo.schedule(8.6, () => x.symbols.zzz(false));
  },
});

defineEgg("cloud", {
  play(x) {
    x.app.world.sunAltOverride = 30;
    x.gestures.cloudWatch(5);
  },
});

defineEgg("ritual", {
  play(x) {
    params.light.phaseDeg = 0;
    x.gestures.ritual();
    x.sound.shimmer();
  },
});

defineEgg("longreturn", {
  play(x) {
    x.gestures.longReturn();
  },
});

defineEgg("tug", {
  play(x) {
    const u = "hey";
    x.chat.startExchange(u);
    x.sound.send();
    x.app.bus.emit("user:send", { text: u });
    x.demo.reply(u, { text: "Oh! Hi.", v: 0.6, a: 0.6, act: "idle_drift", i: 0.4, think: 1.2 });
  },
});

defineEgg("doodle", {
  play(x) {
    x.app.moon.flashExpr("focused", 2.5);
    x.symbols.pop("☾", { anchor: "right", offset: { x: 0.2, y: 0.1, z: 0 }, size: 0.55, life: 4.8, rise: 0.03, sway: 0.2, color: "#ffe6bd" });
    x.sound.shimmer();
    x.demo.schedule(2.6, () => x.app.moon.flashExpr("content", 2.0));
  },
});

defineEgg("lookup", {
  play(x) {
    x.app.moon.chatMode = true;
    x.demo.say("look, the stars are out tonight", 0.6, 0.55, "idle_drift");
  },
});

defineEgg("tiltwait", {
  play(x) {
    const u = "I'm back.";
    x.chat.startExchange(u);
    x.sound.send();
    x.demo.reply(u, { text: "Did you sleep well?", v: 0.5, a: 0.45, act: "lean_in", i: 0.4, think: 0.8 });
    // 六秒后你开始打字：它才把头摆正
    x.demo.schedule(7.0, () => x.app.bus.emit("user:typing", { active: true }));
    x.demo.schedule(8.5, () => x.app.bus.emit("user:typing", { active: false }));
  },
});
