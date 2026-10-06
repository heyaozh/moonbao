// V9-B：手势与传感器（13 条）。真手势 / 传感器的识别在 web/moon/interact.ts 和 main.ts；这里只是录片 / 面板用的脚本化版本。

import * as THREE from "three";
import type { App } from "../app/app";
import { params } from "../moon/params";
import { defineEgg } from "./registry";

/** 月亮表面上的一点（dx, dy 以半径为单位，朝你这一面）：剧本里的「手指」 */
function onMoon(app: App, dx: number, dy: number) {
  const c = app.moon.center;
  const r = app.moon.radius;
  return new THREE.Vector3(c.x + dx * r, c.y + dy * r, c.z + r * 0.75);
}
/** 脸上的一点（dx, dy 在脸的坐标里，眼睛在 ±eyeSpacing/2）：脸朝观察者会低头一点，所以要按球的朝向转过去 */
function onFace(app: App, dx: number, dy: number) {
  const r = app.moon.radius;
  const local = new THREE.Vector3(dx * r, dy * r, Math.sqrt(Math.max(0.1, 1 - dx * dx - dy * dy)) * r);
  return local.applyQuaternion(app.moon.body.mesh.quaternion).add(app.moon.center);
}

defineEgg("pinch", {
  play(x) {
    x.interact.simPinch(0.55, 0.45, 0.7, 25);
    x.demo.schedule(2.6, () => x.interact.simPinch(1.4, 0.4, 0.5, -20));
  },
});

defineEgg("tickle", {
  play(x) {
    x.interact.simTickle();
    x.demo.schedule(2.3, () => x.interact.simTickle());
  },
});

defineEgg("rub", { play: (x) => x.interact.simRub(5.4) });

defineEgg("hug", { play: (x) => x.interact.simHug(1.9) });

defineEgg("zonepoke", {
  play(x) {
    const F = params.face;
    x.interact.poke(onFace(x.app, F.eyeSpacing / 2, F.eyeY)); // 右眼
    x.demo.schedule(1.5, () => x.interact.poke(onFace(x.app, 0, F.eyeY - F.mouthBelow))); // 嘴
    x.demo.schedule(3.1, () => x.interact.poke(onFace(x.app, -F.blushX, F.eyeY - F.blushBelow))); // 左腮
  },
});

defineEgg("hold", { play: (x) => x.interact.simGrabHold(3.6) });

defineEgg("twist", { play: (x) => x.interact.simTwist(150, 1.0, 0.5) });

defineEgg("facedown", {
  play(x) {
    x.interact.setFaceDown(true);
    x.demo.schedule(4.2, () => x.interact.setFaceDown(false));
  },
});

defineEgg("return", {
  play(x) {
    x.life.locked = false;
    x.life.playOpening("doze");
    x.app.moon.playAction("brighten", 0.4, "reflex");
  },
});

defineEgg("rock", { play: (x) => x.interact.simRock(5.5) });

defineEgg("blow", {
  play(x) {
    x.interact.blow(1);
    x.demo.schedule(2.8, () => x.interact.blow(0.7));
  },
});

defineEgg("hover", {
  play(x) {
    // 光标绕着它走一圈再停在它旁边
    const pts: [number, number, number][] = [
      [0, -0.6, 0.2],
      [0.6, -0.5, 0.6],
      [1.2, 0.1, 0.7],
      [1.8, 0.55, 0.3],
      [2.4, 0.5, -0.3],
      [3.0, -0.1, -0.5],
      [3.6, -0.55, -0.1],
      [4.2, -0.4, 0.4],
    ];
    for (const [t, nx, ny] of pts) x.demo.schedule(t, () => x.interact.lookAtScreen(nx, ny, 0.8));
  },
});

defineEgg("vibrate", {
  play(x) {
    x.interact.poke(onMoon(x.app, 0.3, 0.1));
    x.demo.schedule(1.4, () => x.interact.fling(new THREE.Vector3(3.2, 0.9, -0.3), new THREE.Vector3(0.1, 0.5, 0)));
  },
});
