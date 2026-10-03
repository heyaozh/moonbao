// 画月亮（G1，2026-09-30 用户）：月亮飞到眼前、放得够大，用有限的颜料在它身上画；画的会一直留着。
// 颜料按「画在球面上的面积」算：画掉多少用多少，橡皮擦掉的、一键清除的都退回来。
// 画布是一张等距圆柱图（经度 × 纬度），和月面贴图同一套坐标（跟着月亮转、不跟着脸跑）；
// 直接在字节数组上画，只把改动过的那几行传给显卡（DataTexture.updateRanges），手机上也不卡。
// 一根手指画；两根手指（或「手」工具）转它、捏合缩放；电脑上滚轮缩放。

import * as THREE from "three";
import type { WindowCamera } from "../world/camera";
import { params } from "./params";
import type { MoonRenderer } from "./renderer";

export type PaintTool = "brush" | "eraser" | "hand";

const TILE = 64;
const SAVE_KEY = "moonbao.paint.v1";
const UNDO_MAX = 20;

export class MoonPaint {
  readonly W = params.paint.width;
  readonly H = params.paint.height;
  readonly data: Uint8Array;
  readonly texture: THREE.DataTexture;
  active = false;
  tool: PaintTool = "brush";
  color = 0;
  /** 已经用掉的颜料（占月球表面的比例） */
  used = 0;
  /** 这一笔因为颜料用完被挡住了 */
  ranOut = false;
  onChange?: () => void;
  onEnter?: () => void;
  onExit?: () => void;

