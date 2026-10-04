// V9-A：秘密彩蛋的演出 + 符号管线的三条示范（zzz / ♪ / !，之后 V9-C / V9-D 接到真实触发上）。

import { isAction } from "../../shared/protocol";
import { EXPRESSIONS, type ExprName } from "../moon/expressions";
import { params } from "../moon/params";
import { defineEgg } from "./registry";

/** 片子里的「暗号」只是示意；真暗号在用户自己的 .env + persona/eggs.json 里，仓库和 agent 都看不到 */
const DEMO_PHRASE = "I'm here, 小月亮 ✦";
const DEMO_WORDS = "i love you";

defineEgg("secret", {
  lead: 1.0,
  setup(x, opts) {
    const phrase = typeof opts.phrase === "string" ? opts.phrase : DEMO_PHRASE;
    x.chat.startExchange(phrase);
    x.sound.send();
    x.sound.resetGlyphs();
  },
  play(x, opts) {
    const m = x.app.moon;
    const E = params.eggs.secret;
    const at = (t: number, fn: () => void) => x.demo.schedule(t, fn);
    const expr = (typeof opts.expr === "string" && opts.expr in EXPRESSIONS ? opts.expr : "heart") as ExprName;
    const action = isAction(opts.action) ? opts.action : "bounce";
    const k = typeof opts.intensity === "number" ? opts.intensity : 0.8;
    const words = typeof opts.words === "string" ? opts.words : DEMO_WORDS;
    // 惊讶 → 爱心眼 + 弹跳 + 冒 ♥ → 亮起 → 写字（隆重档）→ 眨一下
    m.flashExpr("surprised", 0.45);
    m.blinker.blinkNow(true);
    at(0.45, () => {
      m.flashExpr(expr, E.heartHold);
      m.playAction(action, k, "manual");
      x.sound.shimmer();
    });
    for (let i = 0; i < E.hearts; i++) {
      at(0.65 + i * 0.4, () =>
        x.symbols.pop("♥", { anchor: "head", offset: { x: -0.9 + 0.55 * i, y: 0.1 * i, z: 0 }, size: 0.27 + i * 0.05, life: 2.2, rise: 0.4, sway: 0.6, color: "#ff8fa8" })
      );
    }
    at(1.45, () => m.playAction("brighten", 0.9, "manual"));
    if (x.scripted) {
      x.chat.markGrand();
      at(E.wordsAt, () => x.demo.say(words, 0.9, 0.7, "brighten", { proactive: false }));
    }
    at(E.wordsAt + 4.4, () => m.blinker.blinkNow(false));
  },
});

defineEgg("zzz", {
  play(x) {
    x.app.moon.flashExpr("sleeping", 5.6);
    x.symbols.zzz(true);
    x.demo.schedule(5.0, () => x.symbols.zzz(false));
  },
});

defineEgg("notes", {
  play(x) {
    const m = x.app.moon;
    m.flashExpr("content", 5.6);
    m.playAction("nod", 0.3, "manual");
    for (let i = 0; i < 7; i++) {
      x.demo.schedule(0.2 + i * 0.7, () => {
        x.symbols.note();
        x.sound.glyph();
      });
    }
  },
});

defineEgg("bang", {
  play(x) {
    const m = x.app.moon;
    const met = x.app.world.meteors.spawn(x.app.stage.cam);
    m.flashExpr("surprised", 1.3);
    m.blinker.blinkNow(true);
    x.symbols.bang();
    x.sound.shimmer();
    if (met) {
      m.lookTarget = met.start.clone().addScaledVector(met.dir, met.speed * 0.3);
      m.lookWeight = 0.3;
      x.demo.schedule(1.4, () => {
        m.lookWeight = 0;
        m.flashExpr("happy", 1.2);
      });
    }
  },
});
