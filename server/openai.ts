import type { ChannelConfig, UsageInfo } from './types';

export class UpstreamError extends Error {
  status: number;
  kind: string;
  body: string;

  constructor(status: number, body: string) {
    super(`Upstream responded ${status}`);
    this.status = status;
    this.kind = classifyError(status, body);
    this.body = body.slice(0, 2000);
  }
}

export function classifyError(status: number, body: string): string {
  const lower = body.toLowerCase();
  if (status === 0 || lower === 'timeout' || lower.includes('aborted')) return 'timeout';
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 429) return 'rate_limited';
  if (
    lower.includes('context_length') ||
    lower.includes('maximum context') ||
    lower.includes('max_tokens') ||
    lower.includes('too long') ||
    lower.includes('reduce the length')
  ) {
    return 'context_limit';
  }
  if (lower.includes('model') && lower.includes('not found')) return 'model_not_found';
  if (status === 404) return 'model_not_found';
  if (status >= 500) return 'upstream_server_error';
  return 'unknown_error';
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

export async function fetchModels(
  channel: ChannelConfig,
): Promise<string[]> {
  const res = await fetch(endpoint(channel.baseUrl, '/models'), {
    headers: { Authorization: `Bearer ${channel.apiKey}` },
  });
  if (!res.ok) throw new UpstreamError(res.status, await res.text());
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  return (json.data ?? []).map((m) => m.id ?? '').filter(Boolean);
}

export interface CompletionPayload {
  model: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  stream?: boolean;
  stream_options?: { include_usage: boolean };
}

export async function chat(
  channel: ChannelConfig,
  payload: CompletionPayload,
  signal?: AbortSignal,
): Promise<Response> {
  const body = JSON.stringify(payload);
  const res = await fetch(endpoint(channel.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${channel.apiKey}`,
    },
    body,
    signal,
  });
  return res;
}

/** Wrap low-level fetch failures (e.g. abort) into UpstreamError with a kind. */
export function wrapFetchError(err: unknown): never {
  const isAbort = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
  if (isAbort) throw new UpstreamError(0, 'timeout');
  throw err instanceof Error ? err : new Error(String(err));
}

export async function chatJson(
  channel: ChannelConfig,
  payload: CompletionPayload,
  timeoutMs = 240_000,
): Promise<{ content: string; usage: UsageInfo }> {
  let res: Response;
  try {
    res = await chat(channel, payload, AbortSignal.timeout(timeoutMs));
    if (!res.ok) {
      const errBody = await res.text();
      // Some providers reject stream_options; retry without it.
      if (payload.stream_options && (res.status === 400 || res.status === 422)) {
        const retry = { ...payload } as Partial<CompletionPayload>;
        delete retry.stream_options;
        res = await chat(channel, retry as CompletionPayload, AbortSignal.timeout(timeoutMs));
        if (!res.ok) throw new UpstreamError(res.status, await res.text());
      } else {
        throw new UpstreamError(res.status, errBody);
      }
    }
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    wrapFetchError(err);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const u = json.usage ?? {};
  return {
    content: json.choices?.[0]?.message?.content ?? '',
    usage: {
      promptTokens: u.prompt_tokens ?? null,
      completionTokens: u.completion_tokens ?? null,
      totalTokens: u.total_tokens ?? null,
    },
  };
}

/** Parse an OpenAI-style SSE body, invoking onDelta per text chunk. */
export async function readStreamChunks(
  res: Response,
  onDelta: (text: string) => void,
): Promise<UsageInfo> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage: UsageInfo = { promptTokens: null, completionTokens: null, totalTokens: null };
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n');
    buffer = parts.pop()!;
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let evt: {
        choices?: Array<{ delta?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }
      const delta = evt.choices?.[0]?.delta?.content;
      if (delta) onDelta(delta);
      if (evt.usage) {
        usage = {
          promptTokens: evt.usage.prompt_tokens ?? null,
          completionTokens: evt.usage.completion_tokens ?? null,
          totalTokens: evt.usage.total_tokens ?? null,
        };
      }
    }
  }
  return usage;
}

export function estimateTokensFromChars(text: string): number {
  return Math.round(text.length / 4);
}
