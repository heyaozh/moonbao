// 月亮本体：一个球 + 画在球面上的脸 + 光晕。
// 2026-09-26 用户：脸固定在月亮上——整个球转过来看你，纹理和表情一起转，不是表情在表面上漂移。
// 所以眼、嘴、腮红都在着色器里按「物体局部坐标」画（距离场 + 抗锯齿，特写时依然清晰），跟着球的旋转和压扁一起变形。
// 月相 = 世界坐标里的一盏方向光（真实月相与亮边方向由 world.ts 给），轮廓永远是圆的。

import * as THREE from "three";
import { bakeCraters } from "./craters";
import type { FaceParams } from "./expressions";
import { params } from "./params";
import { asset } from "../asset";

const vert = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vWN;
  varying vec3 vWP;
  void main() {
    vObj = normalize(position);
    vWN = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWP = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const frag = /* glsl */ `
  float sstep(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
  uniform sampler2D uAlbedo, uHeight, uCraters, uPaint;
  uniform float uCraterDetail;
  uniform mat3 uTexRot, uObjToWorld;
  uniform vec3 uSunDir;
  uniform float uEarthshine, uSoft, uWrap, uSSS, uBright, uRim, uGlow, uSelfGlow, uRealism, uBump, uTexContrast, uLimb, uVolume;
  uniform vec3 uVolumeDir;
  uniform vec3 uLit, uShade, uSSSColor, uRimColor, uSelfGlowColor;
  // 脸
  uniform float uEyeSpacing, uEyeY, uEyeW, uEyeH, uHlX, uHlY, uHlSize, uHl, uGazeRange;
  uniform float uHl2, uHl2X, uHl2Y, uHl2Size, uFaceOn, uHatch;
  uniform float uMouthBelow, uMouthWidth, uMouthTh, uSmileDepth, uCat;
  uniform float uBlushX, uBlushBelow, uBlushR, uBlushFeather, uBlushOpacity, uBlushAspect;
  uniform vec3 uEyeColor, uMouthColor, uMouthInner, uTongue, uBlushColor;
  uniform vec2 uOpen;       // 左右眼睁开
  uniform float uHappy, uSqueeze, uDizzy, uClosed, uEyeScale, uSad, uHeart;
  uniform vec3 uHeartColor;
  uniform vec2 uGaze;
  uniform float uCurve, uMouthOpen, uMWidth, uRound, uWave;
  uniform float uTime;
  varying vec3 vObj;
  varying vec3 vWN;
  varying vec3 vWP;
  const float PI = 3.14159265;

  float sdEllipse(vec2 p, vec2 r) {
    float k0 = length(p / r);
    float k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / max(k1, 1e-5);
  }
  float sdSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }
  // 圆弧（以 +y 为对称轴，张角 sc = (sin, cos)，半径 ra），返回到弧线的距离
  float sdArc(vec2 p, vec2 sc, float ra) {
    p.x = abs(p.x);
    return (sc.y * p.x > sc.x * p.y) ? length(p - sc * ra) : abs(length(p) - ra);
  }
  // 过 (±w, 0)、弧顶在 (0, h) 的圆弧（h>0 向上拱 ∩，h<0 向下 ∪）
  float sdBow(vec2 p, float w, float h) {
    float s = sign(h);
    h = max(abs(h), 1e-4);
    p.y *= s;
    float R = (w * w + h * h) / (2.0 * h);
    vec2 c = vec2(0.0, h - R);
    vec2 sc = vec2(w / R, (R - h) / R);
    return sdArc(p - c, sc, R);
  }
  // ♥（iq）：尖在原点、顶在 y≈1、最宽约 ±0.6
  float sdHeart(vec2 p) {
    p.x = abs(p.x);
    if (p.y + p.x > 1.0) { vec2 q = p - vec2(0.25, 0.75); return length(q) - sqrt(2.0) / 4.0; }
    vec2 q1 = p - vec2(0.0, 1.0);
    vec2 q2 = p - 0.5 * max(p.x + p.y, 0.0);
    return sqrt(min(dot(q1, q1), dot(q2, q2))) * sign(p.x - p.y);
  }
  float sdSpiral(vec2 p, float k, float rmax) {
    float r = length(p);
    float a = atan(p.y, p.x) + uTime * 7.0;
    float t = r / k - a / (2.0 * PI);
    float d = abs(fract(t) - 0.5) * k;
    return r > rmax ? r - rmax : d;
  }

  // 一只眼的覆盖度（side = -1 左眼 / +1 右眼）
  float eye(vec2 p, float side, float open, float aa, out float hl) {
    float ew = uEyeW * uEyeScale;
    float eh = uEyeH * uEyeScale;
    // 难过：眼角往外下垂一点
    float tilt = side * uSad * 0.35;
    p = mat2(cos(tilt), -sin(tilt), sin(tilt), cos(tilt)) * p;
    float th = uEyeH * 0.19;
    // 圆 / 闭：竖向缩放，最细是一条线
    float hOpen = max(eh * open, th * 0.8);
    float dOval = sdEllipse(p, vec2(ew * mix(1.12, 1.0, open), hOpen));
    // ^ 笑眼：向上拱的弧
    float dHappy = sdBow(p + vec2(0.0, eh * 0.25), ew * 1.05, eh * 0.95) - th;
    // > < 挤眼：两段斜线
    float sx = -side;
    float dSq = min(sdSegment(p, vec2(-sx * ew, eh * 0.75), vec2(sx * ew * 0.9, 0.0)), sdSegment(p, vec2(sx * ew * 0.9, 0.0), vec2(-sx * ew, -eh * 0.75))) - th;
    // @ 晕：旋涡
    float dDz = sdSpiral(p * vec2(1.0, 0.95), eh * 0.42, eh * 1.25) - th * 0.8;
    // ‿ 安详地闭着：向下弯的弧
    float dClosed = sdBow(p - vec2(0.0, eh * 0.1), ew * 1.0, -eh * 0.5) - th * 0.9;
    float d = mix(dOval, dHappy, uHappy);
    d = mix(d, dClosed, uClosed);
    // ♥ 爱心眼：比眼睛略大，轻轻跳动（只有秘密彩蛋会把 uHeart 推起来）
    float hs = eh * 1.75 * (1.0 + 0.06 * uHeart * sin(uTime * 7.0));
    float dHeart = sdHeart((p + vec2(0.0, hs * 0.5)) / hs) * hs;
    d = mix(d, dHeart, uHeart);
    d = mix(d, dSq, uSqueeze);
    d = mix(d, dDz, uDizzy);
    // 难过：上眼睑斜切掉内上角
    if (uSad > 0.01) {
      vec2 n = normalize(vec2(side * 0.55, 1.0));
      float lid = dot(p, n) - eh * mix(1.2, 0.35, uSad);
      d = max(d, lid);
    }
    float cov = sstep(aa, -aa, d);
    // 高光：只在圆眼上
    float hv = (1.0 - uHappy) * (1.0 - uSqueeze) * (1.0 - uDizzy) * (1.0 - uClosed) * sstep(0.35, 0.8, open);
    vec2 hp = p - vec2(uHlX * ew, uHlY * eh);
    hl = hv * sstep(uHlSize * ew + aa, uHlSize * ew - aa, length(hp)) * cov;
    // 第二个高光（星星眼）
    if (uHl2 > 0.001) {
      vec2 hp2 = p - vec2(uHl2X * ew, uHl2Y * eh);
      hl = max(hl, uHl2 * hv * sstep(uHl2Size * ew + aa, uHl2Size * ew - aa, length(hp2)) * cov);
    }
    return cov;
  }

  void main() {
    vec3 n = normalize(vObj);
    // ---- 月面贴图坐标（脸的位置由 uTexRot 决定）----
    vec3 tn = uTexRot * n;
    float lon = atan(tn.x, tn.z);
    float lat = asin(clamp(tn.y, -1.0, 1.0));
    vec2 uv = vec2(0.5 + lon / (2.0 * PI), 0.5 + lat / PI);
    vec2 uv2 = vec2(fract(uv.x + 0.5) - 0.5, uv.y);
    vec2 dx = dFdx(uv), dy = dFdy(uv), dx2 = dFdx(uv2), dy2 = dFdy(uv2);
    if (dot(dx, dx) + dot(dy, dy) > dot(dx2, dx2) + dot(dy2, dy2)) { dx = dx2; dy = dy2; }
    vec3 tex = textureGrad(uAlbedo, uv, dx, dy).rgb;
    float tl = dot(tex, vec3(0.3, 0.59, 0.11));
    // 贴图近侧的平均反照率（线性）实测 0.22：按它归一化，再调对比，保住设定里的暖白月色
    vec3 texN = clamp(mix(vec3(1.0), tex / 0.22, uTexContrast), 0.25, 1.9);
    vec3 albedo = mix(vec3(1.0), texN, uRealism);
    // 程序化小坑：坑底暗、坑沿亮
    vec2 cr = textureGrad(uCraters, uv, dx, dy).rg - 0.5;
    albedo *= 1.0 + cr.y * 1.6 * uCraterDetail;

    // ---- 凹凸：高程差分 → 扰动法线（在贴图坐标系里做，再转回物体、世界）----
    vec3 N = normalize(vWN);
    if ((uBump > 0.001 && uRealism > 0.001) || uCraterDetail > 0.001) {
      vec2 e = vec2(1.0 / 1024.0, 1.0 / 512.0);
      float h0 = textureGrad(uHeight, uv, dx, dy).r;
      float hu = textureGrad(uHeight, uv + vec2(e.x, 0.0), dx, dy).r - h0;
      float hv = textureGrad(uHeight, uv + vec2(0.0, e.y), dx, dy).r - h0;
      vec3 east = vec3(cos(lon), 0.0, -sin(lon));
      vec3 north = vec3(-sin(lat) * sin(lon), cos(lat), -sin(lat) * cos(lon));
      vec2 ec = vec2(1.0 / 2048.0, 1.0 / 1024.0);
      float c0 = cr.x;
      float cu = textureGrad(uCraters, uv + vec2(ec.x, 0.0), dx, dy).r - 0.5 - c0;
      float cv = textureGrad(uCraters, uv + vec2(0.0, ec.y), dx, dy).r - 0.5 - c0;
      vec3 tn2 = normalize(tn - uBump * uRealism * 30.0 * (hu * east + hv * north) - uCraterDetail * 9.0 * (cu * east + cv * north));
      vec3 n2 = transpose(uTexRot) * tn2;
      N = normalize(uObjToWorld * n2);
    }

    // ---- 光照 ----
    vec3 L = normalize(uSunDir);
    vec3 V = normalize(cameraPosition - vWP);
    float ndl = dot(N, L);
    float term = sstep(-uSoft, uSoft, ndl);
    float wrapD = pow(clamp((ndl + uWrap) / (1.0 + uWrap), 0.0, 1.0), 0.7);
    float direct = term * mix(1.0, wrapD, 0.55);
    float ndv = max(dot(N, V), 0.0);
    // 地照只照暗面（亮面再叠一层蓝会把暖白冲成橄榄色）
    float es = uEarthshine * (0.55 + 0.45 * ndv) * (1.0 - term * 0.9);
    float limb = mix(1.0 - uLimb, 1.0, pow(ndv, 0.6));
    // 体积感：左上方的一盏弱光调制（与月相无关），让满月也有球的立体感
    float vol = mix(1.0, 0.55 + 0.6 * max(dot(N, normalize(uVolumeDir)), 0.0), uVolume);
    limb *= vol;
    vec3 col = albedo * (uLit * direct * uBright * limb + uShade * es);
    // 交界线附近的暖色透光
    float bq = ndl / 0.22;
    float band = exp(-bq * bq);
    col += uSSSColor * uSSS * band * term * 0.35 * albedo;
    // 边缘泛光：亮面暖、暗面一点点冷
    float fres = pow(clamp(1.0 - ndv, 0.0, 1.0), 3.0);
    col += uRimColor * uRim * fres * (0.25 + 0.75 * term) * uGlow;
    col += uSelfGlowColor * uSelfGlow * uGlow * albedo;
    col *= mix(0.72, 1.0, clamp(uGlow, 0.0, 1.0)) + max(uGlow - 1.0, 0.0) * 0.3;
    float lightLevel = clamp(direct * uBright + es, 0.0, 1.5);

    // ---- 你画的颜料（G1）：跟着月面走，受同样的明暗，在脸下面 ----
    vec4 pnt = textureGrad(uPaint, uv, dx, dy);
    col = mix(col, pnt.rgb * (0.3 + 0.85 * clamp(lightLevel, 0.0, 1.2)), pnt.a);

    // ---- 脸：物体局部坐标的正面（+z）上，正交投影到脸平面 ----
    if (n.z > 0.05 && uFaceOn > 0.5) {
      vec2 p = n.xy;
      float aa = max(fwidth(p.x), fwidth(p.y)) * 1.1;
      vec2 gaze = uGaze * uGazeRange;
      vec2 eyeC = vec2(uEyeSpacing * 0.5, uEyeY);
      float hlL, hlR;
      float eL = eye(p - (vec2(-eyeC.x, eyeC.y) + gaze), -1.0, uOpen.x, aa, hlL);
      float eR = eye(p - (eyeC + gaze), 1.0, uOpen.y, aa, hlR);
      float eyes = max(eL, eR);
      // 腮红
      vec2 bc = vec2(uBlushX, uEyeY - uBlushBelow);
      vec2 bs = vec2(1.0 / max(uBlushAspect, 0.2), 1.0);
      float bd = min(length((p - vec2(-bc.x, bc.y)) * bs), length((p - bc) * bs));
      float blush = uBlushOpacity * (1.0 - sstep(uBlushR * (1.0 - uBlushFeather), uBlushR, bd));
      col = mix(col, uBlushColor * max(lightLevel, 0.4) * 0.9, blush * 0.9);
      // 害羞的斜线腮红 ///：腮红里几道短斜线（深一点的粉）
      if (uHatch > 0.001) {
        vec2 lc = p.x < 0.0 ? p - vec2(-bc.x, bc.y) : p - bc;
        float w = uBlushR * 0.36;
        float sl = lc.x + lc.y * 0.6;
        float dl = abs(fract(sl / w + 0.5) - 0.5) * w;
        float line = 1.0 - sstep(uBlushR * 0.055 - aa, uBlushR * 0.055 + aa, dl);
        float box = (1.0 - sstep(uBlushR * 0.38, uBlushR * 0.46, abs(lc.y))) * (1.0 - sstep(uBlushR * 0.78, uBlushR * 0.9, abs(lc.x)));
        col = mix(col, uBlushColor * 0.62 * max(lightLevel, 0.4), line * box * uHatch);
      }
      // 嘴
      vec2 mp = p - vec2(gaze.x * 0.5, uEyeY - uMouthBelow + gaze.y * 0.4);
      float mw = uMouthWidth * 0.5 * uMWidth;
      float th = uMouthTh * 0.5;
      float depth = uCurve * uSmileDepth;
      float dStroke = sdBow(mp, mw, -depth) - th;
      // 张开：微笑的碗（弧线与顶边之间填满）
      float openD = uMouthOpen * uSmileDepth * 2.2;
      float R = (mw * mw + (abs(depth) + openD) * (abs(depth) + openD)) / (2.0 * max(abs(depth) + openD, 1e-4));
      float dDisk = length(mp - vec2(0.0, -(abs(depth) + openD) + R)) - R;
      float dFill = max(dDisk, mp.y - 0.25 * th);
      float dSmile = uMouthOpen > 0.02 ? min(dStroke, dFill) : dStroke;
      // 猫嘴 ω：两段小微笑弧并排，在中间顶上相接（张嘴时用原来的碗）
      if (uCat > 0.001) {
        float hw = mw * 0.5;
        float dCat = min(sdBow(mp - vec2(hw, 0.0), hw, -depth * 1.1), sdBow(mp + vec2(hw, 0.0), hw, -depth * 1.1)) - th;
        dSmile = mix(dSmile, dCat, uCat * (1.0 - clamp(uMouthOpen * 3.0, 0.0, 1.0)));
      }
      // o 型
      vec2 orad = vec2(0.026 + 0.022 * uMouthOpen, 0.02 + 0.04 * uMouthOpen) * mix(1.0, uMWidth, 0.5);
      float dO = sdEllipse(mp + vec2(0.0, 0.01), orad);
      // 波浪（委屈 / 晕）
      float wx = clamp(mp.x, -mw, mw);
      float dWave = length(vec2(mp.x - wx, mp.y - 0.011 * sin(wx / mw * 7.0))) - th;
      float dM = mix(dSmile, dO, uRound);
      dM = mix(dM, dWave, uWave);
      float mouth = sstep(aa, -aa, dM);
      float inner = sstep(aa, -aa, dM + th * 1.2) * clamp(uMouthOpen * 1.5 + uRound * uMouthOpen, 0.0, 1.0);
      // 张嘴时下半部分是粉色小舌头
      float tongue = inner * (1.0 - sstep(-0.75, -0.2, mp.y / max(abs(depth) + openD, 1e-3))) * clamp(uMouthOpen * 2.0 - 0.3, 0.0, 1.0);
      vec3 mcol = mix(mix(uMouthColor, uMouthInner, inner), uTongue, tongue);
      col = mix(col, mcol * mix(0.35, 1.0, clamp(lightLevel, 0.0, 1.0)), mouth);
      // 眼睛：哑光深色 + 小高光（暗部也看得见）；爱心眼是粉红的
      col = mix(col, mix(uEyeColor, uHeartColor, uHeart), eyes);
      col += vec3(1.0) * (hlL + hlR) * uHl * mix(0.45, 1.0, clamp(lightLevel, 0.0, 1.0));
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** 还没画过：1×1 全透明 */
function emptyPaint() {
  const t = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

function makeHaloTexture() {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.28, "rgba(255,255,255,0.55)");
  grd.addColorStop(0.5, "rgba(255,255,255,0.18)");
  grd.addColorStop(0.75, "rgba(255,255,255,0.05)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class MoonBody {
  /** 位置节点（世界坐标） */
  readonly root = new THREE.Group();
  /** 压扁节点：沿任意方向的体积守恒缩放（撞墙、被戳时用），矩阵手动设置 */
  readonly squashNode = new THREE.Object3D();
  /** 球本身：朝向 = 看你 + 动作 */
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly halo: THREE.Sprite;
  private texReady = { albedo: false, height: false };

  constructor() {
    const P = params;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uAlbedo: { value: null },
        uPaint: { value: emptyPaint() },
        uHeight: { value: null },
        uCraters: { value: null },
        uCraterDetail: { value: 0 },
        uTexRot: { value: new THREE.Matrix3() },
        uObjToWorld: { value: new THREE.Matrix3() },
        uSunDir: { value: new THREE.Vector3(0, 0, 1) },
        uEarthshine: { value: 0.2 },
        uSoft: { value: P.moon.terminatorSoftness },
        uWrap: { value: P.moon.wrap },
        uSSS: { value: P.moon.sss },
        uSSSColor: { value: new THREE.Color(P.moon.sssColor) },
        uBright: { value: P.moon.brightness },
        uRim: { value: P.moon.rim },
        uRimColor: { value: new THREE.Color(P.moon.rimColor) },
        uGlow: { value: 1 },
        uSelfGlow: { value: P.moon.selfGlow },
        uSelfGlowColor: { value: new THREE.Color(P.moon.selfGlowColor) },
        uRealism: { value: 0 },
        uBump: { value: 0 },
        uTexContrast: { value: P.moon.textureContrast },
        uLimb: { value: P.moon.limbDarkening },
        uVolume: { value: P.moon.volume },
        uVolumeDir: { value: new THREE.Vector3(-0.55, 0.6, 0.6) },
        uLit: { value: new THREE.Color(P.moon.litColor) },
        uShade: { value: new THREE.Color(P.moon.shadeColor) },
        uEyeSpacing: { value: 0.54 },
        uEyeY: { value: 0 },
        uEyeW: { value: 0.06 },
        uEyeH: { value: 0.07 },
        uHlX: { value: 0 },
        uHlY: { value: 0 },
        uHlSize: { value: 0.2 },
        uHl: { value: 1 },
        uHl2: { value: 0 },
        uFaceOn: { value: 1 },
        uHatch: { value: 0 },
        uHl2X: { value: 0.3 },
        uHl2Y: { value: -0.3 },
        uHl2Size: { value: 0.13 },
        uCat: { value: 0 },
        uBlushAspect: { value: 1 },
        uGazeRange: { value: 0.06 },
        uMouthBelow: { value: 0.2 },
        uMouthWidth: { value: 0.2 },
        uMouthTh: { value: 0.02 },
        uSmileDepth: { value: 0.05 },
        uBlushX: { value: 0.46 },
        uBlushBelow: { value: 0.14 },
        uBlushR: { value: 0.1 },
        uBlushFeather: { value: 0.8 },
        uBlushOpacity: { value: 0.4 },
        uEyeColor: { value: new THREE.Color() },
        uMouthColor: { value: new THREE.Color() },
        uMouthInner: { value: new THREE.Color() },
        uTongue: { value: new THREE.Color() },
        uBlushColor: { value: new THREE.Color() },
        uOpen: { value: new THREE.Vector2(1, 1) },
        uHappy: { value: 0 },
        uSqueeze: { value: 0 },
        uDizzy: { value: 0 },
        uClosed: { value: 0 },
        uEyeScale: { value: 1 },
        uSad: { value: 0 },
        uHeart: { value: 0 },
        uHeartColor: { value: new THREE.Color() },
        uGaze: { value: new THREE.Vector2() },
        uCurve: { value: 0.6 },
        uMouthOpen: { value: 0 },
        uMWidth: { value: 1 },
        uRound: { value: 0 },
        uWave: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: vert,
      fragmentShader: frag,
    });
    const loader = new THREE.TextureLoader();
    loader.load(asset(P.moon.albedoUrl), (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = THREE.RepeatWrapping;
      t.anisotropy = 8;
      mat.uniforms.uAlbedo.value = t;
      this.texReady.albedo = true;
    });
    loader.load(asset(P.moon.heightUrl), (t) => {
      t.wrapS = THREE.RepeatWrapping;
      mat.uniforms.uHeight.value = t;
      this.texReady.height = true;
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), mat);
    this.mesh.renderOrder = 0;
    this.squashNode.matrixAutoUpdate = false;
    this.squashNode.add(this.mesh);
    this.root.add(this.squashNode);

    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: makeHaloTexture(), color: new THREE.Color(P.light.haloColor), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.halo.renderOrder = -5;
  }

  /** 烘焙程序化陨石坑贴图（需要渲染器，App 建好舞台后调用一次）。 */
  bake(renderer: THREE.WebGLRenderer, size = 2048) {
    const t = bakeCraters(renderer, size, size / 2);
    this.mesh.material.uniforms.uCraters.value = t;
    this.cratersReady = true;
  }
  private cratersReady = false;

  get ready() {
    return this.texReady.albedo;
  }

  private tmpM = new THREE.Matrix4();
  private tmpV = new THREE.Vector3();

  /** 沿世界方向 axis 压扁 amount（>0 压扁，<0 拉长），体积守恒。 */
  /** 画月亮的画布（G1） */
  setPaint(tex: THREE.Texture) {
    this.mesh.material.uniforms.uPaint.value = tex;
  }
  /** 物体坐标 → 月面贴图坐标的旋转（和着色器里的 uTexRot 同一个） */
  get texRot(): THREE.Matrix3 {
    return this.mesh.material.uniforms.uTexRot.value as THREE.Matrix3;
  }

  setSquash(axis: THREE.Vector3, amount: number, radius: number) {
    const a = Math.max(-0.35, Math.min(0.35, amount));
    const along = 1 - a;
    const perp = 1 / Math.sqrt(Math.max(0.2, along));
    // M = perp·I + (along - perp)·nnᵀ，再乘半径
    const n = this.tmpV.copy(axis).normalize();
    const k = along - perp;
    const m = this.tmpM.set(
      perp + k * n.x * n.x, k * n.x * n.y, k * n.x * n.z, 0,
      k * n.y * n.x, perp + k * n.y * n.y, k * n.y * n.z, 0,
      k * n.z * n.x, k * n.z * n.y, perp + k * n.z * n.z, 0,
      0, 0, 0, 1
    );
    m.multiplyScalar(radius);
    m.elements[15] = 1;
    this.squashNode.matrix.copy(m);
    this.squashNode.matrixWorldNeedsUpdate = true;
  }

  update(opts: { sunDir: THREE.Vector3; earthshine: number; glow: number; face: FaceParams; blush: number; time: number; night: number; radius: number; illuminated: number }) {
    const P = params;
    const u = this.mesh.material.uniforms;
    const F = P.face;
    const f = opts.face;
    u.uSunDir.value.copy(opts.sunDir);
    u.uEarthshine.value = opts.earthshine;
    u.uGlow.value = opts.glow;
    u.uSoft.value = P.moon.terminatorSoftness;
    u.uWrap.value = P.moon.wrap;
    u.uSSS.value = P.moon.sss;
    u.uBright.value = P.moon.brightness;
    u.uRim.value = P.moon.rim;
    u.uSelfGlow.value = Math.min(P.moon.selfGlow, P.moon.selfGlowMax);
    u.uRealism.value = this.texReady.albedo ? P.moon.surfaceRealism : 0;
    u.uBump.value = this.texReady.height ? P.moon.bumpStrength : 0;
    u.uCraterDetail.value = this.cratersReady ? P.moon.craterDetail : 0;
    u.uTexContrast.value = P.moon.textureContrast;
    u.uLimb.value = P.moon.limbDarkening;
    u.uVolume.value = P.moon.volume;
    (u.uVolumeDir.value as THREE.Vector3).set(P.moon.volumeDir.x, P.moon.volumeDir.y, P.moon.volumeDir.z);
    (u.uLit.value as THREE.Color).set(P.moon.litColor);
    (u.uShade.value as THREE.Color).set(P.moon.shadeColor);
    (u.uSSSColor.value as THREE.Color).set(P.moon.sssColor);
    (u.uRimColor.value as THREE.Color).set(P.moon.rimColor);
    (u.uSelfGlowColor.value as THREE.Color).set(P.moon.selfGlowColor);
    // 脸在月面上的位置：物体 +z（脸）对应贴图的 (faceLon, faceLat)
    const lonR = THREE.MathUtils.degToRad(P.moon.faceLon);
    const latR = THREE.MathUtils.degToRad(P.moon.faceLat);
    const rot = new THREE.Matrix4().makeRotationY(lonR).multiply(new THREE.Matrix4().makeRotationX(-latR));
    (u.uTexRot.value as THREE.Matrix3).setFromMatrix4(rot);
    this.mesh.updateMatrixWorld(true);
    (u.uObjToWorld.value as THREE.Matrix3).getNormalMatrix(this.mesh.matrixWorld);
    // 脸的形状
    u.uEyeSpacing.value = F.eyeSpacing;
    u.uEyeY.value = F.eyeY;
    u.uEyeW.value = F.eyeW;
    u.uEyeH.value = F.eyeH;
    u.uHlX.value = F.highlightX;
    u.uHlY.value = F.highlightY;
    u.uHlSize.value = F.highlightSize;
    u.uHl.value = F.highlight;
    u.uHl2.value = Math.max(F.highlight2, f.sparkle);
    u.uFaceOn.value = F.visible;
    u.uHl2X.value = F.highlight2X;
    u.uHl2Y.value = F.highlight2Y;
    u.uHl2Size.value = F.highlight2Size;
    u.uCat.value = Math.max(F.catMouth, f.cat);
    u.uHatch.value = f.hatch;
    u.uBlushAspect.value = F.blushAspect;
    u.uGazeRange.value = F.gazeRange;
    u.uMouthBelow.value = F.mouthBelow;
    u.uMouthWidth.value = F.mouthWidth;
    u.uMouthTh.value = F.mouthThickness;
    u.uSmileDepth.value = F.smileDepth;
    u.uBlushX.value = F.blushX;
    u.uBlushBelow.value = F.blushBelow;
    u.uBlushR.value = F.blushRadius;
    u.uBlushFeather.value = F.blushFeather;
    u.uBlushOpacity.value = Math.min(1, F.blushBase + (F.blushMax - F.blushBase) * opts.blush);
    (u.uEyeColor.value as THREE.Color).set(F.eyeColor);
    (u.uMouthColor.value as THREE.Color).set(F.mouthColor);
    (u.uMouthInner.value as THREE.Color).set(F.mouthInner);
    (u.uTongue.value as THREE.Color).set(F.tongueColor);
    (u.uBlushColor.value as THREE.Color).set(F.blushColor);
    // 表情
    (u.uOpen.value as THREE.Vector2).set(Math.max(0, f.openL), Math.max(0, f.openR));
    u.uHappy.value = THREE.MathUtils.clamp(f.happy, 0, 1);
    u.uSqueeze.value = THREE.MathUtils.clamp(f.squeeze, 0, 1);
    u.uDizzy.value = THREE.MathUtils.clamp(f.dizzy, 0, 1);
    u.uClosed.value = THREE.MathUtils.clamp(f.closed, 0, 1);
    u.uEyeScale.value = f.eyeScale;
    u.uSad.value = THREE.MathUtils.clamp(f.sad, 0, 1);
    u.uHeart.value = THREE.MathUtils.clamp(f.heart, 0, 1);
    (u.uHeartColor.value as THREE.Color).set(F.heartColor);
    (u.uGaze.value as THREE.Vector2).set(f.gazeX, f.gazeY);
    u.uCurve.value = f.curve;
    u.uMouthOpen.value = Math.max(0, f.open);
    u.uMWidth.value = f.width;
    u.uRound.value = THREE.MathUtils.clamp(f.round, 0, 1);
    u.uWave.value = THREE.MathUtils.clamp(f.wave, 0, 1);
    u.uTime.value = opts.time;
    // 光晕：和月心同一深度，球的前半面挡住中心；夜里更明显
    this.halo.position.copy(this.root.position);
    const hs = P.light.haloScale * opts.radius * 2 * (0.9 + 0.1 * opts.glow);
    this.halo.scale.set(hs, hs, 1);
    const hm = this.halo.material as THREE.SpriteMaterial;
    // 光晕跟着亮面比例走：蛾眉月时只剩一点点
    hm.opacity = P.light.haloOpacity * opts.glow * (0.3 + 0.7 * opts.night) * (0.25 + 0.75 * opts.illuminated);
    hm.color.set(P.light.haloColor);
  }
}
