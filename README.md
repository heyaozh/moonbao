# moonbao

一个住在你手机夜空里的小月亮。它有两颗会眨的黑豆眼，不说话——用光、动作和星星拼出的字回应你；它记得你说过的话，第二天会想起来问你；你可以在它身上画花纹，它会一直留着。

- **[PLAN.md](PLAN.md)** — 执行计划（阶段 / checkpoint / 未决问题 / 会话记录）
- **[docs/design.md](docs/design.md)** — 设定与想法的完整记录（角色、月相、空间感、回应通道、声音、成长）
- **[docs/next-session-prompt.md](docs/next-session-prompt.md)** — 开新 session 时用的交接 prompt（含待讨论的开放点）
- **persona/** — 角色圣经草案（`system-prompt.md`）+ 身体协议（`protocol.md`）+ 人格回归测例（`tests/cases.json`）

## 运行

```bash
npm install
cp .env.example .env      # 至少填 ANTHROPIC_API_KEY；CHARACTER_NAME 选 小满 / 皎皎
npm run dev               # 网页 (:5176) + 对话服务端 (:8787)
```

打开 http://localhost:5176 ，底部输入框跟它说话。现在的渲染层是一个 DOM 占位圆（会发光、会浮动），只为验证整条链路；three.js 月亮在 P0 落地。

```bash
npm run test:persona            # 人格回归测例（20 条，硬断言 + LLM 评审）；改人格/换模型前后各跑一遍
npm run memory -- list          # 看记忆与待提起的 follow-up
npm run memory -- add "用户明天下午有面试" "问问面试怎么样" 30   # 30 分钟后到期
npm run memory -- due 3         # 把 #3 改成立刻到期 → 页面点「主动开口(强制)」
npm run memory -- seen 5        # 伪造 5 天没见 → 测久别归来
```

调试端点：`/api/health`、`/api/memory`。页面 console：`__say("你好")`、`__act("bounce")`、`__step(2)`。

## 架构一眼图

```
shared/protocol.ts      角色运行时协议（前后端共用）：PetHeader / ServerEvent / ClientMessage / HeaderScanner
server/
  index.ts              WS 桥接 + 调试 HTTP 端点；人格 = persona/*.md，{{NAME}} 由 CHARACTER_NAME 替换
  cascade.ts            一轮对话：文字 → 记忆检索 → LLM 流式（首行头→情绪/动作，正文→气泡）→ 可选 TTS
                        onSessionStart：到期 follow-up / 久别归来 → 主动开口（每日频控）
  llm.ts / tts.ts / asr.ts   provider 适配层
  memory/               SQLite + 本地 embedding：检索打分、去重强化、置信度、睡眠整理（含 follow_up_at 提取）
web/
  runtime/bus.ts        事件总线（中枢）
  runtime/client.ts     WS 客户端 → 总线
  runtime/pacer.ts      节拍器：文字按阅读速度显现，后续拍的情绪/动作等前一拍说完再上
  runtime/runtime.ts    总线 → 渲染层；Tier 0 反射（打字→飘近、思考→歪头、卡住→变暗、断线→变暗/重连→亮起）
  runtime/renderer.ts   CharacterRenderer 接口 + PlaceholderRenderer / StubRenderer / FanoutRenderer
  runtime/chat.ts       气泡 + 输入框 + 状态
  moon/                 （P0）three.js 月亮：几何、光照/月相、眼睛、弹簧运动；params.ts 参数外置
scripts/persona-test.ts 人格回归；scripts/memory-cli.ts 记忆调试
```

LLM 每轮回复的第一行是一个紧凑 JSON 头 `{"v":心情,"a":活力,"act":"动作","i":强度}`，随后才是话；一条回复可以分两三拍。
渲染层只消费 `{情绪目标, 动作意图, 在听/在说}`。
