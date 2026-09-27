// 「窗」相机：屏幕就是一扇固定的窗（z = 0 平面，短边从 -1 到 1），观察者的眼睛在窗前 eyeDistance 处。
// 手机倾斜 / 鼠标位置 → 眼睛在窗前横移 → 离轴投影（非对称视锥）。
// 这是空间感的核心：只旋转相机像全景图，平移眼睛 + 斜切视锥才像透过窗户看盒子（fish-tank VR）。
// 好处：和屏幕平行的平面（对话气泡、字）在离轴投影下只平移缩放、不会被拉歪——倾斜时字永远好读。

import * as THREE from "three";
import { approach, clamp } from "../moon/math";
import { params } from "../moon/params";

export class WindowCamera {
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
  /** 窗的半宽 / 半高（世界单位，短边 = 1）。 */
  halfW = 1;
  halfH = 1;
  private tiltTarget = { x: 0, y: 0 };
  /** 倾斜输入（度），低通后。 */
  tilt = { x: 0, y: 0 };
  /** 观察者眼睛相对窗中心的偏移（世界单位）。 */
  eye = { x: 0, y: 0 };
  /** 自动摇（脚本化倾斜轨迹，桌面演示 / 录 GIF 用）。 */
  autoShake = false;
  private t = 0;
  private betaRef: number | null = null;

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

  /** 桌面端：鼠标在视口里的归一化位置（-1..1）模拟倾斜。 */
  setPointer(nx: number, ny: number) {
    const g = params.space.mouseTiltDeg;
    this.setTilt(nx * g, -ny * g);
  }

  /** 真机：DeviceOrientation。beta（前后）以第一次读数为「拿着的自然角度」。 */
  setOrientation(beta: number | null, gamma: number | null) {
    if (beta == null || gamma == null) return;
    if (this.betaRef == null) this.betaRef = beta;
    // 慢慢把基准拉向当前角度：长时间换个姿势拿手机，画面会自己回正
    this.betaRef += (beta - this.betaRef) * 0.002;
    this.setTilt(gamma, beta - this.betaRef);
  }

  recalibrate() {
    this.betaRef = null;
  }

  get eyeZ() {
    return params.space.eyeDistance;
  }

  update(dt: number) {
    this.t += dt;
    if (this.autoShake) {
      const a = params.space.tiltClampDeg * 0.55;
      this.setTilt(a * Math.sin(this.t * 0.9), a * 0.5 * Math.sin(this.t * 0.57 + 1.3));
    }
    const tau = params.space.tiltSmoothing;
    this.tilt.x = approach(this.tilt.x, this.tiltTarget.x, tau, dt);
    this.tilt.y = approach(this.tilt.y, this.tiltTarget.y, tau, dt);
    const k = (params.space.shiftAt20deg / 20) * params.space.parallaxStrength;
    this.eye.x = this.tilt.x * k;
    this.eye.y = this.tilt.y * k;
    this.applyProjection();
  }

  /** 离轴投影：眼睛在 (ex, ey, ez)，窗固定在 z=0，视锥的四边穿过窗的四角。 */
  private applyProjection() {
    const ez = this.eyeZ;
    const { x: ex, y: ey } = this.eye;
    const cam = this.camera;
    cam.position.set(ex, ey, ez);
    cam.rotation.set(0, 0, 0);
    cam.updateMatrixWorld(true);
    const n = cam.near;
    const s = n / ez;
    cam.projectionMatrix.makePerspective((-this.halfW - ex) * s, (this.halfW - ex) * s, (this.halfH - ey) * s, (-this.halfH - ey) * s, n, cam.far);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  }

  /**
   * 让某一层随倾斜只移动「真实位移」的 m 倍（0 = 钉在屏幕上不动，1 = 按真实深度）。
   * 深度 d（屏幕后方为正）处的点在窗上的真实位移 = eye·d/(ez+d)；把整层反向平移 (1-m) 份抵消掉。
   */
  layerOffset(depth: number, m: number, out: THREE.Vector3) {
    const k = (depth / this.eyeZ) * (1 - m);
    return out.set(-this.eye.x * k, -this.eye.y * k, 0);
  }

  /** 屏幕归一化坐标（-1..1，y 向上）→ 窗平面上的点（世界坐标）。 */
  screenToWindow(nx: number, ny: number, out = new THREE.Vector3()) {
    return out.set(nx * this.halfW, ny * this.halfH, 0);
  }

  /** 从眼睛穿过屏幕某点的射线。 */
  ray(nx: number, ny: number, out = new THREE.Ray()) {
    out.origin.copy(this.camera.position);
    out.direction.copy(this.screenToWindow(nx, ny)).sub(out.origin).normalize();
    return out;
  }

  /** 世界坐标 → 屏幕归一化坐标（-1..1，y 向上），用来给字排版避开月亮。 */
  project(p: THREE.Vector3, out = new THREE.Vector2()) {
    const e = this.camera.position;
    const t = e.z / (e.z - p.z);
    return out.set((e.x + (p.x - e.x) * t) / this.halfW, (e.y + (p.y - e.y) * t) / this.halfH);
  }

  /** 深度 d（屏幕后方为正）处，屏幕边缘对应的半宽 / 半高（世界单位，按居中的眼睛算）。 */
  extentAt(depth: number) {
    const s = (this.eyeZ + depth) / this.eyeZ;
    return { w: this.halfW * s, h: this.halfH * s };
  }
}
