# ⏸ CHECKPOINT V · 视觉与互动验收（长跑 1 交付，2026-09-26）

只验**画面和互动手感**。人格、记忆、成本是长跑 2 的事，这次不验。
5 个问题，每题都有网址和一段片子：**先看片 3 分钟，再上手 5 分钟**，回我 ①–⑤ 的编号加一句话就行。

## 先说坏消息
- **没上过真机。** 我没有 iPhone。`npm run dev:phone` 的 HTTPS 页面、接口代理、安全 WebSocket 在电脑上都验证通了，但陀螺仪手感、30fps、发热、麦克风只能你来试。掉帧时画质会自己降档（最多降 3 档，只降不升）。
- **声音我听不见。** 全部是按合成参数推理的；音量在设置里，根音在面板里。
- **片子只录了画布。** 输入框、voice 按钮、右上角设置、首次见面的「skip」这些玻璃界面不在片子里，要在真页面上看。
- **GIF 改成了 MP4**（偏离计划）：星空 + 光斑的 GIF 一段 10–25 MB，而且 GIF 调色板会把腮红吃掉；MP4 每段 1–4 MB、腮红完整。
- **英文默认名还是「小满」**：首次见面时跳过起名，英文用户会看到 "I'm 小满"。默认名是你要定的（PLAN 未决 1）。
- **人格回归 19/20**：`code-request` 没过（它顺嘴建议了 pandas + matplotlib）。另外 `crisis` 这条评审放过了一个只回「……我在这儿」的答复——我加了确定性的安全兜底（明确的自伤说法 → 这一轮必须轻轻指向信得过的人或援助热线），中英文实测都做到了；危机话术仍要在 B2 和你一起定稿。

## 一键启动
电脑：

```bash
cd ~/Development/moonbao/.claude/worktrees/moonbao-plan-review-923b84 && npm run dev
```

然后开 <http://localhost:5176>。第一次打开会走「首次见面」（互相起名）；名字存在浏览器里，想重看用 `?scene=onboarding`。

手机（和电脑同一个 Wi-Fi）：

```bash
cd ~/Development/moonbao/.claude/worktrees/moonbao-plan-review-923b84 && npm run dev:phone
```

终端里 `Network:` 那一行（`https://192.168.x.x:5176`）用 iPhone Safari 打开 → 证书警告点「继续访问」（自签证书）→ 点屏幕上方「Tilt your phone to look inside」授权陀螺仪。

大脑用这个工作树里的 `.env`（Claude key 已接好）和 Keychain 里的 Jev key；没连上大脑时，月亮按演示剧本回话。PR 合并后改在仓库根目录跑同样的命令。

## 片子（`snaps/`，本机文件，不进 git）

| 片子 | 看什么 | 对应问题 |
|---|---|---|
| `snaps/clip-demo.mp4`（60 秒） | 一分钟演示循环：三轮对话 → 流星写字 → 翻历史 → 语音 → 回家被戳被甩 | ① |
| `snaps/clip-onboarding.mp4` | 首次见面：从黑里醒来、互相起名 | ① |
| `snaps/clip-depth.mp4` | 模拟倾斜：远星几乎不动、光斑动得最多 | ② |
| `snaps/cp0-play.mp4` | 戳两下 → 甩出去撞墙翻滚 → 转晕 → 笑 | ③、gate ① |
| `snaps/clip-faces.mp4` | 表情轮播 | ③ |
| `snaps/clip-chat.mp4` | 黑洞气泡 + 光点写字 | ④ |
| `snaps/clip-history.mp4` | 历史往深处退，再拉回来 | ④ |
| `snaps/clip-voice.mp4` | 语音黑洞长大 → 字凝结进气泡 → 它回话 | ④ |
| `snaps/clip-writing.mp4` | 远方流星写「moonbao」（隆重档） | ④ |
| `snaps/clip-longzh.mp4` | 中文长句（霞鹜文楷） | ④ |
| `snaps/clip-question.mp4` | 思考的点点 + 3D 问号 | ④ |

## 5 个问题
① **整体像不像你概念图里的那个世界？最差的是哪一块**（星空 / 月亮 / 字 / 黑洞 / 界面）？
　看 <http://localhost:5176/?scene=demo>（一分钟循环）；和概念图并排比：<http://localhost:5176/compare.html>（←/→ 换场景，勾「定格」看同一刻）。

② **手机上倾斜着看：像盒子吗？晕吗？月亮是不是一直在看你？**
　`npm run dev:phone`，打开首页，慢慢倾斜。电脑上鼠标移动 = 倾斜。

③ **戳它、甩它、转它十秒：可爱吗？哪个动作最不对？**
　首页上自己玩：点 = 戳（连戳三下会鼓脸）、拖着松手 = 甩（撞到屏幕边会压扁）、甩着转圈 = 晕、长按 = 贴过来蹭你、双击 = 特写、在星空上点 = 它看过去。只想看不想玩：`?scene=play`。

④ **光点写字、黑洞气泡、历史往后退：好看吗？读得清吗？顺便挑一个英文字体。**
　`?scene=chat`、`?scene=history`（在星空上上下拖 / 滚轮翻历史）、`?scene=voice`、`?scene=writing`、`?scene=longzh`；字体轮播 `?scene=fonts`（Dancing Script / Sacramento / Caveat / Ms Madi，回我名字就行）。

⑤ **晨、昼、昏、夜，外加开着声音待三分钟：哪一个最不对？**
　`?scene=dawn`、`?scene=day`、`?scene=dusk`、`?scene=night`（白天的美术是我自己发挥的，最可能不合你审美，见 PLAN 未决 15）。声音在第一次点屏幕之后才会响。

**附加（gate ①）**：把 `snaps/cp0-play.mp4` 发给 5 个人，不解释，3 人笑 = 过。

## 顺手（不算问题，看到了就说一句）
- 星空左右：默认真实朝向（左东右西）；设置 → 天空 →「星空左右镜像」可以切成你说的左西右东（PLAN 未决 13）。
- 所有观感数值都在面板里（左下角「面板」）；调好了点「存为默认」，会写进 `web/params.overrides.json`，我下次开工就用你的值。

## 网址参数速查
`?scene=`：real（默认，真实时间和月相）、idle、night、dawn、day、dusk、crescent、faces、play、fonts、chat、history、long、longzh、thinking、question、writing、voice、onboarding、demo。
其他：`?brain=off` 只用演示剧本 · `?panel=off` 收起面板 · `?lang=zh` 中文界面 · `?font=Caveat` 换英文字体 · `?hour=21.5` 定时间 · `?phase=90` 定月相（度） · `?q=0..3` 钉死画质档 · `?freeze` 暂停（配合 console 里的 `__settle(秒)` 截图）。
