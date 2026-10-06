# 五官与表情：AI 出图 prompt（2026-09-30）

用户：「给我个 prompt（关于面部表情的和五官排布的，月球本体已经有了）去 ai 生成看看有没有更好的美术效果」。

**用法**：在 ChatGPT（图片编辑）或其他支持「上传图片再编辑」的工具里，先上传底图，再粘贴 prompt。
- 底图 A（光月亮，没有脸）：`assets/moon/reference/moon-base-noface.jpg`，就是 app 里真在渲染的那个月亮。
- 底图 B（现在的脸）：`assets/moon/reference/moon-base-face.jpg`。
- 为什么要求「平面、简单的深色形状」：选中的方案要在着色器里用矢量形状重画出来（跟着月亮转、任意放大都清楚）。立体的鼻子、眉毛、四肢、带渐变的大眼睛都画不回来。

挑出喜欢的格子后，截图给我（或者说第几格），我按它改 `web/moon/looks.ts` 里的数值，必要时加新的形状。

---

## Prompt 1 · 五官方案表（3×3，上传底图 A）

```
Mode: built-in image_gen editing.

Use the supplied image as the base: a warm ivory, softly glowing, realistic full moon with a gentle lunar texture, floating in a dark starry sky. Create a 3x3 character design sheet: nine copies of this SAME moon, identical size, lighting, color, texture and camera, arranged in a clean grid with thin dark gaps. Do not redesign the moon itself. The only difference between the nine cells is a cute face painted directly onto the moon's surface, centered slightly below the middle, like a flat decal that follows the sphere's curvature.

Face style rules for every cell: flat, simple, graphic shapes only; near-black eyes (#17141d) and mouth lines; optional tiny pure-white eye highlights; soft round pink blush (#ff7488) as a gentle gradient. No nose, no eyebrows, no eyelashes, no limbs, no accessories, no 3D sculpting, no outlines around the moon, no text.

Cell 1: medium vertical bean-shaped eyes with one small highlight each, a small thin smile arc, round soft blush (control design).
Cell 2: "baby schema": all features placed lower on the face, eyes wide apart and a bit bigger, a very small smile right under the eyes, large soft blush.
Cell 3: tiny solid black bean dots with no highlight, close together, a tiny smile, faint small blush; minimal and calm.
Cell 4: big glossy eyes with two white highlights each (one large upper-left, one small lower-right), a tiny smile, round blush.
Cell 5: small bean eyes, a cat mouth shaped like "ω", horizontal oval blush.
Cell 6: soft horizontal oval eyes (wider than tall), faint highlight, a gentle shallow smile.
Cell 7: medium eyes, a small open "D" smile with a tiny pink tongue, blush drawn as a few short diagonal hatch lines.
Cell 8: happy closed eyes as upward arcs "^ ^", small open smile, rosy blush.
Cell 9: round eyes placed a little higher, a tiny round "o" mouth, curious look.

Keep all nine faces the same scale relative to the moon, readable at phone size, and lovable rather than creepy. Warm, soft, mochi-like, gentle.
```

## Prompt 2 · 表情表（4×3，上传底图 B，或 Prompt 1 里你选中的那一格）

```
Mode: built-in image_gen editing.

Use the supplied image as the base: a cute moon character with a flat, simple face painted on a realistic warm ivory lunar surface. Create a 4x3 expression sheet: twelve copies of this SAME moon with the same size, lighting, texture, camera and the SAME face design (same eye size, eye spacing, feature positions, colors and blush). Only the shapes of the eyes, mouth and blush intensity change to express emotion. Keep every feature a flat, simple graphic shape (near-black eyes and mouth, tiny white highlights, soft pink blush). No eyebrows, no nose, no limbs, no props, no text, no 3D sculpting.

Row 1: 1 neutral gentle smile; 2 happy with closed upward-arc eyes "^ ^" and small open smile; 3 laughing with a wide open mouth and tiny tongue, eyes squeezed; 4 shy: eyes glancing down to the side, stronger blush, tiny wavy smile.
Row 2: 5 surprised: round open eyes, small "o" mouth; 6 sleepy: peaceful downward-curved closed eyes, tiny "o" mouth; 7 sad: outer eye corners drooping, small downturned mouth; 8 pouty: slightly puffed look, short wavy mouth.
Row 3: 9 dizzy: spiral "@ @" eyes, wavy mouth; 10 thinking: eyes looking up-left, small flat mouth; 11 wink: one "^" closed eye and one open eye, playful smile; 12 content: relaxed half-closed arcs, soft smile.

Expressions should read clearly at small phone size, feel soft, warm and lovable, and stay consistent as one character.
```

## Prompt 3 · 单张精修（看美术上限，上传底图 A）

```
Mode: built-in image_gen editing.

Use the supplied image as the base and keep the moon exactly as it is: same realistic warm ivory lunar texture, glow, size, framing and starry background. Paint the most lovable possible face onto the moon's surface, like a flat decal that follows the sphere's curvature: two small near-black bean eyes with tiny white highlights, a small gentle smile, and soft round pink blush just below and outside the eyes. Features sit slightly below the center of the disc and read clearly at phone size. The feeling is warm, soft, mochi-like, sleepy-sweet and comforting, like a companion who quietly keeps you company at night. Flat, simple graphic features only: no eyebrows, no nose, no eyelashes, no limbs, no accessories, no 3D sculpting, no text.
```
