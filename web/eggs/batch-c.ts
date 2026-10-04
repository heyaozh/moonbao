// V9-C：动作与表情（20 条）。真实触发在 gestures.ts / behaviors.ts / chatview.ts / main.ts；这里是录片 / 面板用的脚本化版本。

import * as THREE from "three";
import type { App } from "../app/app";
import { defineEgg } from "./registry";

function onFace(app: App, dx: number, dy: number) {
  const r = app.moon.radius;
  const local = new THREE.Vector3(dx * r, dy * r, Math.sqrt(Math.max(0.1, 1 - dx * dx - dy * dy)) * r);
  return local.applyQuaternion(app.moon.body.mesh.quaternion).add(app.moon.center);
}

/** 从右上方划过的流星（固定路径，录片可复现） */
function spawnMeteor(app: App) {
  const cam = app.stage.cam;
  const depth = 5;
  const ext = cam.extentAt(depth);
  const start = new THREE.Vector3(ext.w * 0.75, ext.h * 0.8, -depth);
  const dir = new THREE.Vector3(-0.85, -0.45, 0).normalize();
  return app.world.meteors.spawn(cam, { start, dir, speed: 3.2, life: 1.9, trail: 1.5 });
}

defineEgg("attend", {
  play(x) {
    const met = spawnMeteor(x.app);
    if (!met) return;
    x.sound.meteor();
    x.gestures.dilate();
    x.gestures.attend(() => met.start.clone().addScaledVector(met.dir, met.speed * Math.min(met.age, met.life)), 2.6);
    x.demo.schedule(2.7, () => x.app.moon.flashExpr("starry", 1.4));
  },
});

defineEgg("glance", {
  play(x) {
    const u = "Will you stay with me tonight?";
    x.chat.startExchange(u);
    x.sound.send();
    x.demo.reply(u, { text: "Of course. I'll keep the stars quiet for you.", v: 0.6, a: 0.45, act: "nod", i: 0.5, think: 0.9 });
  },
});

defineEgg("conduct", {
  play(x) {
    x.app.moon.chatMode = true;
    x.demo.say("gathering the quietest stars for you", 0.6, 0.55, "idle_drift");
  },
});

defineEgg("reading", {
  play(x) {
    const u = "Today was long and strange and I kept thinking about what you said yesterday about the stars, so here I am again.";
    x.chat.startExchange(u);
    x.sound.send();
    x.app.bus.emit("user:send", { text: u });
    x.demo.reply(u, { text: "Mm. I read every word.", v: 0.4, a: 0.35, act: "lean_in", i: 0.5, think: 2.4 });
  },
});

defineEgg("breath", {
  play(x) {
    // 待机 4 秒看呼吸，然后光闪两下（主动开口前的那一下）
    x.demo.schedule(4.0, () => x.app.moon.blinkLight());
    x.demo.schedule(4.6, () => x.app.moon.flashExpr("smile", 1.5));
  },
});

defineEgg("stretch", { play: (x) => x.gestures.stretch() });
defineEgg("shakeoff", { play: (x) => x.gestures.shakeOff() });
defineEgg("sneeze", { play: (x) => x.gestures.sneeze() });
defineEgg("headshake", {
  play(x) {
    x.app.moon.flashExpr("sweat", 2.4);
    x.demo.schedule(0.4, () => x.gestures.headShake());
  },
});
defineEgg("shrug", { play: (x) => x.gestures.shrug() });
defineEgg("flip", { play: (x) => x.app.moon.playAction("spin", 1, "manual") });
defineEgg("sway", { play: (x) => x.gestures.sway(4.2) });

defineEgg("puff", {
  play(x) {
    for (let i = 0; i < 3; i++) x.demo.schedule(i * 0.32, () => x.interact.poke(onFace(x.app, 0.05 * (i - 1), 0.25)));
  },
});

defineEgg("starry", {
  play(x) {
    x.app.moon.flashExpr("surprised", 0.4);
    x.demo.schedule(0.4, () => {
      x.app.moon.flashExpr("starry", 3.2);
      x.app.moon.playAction("brighten", 0.6, "manual");
      x.sound.shimmer();
    });
  },
});

defineEgg("blank", { play: (x) => x.gestures.blankStare(3.2) });

defineEgg("sweat", {
  play(x) {
    x.app.moon.flashExpr("sweat", 3.4);
    x.chat.thinking.showQuestion(true);
    x.demo.schedule(3.4, () => x.chat.thinking.showQuestion(false));
  },
});

defineEgg("whistle", { play: (x) => x.gestures.whistle(3.6) });

defineEgg("tongue", {
  play(x) {
    x.app.moon.flashExpr("laugh", 0.9);
    x.demo.schedule(0.9, () => x.app.moon.flashExpr("tongue", 1.6));
  },
});

defineEgg("dilate", {
  play(x) {
    const met = spawnMeteor(x.app);
    x.sound.meteor();
    x.gestures.dilate();
    if (met) {
      x.app.moon.lookTarget = met.start.clone().addScaledVector(met.dir, met.speed * 0.6);
      x.app.moon.lookWeight = 0.45;
      x.demo.schedule(1.8, () => (x.app.moon.lookWeight = 0));
    }
    x.demo.schedule(0.6, () => x.app.moon.flashExpr("surprised", 0.8));
  },
});

defineEgg("symbols", {
  play(x) {
    x.life.locked = false;
    x.app.moon.setEmotion(0.2, 0.5);
    x.life.play("hum");
    x.demo.schedule(3.4, () => x.life.play("doze"));
    x.demo.schedule(7.2, () => {
      x.life.play("meteor", undefined);
    });
  },
});
