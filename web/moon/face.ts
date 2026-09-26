// 嘴与腮红：常驻的表情件（2026-09-23 拍板：它不说话，但可以有表情）。
// 嘴形三种（微笑 / o 型 / 平），用三个权重的弹簧连续插值，画在一张小 canvas 上贴到球面。
// 腮红是两片羽化的粉色圆，不透明度随害羞 / 开心加深。位置和比例全部来自 params.mouth / params.blush（按参考图量的）。

import * as THREE from "three";
import { placeOnSphere } from "./eyes";
import { Spring, approach, clamp, lerp } from "./math";
import { params } from "./params";

export type MouthShape = "smile" | "o" | "flat";

const MOUTH_W = 256;
const MOUTH_H = 128;

export class Face {
  readonly mouth: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly blushL: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly blushR: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  /** 三个形状权重的弹簧（和为 1 附近） */
  private wSmile = new Spring(1, params.mouth.morphOmega, params.mouth.morphZeta);
  private wO = new Spring(0, params.mouth.morphOmega, params.mouth.morphZeta);
  private wFlat = new Spring(0, params.mouth.morphOmega, params.mouth.morphZeta);
  /** 微笑的幅度（0..1，心情越好弧越弯） */
  smileAmount = 0.7;
  private blushOpacity = params.blush.opacityBase;
  private lastKey = "";

  constructor(parent: THREE.Group) {
    this.canvas.width = MOUTH_W;
    this.canvas.height = MOUTH_H;
    this.ctx = this.canvas.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.mouth = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, color: new THREE.Color(params.mouth.color) }));
    this.mouth.renderOrder = 2;

    const blushTex = makeBlushTexture(params.blush.feather);
    const mk = () => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: blushTex, transparent: true, depthWrite: false, color: new THREE.Color(params.blush.color) }));
      m.renderOrder = 2;
      return m;
    };
    this.blushL = mk();
    this.blushR = mk();
    parent.add(this.mouth, this.blushL, this.blushR);
    this.redraw();
  }

  /** 目标嘴形（由情绪或动作决定）。 */
  setShape(s: MouthShape) {
    this.wSmile.target = s === "smile" ? 1 : 0;
    this.wO.target = s === "o" ? 1 : 0;
    this.wFlat.target = s === "flat" ? 1 : 0;
  }

  /**
   * @param eyeY 两眼中点在球面上的高度（半径为单位，和 eyes.ts 同一坐标）
   * @param blushTarget 腮红目标不透明度（0..1）
   * @param shade 0..1 暗部程度（嘴在暗部稍微提亮一点，别消失）
   */
  update(dt: number, eyeY: number, blushTarget: number, shade: number) {
    const M = params.mouth;
    const B = params.blush;
    for (const s of [this.wSmile, this.wO, this.wFlat]) {
      s.omega = M.morphOmega;
      s.zeta = M.morphZeta;
      s.step(dt);
    }
    this.mouth.visible = M.enabled;
    this.blushL.visible = this.blushR.visible = B.enabled;

    // 嘴：贴在球面，位置在两眼中点下方
    const my = eyeY - M.below;
    placeOnSphere(this.mouth, 0, my, 1.0);
    const planeW = 0.6; // 半径的倍数：canvas 横向 = 0.6 R
    this.mouth.scale.set(planeW, planeW * (MOUTH_H / MOUTH_W), 1);
    const key = `${this.wSmile.x.toFixed(2)}|${this.wO.x.toFixed(2)}|${this.wFlat.x.toFixed(2)}|${this.smileAmount.toFixed(2)}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.redraw();
    }
    this.mouth.material.color.set(M.color).lerp(new THREE.Color("#6b7699"), clamp(shade * 0.8, 0, 1));

    // 腮红
    this.blushOpacity = approach(this.blushOpacity, blushTarget, B.opacityTau, dt);
    const by = eyeY - B.below;
    placeOnSphere(this.blushL, -B.offsetX, by, 1.0);
    placeOnSphere(this.blushR, B.offsetX, by, 1.0);
    const bs = B.radius * 2 * 1.6; // 羽化后视觉半径小于贴图，放大一点
    this.blushL.scale.set(bs, bs, 1);
    this.blushR.scale.set(bs, bs, 1);
    this.blushL.material.opacity = this.blushR.material.opacity = this.blushOpacity * (1 - shade * 0.5);
    this.blushL.material.color.set(B.color);
    this.blushR.material.color.set(B.color);
  }

  /** 把当前权重画成一张嘴：一条弧线（微笑 ↔ 平）+ 一个 o（按权重淡入）。单位：canvas 横向 = 0.6 R。 */
  private redraw() {
    const M = params.mouth;
    const g = this.ctx;
    const pxPerR = MOUTH_W / 0.6;
    g.clearRect(0, 0, MOUTH_W, MOUTH_H);
    g.strokeStyle = "#fff";
    g.fillStyle = "#fff";
    g.lineCap = "round";
    const cx = MOUTH_W / 2;
    const cy = MOUTH_H / 2;
    const ws = clamp(this.wSmile.x, 0, 1);
    const wo = clamp(this.wO.x, 0, 1);
    const wf = clamp(this.wFlat.x, 0, 1);
    const lineW = ws + wf;
    if (lineW > 0.01) {
      const width = lerp(M.flatWidth, M.smileWidth, ws / Math.max(0.001, lineW)) * pxPerR;
      const curve = M.smileCurve * (ws / Math.max(0.001, lineW)) * (0.4 + 0.6 * this.smileAmount) * pxPerR;
      g.globalAlpha = clamp(lineW, 0, 1) * (1 - wo * 0.85);
      g.lineWidth = M.thickness * pxPerR;
      g.beginPath();
      // 两端上翘：端点比中点高 curve；用二次曲线，控制点在中点下方 2*curve
      g.moveTo(cx - width / 2, cy - curve);
      g.quadraticCurveTo(cx, cy + curve * 1.6, cx + width / 2, cy - curve);
      g.stroke();
    }
    if (wo > 0.01) {
      g.globalAlpha = wo;
      const r = M.oRadius * pxPerR * (0.5 + 0.5 * wo);
      g.beginPath();
      g.ellipse(cx, cy, r * 0.85, r, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    this.tex.needsUpdate = true;
  }
}

function makeBlushTexture(feather: number) {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(clamp(1 - feather, 0.05, 0.95), "rgba(255,255,255,0.7)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
