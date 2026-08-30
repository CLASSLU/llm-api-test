import { reactive, computed } from 'vue';
import { postSse } from './sse';

export type TestId = 'speed' | 'concurrency' | 'input' | 'output' | 'svg' | 'candy' | 'version';
export type Status = 'idle' | 'running' | 'done' | 'error';

interface Channel {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface State {
  page: 'channel' | 'tests' | 'report' | 'feedback';
  theme: 'dark' | 'light';
  skin: string;
  channel: Channel;
  rememberKey: boolean;
  showKey: boolean;
  models: string[];
  budget: number;
  statuses: Record<TestId, Status>;
  speedResult: any;
  concurrencyResult: any;
  inputResult: any;
  outputResult: any;
  svgResult: any;
  candyResult: any;
  candyElapsedSec: number;
  versionResult: any;
  versionModelId: string;
  suiteRunning: boolean;
  logs: string[];
  feedbackItems: any[];
  feedbackCategories: any[];
  feedbackLoaded: boolean;
  feedbackVoting: string | null;
}

const LS_KEY = 'llmtest.v2';

function loadPersisted(): Partial<State> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export const state = reactive<State>({
  page: 'channel',
  theme: 'light',
  skin: 'day',
  channel: { baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: '', model: '' },
  rememberKey: false,
  showKey: false,
  models: [],
  budget: 3000000,
  statuses: { speed: 'idle', concurrency: 'idle', input: 'idle', output: 'idle', svg: 'idle', candy: 'idle', version: 'idle' },
  speedResult: null,
  concurrencyResult: null,
  inputResult: null,
  outputResult: null,
  svgResult: null,
  candyResult: null,
  candyElapsedSec: 0,
  versionResult: null,
  versionModelId: '',
  suiteRunning: false,
  logs: [],
  feedbackItems: [],
  feedbackCategories: [],
  feedbackLoaded: false,
  feedbackVoting: null,
});

const persisted = loadPersisted();
const savedTheme = localStorage.getItem('llmtest.theme');

function periodOf(hour: number): { skin: string; theme: 'dark' | 'light' } {
  if (hour >= 6 && hour < 11) return { skin: 'dawn', theme: 'light' };
  if (hour >= 11 && hour < 17) return { skin: 'day', theme: 'light' };
  if (hour >= 17 && hour < 20) return { skin: 'dusk', theme: 'dark' };
  return { skin: 'night', theme: 'dark' };
}

if (persisted.channel) {
  state.channel.baseUrl = persisted.channel.baseUrl ?? state.channel.baseUrl;
  state.channel.apiKey = persisted.channel.apiKey ?? '';
  state.channel.model = persisted.channel.model ?? '';
  state.rememberKey = Boolean(persisted.rememberKey && persisted.channel.apiKey);
}
document.documentElement.dataset.theme = state.theme;
if (!savedTheme || (savedTheme !== 'light' && savedTheme !== 'dark')) {
  state.theme = 'light';
  state.skin = periodOf(new Date().getHours()).skin;
} else {
  state.theme = savedTheme;
  state.skin = periodOf(new Date().getHours()).skin;
}
document.body.dataset.skin = state.skin;

export function refreshTimeSkin() {
  const auto = periodOf(new Date().getHours());
  const manual = localStorage.getItem('llmtest.theme');
  if (!manual) {
    state.theme = 'light';
    document.documentElement.dataset.theme = state.theme;
  }
  state.skin = auto.skin;
  document.body.dataset.skin = state.skin;
}

export const statuses = state.statuses;

export function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = state.theme;
  localStorage.setItem('llmtest.theme', state.theme);
}

export function persistChannel() {
  const payload = {
    channel: state.rememberKey ? { ...state.channel } : { ...state.channel, apiKey: '' },
    rememberKey: state.rememberKey,
  };
  localStorage.setItem(LS_KEY, JSON.stringify(payload));
}

export function log(line: string) {
  const ts = new Date().toLocaleTimeString();
  state.logs.push(`[${ts}] ${line}`);
}

const ready = computed(() => Boolean(state.channel.apiKey && state.channel.model));

