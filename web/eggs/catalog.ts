// 彩蛋目录（PLAN V9）：名字、批次、怎么触发、录片时长。纯数据，不引 three——录片脚本（Node）和页面都从这里读。
// 实现在 batch-*.ts 里用 defineEgg(name, …) 注册；开关与手感数值在 params.eggs。

export type EggGroup = "A" | "B" | "C" | "D";

export interface EggInfo {
  name: string;
  label: string;
  group: EggGroup;
  /** 真实世界里怎么触发（给验收清单看） */
  how: string;
  /** 录片时长（秒） */
  seconds: number;
  /** 录片时镜头自动摇（有视差更像盒子，但会分散注意力；默认不摇） */
  shake?: boolean;
  /** 这条彩蛋本身是小日子（录片时不暂停 Behaviors） */
  life?: boolean;
}

export const EGG_CATALOG: EggInfo[] = [
  // ── V9-A · 地基 + 秘密彩蛋 ──
  { name: "secret", label: "秘密彩蛋", group: "A", how: "输入暗号（npm run egg -- add 加；片子里的暗号只是示意）", seconds: 11 },
  { name: "zzz", label: "睡觉冒 z z z", group: "A", how: "它打瞌睡时（V9-D 接到小日子）", seconds: 6 },
  { name: "notes", label: "哼歌冒 ♪", group: "A", how: "它哼歌时（V9-C 接到小日子）", seconds: 6 },
  { name: "bang", label: "惊讶冒「!」", group: "A", how: "被吓到 / 流星突然出现（V9-C 接）", seconds: 4 },
];

export const eggInfo = (name: string) => EGG_CATALOG.find((e) => e.name === name);
