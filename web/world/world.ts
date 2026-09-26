// 世界：把天空的各层装进舞台，并按真实时间和所在地算出：天色、星空朝向、真实月相与亮边方向。
// 时间 / 月相都可以被场景或面板覆盖（录 GIF、看晨昏）。

import * as THREE from "three";
import {
  bestMilkyWayDirection,
  enuToEquatorialMatrix,
  horizontalVector,
  moonPhase,
  sunAltitude,
  type MoonPhase,
  type Vec3,
} from "../astro/astro";
import { loadLocation, type GeoLocation } from "../astro/location";
import { clamp } from "../moon/math";
import { params } from "../moon/params";
import { Backdrop, skyToneAt, type SkyTone } from "./backdrop";
import { Celestial } from "./celestial";
import { Bokeh, Clouds, EarthGlow, FillStars, Meteors } from "./layers";
import type { Stage } from "./stage";

const D2R = Math.PI / 180;

export interface WorldState {
  tone: SkyTone;
  /** 夜的程度 0..1 */
  night: number;
  /** 白天的程度 0..1（云） */
  day: number;
  /** 世界坐标里的「太阳方向」，给月亮打光（真实月相） */
  sunDir: THREE.Vector3;
  earthshine: number;
  phase: MoonPhase;
  date: Date;
}

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * 世界方向 → 赤道坐标 的矩阵（行主序）。
 * 画面中心对准银河此刻最高的一段（不低于 minViewAlt）；朝向按「以天顶为中心、上北」的星图：
 * 从中心点往星图上方挪一点，就是屏幕的「上」。真实朝向下东在左（抬头看天）；mirror = true 时左右镜像。
 */
export function skyFrame(date: Date, latDeg: number, lonDeg: number, minAltDeg: number, mirror: boolean): number[] {
  const lat = latDeg * D2R;
  const lon = lonDeg * D2R;
  const best = bestMilkyWayDirection(date, lat, lon);
  const alt = Math.max(best.alt, minAltDeg * D2R);
  const az = best.az;
  const chart = (a: number, z: number): [number, number] => {
    const rho = Math.PI / 2 - a;
    return [-rho * Math.sin(z), rho * Math.cos(z)];
  };
  const unchart = (x: number, y: number): Vec3 => {
    const rho = Math.hypot(x, y);
    const z = Math.atan2(-x, y);
    return horizontalVector(Math.PI / 2 - rho, z);
  };
  const f = horizontalVector(alt, az);
  const [cx, cy] = chart(alt, az);
  const up0 = sub(unchart(cx, cy + 0.01), f);
  // 与 f 正交化
  let u = norm(sub(up0, f.map((v) => v * dot(up0, f)) as Vec3));
  let r = norm(cross(f, u));
  if (mirror) r = [-r[0], -r[1], -r[2]];
  u = norm(cross(r, f)) as Vec3;
  if (mirror) u = [-u[0], -u[1], -u[2]];
  // ENU = r·wx + u·wy − f·wz  →  A 的三列是 r, u, −f
  const A = [r[0], u[0], -f[0], r[1], u[1], -f[1], r[2], u[2], -f[2]];
  const M = enuToEquatorialMatrix(date, lat, lon);
  const out = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[i * 3 + j] = M[i * 3] * A[j] + M[i * 3 + 1] * A[3 + j] + M[i * 3 + 2] * A[6 + j];
  return out;
}

export class World {
  readonly backdrop = new Backdrop();
  readonly celestial = new Celestial();
  readonly fill = new FillStars();
  readonly meteors = new Meteors();
  readonly bokeh = new Bokeh();
  readonly earthglow = new EarthGlow();
  readonly clouds = new Clouds();
  location: GeoLocation = loadLocation();
  /** 钟点覆盖（本地时间小时，null = 实时） */
  hourOverride: number | null = null;
  /** 日期覆盖（录制用，null = 今天） */
  dateOverride: Date | null = null;
  /** 太阳高度覆盖（度，只影响天色 / 云 / 星星亮度；场景「晨 / 昼 / 昏 / 夜」用），null = 按真实时间算 */
  sunAltOverride: number | null = null;
  private frame: number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  private frameKey = "";
  readonly state: WorldState;