async function postJson(path: string, body?: unknown): Promise<any> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? { channel: { ...state.channel }, options: {} }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${json.kind ?? 'error'}: ${json.error}`);
  return json;
}

function reset(id: TestId): any {
  state.statuses[id] = 'running';
  log(`▶ 开始 ${labelOf(id)}…`);
}

function finish(id: TestId, result: any) {
  setRes(id, result);
  state.statuses[id] = 'done';
  log(`✅ ${labelOf(id)} 完成`);
}

function fail(id: TestId, err: unknown) {
  state.statuses[id] = 'error';
  log(`❌ ${labelOf(id)} 失败: ${err instanceof Error ? err.message : String(err)}`);
}

function setRes(id: TestId, result: any) {
  ({
    speed: () => (state.speedResult = result),
    concurrency: () => (state.concurrencyResult = result),
    input: () => (state.inputResult = result),
    output: () => (state.outputResult = result),
    svg: () => (state.svgResult = result),
    candy: () => (state.candyResult = result),
    version: () => (state.versionResult = result),
  })[id]!();
}

export function labelOf(id: TestId): string {
  return ({ speed: '响应速度', concurrency: '并发测试', input: '输入探测', output: '输出探测', svg: 'SVG 测试', candy: '糖果问题', version: '知识截止测试' })[id];
}

export async function runVersionCheck() {
  if (!ready.value) return;
  const modelId = state.versionModelId || state.channel.model;
  reset('version');
  try {
    persistChannel();
    await postSse('/api/test/version', { channel: { ...state.channel }, modelId }, (evt) => {
      if (evt.type === 'progress') log(evt.message);
      else if (evt.type === 'result') finish('version', evt.data);
      else if (evt.type === 'error') fail('version', new Error(evt.message));
    });
  } catch (e) { fail('version', e); }
}


export type SvgUserRating = 'good' | 'ok' | 'bad';
export const SVG_RATING_LABELS: Record<SvgUserRating, string> = { good: '👍 画得好', ok: '😐 还行', bad: '👎 不行' };
const SVG_RATING_SCORE: Record<SvgUserRating, number> = { good: 100, ok: 50, bad: 0 };

export function rateSvg(rating: SvgUserRating) {
  if (!state.svgResult) return;
  state.svgResult = { ...state.svgResult, selfRating: rating };
  log(`🧑‍🎨 SVG 自评：${SVG_RATING_LABELS[rating]}`);
}


export async function runSpeed() {
  if (!ready.value) return;
  reset('speed');
  try {
    persistChannel();
    finish('speed', await postJson('/test/speed'));
  } catch (e) { fail('speed', e); }
}

export async function runConcurrencyTest() {
  if (!ready.value) return;
  reset('concurrency');
  try {
    persistChannel();
    await postSse('/api/test/concurrency', { channel: { ...state.channel }, options: {} }, (evt) => {
      if (evt.type === 'progress') log(evt.message);
      else if (evt.type === 'result') finish('concurrency', evt.data);
      else if (evt.type === 'error') fail('concurrency', new Error(evt.message));
    });
  } catch (e) { fail('concurrency', e); }
}

export async function runInputProbe() {
  if (!ready.value) return;
  reset('input');
  try {
    persistChannel();
    await postSse('/api/test/input', {
      channel: { ...state.channel },
      options: { budgetTokens: state.budget },
    }, (evt) => {
      if (evt.type === 'progress') log(evt.message);
      else if (evt.type === 'result') finish('input', evt.data);
      else if (evt.type === 'error') fail('input', new Error(evt.message));
    });
  } catch (e) { fail('input', e); }
}

export async function runOutputProbe() {
  if (!ready.value) return;
  reset('output');
  try {
    persistChannel();
    let result: any = null;
    await postSse('/api/test/output', {
      channel: { ...state.channel },
      options: {},
    }, (evt) => {
      if (evt.type === 'progress') log(evt.message);
      else if (evt.type === 'result') result = evt.data;
      else if (evt.type === 'error') throw new Error(evt.message);
    });
    if (result) finish('output', result);
  } catch (e) { fail('output', e); }
}

export async function runSvgTest() {
  if (!ready.value) return;
  reset('svg');
  try {
    persistChannel();
    finish('svg', await postJson('/test/svg'));
  } catch (e) { fail('svg', e); }
}

export async function runCandyTest() {
  if (!ready.value) return;
  reset('candy');
  state.candyElapsedSec = 0;
  try {
    persistChannel();
    await postSse('/api/test/candy', { channel: { ...state.channel } }, (evt) => {
      if (evt.type === 'progress') {
        const sec = evt.data?.elapsedSec ?? 0;
        state.candyElapsedSec = sec;
        if (sec > 0 && sec % 30 === 0) log(`🍬 ${evt.message}`);
      }
      else if (evt.type === 'result') finish('candy', evt.data);
      else if (evt.type === 'error') fail('candy', new Error(evt.message));
    });
  } catch (e) { fail('candy', e); }
}

export async function runSuite() {
  if (state.suiteRunning || !ready.value) return;
  state.suiteRunning = true;
  log('🚀 一键全面体检开始');
  try {
    await runSpeed();
    await runConcurrencyTest();
    await runSvgTest();
    await runCandyTest();
    await runVersionCheck();
    await runInputProbe();
    await runOutputProbe();
  } finally {
    state.suiteRunning = false;
    log('🏁 一键全面体检结束，报告已更新');
    state.page = 'report';
  }
}

/* ── Report ─────────────────────────── */
export interface ReportRow {
  name: string;
  icon: string;
  score: number | null;
  maxScore: number;
  summary: string;
}

/** 40% TTFB（<=300ms 满分，>=10s 归零）+ 60% 吞吐（>=150 tok/s 满分）。 */
function speedScore(sp: { ttfbMs: number; tokensPerSecond: number | null }): number {
  const ttfbScore = Math.max(0, Math.min(100, Math.round(100 - ((sp.ttfbMs - 300) / 9700) * 100)));
  const tpsScore = Math.max(0, Math.min(100, Math.round(((sp.tokensPerSecond ?? 0) / 150) * 100)));
  return Math.round(ttfbScore * 0.4 + tpsScore * 0.6);
}
export const reportRows = computed<ReportRow[]>(() => {
  const rows: ReportRow[] = [];
  const sp = state.speedResult;
  rows.push({
    name: '响应速度', icon: '⚡',
    score: sp ? speedScore(sp) : null,
    maxScore: 100,
    summary: sp ? `TTFB ${sp.ttfbMs}ms · ${(sp.tokensPerSecond ?? 0).toFixed(1)} tok/s` : '未测试',
  });
  const cc = state.concurrencyResult;
  rows.push({
    name: '并发能力', icon: '🧵',
    score: cc ? Math.min(100, Math.max(0, Math.round((Math.log2(Math.max(1, cc.maxConcurrentOk)) / 6) * 100))) : null,
    maxScore: 100,
    summary: cc ? `${cc.maxConcurrentOk} 并发${cc.capped ? '（未探到顶）' : ''} · 测了 ${cc.levels.length} 档` : '未测试',
  });
  const ip = state.inputResult;
  rows.push({
    name: '最大输入', icon: '📥',
    score: ip ? (ip.maxSafeTokens ? Math.round(Math.min(100, Math.max(0, Math.round((Math.log2(ip.maxSafeTokens / 1024) / 10) * 100))) * (ip.echoVerified === false ? 0.5 : 1)) : 0) : null,
    maxScore: 100,
    summary: ip ? `实测 ${ip.maxSafeTokens?.toLocaleString() ?? '未通过'} tok${ip.claim ? ` · 宣称 ${ip.claim.toLocaleString()}（${ip.claimSource}）` : ''}${ip.inconclusive ? ' · 下界' : ''}${ip.echoVerified === false ? ' · ⚠ 口令未回显（仅供参考）' : ''}` : '未测试',
  });
  const op = state.outputResult;
  rows.push({
    name: '最大输出', icon: '📤',
    score: op ? (op.achievedCompletionTokens ? Math.min(100, Math.max(0, Math.round((Math.log2(op.achievedCompletionTokens / 1024) / 7) * 100))) : 0) : null,
    maxScore: 100,
    summary: op ? `实测 ${op.achievedCompletionTokens} tok · ${op.finishedByStop ? '自然停止' : op.timedOut ? '超时截断' : '压到上限'}${op.tokenReportMismatched ? ` · 渠报 ${op.reportedCompletionTokens}（可疑）` : ''}` : '未测试',
  });
  const sv = state.svgResult;
  rows.push({
    name: 'SVG 创作', icon: '🎨',
    score: sv ? (sv.selfRating ? SVG_RATING_SCORE[sv.selfRating as SvgUserRating] : sv.grade.isValidSvg ? Math.max(20, sv.grade.richnessScore) : 0) : null,
    maxScore: 100,
    summary: sv ? `${sv.grade.elementCount} 元素${sv.selfRating ? ` · 用户评:${({ good: '好', ok: '一般', bad: '差' } as Record<string, string>)[sv.selfRating]}` : ''}` : '未测试',
  });
  const cd = state.candyResult;
  const candyScoreMap: Record<string, number> = { advanced: 100, close: 60 };
  rows.push({
    name: '逻辑推理', icon: '🍬',
    score: cd ? candyScoreMap[cd.grade.verdict] ?? 0 : null,
    maxScore: 100,
    summary: cd ? (({ advanced: '答对 21（高级）', close: '答 29（第二梯队）', failed: `答 ${cd.grade.detectedNumber ?? '?'}（不合格）` } as Record<string, string>)[cd.grade.verdict as string] ?? '未知结果') : '未测试',
  });
  const vr = state.versionResult;
  rows.push({
    name: '知识截止', icon: '📚',
    score: vr ? (vr.pctKnown ?? null) : null,
    maxScore: 100,
    summary: vr ? `${vr.verdictLabel} · 知情率 ${vr.pctKnown}%` : '未测试',
  });

  return rows;
});

export const overallScore = computed(() => {
  const rows = reportRows.value;
  if (!rows.some((r) => r.score !== null)) return null;
  // 未跑的项计 0 分，避免部分测试把综合分抬高。
  return Math.round(rows.reduce((s, r) => s + (r.score ?? 0), 0) / rows.length);
});

export function buildMarkdown(): string {
  const ch = state.channel;
  const lines: string[] = [
    '# LLM API 渠道体检报告',
    '',
    `- 渠道：\`${ch.baseUrl}\``,
    `- 模型：\`${ch.model}\``,
    `- 时间：${new Date().toLocaleString()}`,
    `- 综合评分：**${overallScore.value ?? '—'} / 100**`,
    '',
    '| 项目 | 得分 | 说明 |',
    '|---|---|---|',
  ];
  for (const r of reportRows.value) {
    lines.push(`| ${r.icon} ${r.name} | ${r.score !== null ? `${r.score}/${r.maxScore}` : '—'} | ${r.summary} |`);
  }
  lines.push('', '> 由 LLM API 渠道体检工具生成；测试机时间与网络状况可能影响速度指标。');
  return lines.join('\n');
}

