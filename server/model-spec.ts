import { chatJson } from './openai';
import { tavilySearch } from './search';
import type { ChannelConfig, Env } from './types';

export interface ModelSpec {
  contextTokens: number | null;
  maxOutputTokens: number | null;
  sourceUrl: string | null;
}

function parseSpecJson(text: string): { contextTokens: number | null; maxOutputTokens: number | null } {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  try {
    const j = JSON.parse((fence ? fence[1] : text).trim()) as Record<string, unknown>;
    const num = (v: unknown, max: number): number | null => {
      const n = typeof v === 'string' ? Number(v.replace(/[^\d]/g, '')) : Number(v);
      return Number.isFinite(n) && n >= 256 && n <= max ? Math.round(n) : null;
    };
    return {
      contextTokens: num(j.contextTokens, 20_000_000),
      maxOutputTokens: num(j.maxOutputTokens, 2_000_000),
    };
  } catch {
    return { contextTokens: null, maxOutputTokens: null };
  }
}

/**
 * Ask the web (Tavily) + a synthesising LLM for the model's official
 * context window and max output tokens. Returns nulls on any failure —
 * callers must degrade gracefully (default strategies).
 */
export async function lookupModelSpec(
  modelId: string,
  env: Env,
  testChannel: ChannelConfig,
): Promise<ModelSpec | null> {
  if (!env?.TAVILY_API_KEY) return null;
  const hits = (
    await Promise.all([
      tavilySearch(`${modelId} context window tokens official`, env.TAVILY_API_KEY, 4).catch(() => []),
      tavilySearch(`${modelId} max output tokens official`, env.TAVILY_API_KEY, 4).catch(() => []),
    ])
  ).flat();
  if (!hits.length) return null;
  const snippets = hits.map((h) => `- ${h.title} (${h.url})\n${h.snippet}`).join('\n\n').slice(0, 6000);

  const synth: ChannelConfig =
    env.RESEARCH_BASE_URL && env.RESEARCH_API_KEY && env.RESEARCH_MODEL
      ? { baseUrl: env.RESEARCH_BASE_URL, apiKey: env.RESEARCH_API_KEY, model: env.RESEARCH_MODEL }
      : testChannel;
  const { content } = await chatJson(synth, {
    model: synth.model,
    messages: [{
      role: 'user',
      content: `从下面的搜索片段中提取模型「${modelId}」的官方参数。只输出 JSON：\n{"contextTokens":数字或null,"maxOutputTokens":数字或null}\n例如 128k = 128000，1M = 1000000。片段里没有可靠依据就给 null，禁止编造。\n\n${snippets}`,
    }],
    max_tokens: 256,
  });
  const parsed = parseSpecJson(content);
  if (parsed.contextTokens === null && parsed.maxOutputTokens === null) return null;
  return { ...parsed, sourceUrl: hits[0]?.url ?? null };
}