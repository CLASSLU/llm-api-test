import {
  chat,
  chatJson,
  UpstreamError,
  wrapFetchError,
  estimateTokensFromChars,
  readStreamChunks,
} from './openai';
import { lookupModelSpec } from './model-spec';
import type {
  ChannelConfig,
  Env,
  InputProbeOptions,
  InputProbeResult,
  OutputProbeOptions,
  OutputProbeResult,
  ProbeEvent,
  SpeedResult,
} from './types';

/** Failure kinds meaning "this size exceeds the channel's real capacity" — drive the binary search down. */
const BOUNDARY_KINDS = new Set(['context_limit', 'truncation_suspect']);

const CALIBRATION_SENTENCE =
  'The quick brown fox jumps over the lazy dog near the river bank at dawn while birds sing loudly. ';

/**
 * Build filler text targeting ~targetTokens using chars-per-token ratio
 * calibrated against the provider's own tokenizer response.
 */
export function padToTokenCount(
  targetTokens: number,
  charsPerToken: number,
): string {
  const targetChars = Math.max(8, Math.round(targetTokens * charsPerToken));
  const reps = Math.ceil(targetChars / CALIBRATION_SENTENCE.length);
  return CALIBRATION_SENTENCE.repeat(reps).slice(0, targetChars);
}

/**
 * Calibrate chars/token by sending a tiny known-size prompt and reading
 * the provider-reported prompt_tokens from usage.
 */
export async function calibrateCharsPerToken(
  channel: ChannelConfig,
): Promise<number> {
  const text = CALIBRATION_SENTENCE.repeat(20);
  const { usage } = await chatJson(channel, {
    model: channel.model,
    messages: [{ role: 'user', content: text }],
    max_tokens: 8,
  });
  const measured = usage.promptTokens ?? estimateTokensFromChars(text);
  const ratio = text.length / Math.max(measured, 1);
  // Guard against wild ratios; typical values are 2..6.
  return Math.min(10, Math.max(1.5, ratio));
}

function randomCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/** Filler text of exactly n chars (for precise prompt sizing). */
function padChars(n: number): string {
  const reps = Math.ceil(n / CALIBRATION_SENTENCE.length);
  return CALIBRATION_SENTENCE.repeat(reps).slice(0, Math.max(8, n));
}

/**
 * Probe at a target size. A pass requires more than HTTP 200:
 * the model must echo back the random head/tail markers (i.e. it actually
 * *saw* both ends of the prompt), and the provider-reported prompt_tokens
 * must roughly match our target (otherwise: silent truncation upstream).
 */
async function probeOnceAtSize(
  channel: ChannelConfig,
  targetTokens: number,
  charsPerToken: number,
): Promise<{ ok: boolean; echoOk?: boolean; measured: number | null; kind: string | null; detail?: string }> {
  const headCode = randomCode();
  const tailCode = randomCode();
  const prefix = `<S=${headCode}>\n`;
  const suffix = `\n<E=${tailCode}>\n\n请只回复上文开头和结尾的两个标记码，用空格分隔，不要输出其他内容。`;
  const filler = padChars(Math.round(targetTokens * charsPerToken) - prefix.length - suffix.length);
  try {
    // max_tokens is 256 (not 16): reasoning models burn their allowance on
    // thinking tokens before emitting any visible content; 16 truncates them
    // into an empty reply and a bogus "content_mismatch".
    const { content, usage } = await chatJson(channel, {
      model: channel.model,
      messages: [{ role: 'user', content: prefix + filler + suffix }],
      max_tokens: 256,
    });
    const measured = usage.promptTokens;
    const snippet = content.trim().slice(0, 80);
    const echoOk = content.includes(headCode) && content.includes(tailCode);
    const usageLow = measured !== null && measured < targetTokens * 0.97;
    // Echo pass is ground truth: the model demonstrably read both ends.
    if (echoOk) {
      return { ok: true, echoOk: true, measured, kind: null,
        detail: usageLow ? `渠报 prompt ${measured} 小于目标 ${targetTokens}，usage 计数可疑` : undefined };
    }
    // HTTP ok + provider-reported size matches but no echo: capacity accepted,
    // visibility unproven (model may have been truncated, or just disobeyed).
    if (!usageLow) {
      return { ok: true, echoOk: false, measured, kind: null,
        detail: snippet ? `口令未回显，回复:「${snippet}」` : '口令未回显：回复为空' };
    }
    // Provider itself reports receiving far fewer tokens than we sent: silent truncation.
    return { ok: false, echoOk: false, measured, kind: 'truncation_suspect', detail: snippet ? `回复:「${snippet}」` : undefined };
  } catch (err) {
    if (err instanceof UpstreamError) {
      return { ok: false, measured: null, kind: err.kind };
    }
    return { ok: false, measured: null, kind: 'network_error' };
  }
}

