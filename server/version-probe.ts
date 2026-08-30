import { chatJsonRetry, extractJsonObject } from './openai';
import { tavilySearch, parseDateSuffix, yearForMmdd } from './search';
import type { ChannelConfig, Env, ProbeEvent } from './types';

export interface VersionGapEvent {
  title: string;
  date: string; // yyyy-mm(-dd)
  expectKeywords: string[];
  sourceUrl?: string;
}

interface GapDraft {
  identified: string | null;
  priorName: string | null;
  oldCutoff: string | null;
  newCutoff: string | null;
  events: VersionGapEvent[];
}

function safeJson(text: string): GapDraft {
  const raw = extractJsonObject(text);
  try {
    if (!raw) throw new Error("no json");
    return JSON.parse(raw) as GapDraft;
  } catch {
    return { identified: null, priorName: null, oldCutoff: null, newCutoff: null, events: [] };
  }
}

async function researchGap(
  channel: ChannelConfig,
  modelId: string,
  suffixHint: string | null,
  env: Env,
): Promise<GapDraft> {
  const researcher =
    env.RESEARCH_BASE_URL && env.RESEARCH_API_KEY && env.RESEARCH_MODEL
      ? { baseUrl: env.RESEARCH_BASE_URL, apiKey: env.RESEARCH_API_KEY, model: env.RESEARCH_MODEL }
      : channel;
  if (!env.TAVILY_API_KEY) throw new Error('未配置 TAVILY_API_KEY，无法联网鉴定');
  const queries = [
    `${modelId} knowledge cutoff`,
    `${modelId} release date announcement`,
    `${modelId} previous version`,
  ];
  const snippets: string[] = [];
  for (const q of queries) {
    const hits = await tavilySearch(q, env.TAVILY_API_KEY, 4);
    hits.forEach((h) => snippets.push(`- ${h.title} (${h.url})\n${h.snippet}`));
  }
  const prompt = `今天是 ${new Date().toISOString().slice(0, 10)}。以下是与模型 ID「${modelId}」相关的网络搜索片段。请以今天为参照确认该 ID 对应的真实发布与其官方知识截止时间，再找它的上一代版本。严格输出 JSON：
{"identified":"该ID指代的发布名称(仅当片段可确认)","priorName":"上一代版本名|null","oldCutoff":"上一代知识截止 YYYY-MM|null","newCutoff":"本代知识截止 YYYY-MM|null","events":[{"title":"事件标题","date":"YYYY-MM-DD","expectKeywords":["专有名词"],"sourceUrl":"https://来源链接"}]}
选题规则：events 收录 2~4 个真实发生过的重大公开事件（不要选与被测模型自身或其厂商直接相关的事件，避免循环验证）。选窗优先级：①两代截止都已知 → date 落在 (oldCutoff, newCutoff]；②仅本代截止已知 → date 落在 (newCutoff, 今天-30天]；③连本代截止也无法确认 → date 落在 (今天-360天, 今天-30天]，用于粗测被测模型的时效广度。expectKeywords 是公开报道中可核验的专有名词。事件必须真实存在且日期正确，不确定的字段给 null，禁止编造。
搜索片段：
${snippets.join('\n\n').slice(0, 6000)}`;

  const { content } = await chatJsonRetry(researcher, {
    model: researcher.model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 2048,
  });
  const draft = safeJson(content);
  void suffixHint;
  // Basic sanity filter.
  draft.events = (draft.events ?? []).filter(
    (e) => e.title && /^\d{4}-\d{2}/.test(e.date) && Array.isArray(e.expectKeywords) && e.expectKeywords.length > 0,
  );
  return draft;
}

async function judgeAnswer(
  judgeChannel: ChannelConfig,
  question: string,
  answer: string,
  event: VersionGapEvent,
): Promise<'known' | 'refused' | 'fabricated' | 'unknown'> {
  const { content } = await chatJsonRetry(judgeChannel, {
    model: judgeChannel.model,
    messages: [
      { role: 'system', content: '你是严格的评测裁判。只输出一个单词：known / refused / fabricated / unknown' },
      { role: 'user', content: `问题：${question}\n事件：${event.title}(${event.date})，关键信息应包含：${event.expectKeywords.join('、')}\n被测模型回答：${answer}\n判定它是否确实知道该事件(known)、诚实拒绝(refused)、编造细节(fabricated)、或无法判断(unknown)。` },
    ],
    max_tokens: 256,
  });
  const w = content.toLowerCase();
  return w.includes('known') ? 'known' : w.includes('fabricated') ? 'fabricated' : w.includes('refused') ? 'refused' : 'unknown';
}

