# assets/ui-concept · 用户的概念图（画面对照标准）

用户 2026-09-26 用 image_gen 做的 UI 概念图，是长跑 1 的**画面标准答案**。原图（1024×1536 PNG，约 2 MB/张）在主检出 `~/Development/moonbao/assets/ui-concept/`；这里入库的是 768×1152 JPEG（q86）和生成 prompt。

| 图 | 画的是什么 | 对照场景 |
|---|---|---|
| `moon-ui-left.jpg` / `moon-ui-right.jpg` | 第一版：月亮很大、贴着玻璃；左右两个角度看同一个盒子 | `?scene=idle` + 倾斜 |
| `moon-ui-left-v2.jpg` / `moon-ui-right-v2.jpg` | 月亮往后退约 18%，露出银河；^ ^ 笑眼 | `?scene=idle` |
| `moonbao-meteor-lettering.jpg` | 月亮 o 嘴专注地指挥流星，拼出手写的 "moonbao"，最后两个字母还在写 | `?scene=writing` |
| `moonbao-long-message.jpg` | 长句英文手写字，流星从不同方向汇入句尾 | `?scene=long` |
| `moonbao-chinese-message.jpg` | 六行中文手写字（行楷感），月亮抬头笑 | `?scene=long&lang=zh` |
| `moonbao-dialogue-lensing.jpg` | 用户的话在黑洞气泡里，边缘引力透镜，右侧小尾巴；月亮手写回复 | `?scene=chat` |
| `moonbao-squish-typing-v2.jpg` | >.< 被整体压扁的月亮（不是局部凹陷）；三颗星星 · · · 在思考 | `?scene=thinking` |
| `moonbao-depth-01/02/03.jpg` | 三轮对话在不同深度；旧的变小、变淡、往深处退；月亮缩到左边给字让位；蛾眉月 + 地照 | `?scene=history` |

`*-prompt.txt`、`prompts*.txt` 是生成时的 prompt，里面写了用户想要的细节（光斑、地照、透镜、字体……）。