export async function* runInputProbe(
  channel: ChannelConfig,
  opts: InputProbeOptions,
  env: Env,
): AsyncGenerator<ProbeEvent> {
  const attempts: InputProbeResult['attempts'] = [];
  let spentTokens = 0;
  yield { type: 'progress', message: 'Calibrating tokenizer…' };

  let charsPerToken: number;
  try {
    charsPerToken = await calibrateCharsPerToken(channel);
    spentTokens += 300;
  } catch {
    yield { type: 'progress', message: 'Calibration failed; falling back to 4 chars/token.' };
    charsPerToken = 4;
  }
  yield { type: 'progress', message: `chars/token ratio ≈ ${charsPerToken.toFixed(2)}` };

  // Resolve the claim to test against: user hint > official spec lookup > 1M default.
  let claim = opts.claimedMaxContextTokens ?? null;
  let claimSource = claim !== null ? '手动指定' : '';
  if (claim === null) {
    yield { type: 'progress', message: '联网检索官方上下文宣称…' };
    let lookupErr: unknown = null;
    const spec = await lookupModelSpec(channel.model, env, channel).catch((e) => {
      lookupErr = e;
      return null;
    });
    if (lookupErr && !spec) {
      yield { type: 'progress', message: '联网检索失败：' + String(lookupErr instanceof Error ? lookupErr.message : lookupErr) };
    }
    if (spec?.contextTokens) {
      claim = spec.contextTokens;
      claimSource = '官方资料（联网检索）';
    } else {
      claim = 1_000_000;
      claimSource = '未查到官方数据，按 1M 试';
    }
  }
  yield { type: 'progress', message: `检测宣称上限 ${claim.toLocaleString()} tokens（${claimSource}）` };

  /** Probe with escalation: 3 tries at growing delays before giving up. */
  async function probeResilient(size: number) {
    const delays = [0, 2000, 6000];
    let last: { ok: boolean; echoOk?: boolean; measured: number | null; kind: string | null; detail?: string } | null = null;
    for (const d of delays) {
      if (d) await new Promise((res) => setTimeout(res, d));
      last = await probeOnceAtSize(channel, size, charsPerToken);
      spentTokens += size;
      if (last.ok || BOUNDARY_KINDS.has(last.kind ?? '')) return last;
    }
    return last!;
  }

  const resultBase = () => {
    const passing = attempts.filter((a) => a.ok);
    return { attempts, spentApprox: spentTokens, claim, claimSource, echoVerified: passing.length > 0 && passing.every((a) => a.echoOk === true) };
  };

  // Validate at the claim first.
  const first = await probeResilient(claim);
  attempts.push(attemptRecord(claim, first));
  yield { type: 'progress', message: first.ok ? `宣称 ${claim.toLocaleString()} 达标 ✓` : `宣称 ${claim.toLocaleString()} 未达到（${first.kind}）` };
  if (first.ok) {
    yield { type: 'result', data: { ...resultBase(), maxSafeTokens: claim } };
    yield { type: 'done' };
    return;
  }
  if (!BOUNDARY_KINDS.has(first.kind ?? '')) {
    yield { type: 'result', data: { ...resultBase(), maxSafeTokens: null } };
    yield { type: 'done' };
    return;
  }

  // Binary search the true boundary between lo (confirmed pass) and claim.
  let lo = 256;
  let hi = claim;
  const maxSteps = opts.maxAttempts ?? 12;
  {
    const r = await probeResilient(lo);
    attempts.push(attemptRecord(lo, r));
    if (!r.ok) {
      yield { type: 'progress', message: `基线 ${lo} tokens 也持续失败(${r.kind})，疑似渠道异常，终止。` };
      yield { type: 'result', data: { ...resultBase(), maxSafeTokens: null } };
      yield { type: 'done' };
      return;
    }
  }

  let step = 0;
  let inconclusive = false;
  let unresolvedStreak = 0;
  let unknownAbove: number | null = null;
  while (hi - lo > Math.max(64, hi * 0.02) && step < maxSteps) {
    step++;
    const mid = Math.floor((lo + hi) / 2);
    yield { type: 'progress', message: `Probing ${mid} tokens… (${lo} ✓ / ${hi} ?)` };
    const r = await probeResilient(mid);
    attempts.push(attemptRecord(mid, r));
    if (spentTokens > opts.budgetTokens) {
      yield { type: 'progress', message: `Budget exhausted after ${step} probes.` };
      inconclusive = true;
      break;
    }
    if (r.ok) {
      lo = mid;
      if (mid > (unknownAbove ?? -1)) unknownAbove = null;
      unresolvedStreak = 0;
    } else if (BOUNDARY_KINDS.has(r.kind ?? '')) {
      hi = mid;
      unresolvedStreak = 0;
    } else {
      // Unknown outcome: probe the UPPER half instead of aborting.
      if (unknownAbove === null || mid < unknownAbove) unknownAbove = unknownAbove ?? mid;
      unresolvedStreak++;
      const alt = Math.floor((mid + hi) / 2);
      yield { type: 'progress', message: `${mid} 处不可判定(${r.kind})，改试上区间点 ${alt}…` };
      const r2 = await probeResilient(alt);
      attempts.push(attemptRecord(alt, r2));
      if (spentTokens > opts.budgetTokens) {
        yield { type: 'progress', message: `Budget exhausted after fallback probe.` };
        inconclusive = true;
        break;
      }
      if (r2.ok) {
        lo = alt;
        if (alt > (unknownAbove ?? -1)) unknownAbove = null;
        unresolvedStreak = 0;
      } else if (BOUNDARY_KINDS.has(r2.kind ?? '')) {
        hi = alt;
        unresolvedStreak = Math.max(0, unresolvedStreak - 1);
      } else {
        unresolvedStreak++;
      }
      if (unresolvedStreak >= 3) {
        yield { type: 'progress', message: `连续 ${unresolvedStreak} 次不可判定(${r.kind})，疑似渠道故障，中止。` };
        inconclusive = true;
        break;
      }
    }
  }
  yield {
    type: 'result',
    data: {
      ...resultBase(),
      maxSafeTokens: lo,
      ...((inconclusive || unknownAbove !== null) ? { inconclusive: true } : {}),
    },
  };
  yield { type: 'done' };
}
function attemptRecord(
  targetTokens: number,
  r: { ok: boolean; echoOk?: boolean; measured: number | null; kind: string | null; detail?: string },
) {
  return {
    targetTokens,
    ok: r.ok,
    measuredPromptTokens: r.measured,
    errorKind: r.kind ?? undefined!,
    ...(r.echoOk !== undefined ? { echoOk: r.echoOk } : {}),
    ...(r.detail ? { detail: r.detail } : {}),
  };
}

