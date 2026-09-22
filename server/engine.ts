// DialogueEngine 抽象：级联引擎与 s2s 引擎（realtime 等）都实现这个接口。
// 上层（角色运行时/前端）只依赖这里的类型，不感知底下是哪种实现。
// 事件类型统一定义在 shared/protocol.ts（前后端共用）。

import type { ServerEvent, EngineState } from "../shared/protocol.js";

export type { EngineState };
export type EngineEvent = ServerEvent;

export interface DialogueEngine {
  /** 用户打字发来一句话（文字主通道） */
  onText(text: string): Promise<void>;
  /** 用户说完一段话（16kHz 单声道 16-bit WAV，语音可选通道） */
  onUtterance(wav: Buffer): Promise<void>;
  /** 页面打开/回到前台：判定是否要主动开口（follow-up / 久别归来） */
  onSessionStart(opts?: { force?: boolean }): Promise<void>;
  /** 用户开口/手动打断：取消进行中的思考与说话 */
  interrupt(): void;
  /** 清空对话上下文 */
  reset(): void;
  /** 事件出口（推给前端） */
  onEvent(handler: (ev: EngineEvent) => void): void;
}
