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

  constructor(canvas: HTMLCanvasElement) {
    this.stage = new Stage(canvas);
    this.world = new World(this.stage);
    this.stage.back.add(this.moon.body.halo, this.moon.body.root);
    this.moon.body.bake(this.stage.gl, matchMedia("(pointer: coarse)").matches ? 1024 : 2048);
    installPacer(this.bus);
    installRuntime(this.bus, this.moon);
    this.client = new EngineClient(this.bus, this.audio);
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
    const loop = (now: number) => {
      const dt = Math.min(params.perf.maxFrameDt, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      this.step(dt);
      this.stage.render(dt);
      this.fpsAcc.n++;
      this.fpsAcc.t += dt;
      if (this.fpsAcc.t >= 0.5) {
        this.fps = this.fpsAcc.n / this.fpsAcc.t;
        this.fpsAcc = { n: 0, t: 0 };
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