/* ── Feedback ─────────────────────────── */
const CID_KEY = 'llmtest.cid';
let _cid = localStorage.getItem(CID_KEY) ?? '';
if (!_cid) {
  _cid = `cid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(CID_KEY, _cid);
}
export const clientId = _cid;

export async function loadFeedback(force = false) {
  if (state.feedbackLoaded && !force) return;
  try {
    const res = await fetch(`/api/feedback?cid=${encodeURIComponent(clientId)}`);
    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      throw new Error(typeof errBody?.error === 'string' ? errBody.error : `HTTP ${res.status}`);
    }
    const body = await res.json();
    state.feedbackItems = body.items ?? [];
    state.feedbackCategories = body.categories ?? [];
    state.feedbackLoaded = true;
  } catch (e) {
    log(`❌ 反馈列表加载失败: ${e instanceof Error ? e.message : e}`);
  }
}

export async function voteFeedback(id: string) {
  if (state.feedbackVoting) return;
  state.feedbackVoting = id;
  try {
    const res = await fetch('/api/feedback/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, clientId }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      throw new Error(typeof errBody?.error === 'string' ? errBody.error : `HTTP ${res.status}`);
    }
    const body = await res.json();
    state.feedbackItems = body.items ?? [];
  } catch (e) {
    log(`❌ 投票失败: ${e instanceof Error ? e.message : e}`);
  } finally {
    state.feedbackVoting = null;
  }
}

export async function submitCustomFeedback(category: string, text: string): Promise<string | null> {
  const clean = text.trim();
  if (!clean) return '内容不能为空';
  if (clean.length > 200) return '最多 200 字';
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, text: clean, clientId }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      throw new Error(typeof errBody?.error === 'string' ? errBody.error : `HTTP ${res.status}`);
    }
    const body = await res.json();
    state.feedbackItems = body.items ?? [];
    state.feedbackCategories = body.categories ?? [];
    state.feedbackLoaded = true;
    log('✅ 反馈已提交');
    return null;
  } catch (e) {
    return `提交失败: ${e instanceof Error ? e.message : e}`;
  }
}

export function download(filename: string, content: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function loadModels() {
  try {
    persistChannel();
    const json = await postJson('/models');
    state.models = json.models ?? [];
    if (!state.channel.model && state.models.length) state.channel.model = state.models[0];
    log(`拉取到 ${state.models.length} 个模型`);
  } catch (e) {
    log(`❌ 模型列表失败: ${e instanceof Error ? e.message : e}`);
  }
}