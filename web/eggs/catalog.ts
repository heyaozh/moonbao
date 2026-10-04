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
  // ── V9-B · 手势与传感器 ──
  { name: "pinch", label: "双指捏", group: "B", how: "两根手指捏它（捏开 = 拉长），松手弹回", seconds: 6 },
  { name: "tickle", label: "挠痒痒", group: "B", how: "抓着它快速来回搓动（小幅度）", seconds: 5 },
  { name: "rub", label: "搓", group: "B", how: "长按不放，再来回动；搓久了打哈欠", seconds: 7 },
  { name: "hug", label: "圈住 = 抱抱", group: "B", how: "在星空上绕它画一圈", seconds: 6 },
  { name: "zonepoke", label: "分区戳（眼 / 嘴 / 腮）", group: "B", how: "戳眼睛、嘴、腮各有反应", seconds: 6 },
  { name: "hold", label: "抓着不动 3 秒", group: "B", how: "抓住它别动：看你手指 → 看你 → 慢眨", seconds: 6 },
  { name: "twist", label: "两指拧", group: "B", how: "两指拧它转过去，松手转回来（拧多了害羞）", seconds: 5 },
  { name: "facedown", label: "扣下手机睡觉 / 拿起伸懒腰", group: "B", how: "手机屏幕朝下扣 1 秒多；拿起来", seconds: 8 },
  { name: "return", label: "切回来发现你", group: "B", how: "离开 app 一分钟再回来（片子只演「被发现」）", seconds: 6, life: true },
  { name: "rock", label: "轻摇摇篮", group: "B", how: "轻轻、有节奏地摇手机", seconds: 8 },
  { name: "blow", label: "吹气", group: "B", how: "对着麦克风吹（默认不听；面板「吹气：常开听」打开）", seconds: 6 },
  { name: "hover", label: "桌面光标视线", group: "B", how: "电脑上鼠标靠近它，眼神跟着走", seconds: 6 },
  { name: "vibrate", label: "安卓震动", group: "B", how: "戳 / 撞墙时手机震一下（iOS 等 Capacitor；片子看不出，手机上试）", seconds: 4 },
];

export const eggInfo = (name: string) => EGG_CATALOG.find((e) => e.name === name);