  constructor(private stage: Stage) {
    stage.back.add(this.backdrop.mesh, this.celestial.milky, this.celestial.stars, this.fill.group, this.clouds.group, this.earthglow.mesh, this.meteors.group);
    stage.front.add(this.bokeh.points);
    const now = new Date();
    this.state = {
      tone: skyToneAt(-30),
      night: 1,
      day: 0,
      sunDir: new THREE.Vector3(0, 0, 1),
      earthshine: 0.2,
      phase: moonPhase(now, 0, 0),
      date: now,
    };
  }

  /** 当前的「世界时间」：实时，或被钟点 / 日期覆盖。 */
  now(): Date {
    const d = this.dateOverride ? new Date(this.dateOverride) : new Date();
    if (this.hourOverride != null) {
      const h = Math.floor(this.hourOverride);
      const m = Math.round((this.hourOverride - h) * 60);
      d.setHours(h, m, 0, 0);
    }
    return d;
  }

  update(dt: number) {
    const cam = this.stage.cam;
    const date = this.now();
    const { lat, lon } = this.location;
    // 天色
    let sunAltDeg = this.sunAltOverride ?? sunAltitude(date, lat * D2R, lon * D2R) / D2R;
    if (params.sky.alwaysNight) sunAltDeg = Math.min(sunAltDeg, -20);
    const tone = skyToneAt(sunAltDeg);
    const night = tone.night;
    const day = clamp((sunAltDeg + 5) / 9, 0, 1);
    const sunset = clamp(1 - Math.abs(sunAltDeg - 1) / 8, 0, 1) * (1 - clamp((sunAltDeg - 6) / 6, 0, 1));
    const vis = night + (1 - night) * params.sky.dayStarVisibility;

    // 星空朝向：随时间慢慢转，没必要每帧算（每分钟 / 覆盖变了才算）
    const key = `${Math.floor(date.getTime() / 60000)}|${lat.toFixed(2)}|${lon.toFixed(2)}|${params.sky.minViewAltDeg}|${params.sky.mirrorEastWest}`;
    if (key !== this.frameKey) {
      this.frameKey = key;
      this.frame = skyFrame(date, lat, lon, params.sky.minViewAltDeg, params.sky.mirrorEastWest);
    }

    // 真实月相：相位角 + 亮边方向 → 世界坐标里的太阳方向（+z 朝观察者，+y 朝上）
    let phase = this.state.phase;
    if (params.light.phaseDeg >= 0) {
      const pa = params.light.phaseDeg * D2R;
      const waxing = params.light.phaseDeg <= 180;
      const pAngle = waxing ? pa : 2 * Math.PI - pa;
      phase = {
        phaseAngle: Math.min(Math.PI, pAngle),
        illuminated: (1 + Math.cos(pa)) / 2,
        waxing,
        brightLimbAngle: params.light.limbDeg * D2R,
        cycle: ((params.light.phaseDeg + 180) % 360) / 360,
      };
    } else if (key !== this.phaseKey) {
      this.phaseKey = key;
      phase = moonPhase(date, lat * D2R, lon * D2R);
    }
    const i = phase.phaseAngle;
    const a = phase.brightLimbAngle;
    // 亮边在屏幕上的方向：从「上」逆时针转 a（朝东为正；真实朝向下东在左）
    const mirror = params.sky.mirrorEastWest ? -1 : 1;
    const ux = -Math.sin(a) * mirror;
    const uy = Math.cos(a);
    this.state.sunDir.set(Math.sin(i) * ux, Math.sin(i) * uy, Math.cos(i)).normalize();
    const es = (1 - Math.cos(i)) / 2; // 新月附近最强
    this.state.earthshine = params.light.earthshineMin + (params.light.earthshineMax - params.light.earthshineMin) * es;
    Object.assign(this.state, { tone, night, day, phase, date });

    // 各层
    this.backdrop.update(tone, cam.eye);
    const pr = this.stage.pixelRatio;
    this.celestial.update(dt, this.frame, cam.eye, cam.eyeZ, { w: cam.halfW, h: cam.halfH }, vis, pr);
    this.fill.update(dt, cam, vis, pr);
    const b = this.stage.bufferSize;
    this.meteors.update(dt, cam, b.w, b.h, vis);
    this.bokeh.update(dt, cam, b.h, 0.6 + 0.4 * night);
    this.earthglow.update(cam, night);
    this.clouds.update(dt, cam, day, sunset);
  }
  private phaseKey = "";
}
