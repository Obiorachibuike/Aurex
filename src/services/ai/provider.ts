import { env } from "@/lib/env";
import type { Settings } from "../settings";

export type ProviderMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; content: string; tool_call_id: string };

export type ProviderToolSpec = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

export type ProviderResponse = {
  content: string;
  toolCalls: { id: string; name: string; arguments: string }[];
  usage: { promptTokens: number; completionTokens: number };
};

/** Provider-independent chat interface. Add a provider by implementing this and wiring it in resolveAiProvider. */
export interface AiProvider {
  key: string;
  model: string;
  chat(input: { messages: ProviderMessage[]; tools: ProviderToolSpec[]; temperature: number; maxTokens: number }): Promise<ProviderResponse>;
}

/** Works with any OpenAI-compatible Chat Completions API (Agnes AI, OpenAI, and many gateways). */
export function createOpenAICompatibleProvider(cfg: { key: string; baseUrl: string; apiKey: string; model: string }): AiProvider {
  return {
    key: cfg.key,
    model: cfg.model,
    async chat({ messages, tools, temperature, maxTokens }) {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: cfg.model, messages, ...(tools.length ? { tools, tool_choice: "auto" } : {}), temperature, max_tokens: maxTokens, stream: false }),
        cache: "no-store",
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) throw new Error(`${cfg.key} responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const json = (await res.json()) as { choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const msg = json.choices?.[0]?.message;
      if (!msg) throw new Error(`${cfg.key} returned no message`);
      return {
        content: msg.content ?? "",
        toolCalls: (msg.tool_calls ?? []).map((t) => ({ id: t.id, name: t.function.name, arguments: t.function.arguments })),
        usage: { promptTokens: json.usage?.prompt_tokens ?? 0, completionTokens: json.usage?.completion_tokens ?? 0 },
      };
    },
  };
}

/** Returns the configured LLM provider, or null to use the built-in engine. API keys come only from the server environment. */
export function resolveAiProvider(settings: Settings["ai"]): AiProvider | null {
  switch (settings.provider) {
    case "agnes":
      return env.ai.agnesKey ? createOpenAICompatibleProvider({ key: "agnes", baseUrl: env.ai.agnesUrl, apiKey: env.ai.agnesKey, model: settings.model || "agnes-2.5-flash" }) : null;
    case "openai":
      return env.ai.openaiKey ? createOpenAICompatibleProvider({ key: "openai", baseUrl: env.ai.openaiUrl, apiKey: env.ai.openaiKey, model: settings.model || "gpt-4o-mini" }) : null;
    case "custom":
      return env.ai.customKey && /^https:\/\//.test(settings.baseUrl) ? createOpenAICompatibleProvider({ key: "custom", baseUrl: settings.baseUrl.replace(/\/$/, ""), apiKey: env.ai.customKey, model: settings.model }) : null;
    default:
      return null;
  }
}

export function providerStatus(settings: Settings["ai"]): { active: string; configured: Record<string, boolean> } {
  const p = resolveAiProvider(settings);
  return { active: p ? `${p.key} (${p.model})` : "Built-in engine", configured: { agnes: !!env.ai.agnesKey, openai: !!env.ai.openaiKey, custom: !!env.ai.customKey } };
}
