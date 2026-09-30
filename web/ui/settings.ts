// 设置面板：右上角那颗玻璃按钮打开（2026-09-26 用户：毕竟会需要账号等设置）。
// 和输入框同一种玻璃语言；打开时背后的宇宙轻轻虚化、变暗，像把一块玻璃片拉到眼前。
// 账号先占位（即将推出）；名字、声音、画面、位置、语言、它记得的事、关于（署名）。

import { requestGeolocation, saveLocation } from "../astro/location";
import { params } from "../moon/params";

export interface Profile {
  userName: string;
  moonName: string;
  lang: "auto" | "en" | "zh";
  onboarded: boolean;
}

const PKEY = "moonbao.profile";
const SKEY = "moonbao.settings";

export function loadProfile(): Profile {
  try {
    const j = JSON.parse(localStorage.getItem(PKEY) ?? "{}");
    return { userName: j.userName ?? "", moonName: j.moonName ?? "", lang: j.lang ?? "auto", onboarded: !!j.onboarded };
  } catch {
    return { userName: "", moonName: "", lang: "auto", onboarded: false };
  }
}
export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(PKEY, JSON.stringify(p));
  } catch {
    /* 隐私模式 */
  }
}

/** 用户在设置里调过的偏好（声音、画面）：存在本机，启动时覆盖 params */
export function loadUserSettings() {
  try {
    const j = JSON.parse(localStorage.getItem(SKEY) ?? "{}");
    if (typeof j.ambient === "number") params.sound.ambient = j.ambient;
    if (typeof j.sfx === "number") params.sound.sfx = j.sfx;
    if (typeof j.muted === "boolean") params.sound.muted = j.muted;
    if (typeof j.alwaysNight === "boolean") params.sky.alwaysNight = j.alwaysNight;
    if (typeof j.mirror === "boolean") params.sky.mirrorEastWest = j.mirror;
    if (typeof j.parallax === "number") params.space.parallaxStrength = j.parallax;
  } catch {
    /* 忽略 */
  }
}
function saveUserSettings() {
  try {
    localStorage.setItem(
      SKEY,
      JSON.stringify({
        ambient: params.sound.ambient,
        sfx: params.sound.sfx,
        muted: params.sound.muted,
        alwaysNight: params.sky.alwaysNight,
        mirror: params.sky.mirrorEastWest,
        parallax: params.space.parallaxStrength,
      })
    );
  } catch {
    /* 忽略 */
  }
}