export async function measureSpeed(
  channel: ChannelConfig,
): Promise<SpeedResult> {
  const started = Date.now();
  const prompt = 'Count from 1 to 100 slowly.';
  let ttfb: number | null = null;
  let fullText = '';
  let res: Response;
  try {
    res = await chat(channel, {
      model: channel.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1024,
      stream: true,
      stream_options: { include_usage: true },
    }, AbortSignal.timeout(120_000));
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      // Retry without stream_options once.
      if (res.status === 400 || res.status === 422) {
        return measureSpeedNoUsageOption(channel, started, prompt);
      }
      throw new UpstreamError(res.status, errText);
    }
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    wrapFetchError(err);
  }
  const usage = await readStreamChunks(res, () => {
    if (ttfb === null) ttfb = Date.now() - started;
  });
  const totalMs = Date.now() - started;
  const completionTokens = usage.completionTokens ?? estimateTokensFromChars(fullText);
  const genMs = Math.max(1, totalMs - (ttfb ?? 0));
  return {
    model: channel.model,
    ttfbMs: ttfb,
    totalMs,
    completionTokens,
    promptTokens: usage.promptTokens ?? estimateTokensFromChars(prompt),
    tokensPerSecond: usage.completionTokens !== null ? usage.completionTokens / (genMs / 1000) : null,
  };
}

