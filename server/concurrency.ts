import { chat, readStreamChunks, UpstreamError, wrapFetchError } from './openai';
import type { ChannelConfig, ProbeEvent } from './types';

export interface ConcurrencyLevel {
  n: number;
  ok: number;
  failed: number;
  errorKinds: Record<string, number>;
}

export interface ConcurrencyResult {
  /** Last level where every parallel request succeeded. */
  maxConcurrentOk: number;
  /** True when the ceiling was reached without any failure — real limit unknown. */
  capped?: boolean;
  levels: ConcurrencyLevel[];
}

export interface ConcurrencyOptions {
  /** Pause between levels to avoid tripping RPM limits; defaults to 8s (0 in tests). */
  gapMs?: number;
}

const LEVELS = [1, 2, 4, 8, 16, 32, 64];
const PER_REQUEST_TIMEOUT_MS = 60_000;
const PROMPT = 'Count from 1 to 60 slowly, separated by spaces.';

/** One small streaming request: kept light, but long enough to overlap with its peers. */
async function fireOne(channel: ChannelConfig): Promise<string | null> {
  try {
    const res = await chat(channel, {
      model: channel.model,
      messages: [{ role: 'user', content: PROMPT }],
      max_tokens: 200,
      stream: true,
    }, AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS));
    if (!res.ok) throw new UpstreamError(res.status, await res.text());
    await readStreamChunks(res, () => {});
    return null; // success
  } catch (err) {
    if (err instanceof UpstreamError) return err.kind;
    try {
      wrapFetchError(err);
    } catch (wrapped) {
      return wrapped instanceof UpstreamError ? wrapped.kind : 'network_or_timeout';
    }
    return 'network_or_timeout';
  }
}

export async function* runConcurrencyProbe(
  channel: ChannelConfig,
  opts: ConcurrencyOptions,
): AsyncGenerator<ProbeEvent> {
  const progress = (message: string): ProbeEvent => ({ type: 'progress', message });
  const gap = Math.max(0, opts.gapMs ?? 8_000);
  const levels: ConcurrencyLevel[] = [];
  let lastFullPass = 0;

  for (let i = 0; i < LEVELS.length; i++) {
    const n = LEVELS[i];
    if (i > 0 && gap > 0) {
      yield progress(`歇 ${Math.round(gap / 1000)}s 再上强度（避开 RPM 限流干扰）…`);
      await new Promise((r) => setTimeout(r, gap));
    }
    yield progress(`并发 ${n} 路同时压上…`);
    const outcomes = await Promise.all(Array.from({ length: n }, () => fireOne(channel)));
    const kinds: Record<string, number> = {};
    let failed = 0;
    for (const o of outcomes) {
      if (o === null) continue;
      failed++;
      kinds[o] = (kinds[o] ?? 0) + 1;
    }
    levels.push({ n, ok: n - failed, failed, errorKinds: kinds });
    if (failed === 0) {
      lastFullPass = n;
      yield progress(`并发 ${n} 全部成功 ✓`);
      continue;
    }
    const kindsText = Object.entries(kinds).map(([k, v]) => `${k}×${v}`).join(', ');
    yield progress(`并发 ${n}：${n - failed} 成功 / ${failed} 失败（${kindsText}），到顶了`);
    break;
  }

  const capped = levels.length === LEVELS.length && levels[levels.length - 1].failed === 0;
  yield {
    type: 'result',
    data: {
      maxConcurrentOk: lastFullPass,
      ...(capped ? { capped: true } : {}),
      levels,
    } satisfies ConcurrencyResult,
  };
  yield { type: 'done' };
}