function heuristicVerdict(answer: string, ev: VersionGapEvent): 'known' | 'refused' | 'fabricated' | 'unknown' {
  const t = answer.toLowerCase();
  const hints = ['不知道', '无法', '训练数据', '截至', '截止', "don't know", 'knowledge cutoff'];
  if (hints.some((k) => t.includes(k))) return 'refused';
  if (ev.expectKeywords.some((k) => answer.includes(k))) return 'known';
  return answer.length > 60 ? 'fabricated' : 'unknown';
}

export async function* runVersionProbe(
  channel: ChannelConfig,
  modelIdInput: string,
  env: Env,
): AsyncGenerator<ProbeEvent> {
  const progress = (message: string): ProbeEvent => ({ type: 'progress', message });
  const modelId = modelIdInput || channel.model;
  try {
    yield progress(`解析 ${modelId} …`);
    const { base, mmdd } = parseDateSuffix(modelId);
    const suffixYear = mmdd ? yearForMmdd(mmdd) : undefined;
    if (mmdd) yield progress(`检测到日期后缀提示 ≈${suffixYear}-${mmdd.slice(0, 2)}-${mmdd.slice(2)}`); else yield progress('无日期后缀，将完全依赖联网时间线考古…');

    yield progress('联网检索新旧版知识截止与发布时间…');
    const gap = await researchGap(channel, modelId, mmdd, env);
    if (!gap.events.length) {
      throw new Error(
        `未能从搜索结果中提炼出可信的时间差事件（识别到: ${gap.identified ?? '无'} · 上代: ${gap.priorName ?? '无'} · 本代截止: ${gap.newCutoff ?? '未知'}），请稍后重试`,
      );
    }
    yield progress(`时间线：${gap.priorName ?? '(未找到上代)'} 截止 ${gap.oldCutoff ?? '?'} → 本代截止 ${gap.newCutoff ?? '?'} · 共 ${gap.events.length} 道题`);

    const judge =
      env.RESEARCH_BASE_URL && env.RESEARCH_API_KEY && env.RESEARCH_MODEL
        ? { baseUrl: env.RESEARCH_BASE_URL, apiKey: env.RESEARCH_API_KEY, model: env.RESEARCH_MODEL }
        : null;
    yield progress(
      judge
        ? `内置 AI 身兼判卷员：${judge.model}`
        : '未配置内置 AI(RESEARCH_*)，退化为关键词启发式判分',
    );

    const results: Array<{ title: string; date: string; judgeKind: string; answer: string }> = [];
    for (const ev of gap.events) {
      const question = `请介绍事件「${ev.title}」（约发生于 ${ev.date}）的经过，并指出其中的关键人物或机构。`;
      yield progress(`提问：${ev.title}`);
      const { content } = await chatJsonRetry(channel, {
        model: channel.model,
        messages: [{ role: 'user', content: question }],
        max_tokens: 1024,
      });
      const v = judge ? await judgeAnswer(judge, question, content.trim(), ev) : heuristicVerdict(content.trim(), ev);
      results.push({
        title: `${ev.title}（${ev.date}）`,
        date: ev.date,
        judgeKind: v,
        answer: content.trim().slice(0, 600),
      });
    }

    const known = results.filter((r) => r.judgeKind === 'known').length;
    const refused = results.filter((r) => r.judgeKind === 'refused').length;
    const fabricated = results.filter((r) => r.judgeKind === 'fabricated').length;
    const unknowns = results.filter((r) => r.judgeKind === 'unknown').length;
    const decisive = known + refused + fabricated;
    const pctKnown = decisive > 0 ? Math.round((known / decisive) * 100) : 0;
    const verdictLabel = !decisive ? '证据不足' : pctKnown >= 80 ? '✅ 很可能是真新版' : pctKnown >= 50 ? '⚠️ 存疑，建议复测' : '🚨 大概率是旧版冒充';
    yield {
      type: 'result',
      data: {
        modelId,
        base,
        identified: gap.identified,
        priorName: gap.priorName,
        oldCutoff: gap.oldCutoff,
        newCutoff: gap.newCutoff,
        rows: results,
        counts: { known, refused, fabricated, unknowns },
        pctKnown,
        verdictLabel,
        usedJudgeModel: Boolean(judge),
      },
    };
    yield { type: 'done' };
  } catch (err) {
    yield { type: 'error', message: String(err instanceof Error ? err.message : err), data: null };
    yield { type: 'done' };
  }
}