async function measureSpeedNoUsageOption(
  channel: ChannelConfig,
  started: number,
  prompt: string,
): Promise<SpeedResult> {
  let ttfb: number | null = null;
  let fullText = '';
  let res: Response;
  try {
    res = await chat(channel, {
      model: channel.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1024,
      stream: true,
    }, AbortSignal.timeout(120_000));
    if (!res.ok) throw new UpstreamError(res.status, await res.text());
    await readStreamChunks(res, (d) => {
      if (ttfb === null) ttfb = Date.now() - started;
      fullText += d;
    });
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    wrapFetchError(err);
  }
  const totalMs = Date.now() - started;
  const completionTokens = estimateTokensFromChars(fullText);
  const genMs = Math.max(1, totalMs - (ttfb ?? 0));
  return {
    model: channel.model,
    ttfbMs: ttfb,
    totalMs,
    completionTokens,
    promptTokens: estimateTokensFromChars(prompt),
    tokensPerSecond: completionTokens / (genMs / 1000),
  };
}

const OUTPUT_FILLER_PROMPT =
  'Please repeat the exact string "apple banana cherry " over and over without stopping, formatting, counting, or explaining. Do not stop early.';

const ASTRONOMICAL_MAX_TOKENS = 1_000_000;

/** Pull a real completion cap out of provider error text, e.g. "supports at most 16384 completion tokens". */
function parseCapFromError(body: string): number | null {
  const m = /(?:at most|maximum(?: of)?|up to|no more than|must not exceed|不超过|不能超过|上限为)\s*[:\s]*([\d,]+)/i.exec(body);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n >= 256 && n <= 20_000_000 ? n : null;
}

