// App：把舞台、世界、月亮、运行时（总线 / 节拍器 / 反射）、输入和调试工具接在一起，跑更新循环。

import { SpeechAudio } from "../audio/speech";
import { MoonRenderer } from "../moon/renderer";
import { params } from "../moon/params";
import { Bus } from "../runtime/bus";
import { EngineClient } from "../runtime/client";
import { installPacer } from "../runtime/pacer";
import { installRuntime } from "../runtime/runtime";
import { Stage } from "../world/stage";
import { World } from "../world/world";

export class App {
  readonly stage: Stage;
  readonly world: World;
  readonly moon = new MoonRenderer();
  readonly bus = new Bus();
  readonly audio = new SpeechAudio();
  readonly client: EngineClient;
  /** 每帧额外要跑的东西（对话画面、手势、行为……按模块挂进来） */
  private tickers: ((dt: number) => void)[] = [];
  private last = performance.now();
  private running = false;
  fps = 0;
  private fpsAcc = { n: 0, t: 0 };
  /** 暂停更新与渲染（测试 / 截图用；网址加 ?freeze 从一开始就停，然后用 __step 推进） */
  paused = new URLSearchParams(location.search).has("freeze");
  /** 手机（粗指针）：帧率封顶 fpsMobile，画质从 1 档起 */
  readonly mobile = matchMedia("(pointer: coarse)").matches;
  private lastFrame = 0;
  private adapt = { t: 0, n: 0, slow: 0, since: 0, on: true };

  constructor(canvas: HTMLCanvasElement) {
    this.stage = new Stage(canvas);
    this.world = new World(this.stage);
    this.stage.back.add(this.moon.body.halo, this.moon.body.root);
    this.moon.body.bake(this.stage.gl, matchMedia("(pointer: coarse)").matches ? 1024 : 2048);
    installPacer(this.bus);
    installRuntime(this.bus, this.moon);
    this.client = new EngineClient(this.bus, this.audio);
    // 画质档：?q= 钉死；否则手机从 1 档、电脑从 0 档起，掉帧再往下降
    const q = new URLSearchParams(location.search).get("q");
    if (q != null && q !== "") {
      this.adapt.on = false;
      this.stage.setQuality(Number(q));
    } else {
      const start = params.perf.startTier >= 0 ? params.perf.startTier : this.mobile ? 1 : 0;
      if (start !== 0) this.stage.setQuality(start);
    }
    // 先推进一步：所有 uniform 在第一次渲染前就是有效值（页面隐藏时 rAF 不跑，截图也不会是白屏）
    this.step(0);
  }

  onTick(fn: (dt: number) => void) {
    this.tickers.push(fn);
  }

  /** 推进一步（不渲染）。录制和 __step 用。 */
  step(dt: number) {
    this.stage.cam.update(dt);
    this.world.update(dt);
    for (const fn of this.tickers) fn(dt);
    this.moon.tick(dt, { cam: this.stage.cam, world: this.world.state });
  }

  start() {
    if (this.running) return;
    this.running = true;
    // 不按 document.hidden 门控：真隐藏时浏览器自己会停 rAF；嵌入式浏览器面板会把可见页面也报成 hidden
    document.addEventListener("visibilitychange", () => (this.last = performance.now()));
    // 暂停时改尺寸会清空画布：补渲一帧（对照页的定格画面不会变黑）
    addEventListener("resize", () => this.paused && requestAnimationFrame(() => this.stage.render(0)));
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      if (this.paused) {
        this.last = now;
        return;
      }
      // 帧率封顶：手机 30（省电、不发烫），电脑 60
      const cap = this.mobile ? params.perf.fpsMobile : params.perf.fpsDesktop;
      if (cap > 0 && now - this.lastFrame < 1000 / cap - 2) return;
      this.lastFrame = now;
      const raw = Math.max(0, (now - this.last) / 1000);
      const dt = Math.min(params.perf.maxFrameDt, raw);
      this.last = now;
      this.step(dt);
      this.stage.render(dt);
      this.fpsAcc.n++;
      this.fpsAcc.t += raw;
      if (this.fpsAcc.t >= 0.5) {
        this.fps = this.fpsAcc.n / this.fpsAcc.t;
        this.fpsAcc = { n: 0, t: 0 };
      }
      this.adaptQuality(raw, cap);
    };
    requestAnimationFrame(loop);
  }

  /** 持续掉帧就降一档（开头 4 秒不算：加载、编译着色器）。只降不升。 */
  private adaptQuality(raw: number, cap: number) {
    const a = this.adapt;
    if (!a.on || !params.perf.adaptive || raw > 0.5) return; // 切后台回来的那一帧不算
    a.since += raw;
    if (a.since < 4) return;
    a.t += raw;
    a.n++;
    if (a.t < 2) return;
    const fps = a.n / a.t;
    a.t = 0;
    a.n = 0;
    a.slow = fps < cap * 0.8 ? a.slow + 1 : 0;
    if (a.slow >= 2 && this.stage.quality < 3) {
      this.stage.setQuality(this.stage.quality + 1);
      console.info(`[perf] ${fps.toFixed(0)} fps < ${cap}：画质降到 ${this.stage.quality} 档`);
      a.slow = 0;
      a.since = 0;
    }
  }
}
