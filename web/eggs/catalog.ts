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
  // ── V9-C · 动作与表情 ──
  { name: "attend", label: "共同注意", group: "C", how: "追流星时回头看你一眼「你看！」，再接着追", seconds: 6, life: true },
  { name: "glance", label: "写完一句看你一眼", group: "C", how: "它每说完一句：看你 + 眨一下", seconds: 9 },
  { name: "conduct", label: "指挥星星写字", group: "C", how: "写字时视线跟着笔锋；隆重档 o 嘴专注", seconds: 9 },
  { name: "reading", label: "读你的字 + 听时安定", group: "C", how: "你发长句它飘近眯眼看；你打字时它漂得更稳", seconds: 6 },
  { name: "breath", label: "呼吸光 + 闪两下", group: "C", how: "待机时光晕慢呼吸；它想引起注意时光闪两下", seconds: 8 },
  { name: "stretch", label: "伸懒腰", group: "C", how: "睡醒 / 发呆很久之后", seconds: 4 },
  { name: "shakeoff", label: "抖落星尘", group: "C", how: "翻滚够多圈停稳后、打喷嚏后", seconds: 4 },
  { name: "sneeze", label: "打喷嚏", group: "C", how: "稀有待机事件；被吹气后有概率", seconds: 5 },
  { name: "headshake", label: "摇头", group: "C", how: "「这个我不懂诶」时（配一滴汗）", seconds: 4 },
  { name: "shrug", label: "耸肩", group: "C", how: "不知道的时候", seconds: 4 },
  { name: "flip", label: "翻跟头", group: "C", how: "撒欢（spin 动作的高档）", seconds: 4 },
  { name: "sway", label: "摇摆", group: "C", how: "哼歌时心情好就摇，边摇边冒 ♪", seconds: 6 },
  { name: "puff", label: "鼓脸放气", group: "C", how: "连戳三下鼓脸，两秒后「噗」地放气原谅你", seconds: 6 },
  { name: "starry", label: "星星眼 ✦ ✦", group: "C", how: "追到流星 / 看到喜欢的", seconds: 5 },
  { name: "blank", label: "发呆 - -", group: "C", how: "待机时偶尔放空几秒，双眨回神", seconds: 6 },
  { name: "sweat", label: "一滴汗", group: "C", how: "听岔了 / 问题太难（和 3D 问号一起）", seconds: 5 },
  { name: "whistle", label: "吹口哨", group: "C", how: "偷懒被抓到装没事（V9-D 接）", seconds: 5 },
  { name: "tongue", label: "吐舌头 :P", group: "C", how: "被挠痒痒笑完之后", seconds: 4 },
  { name: "dilate", label: "瞳孔放大", group: "C", how: "看到流星的那一瞬", seconds: 4 },
  { name: "symbols", label: "zzz / ♪ / ! 接上小日子", group: "C", how: "哼歌冒 ♪、打瞌睡冒 zzz、流星突然出现冒「!」", seconds: 10, life: true },
];

export const eggInfo = (name: string) => EGG_CATALOG.find((e) => e.name === name);
