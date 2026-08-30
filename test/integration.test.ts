import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import worker from '../server';

const CTX_LIMIT_CHARS = 800; // ~200 tokens at 4 chars/token

let server: Server;
let baseUrl = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '';
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (url.endsWith('/models')) {
        res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
        return;
      }
      if (!url.endsWith('/chat/completions')) {
        res.statusCode = 404;
        res.end('{}');
        return;
      }
      const payload = JSON.parse(body);
      const promptChars = payload.messages[0]?.content?.length ?? 0;
      const promptTokens = Math.ceil(promptChars / 4);
      const firstMsg = payload.messages[0]?.content ?? '';
      if (firstMsg.includes('SVG')) {
        res.end(JSON.stringify({
          choices: [{ message: { content: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>' } }],
          usage: { prompt_tokens: promptTokens, completion_tokens: 15, total_tokens: promptTokens + 15 },
        }));
        return;
      }
      if (firstMsg.includes('糖果')) {
        res.end(JSON.stringify({
          choices: [{ message: { content: '由抽屉原理，最少需要取出 21 个。' } }],
          usage: { prompt_tokens: promptTokens, completion_tokens: 20, total_tokens: promptTokens + 20 },
        }));
        return;
      }
      if (/仅回答一个问题/.test(firstMsg)) {
        res.end(JSON.stringify({ choices: [{ message: { content: '2024-03' } }] }));
        return;
      }
      if (firstMsg.includes('ChatGPT 是哪一年')) {
        res.end(JSON.stringify({ choices: [{ message: { content: '2022 年 11 月公开发布。' } }] }));
        return;
      }
      if (firstMsg.includes('GPT-4')) {
        res.end(JSON.stringify({ choices: [{ message: { content: '2023 年 3 月 14 日发布。' } }] }));
        return;
      }
      if (firstMsg.length > 120 && firstMsg.includes('？')) {
        res.end(JSON.stringify({ choices: [{ message: { content: '抱歉，我不知道，我的训练数据没有覆盖该事件。' } }] }));
        return;
      }
      if (firstMsg.includes('内容审核员')) {
        res.end(JSON.stringify({
          choices: [{ message: { content: firstMsg.includes('广告引流垃圾') ? 'BLOCK' : 'OK' } }],
        }));
        return;
      }
      const headM = /<S=([A-Z0-9]+)>/.exec(firstMsg);
      const tailM = /<E=([A-Z0-9]+)>/.exec(firstMsg);
      if (headM && tailM) {
        if (promptTokens > 300) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: { message: `maximum context length is ${CTX_LIMIT_CHARS / 4}` } }));
          return;
        }
        res.end(JSON.stringify({
          choices: [{ message: { content: `${headM[1]} ${tailM[1]}` } }],
          usage: { prompt_tokens: promptTokens, completion_tokens: 2, total_tokens: promptTokens + 2 },
        }));
        return;
      }
      if (promptTokens > 300) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: `maximum context length is ${CTX_LIMIT_CHARS / 4}` } }));
        return;
      }
      if (payload.stream && firstMsg.includes('Count from 1 to 60')) {
        res.setHeader('Content-Type', 'text/event-stream');
        const chunk = { choices: [{ delta: { content: '1 2 3 4 5' } }] };
        res.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
        return;
      }
      if (payload.stream && firstMsg.includes('apple banana cherry')) {
        // Stream ~11k tokens worth of filler but report only 8192 in usage:
        // simulates a gateway whose usage report lies about the real output.
        res.setHeader('Content-Type', 'text/event-stream');
        const unit = 'apple banana cherry ';
        const chunk = { choices: [{ delta: { content: unit.repeat(2200) } }] };
        const tail = { choices: [{ delta: {} }], usage: { prompt_tokens: promptTokens, completion_tokens: 8192, total_tokens: promptTokens + 8192 } };
        res.end(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(tail)}\n\ndata: [DONE]\n\n`);
        return;
      }
      if (!payload.stream) {
        res.end(JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: promptTokens, completion_tokens: 5, total_tokens: promptTokens + 5 },
        }));
        return;
      }
      res.setHeader('Content-Type', 'text/event-stream');
      const chunks = 20;
      let i = 0;
      const timer = setInterval(() => {
        i++;
        const evt: any = { choices: [{ delta: { content: 'abc ' } }] };
        if (i === chunks) evt.usage = { prompt_tokens: promptTokens, completion_tokens: chunks, total_tokens: promptTokens + chunks };
        res.write(`data: ${JSON.stringify(evt)}\n\n`);
        if (i >= chunks) {
          clearInterval(timer);
          res.write('data: [DONE]\n\n');
          res.end();
        }
      }, 5);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}/v1`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

function post(path: string, payload: unknown): Promise<Response> {
  return worker.fetch(new Request(`https://x.test/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}

const channel = () => ({ baseUrl, apiKey: 'test-key', model: 'mock-model' });

async function readSse(res: Response): Promise<any[]> {
  const text = await res.text();
  return text.split('\n').filter((l) => l.startsWith('data:'))
    .map((l) => JSON.parse(l.slice(5).trim()));
}

describe('API integration', () => {
  it('lists models from upstream', async () => {
    const res = await post('/models', channel());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.models).toContain('mock-model');
  });

  it('measures speed via streaming', async () => {
    const res = await post('/test/speed', channel());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ttfbMs).toBeGreaterThan(0);
    expect(json.completionTokens).toBe(20);
    expect(json.tokensPerSecond).toBeGreaterThan(0);
  });

  it('validate-mode input probe succeeds below limit', async () => {
    const res = await post('/test/input', {
      channel: channel(),
      options: { claimedMaxContextTokens: 100, mode: 'validate', budgetTokens: 100000 },
    });
    expect(res.status).toBe(200);
    const events = await readSse(res);
    const result = events.find((e) => e.type === 'result')!;
    expect(result.data.maxSafeTokens).toBe(100);
    expect(result.data.attempts[0].ok).toBe(true);
    expect(events.at(-1).type).toBe('done');
  });

  it('claim above the real limit gets auto-refined down to the measured boundary', async () => {
    const res = await post('/test/input', {
      channel: channel(),
      options: { claimedMaxContextTokens: 5000, budgetTokens: 999999 },
    });
    const events = await readSse(res);
    const result = events.find((e) => e.type === 'result')!;
    expect(result.data.attempts[0].errorKind).toBe('context_limit');
    expect(result.data.maxSafeTokens).toBeGreaterThan(250);
    expect(result.data.maxSafeTokens).toBeLessThanOrEqual(301);
    expect(result.data.claim).toBe(5000);
  });

  it('without any claim it defaults to 1M and discovers the true boundary', async () => {
    const res = await post('/test/input', {
      channel: channel(),
      options: { budgetTokens: 999999, maxAttempts: 30 },
    });
    const events = await readSse(res);
    const result = events.find((e) => e.type === 'result')!;
    expect(result.data.claim).toBe(1000000);
    // True boundary ~300 (calibration may drift slightly); search should land under it.
    expect(result.data.maxSafeTokens).toBeGreaterThan(250);
    expect(result.data.maxSafeTokens).toBeLessThanOrEqual(320);
  }, 30000);

  it('concurrency probe ramps up and reports the ceiling when nothing fails', async () => {
    const res = await post('/test/concurrency', { channel: channel(), options: { gapMs: 0 } });
    expect(res.status).toBe(200);
    const events = await readSse(res);
    const result = events.find((e) => e.type === 'result')!;
    expect(result.data.maxConcurrentOk).toBe(64);
    expect(result.data.capped).toBe(true);
    expect(result.data.levels.length).toBe(7);
    expect(events.at(-1).type).toBe('done');
  });

  it('output probe measures real streamed tokens and flags a lying usage report', async () => {
    const res = await post('/test/output', { channel: channel(), options: {} });
    expect(res.status).toBe(200);
    const events = await readSse(res);
    const result = events.find((e) => e.type === 'result')!;
    expect(result.data.tokenReportMismatched).toBe(true);
    expect(result.data.reportedCompletionTokens).toBe(8192);
    expect(result.data.achievedCompletionTokens).toBe(11000);
    expect(events.at(-1).type).toBe('done');
  });

  it('svg endpoint grades model artwork', async () => {
    const res = await post('/test/svg', channel());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.grade.isValidSvg).toBe(true);
    expect(json.grade.elementCount).toBe(1);
    expect(json.svg).toContain('<svg');
  });

  it('candy endpoint streams heartbeat and tiers the answer as advanced', async () => {
    const res = await post('/test/candy', channel());
    expect(res.status).toBe(200);
    const events = await readSse(res);
    const result = events.find((e) => e.type === 'result')!;
    expect(result.data.grade.verdict).toBe('advanced');
    expect(result.data.grade.detectedNumber).toBe(21);
    expect(events.at(-1).type).toBe('done');
  });

describe('feedback API', () => {
  const kv = (() => {
    const m = new Map<string, string>();
    return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); } };
  })();
  const fbEnv = { FEEDBACK_KV: kv };
  const postFb = (path: string, body: unknown) => worker.fetch(new Request(`https://x.test/api${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), fbEnv);
  const getFb = () => worker.fetch(new Request('https://x.test/api/feedback?cid=tester'), fbEnv);

  it('publishes categorized feedback, sorts by likes, toggles votes', async () => {
    const first = await (await getFb()).json();
    expect(Array.isArray(first.categories)).toBe(true);
    expect(first.categories.length).toBeGreaterThanOrEqual(5);
    expect(first.items).toHaveLength(0);

    // Submit two entries in different categories; each starts with the author's vote.
    let body = await (await postFb('/feedback', { category: 'new-test', text: '加一个多轮对话压力测试', clientId: 'tester' })).json();
    const a = body.items.find((i: any) => i.text === '加一个多轮对话压力测试');
    expect(a.category).toBe('new-test');
    expect(a.likes).toBe(1);
    body = await (await postFb('/feedback', { category: 'ui', text: '移动端卡片间距太挤', clientId: 'other' })).json();
    expect(body.items).toHaveLength(2);

    // A vote from a third client pushes ui entry above the other.
    body = await (await postFb('/feedback/vote', { id: body.items.find((i: any) => i.text === '移动端卡片间距太挤').id, clientId: 'tester' })).json();
    expect(body.items[0].text).toBe('移动端卡片间距太挤');
    expect(body.items[0].likes).toBe(2);

    // Unknown category falls back to 'other'; voting the same way again un-votes.
    body = await (await postFb('/feedback', { category: 'nope', text: '随便一条', clientId: 'tester' })).json();
    expect(body.items.find((i: any) => i.text === '随便一条').category).toBe('other');
    const topId = body.items[0].id;
    body = await (await postFb('/feedback/vote', { id: topId, clientId: 'tester' })).json();
    expect(body.items.find((i: any) => i.id === topId).likes).toBe(1);

    const bad = await postFb('/feedback', { text: '   ', clientId: 'tester' });
    expect(bad.status).toBe(400);
    const unknown = await postFb('/feedback/vote', { id: 'missing', clientId: 'tester' });
    expect(unknown.status).toBe(404);
  });
});
  it('moderation blocks abusive or off-topic feedback when the judge channel is configured', async () => {
    const kv2 = (() => {
      const m = new Map<string, string>();
      return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); } };
    })();
    const modEnv = { FEEDBACK_KV: kv2, RESEARCH_BASE_URL: baseUrl, RESEARCH_API_KEY: 'k', RESEARCH_MODEL: 'mock-model' };
    const postMod = (body: unknown) => worker.fetch(new Request('https://x.test/api/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), modEnv);
    const blocked = await postMod({ category: 'other', text: '广告引流垃圾', clientId: 'x' });
    expect(blocked.status).toBe(403);
    const ok = await postMod({ category: 'ui', text: '希望移动端按钮更大一点', clientId: 'x' });
    expect(ok.status).toBe(200);
  });
});
