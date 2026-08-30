import { Hono } from 'hono';
import { measureSpeed, runInputProbe, runOutputProbe } from './probe';
import { fetchModels } from './openai';
import { chatJson, chatStreamText } from './openai';
import { CANDY_QUESTION, SVG_PROMPT, gradeCandy, gradeSvg, extractSvgBlock } from './qa';
import { runVersionProbe } from './version-probe';
import { runConcurrencyProbe } from './concurrency';
import { addFeedback, FEEDBACK_CATEGORIES, listFeedback, toggleVote } from './feedback';
import type { ChannelConfig, Env, InputProbeOptions, OutputProbeOptions, ProbeEvent } from './types';

const api = new Hono<{ Bindings: Env }>();

api.post('/models', async (c) => {
  const body = await c.req.json();
  const channel = (body.channel ?? body) as ChannelConfig;
  try {
    const models = await fetchModels(channel);
    return c.json({ models });
  } catch (err: any) {
    return c.json({ error: String(err?.message ?? err) }, 502);
  }
});

function sseResponse(events: AsyncGenerator<ProbeEvent>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (evt: ProbeEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
      try {
        for await (const evt of events) send(evt);
      } catch (err) {
        send({ type: 'error', message: String(err), data: null });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

api.post('/test/speed', async (c) => {
  const body = await c.req.json();
  const channel = (body.channel ?? body) as ChannelConfig;
  try {
    const result = await measureSpeed(channel);
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: String(err?.message ?? err), kind: err?.kind }, 502);
  }
});

api.post('/test/input', (c) =>
  c.env ? sseResponse(genInput(c)) : sseResponse(genInput(c)),
);

async function* genInput(c: any): AsyncGenerator<ProbeEvent> {
  const body = await c.req.json();
  const channel = body.channel as ChannelConfig;
  const opts = (body.options ?? {}) as InputProbeOptions;
  yield* runInputProbe(channel, opts, c.env as Env);
}

api.post('/test/output', (c) => sseResponse(genOutput(c)));

async function* genOutput(c: any): AsyncGenerator<ProbeEvent> {
  const body = await c.req.json();
  const channel = body.channel as ChannelConfig;
  const opts = (body.options ?? {}) as OutputProbeOptions;
  yield* runOutputProbe(channel, opts, c.env as Env);
}

api.post('/test/svg', async (c) => {
  const body = await c.req.json();
  const channel = (body.channel ?? body) as ChannelConfig;
  try {
    const { content } = await chatStreamText(channel, {
      model: channel.model,
      messages: [{ role: 'user', content: SVG_PROMPT }],
      max_tokens: 4096,
    }, 300_000);
    const clean = extractSvgBlock(content);
    return c.json({ grade: gradeSvg(clean), svg: clean });
  } catch (err: any) {
    return c.json({ error: String(err?.message ?? err), kind: err?.kind }, 502);
  }
});

// Reasoning models can think for minutes on this puzzle; give it 10 min and
// stream heartbeats so the UI can show the user it is still alive.
api.post('/test/candy', (c) => sseResponse(genCandy(c)));

async function* genCandy(c: any): AsyncGenerator<ProbeEvent> {
  const body = await c.req.json();
  const channel = (body.channel ?? body) as ChannelConfig;
  const started = Date.now();
  const box: { res: Awaited<ReturnType<typeof chatStreamText>> | null; err: any; done: boolean; chars: number } = { res: null, err: null, done: false, chars: 0 };
  chatStreamText(channel, {
    model: channel.model,
    messages: [{ role: 'user', content: CANDY_QUESTION }],
    max_tokens: 8192,
  }, 600_000, (d) => { box.chars += d.length; })
    .then((r) => { box.res = r; })
    .catch((e) => { box.err = e; })
    .finally(() => { box.done = true; });
  while (!box.done) {
    const elapsedSec = Math.round((Date.now() - started) / 1000);
    const tokInfo = box.chars > 0 ? ` · 已接收 ~${Math.round(box.chars / 4)} tok` : '';
    yield { type: 'progress', message: `模型思考中，已等待 ${elapsedSec}s${tokInfo}`, data: { elapsedSec } };
    for (let i = 0; i < 50 && !box.done; i++) await new Promise((res) => setTimeout(res, 100));
  }
  if (box.err || !box.res) {
    yield { type: 'error', message: String(box.err?.message ?? box.err ?? 'unknown'), data: box.err?.kind ? { kind: box.err.kind } : null };
  } else {
    yield { type: 'result', data: { grade: gradeCandy(box.res.content), usage: box.res.usage } };
  }
  yield { type: 'done' };
}

api.post('/test/concurrency', (c) => sseResponse(genConcurrency(c)));

async function* genConcurrency(c: any): AsyncGenerator<ProbeEvent> {
  const body = await c.req.json();
  const channel = (body.channel ?? body) as ChannelConfig;
  yield* runConcurrencyProbe(channel, body.options ?? {});
}
api.post('/test/version', (c) => sseResponse(runVersionProbeFor(c)));

async function* runVersionProbeFor(c: any): AsyncGenerator<ProbeEvent> {
  const body = await c.req.json();
  const channel = (body.channel ?? body) as ChannelConfig;
  const modelId = body.modelId as string | undefined;
  yield* runVersionProbe(channel, modelId ?? channel.model, c.env as Env);
}



api.get('/feedback', async (c) => {
  return c.json({
    categories: FEEDBACK_CATEGORIES,
    items: await listFeedback(c.env as Env, c.req.query('cid') ?? ''),
  });
});

api.post('/feedback', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.text || !body?.clientId) return c.json({ error: 'bad request' }, 400);
  if (String(body.text).trim().length > 200) return c.json({ error: 'too long' }, 400);
  try {
    return c.json({ items: await addFeedback(c.env as Env, String(body.category ?? 'other'), String(body.text), String(body.clientId)) });
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (msg === 'rejected_by_moderation') return c.json({ error: '未通过内容审查：请提交与本工具相关的反馈' }, 403);
    return c.json({ error: 'empty' }, 400);
  }
});

api.post('/feedback/vote', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.id || !body?.clientId) return c.json({ error: 'bad request' }, 400);
  const items = await toggleVote(c.env as Env, String(body.id), String(body.clientId));
  if (!items) return c.json({ error: 'not found' }, 404);
  return c.json({ items });
});

export default api;