export function uiLang(p: Profile): "en" | "zh" {
  if (p.lang !== "auto") return p.lang;
  const q = new URLSearchParams(location.search).get("lang");
  if (q === "zh" || q === "en") return q;
  return (navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
}

const T = {
  en: {
    title: "Menu",
    account: "Account",
    shop: "Shop",
    shopNote: "Coming soon: paints, stickers and little outfits for your moon.",
    look: "My moon",
    lookNote: "Coming soon: choose its eyes, mouth, blush and glow — one moon that's only yours.",
    soon: "Soon",
    signIn: "Sign in — coming soon",
    signNote: "Your moon lives on this device for now. Accounts will let it follow you to a new phone.",
    names: "Names",
    youName: "What the moon calls you",
    moonName: "Your moon's name",
    sound: "Sound",
    ambient: "Night sky",
    sfx: "Stars & moon",
    mute: "Mute",
    sky: "Sky",
    alwaysNight: "Always night",
    parallax: "Depth when tilting",
    mirror: "Mirror the sky (east ↔ west)",
    location: "Location",
    useLoc: "Use my location",
    locNote: "Only for the real sky, sunrise and moon phase. It never leaves this device.",
    lang: "Language",
    memories: "What the moon remembers",
    memNote: "Soon you'll be able to see and erase anything it remembers.",
    about: "About",
    credits: "Milky Way: NASA/Goddard Space Flight Center Scientific Visualization Studio. Gaia DR2: ESA/Gaia/DPAC. Stars: d3-celestial (BSD). Fonts: LXGW WenKai, Dancing Script and friends (SIL OFL).",
    done: "Done",
  },
  zh: {
    title: "菜单",
    account: "账号",
    shop: "商城",
    shopNote: "即将推出：颜料、贴纸，还有给月亮的小装扮。",
    look: "我的月亮",
    lookNote: "即将推出：挑它的眼睛、嘴巴、腮红和光——一个只属于你的月亮。",
    soon: "即将推出",
    signIn: "登录 · 即将推出",
    signNote: "现在月亮住在这台手机里。以后有了账号，换手机它也能跟着你。",
    names: "名字",
    youName: "月亮怎么叫你",
    moonName: "你给月亮起的名字",
    sound: "声音",
    ambient: "夜空",
    sfx: "星星与月亮",
    mute: "静音",
    sky: "天空",
    alwaysNight: "永远是夜晚",
    parallax: "倾斜时的纵深",
    mirror: "星空左右镜像（东 ↔ 西）",
    location: "位置",
    useLoc: "用我的位置",
    locNote: "只用来算真实的星空、日出日落和月相，不会离开这台手机。",
    lang: "语言",
    memories: "月亮记得的事",
    memNote: "很快你就能看到它记得什么，也能让它忘掉。",
    about: "关于",
    credits: "银河：NASA/Goddard Space Flight Center Scientific Visualization Studio。Gaia DR2：ESA/Gaia/DPAC。星表：d3-celestial（BSD）。字体：霞鹜文楷、Dancing Script 等（SIL OFL）。",
    done: "好了",
  },
};

export class SettingsSheet {
  private el: HTMLElement;
  private open = false;
  onChange?: (what: "profile" | "sound" | "sky" | "lang") => void;
  onOpenChange?: (open: boolean) => void;

  constructor(private profile: Profile, private locationLabel: () => string) {
    this.el = document.createElement("div");
    this.el.id = "settings";
    this.el.className = "sheet";
    this.el.hidden = true;
    document.body.appendChild(this.el);
    this.el.addEventListener("click", (e) => {
      if (e.target === this.el) this.toggle(false);
    });
  }

  get isOpen() {
    return this.open;
  }

  toggle(v = !this.open) {
    this.open = v;
    if (v) this.render();
    this.el.hidden = !v;
    requestAnimationFrame(() => this.el.classList.toggle("open", v));
    this.onOpenChange?.(v);
  }

  private render() {
    const t = T[uiLang(this.profile)];
    const P = this.profile;
    this.el.innerHTML = `
      <div class="sheet-card glass-pill" role="dialog" aria-label="${t.title}">
        <header><h2>${t.title}</h2><button class="sheet-close" aria-label="${t.done}">${t.done}</button></header>
        <section>
          <h3>${t.account}</h3>
          <div class="acct"><div class="avatar">☾</div><button class="soft" disabled>${t.signIn}</button></div>
          <p class="note">${t.signNote}</p>
        </section>
        <section>
          <h3>${t.look}</h3>
          <div class="acct"><div class="avatar">✦</div><button class="soft" disabled>${t.soon}</button></div>
          <p class="note">${t.lookNote}</p>
        </section>
        <section>
          <h3>${t.shop}</h3>
          <div class="acct"><div class="avatar">✧</div><button class="soft" disabled>${t.soon}</button></div>
          <p class="note">${t.shopNote}</p>
        </section>
        <section>
          <h3>${t.names}</h3>
          <label class="field"><span>${t.youName}</span><input id="setUserName" maxlength="30" value="${esc(P.userName)}" /></label>
          <label class="field"><span>${t.moonName}</span><input id="setMoonName" maxlength="30" value="${esc(P.moonName)}" /></label>
        </section>
        <section>
          <h3>${t.sound}</h3>
          <label class="field"><span>${t.ambient}</span><input id="setAmb" type="range" min="0" max="1" step="0.01" value="${params.sound.ambient}" /></label>
          <label class="field"><span>${t.sfx}</span><input id="setSfx" type="range" min="0" max="1" step="0.01" value="${params.sound.sfx}" /></label>
          <label class="field toggle"><span>${t.mute}</span><input id="setMute" type="checkbox" ${params.sound.muted ? "checked" : ""} /></label>
        </section>
        <section>
          <h3>${t.sky}</h3>
          <label class="field toggle"><span>${t.alwaysNight}</span><input id="setNight" type="checkbox" ${params.sky.alwaysNight ? "checked" : ""} /></label>
          <label class="field"><span>${t.parallax}</span><input id="setPar" type="range" min="0" max="1.3" step="0.01" value="${params.space.parallaxStrength}" /></label>
          <label class="field toggle"><span>${t.mirror}</span><input id="setMirror" type="checkbox" ${params.sky.mirrorEastWest ? "checked" : ""} /></label>
        </section>
        <section>
          <h3>${t.location}</h3>
          <div class="acct"><span class="loc">${esc(this.locationLabel())}</span><button class="soft" id="setLoc">${t.useLoc}</button></div>
          <p class="note">${t.locNote}</p>
        </section>
        <section>
          <h3>${t.lang}</h3>
          <div class="seg" id="setLang">
            ${(["auto", "en", "zh"] as const).map((l) => `<button data-l="${l}" class="${P.lang === l ? "on" : ""}">${l === "auto" ? "Auto" : l === "en" ? "English" : "中文"}</button>`).join("")}
          </div>
        </section>
        <section>
          <h3>${t.memories}</h3>
          <p class="note">${t.memNote}</p>
        </section>
        <section>
          <h3>${t.about}</h3>
          <p class="note small">${t.credits}</p>
        </section>
      </div>`;
    const $ = <T extends HTMLElement>(id: string) => this.el.querySelector<T>(`#${id}`)!;
    this.el.querySelector<HTMLButtonElement>(".sheet-close")!.onclick = () => this.toggle(false);
    const names = () => {
      P.userName = $<HTMLInputElement>("setUserName").value.trim();
      P.moonName = $<HTMLInputElement>("setMoonName").value.trim();
      saveProfile(P);
      this.onChange?.("profile");
    };
    $<HTMLInputElement>("setUserName").onchange = names;
    $<HTMLInputElement>("setMoonName").onchange = names;
    const snd = () => {
      params.sound.ambient = Number($<HTMLInputElement>("setAmb").value);
      params.sound.sfx = Number($<HTMLInputElement>("setSfx").value);
      params.sound.muted = $<HTMLInputElement>("setMute").checked;
      saveUserSettings();
      this.onChange?.("sound");
    };
    $<HTMLInputElement>("setAmb").oninput = snd;
    $<HTMLInputElement>("setSfx").oninput = snd;
    $<HTMLInputElement>("setMute").onchange = snd;
    const sky = () => {
      params.sky.alwaysNight = $<HTMLInputElement>("setNight").checked;
      params.space.parallaxStrength = Number($<HTMLInputElement>("setPar").value);
      params.sky.mirrorEastWest = $<HTMLInputElement>("setMirror").checked;
      saveUserSettings();
      this.onChange?.("sky");
    };
    $<HTMLInputElement>("setNight").onchange = sky;
    $<HTMLInputElement>("setPar").oninput = sky;
    $<HTMLInputElement>("setMirror").onchange = sky;
    $<HTMLButtonElement>("setLoc").onclick = async () => {
      const loc = await requestGeolocation();
      if (loc) {
        saveLocation(loc);
        this.onChange?.("sky");
        this.render();
      }
    };
    for (const b of this.el.querySelectorAll<HTMLButtonElement>("#setLang button")) {
      b.onclick = () => {
        P.lang = b.dataset.l as Profile["lang"];
        saveProfile(P);
        this.onChange?.("lang");
        this.render();
      };
    }
  }
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
