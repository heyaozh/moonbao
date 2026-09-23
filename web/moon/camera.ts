// 「窗」相机：屏幕就是一扇固定的窗（z = 0 平面，短边从 -1 到 1），观察者的眼睛在窗前 eyeDistance 处。
// 手机倾斜 / 鼠标位置 → 眼睛在窗前横移 → 离轴投影（非对称视锥）。
// 这是空间感的核心：只旋转相机像全景图，平移眼睛 + 斜切视锥才像透过窗户看盒子（fish-tank VR）。

import * as THREE from "three";
import { approach, clamp } from "./math";
import { params } from "./params";

export class WindowCamera {
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 60);
  /** 窗的半宽 / 半高（世界单位，短边 = 1）。 */
  halfW = 1;
  halfH = 1;
  /** 倾斜输入（度）：原始目标与低通后的值。 */
  private tiltTarget = { x: 0, y: 0 };
  tilt = { x: 0, y: 0 };
  /** 观察者眼睛相对窗中心的偏移（世界单位）。 */
  eye = { x: 0, y: 0 };
  /** 自动摇（脚本化倾斜轨迹，桌面演示 / 录 GIF 用）。 */
  autoShake = false;
  private t = 0;
  private betaRef: number | null = null;

  constructor() {
    this.camera.matrixAutoUpdate = true;
  }

  resize(width: number, height: number) {
    const aspect = width / height;
    if (aspect >= 1) {
      this.halfH = 1;
      this.halfW = aspect;
    } else {
      this.halfW = 1;
      this.halfH = 1 / aspect;
    }
  }

  /** 原始倾斜输入（度）。x：左右，y：前后。 */
  setTilt(xDeg: number, yDeg: number) {
    const c = params.space.tiltClampDeg;
    this.tiltTarget.x = clamp(xDeg, -c, c);
    this.tiltTarget.y = clamp(yDeg, -c, c);
  }

  /** 桌面端：鼠标 / 触点在视口里的归一化位置（-1..1）模拟倾斜。 */
  setPointer(nx: number, ny: number) {
    const g = params.space.mouseTiltDeg;
    this.setTilt(nx * g, -ny * g);
  }

  /** 真机：DeviceOrientation。beta（前后）以第一次读数为「放平」基准。 */
  setOrientation(beta: number | null, gamma: number | null) {
    if (beta == null || gamma == null) return;
    if (this.betaRef == null) this.betaRef = beta;
    this.setTilt(gamma, beta - this.betaRef);
  }

  recalibrate() {
    this.betaRef = null;
  }

  update(dt: number) {
    this.t += dt;
    if (this.autoShake) {
      // 两个不可公度的周期，看起来像手在随意晃
      const a = params.space.tiltClampDeg * 0.6;
      this.setTilt(a * Math.sin(this.t * 0.9), a * 0.5 * Math.sin(this.t * 0.57 + 1.3));
    }
    const tau = params.space.tiltSmoothing;
    this.tilt.x = approach(this.tilt.x, this.tiltTarget.x, tau, dt);
    this.tilt.y = approach(this.tilt.y, this.tiltTarget.y, tau, dt);
    const k = params.space.shiftAt20deg / 20;
    this.eye.x = this.tilt.x * k;
    this.eye.y = this.tilt.y * k;
    this.applyProjection();
  }

  /** 离轴投影：眼睛在 (ex, ey, ez)，窗固定在 z=0，视锥的四边穿过窗的四角。 */
  private applyProjection() {
    const ez = params.space.eyeDistance;
    const { x: ex, y: ey } = this.eye;
    const cam = this.camera;
    cam.position.set(ex, ey, ez);
    cam.rotation.set(0, 0, 0);
    const n = cam.near;
    const s = n / ez;
    cam.projectionMatrix.makePerspective(
      (-this.halfW - ex) * s,
      (this.halfW - ex) * s,
      (this.halfH - ey) * s,
      (-this.halfH - ey) * s,
      n,
      cam.far
    );
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  }
}