  private rowW: Float32Array;
  private undo: Map<number, Uint8Array>[] = [];
  private stroke: Map<number, Uint8Array> | null = null;
  private lastN: THREE.Vector3 | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; cx: number; cy: number } | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirtyAny = false;
  private ray = new THREE.Ray();
  private sphere = new THREE.Sphere();
  private q = new THREE.Quaternion();
  private m3 = new THREE.Matrix3();

  constructor(
    private moon: MoonRenderer,
    private cam: WindowCamera,
    private canvas: HTMLCanvasElement
  ) {
    this.data = new Uint8Array(this.W * this.H * 4);
    this.texture = new THREE.DataTexture(this.data, this.W, this.H, THREE.RGBAFormat);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.wrapS = THREE.RepeatWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.needsUpdate = true;
    // 每一行一个像素占球面多少（按 cos 纬度），全部加起来 = 1
    this.rowW = new Float32Array(this.H);
    let sum = 0;
    for (let y = 0; y < this.H; y++) {
      const lat = ((y + 0.5) / this.H - 0.5) * Math.PI;
      this.rowW[y] = Math.cos(lat);
      sum += this.rowW[y] * this.W;
    }
    for (let y = 0; y < this.H; y++) this.rowW[y] /= sum;
    moon.body.setPaint(this.texture);
    this.load();

    canvas.addEventListener("pointerdown", (e) => this.onDown(e));
    addEventListener("pointermove", (e) => this.onMove(e));
    addEventListener("pointerup", (e) => this.onUp(e));
    addEventListener("pointercancel", (e) => this.onUp(e));
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (!this.active) return;
        e.preventDefault();
        this.zoomBy(Math.exp(-e.deltaY * 0.0012));
      },
      { passive: false }
    );
  }

  /** 剩下的颜料 0..1 */
  get left() {
    return Math.max(0, 1 - this.used / params.paint.capacity);
  }
  get canUndo() {
    return this.undo.length > 0;
  }

  enter() {
    if (this.active) return;
    this.active = true;
    this.moon.paintMode = true;
    this.moon.paintZoom = params.paint.zoom;
    // 从它现在的朝向开始（脸对着你）
    this.moon.paintRot.copy(this.moon.body.mesh.quaternion);
    this.moon.exprOverride = "calm";
    this.onEnter?.();
    this.onChange?.();
  }

  exit() {
    if (!this.active) return;
    this.endStroke();
    this.active = false;
    this.moon.paintMode = false;
    this.moon.exprOverride = null;
    this.moon.flashExpr("happy", 1.4);
    this.save();
    this.onExit?.();
  }

  clear() {
    this.endStroke();
    // 一键清除也能撤销：整张图拆成块存下来（只存有颜料的块）
    const rec = new Map<number, Uint8Array>();
    for (let ty = 0; ty < this.H / TILE; ty++) {
      for (let tx = 0; tx < this.W / TILE; tx++) {
        const snap = this.tileCopy(tx, ty);
        let any = false;
        for (let i = 3; i < snap.length; i += 4) if (snap[i]) { any = true; break; }
        if (any) rec.set(ty * 1000 + tx, snap);
      }
    }
    if (rec.size) this.pushUndo(rec);
    this.data.fill(0);
    this.used = 0;
    this.texture.clearUpdateRanges();
    this.texture.needsUpdate = true;
    this.scheduleSave();
    this.onChange?.();
  }

  undoLast() {
    this.endStroke();
    const rec = this.undo.pop();
    if (!rec) return;
    for (const [key, snap] of rec) this.tileRestore(key % 1000, Math.floor(key / 1000), snap);
    this.recount();
    this.texture.clearUpdateRanges();
    this.texture.needsUpdate = true;
    this.scheduleSave();
    this.onChange?.();
  }

  zoomBy(k: number) {
    const P = params.paint;
    this.moon.paintZoom = THREE.MathUtils.clamp(this.moon.paintZoom * k, P.zoomMin, P.zoomMax);
  }

  /** 每帧：有改动就上传（只传改动过的行） */
  update() {
    if (this.dirtyAny) {
      this.texture.needsUpdate = true;
      this.dirtyAny = false;
    }
  }

  // ───────────── 手势 ─────────────

  private onDown(e: PointerEvent) {
    if (!this.active) return;
    e.preventDefault();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      this.canvas.setPointerCapture?.(e.pointerId);
    } catch {
      /* 没有活动指针（合成事件）：不抓也行 */
    }
    if (this.pointers.size === 2) {
      // 第二根手指：这一笔作废成「转 / 缩放」
      this.endStroke();
      this.pinch = this.pinchState();
      return;
    }
    if (this.tool === "hand") return;
    this.stroke = new Map();
    this.ranOut = false;
    this.lastN = null;
    this.paintAt(e.clientX, e.clientY);
    // 画到脸附近：痒，嘿嘿
    const ln = this.lastN as THREE.Vector3 | null;
    if (ln && ln.z > 0.75 && this.tool === "brush") this.moon.flashExpr("giggle", 0.9);
  }

  private onMove(e: PointerEvent) {
    if (!this.active || !this.pointers.has(e.pointerId)) return;
    const prev = this.pointers.get(e.pointerId)!;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size >= 2) {
      const now = this.pinchState();
      if (this.pinch) {
        this.rotateBy(now.cx - this.pinch.cx, now.cy - this.pinch.cy);
        if (this.pinch.d > 0) this.zoomBy(now.d / this.pinch.d);
      }
      this.pinch = now;
      return;
    }
    if (this.tool === "hand") {
      this.rotateBy(e.clientX - prev.x, e.clientY - prev.y);
      return;
    }
    if (this.stroke) this.paintAt(e.clientX, e.clientY);
  }

  private onUp(e: PointerEvent) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) this.endStroke();
  }

  private pinchState() {
    const ps = [...this.pointers.values()];
    const a = ps[0];
    const b = ps[1] ?? ps[0];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  /** 拖动转球：横着拖绕竖轴转，竖着拖绕横轴转（屏幕宽度 = 半圈） */
  private rotateBy(dx: number, dy: number) {
    const k = Math.PI / Math.max(320, this.canvas.clientWidth);
    const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * k);
    const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * k);
    this.moon.paintRot.premultiply(qx).premultiply(qy).normalize();
  }

  private endStroke() {
    if (this.stroke && this.stroke.size) this.pushUndo(this.stroke);
    const had = !!this.stroke;
    this.stroke = null;
    this.lastN = null;
    if (had) {
      this.scheduleSave();
      this.onChange?.();
    }
  }

  private pushUndo(rec: Map<number, Uint8Array>) {
    this.undo.push(rec);
    while (this.undo.length > UNDO_MAX) this.undo.shift();
  }

  // ───────────── 画 ─────────────

  /** 屏幕上的一点 → 月球表面（物体坐标的单位向量）；没点到月亮 = null */
  private hit(clientX: number, clientY: number): THREE.Vector3 | null {
    const r = this.canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1;
    const ny = -(((clientY - r.top) / r.height) * 2 - 1);
    this.cam.ray(nx, ny, this.ray);
    this.sphere.set(this.moon.center, this.moon.radius);
    const p = this.ray.intersectSphere(this.sphere, new THREE.Vector3());
    if (!p) return null;
    this.moon.body.mesh.getWorldQuaternion(this.q).invert();
    return p.sub(this.moon.center).normalize().applyQuaternion(this.q);
  }

  private paintAt(clientX: number, clientY: number) {
    const n = this.hit(clientX, clientY);
    if (!n) {
      this.lastN = null;
      return;
    }
    const P = params.paint;
    const radius = this.tool === "eraser" ? P.eraser : P.brush;
    const rgb = this.tool === "eraser" ? null : hexRGB(P.colors[this.color] ?? P.colors[0]);
    // 和上一点之间按大圆弧补点（快速划过也是连续的一笔）
    const step = ((radius * 0.35) / this.W) * Math.PI * 2;
    if (this.lastN) {
      const ang = this.lastN.angleTo(n);
      const k = Math.min(200, Math.ceil(ang / step));
      for (let i = 1; i <= k; i++) {
        const m = this.lastN.clone().lerp(n, i / k).normalize();
        this.stampN(m, radius, rgb);
      }
    } else this.stampN(n, radius, rgb);
    this.lastN = n;
    this.onChange?.();
  }

  private stampN(n: THREE.Vector3, radius: number, rgb: [number, number, number] | null) {
    // 月面贴图坐标（和着色器里一样：uTexRot · n → 经纬度）
    this.m3.copy(this.moon.body.texRot);
    const t = n.clone().applyMatrix3(this.m3);
    const lon = Math.atan2(t.x, t.z);
    const lat = Math.asin(THREE.MathUtils.clamp(t.y, -1, 1));
    this.stamp(0.5 + lon / (Math.PI * 2), 0.5 + lat / Math.PI, radius, rgb);
  }

  /** 在画布上盖一个章：u/v 0..1（v = 0 是南极），半径是赤道上的像素；靠近两极横向拉宽（球面上还是圆的） */
  private stamp(u: number, v: number, radius: number, rgb: [number, number, number] | null) {
    const { W, H, data } = this;
    const cap = params.paint.capacity;
    const cy = v * H;
    const lat = (v - 0.5) * Math.PI;
    const rx = radius / Math.max(0.12, Math.cos(lat));
    const ry = radius;
    const cx = u * W;
    const y0 = Math.max(0, Math.floor(cy - ry - 1));
    const y1 = Math.min(H - 1, Math.ceil(cy + ry + 1));
    for (let y = y0; y <= y1; y++) {
      const dy = (y + 0.5 - cy) / ry;
      if (dy * dy > 1.1) continue;
      const span = Math.sqrt(Math.max(0, 1.1 - dy * dy)) * rx;
      const xa = Math.floor(cx - span - 1);
      const xb = Math.ceil(cx + span + 1);
      let touched = false;
      for (let xx = xa; xx <= xb; xx++) {
        const dx = (xx + 0.5 - cx) / rx;
        const d = Math.sqrt(dx * dx + dy * dy);
        const a = Math.min(1, Math.max(0, (1 - d) * radius * 0.8));
        if (a <= 0) continue;
        const x = ((xx % W) + W) % W;
        const o = (y * W + x) * 4;
        const b0 = data[o + 3];
        let b1: number;
        if (rgb) {
          b1 = Math.min(255, Math.round(b0 + (255 - b0) * a));
          if (b1 <= b0) continue;
          // 颜料不够：只补到剩下的那么多
          const room = cap - this.used;
          const cost = ((b1 - b0) / 255) * this.rowW[y];
          if (cost > room) {
            this.ranOut = true;
            if (room <= 0) continue;
            b1 = b0 + Math.floor((room / this.rowW[y]) * 255);
            if (b1 <= b0) continue;
          }
          this.touchTile(x, y);
          const k = (b1 - b0) / Math.max(1, b1);
          data[o] = Math.round(data[o] * (1 - k) + rgb[0] * k);
          data[o + 1] = Math.round(data[o + 1] * (1 - k) + rgb[1] * k);
          data[o + 2] = Math.round(data[o + 2] * (1 - k) + rgb[2] * k);
        } else {
          b1 = Math.round(b0 * (1 - a));
          if (b1 >= b0) continue;
          this.touchTile(x, y);
        }
        data[o + 3] = b1;
        this.used += ((b1 - b0) / 255) * this.rowW[y];
        touched = true;
      }
      if (touched) {
        if (xa < 0 || xb >= W) this.texture.addUpdateRange(y * W * 4, W * 4);
        else this.texture.addUpdateRange((y * W + xa) * 4, (xb - xa + 1) * 4);
        this.dirtyAny = true;
      }
    }
    if (this.used < 0) this.used = 0;
  }

  // ───────────── 撤销（按 64×64 的块，改之前先存一份） ─────────────

  private touchTile(x: number, y: number) {
    if (!this.stroke) return;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    const key = ty * 1000 + tx;
    if (!this.stroke.has(key)) this.stroke.set(key, this.tileCopy(tx, ty));
  }

  private tileCopy(tx: number, ty: number) {
    const out = new Uint8Array(TILE * TILE * 4);
    for (let r = 0; r < TILE; r++) {
      const src = ((ty * TILE + r) * this.W + tx * TILE) * 4;
      out.set(this.data.subarray(src, src + TILE * 4), r * TILE * 4);
    }
    return out;
  }

  private tileRestore(tx: number, ty: number, snap: Uint8Array) {
    for (let r = 0; r < TILE; r++) {
      const dst = ((ty * TILE + r) * this.W + tx * TILE) * 4;
      this.data.set(snap.subarray(r * TILE * 4, (r + 1) * TILE * 4), dst);
    }
  }

  private recount() {
    let used = 0;
    for (let y = 0; y < this.H; y++) {
      let row = 0;
      const base = y * this.W * 4 + 3;
      for (let x = 0; x < this.W; x++) row += this.data[base + x * 4];
      used += (row / 255) * this.rowW[y];
    }
    this.used = used;
  }

  // ───────────── 存 / 读（本机；PNG，稀疏的涂鸦只有几十 KB） ─────────────

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 1200);
  }

  save() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      if (this.used <= 0) {
        localStorage.removeItem(SAVE_KEY);
        return;
      }
      const c = document.createElement("canvas");
      c.width = this.W;
      c.height = this.H;
      const g = c.getContext("2d")!;
      const img = g.createImageData(this.W, this.H);
      // 画布的行 0 是南极；PNG 按北在上存（肉眼看得懂）
      for (let y = 0; y < this.H; y++) img.data.set(this.data.subarray(y * this.W * 4, (y + 1) * this.W * 4), (this.H - 1 - y) * this.W * 4);
      g.putImageData(img, 0, 0);
      localStorage.setItem(SAVE_KEY, c.toDataURL("image/png"));
    } catch {
      /* 存不下（隐私模式 / 空间满）：这次先不存 */
    }
  }

  private load() {
    let url: string | null = null;
    try {
      url = localStorage.getItem(SAVE_KEY);
    } catch {
      url = null;
    }
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = this.W;
        c.height = this.H;
        const g = c.getContext("2d", { willReadFrequently: true })!;
        g.drawImage(img, 0, 0, this.W, this.H);
        const d = g.getImageData(0, 0, this.W, this.H).data;
        for (let y = 0; y < this.H; y++) this.data.set(d.subarray((this.H - 1 - y) * this.W * 4, (this.H - y) * this.W * 4), y * this.W * 4);
        this.recount();
        this.texture.clearUpdateRanges();
        this.texture.needsUpdate = true;
        this.onChange?.();
      } catch {
        /* 读不出来：当作没画过 */
      }
    };
    img.src = url;
  }
}

/** "#rrggbb" → sRGB 字节（画布按 sRGB 存，不要经过 three 的线性色彩空间） */
function hexRGB(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