/** One streaming generation; returns the measured result. Throws UpstreamError on HTTP errors. */
async function* streamOnce(
  channel: ChannelConfig,
  maxTokens: number,
  timeoutMs: number,
): AsyncGenerator<ProbeEvent, OutputProbeResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let charsOut = '';
    let timedOut = false;
    let reachedDone = false;
    const res = await chat(channel, {
      model: channel.model,
      messages: [{ role: 'user', content: OUTPUT_FILLER_PROMPT }],
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    }, controller.signal);
    if (!res.ok) throw new UpstreamError(res.status, await res.text());
    type Usage = { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null };
    let usage: Usage = { promptTokens: null, completionTokens: null, totalTokens: null };
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastProgressAt = started;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop()!;
        for (const line of parts) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const payload = t.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const evt = JSON.parse(payload) as any;
            const delta = evt.choices?.[0]?.delta?.content;
            if (delta) charsOut += delta;
            if (evt.usage) {
              usage = {
                promptTokens: evt.usage.prompt_tokens ?? null,
                completionTokens: evt.usage.completion_tokens ?? null,
                totalTokens: evt.usage.total_tokens ?? null,
              };
            }
          } catch { /* skip malformed */ }
        }
        const now = Date.now();
        if (now - lastProgressAt > 1500) {
          lastProgressAt = now;
          const elapsedSec = Math.max(1, (now - started) / 1000);
          const rate = Math.round(charsOut.length / 4 / elapsedSec);
          yield { type: 'progress', message: `已输出 ~${Math.round(charsOut.length / 4).toLocaleString()} tok · ${(elapsedSec).toFixed(0)}s · ~${rate} tok/s` };
        }
      }
      reachedDone = true;
    } catch (err) {
      const isAbort = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      if (isAbort) timedOut = true;
      else throw err;
    }
    clearTimeout(timer);

    // Streamed characters are ground truth; provider-reported usage is only
    // trusted when it roughly matches them (±25%). A deviating report means
    // the gateway lies about token counts.
    const estimated = estimateTokensFromChars(charsOut);
    const reported = usage.completionTokens;
    let achieved = reported ?? estimated;
    let mismatched = false;
    if (reported !== null && estimated > 0) {
      mismatched = Math.abs(estimated - reported) / Math.max(estimated, reported) > 0.25;
      if (mismatched) achieved = estimated;
    }
    const stopped = !timedOut && reachedDone && achieved < maxTokens * 0.9;
    return {
      requestedMaxTokens: maxTokens,
      achievedCompletionTokens: achieved,
      finishedByStop: stopped,
      totalMs: Date.now() - started,
      ...(timedOut ? { timedOut: true } : {}),
      ...(reported !== null ? { reportedCompletionTokens: reported } : {}),
      ...(mismatched ? { tokenReportMismatched: true } : {}),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function* runOutputProbe(
  channel: ChannelConfig,
  opts: OutputProbeOptions,
  env: Env,
): AsyncGenerator<ProbeEvent> {
  const progress = (message: string): ProbeEvent => ({ type: 'progress', message });
  const timeoutMs = Math.min(900_000, Math.max(opts.timeoutMs ?? 0, 240_000));

  let target = opts.targetMaxOutputTokens ?? null;
  let targetSource: string | null = target !== null ? '手动指定' : null;
  let specClaim: number | null = null;
  if (target === null && env?.TAVILY_API_KEY) {
    yield progress('联网检索官方 max_output 宣称…');
    let specLookupErr: unknown = null;
    const spec = await lookupModelSpec(channel.model, env, channel).catch((e) => {
      specLookupErr = e;
      return null;
    });
    if (specLookupErr && !spec) {
      yield progress('联网检索失败：' + String(specLookupErr instanceof Error ? specLookupErr.message : specLookupErr));
    }
    if (spec?.maxOutputTokens) {
      specClaim = spec.maxOutputTokens;
      yield progress(`官方宣称 max output ≈ ${specClaim.toLocaleString()}（联网检索）`);
    }
  }

  const finish = (data: OutputProbeResult) => {
    data.targetSource = targetSource;
    if (specClaim !== null) data.specClaimedMaxOutput = specClaim;
    return data;
  };

  let attempts = 0;
  while (attempts < 3) {
    const t = target ?? ASTRONOMICAL_MAX_TOKENS;
    yield progress(`以 max_tokens=${t.toLocaleString()} 发起流式实测…`);
    let result: OutputProbeResult;
    try {
      result = yield* streamOnce(channel, t, timeoutMs);
    } catch (err) {
      if (err instanceof UpstreamError && (err.status === 400 || err.status === 422) && attempts < 2) {
        attempts++;
        const cap = parseCapFromError(err.body);
        const next = cap ?? specClaim ?? 32_768;
        if (next !== t) {
          target = next;
          targetSource = cap ? '渠道报错口径' : specClaim ? '官方资料（联网检索）' : '回退默认 32k';
          yield progress(`max_tokens=${t.toLocaleString()} 被拒（${err.kind}），改按 ${next.toLocaleString()} 重测`);
          continue;
        }
      }
      const kind = err instanceof UpstreamError ? err.kind : 'network_or_timeout';
      yield { type: 'error', message: kind, data: null };
      yield { type: 'done' };
      return;
    }
    yield { type: 'result', data: finish(result) };
    yield { type: 'done' };
    return;
  }
}