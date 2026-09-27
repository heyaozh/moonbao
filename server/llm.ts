// LLM provider 适配层：级联引擎内的"作家"。
// 统一接口：给完整对话历史，流式吐回复文本。可随时 abort。
// system 支持两块：stable（人格，吃 prompt caching 的稳定前缀）+ volatile（记忆等易变内容，
// 放在缓存断点之后，变动不影响人格前缀的缓存命中）。

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type SystemSpec = string | { stable: string; volatile?: string };

export interface ChatProvider {
  name: string;
  stream(
    system: SystemSpec,
    messages: ChatMessage[],
    signal: AbortSignal
  ): AsyncGenerator<string>;
}

/** Haiku 4.5 / Sonnet 4.5 及更早的模型不接受 output_config.effort。 */
function supportsEffort(model: string) {
  return !/haiku-4-5|sonnet-4-5|claude-3/.test(model);
}

export class ClaudeProvider implements ChatProvider {
  name = "claude";
  private client = new Anthropic();
  constructor(private model: string) {}

  async *stream(system: SystemSpec, messages: ChatMessage[], signal: AbortSignal) {
    const stable = typeof system === "string" ? system : system.stable;
    const volatile = typeof system === "string" ? undefined : system.volatile;
    const blocks: Anthropic.TextBlockParam[] = [
      { type: "text", text: stable, cache_control: { type: "ephemeral" } },
    ];
    if (volatile) blocks.push({ type: "text", text: volatile });

    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: 400,
        system: blocks,
        // effort 只有较新的模型支持；Haiku 4.5 / Sonnet 4.5 收到会 400（2026-09-26 查明）
        ...(supportsEffort(this.model) ? { output_config: { effort: "low" as const } } : {}),
        messages,
      },
      { signal }
    );
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield event.delta.text;
      }
    }
  }
}

export class OpenAIProvider implements ChatProvider {
  name = "openai";
  private client = new OpenAI();
  constructor(private model: string) {}

  async *stream(system: SystemSpec, messages: ChatMessage[], signal: AbortSignal) {
    const text =
      typeof system === "string"
        ? system
        : system.volatile
          ? `${system.stable}\n\n${system.volatile}`
          : system.stable;
    const stream = await this.client.chat.completions.create(
      {
        model: this.model,
        stream: true,
        messages: [{ role: "system", content: text }, ...messages],
      },
      { signal }
    );
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) yield text;
    }
  }
}

export function createProvider(): ChatProvider {
  const which = process.env.LLM_PROVIDER ?? "claude";
  if (which === "openai") {
    return new OpenAIProvider(process.env.OPENAI_MODEL ?? "gpt-4o");
  }
  return new ClaudeProvider(process.env.CLAUDE_MODEL ?? "claude-haiku-4-5");
}
