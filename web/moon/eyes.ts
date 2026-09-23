// 两颗豆眼：贴在月面上、永远朝向观察者的小平面。
// 形态只有四种（圆 / 眯 ^ / 点 · / 闭），眨眼 = 竖向缩放；视线偏移 = 在月面上滑动。
// 眼睛是可爱度的第一来源，所以高光点、暗部自发光、形态切换都在这里而不在别处。

import * as THREE from "three";
import { Spring, clamp, lerp } from "./math";
import { params } from "./params";

const Z_AXIS = new THREE.Vector3(0, 0, 1);

export type EyeShape = "round" | "squint" | "dot" | "closed";

function makeShapeTexture(shape: EyeShape): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, S, S);
  g.fillStyle = "#fff";
  g.strokeStyle = "#fff";
  g.lineCap = "round";
  const cx = S / 2;
  const cy = S / 2;
  if (shape === "round") {
    g.beginPath();
    g.ellipse(cx, cy, S * 0.36, S * 0.4, 0, 0, Math.PI * 2);
    g.fill();
  } else if (shape === "dot") {
    g.beginPath();
    g.arc(cx, cy, S * 0.16, 0, Math.PI * 2);
    g.fill();
  } else if (shape === "closed") {
    g.lineWidth = S * 0.11;
    g.beginPath();
    g.moveTo(S * 0.2, cy + S * 0.04);
    g.quadraticCurveTo(cx, cy + S * 0.14, S * 0.8, cy + S * 0.04);
    g.stroke();
  } else {
    // squint ^ ：笑起来眼睛弯成拱
    g.lineWidth = S * 0.13;
    g.beginPath();
    g.moveTo(S * 0.18, cy + S * 0.14);
    g.quadraticCurveTo(cx, cy - S * 0.3, S * 0.82, cy + S * 0.14);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeHighlightTexture(): THREE.CanvasTexture {
  const S = 64;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.55, "rgba(255,255,255,0.9)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

class Eye {
  readonly root = new THREE.Group();
  readonly bean: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly highlight: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  constructor(private textures: Record<EyeShape, THREE.Texture>, hl: THREE.Texture) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.bean = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ map: textures.round, transparent: true, depthWrite: false })
    );
    this.highlight = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ map: hl, transparent: true, depthWrite: false })
    );
    this.highlight.position.z = 0.002;
    this.bean.renderOrder = 2;
    this.highlight.renderOrder = 3;
    this.root.add(this.bean, this.highlight);
  }
  setShape(s: EyeShape) {
    this.bean.material.map = this.textures[s];
    this.bean.material.needsUpdate = true;
    this.highlight.visible = s === "round";
  }
}

export class Eyes {
  /** 脸的枢轴：放在月心，每帧朝向观察者；roll / nod / tilt 在这上面叠加。 */
  readonly face = new THREE.Group();
  readonly left: Eye;
  readonly right: Eye;
  /** 睁开程度 0..1（眨眼动画写这里）。 */
  openness = 1;
  shape: EyeShape = "round";
  /** 视线偏移目标（-1..1），弹簧跟随。 */
  readonly gazeX: Spring;
  readonly gazeY: Spring;
  private colorNormal = new THREE.Color(params.eyes.color);
  private colorShade = new THREE.Color("#9aa8cc");
  private tmp = new THREE.Vector3();
  private dazeScale = 1;
  private secondEyeOpacity = 1;

  constructor() {
    const textures: Record<EyeShape, THREE.Texture> = {
      round: makeShapeTexture("round"),
      squint: makeShapeTexture("squint"),
      dot: makeShapeTexture("dot"),
      closed: makeShapeTexture("closed"),
    };
    const hl = makeHighlightTexture();
    this.left = new Eye(textures, hl);
    this.right = new Eye(textures, hl);
    this.face.add(this.left.root, this.right.root);
    this.gazeX = new Spring(0, params.eyes.gazeOmega, params.eyes.gazeZeta);
    this.gazeY = new Spring(0, params.eyes.gazeOmega, params.eyes.gazeZeta);
  }

  setShape(s: EyeShape) {
    if (s === this.shape) return;
    this.shape = s;
    this.left.setShape(s);
    this.right.setShape(s);
  }

  /** 呆眼：把眼睛缩成点（连续量，方便插值）。 */
  setDaze(scale: number) {
    this.dazeScale = scale;
  }

  /**
   * @param radius 月亮半径
   * @param shade 0..1，眼睛所在处有多暗（1 = 完全在暗部）
   * @param visibleEyes 1 = 两只，0 = 只留一只（特写用：另一只淡出）
   */
  update(dt: number, radius: number, shade: number, cameraPos: THREE.Vector3, extraRot: { yaw: number; pitch: number; roll: number }) {
    const p = params.eyes;
    this.gazeX.omega = this.gazeY.omega = p.gazeOmega;
    this.gazeX.zeta = this.gazeY.zeta = p.gazeZeta;
    this.gazeX.step(dt);
    this.gazeY.step(dt);

    // 脸朝向观察者，然后叠加动作的转动（roll 让眼睛转到背面）
    this.face.lookAt(cameraPos);
    this.face.rotateY(extraRot.yaw);
    this.face.rotateX(extraRot.pitch);
    this.face.rotateZ(extraRot.roll);

    const gx = this.gazeX.x * p.gazeRange;
    const gy = this.gazeY.x * p.gazeRange;
    const y0 = (p.height - 0.5) * 2 * 0.85 + gy; // 0.85：别贴到球的顶/底
    const half = p.spacing / 2;
    this.place(this.left, -half + gx, y0, radius);
    this.place(this.right, half + gx, y0, radius);

    const sy = clamp(this.openness, 0.06, 1) * this.dazeScale;
    const sx = (1 - (1 - this.openness) * 0.15) * this.dazeScale;
    const size = p.size * radius * 2;
    for (const e of [this.left, this.right]) {
      e.bean.scale.set(size * sx * p.aspect, size * sy, 1);
      e.highlight.scale.set(size * p.highlightSize, size * p.highlightSize * sy, 1);
      e.highlight.position.set(p.highlightX * size * 0.5 * sx, p.highlightY * size * 0.5 * sy, 0.002);
      // 暗部：眼睛稍微发一点灰蓝的光，别消失
      e.bean.material.color.copy(this.colorNormal).lerp(this.colorShade, clamp(shade * p.emissiveInShade * 3, 0, 1));
      e.highlight.material.opacity = lerp(1, 0.6, shade);
    }
    this.left.bean.material.opacity = this.secondEyeOpacity;
    this.left.highlight.material.opacity *= this.secondEyeOpacity;
  }

  /** 把眼睛放到球面上（x, y 以半径为单位），并让平面贴着球面朝外。 */
  private place(e: Eye, x: number, y: number, radius: number) {
    const r2 = x * x + y * y;
    const z = Math.sqrt(Math.max(0.05, 1 - r2));
    this.tmp.set(x, y, z);
    e.root.quaternion.setFromUnitVectors(Z_AXIS, this.tmp.clone().normalize());
    e.root.position.copy(this.tmp).multiplyScalar(radius * 1.012);
  }

  /** 特写时另一只眼淡出（0 = 全隐），下一帧 update 生效。 */
  setSecondEyeOpacity(o: number) {
    this.secondEyeOpacity = o;
  }
}
