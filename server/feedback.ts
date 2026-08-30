import { chatJson } from './openai';
import type { Env } from './types';

/** Feedback dimensions; entries themselves are user-typed. */
export const FEEDBACK_CATEGORIES: Array<{ id: string; label: string; hint: string }> = [
  { id: 'misjudge', label: '结论不准', hint: '某项测试的结论与你的实际体验不符' },
  { id: 'new-test', label: '想要的新测试', hint: '希望增加的能力测试项' },
  { id: 'ui', label: '界面与体验', hint: '排版、交互、丝滑度' },
  { id: 'feature', label: '功能建议', hint: '对比、历史、分享这类工具能力' },
  { id: 'other', label: '其他', hint: '以上都不合适时选这里' },
];

export interface FeedbackItem {
  id: string;
  category: string; // category id
  text: string;
  likes: number;
  mine: boolean;
  createdAt: number;
}

interface RawEntry {
  id: string;
  category: string;
  text: string;
  createdAt: number;
  voters: string[];
}

interface RawStore {
  entries: RawEntry[];
}

const KV_KEY = 'feedback.v1';
const TEXT_MAX = 200;
const MAX_ENTRIES = 500;
const MAX_VOTERS_PER_ITEM = 500;

function categoryLabel(id: string): string {
  return FEEDBACK_CATEGORIES.find((c) => c.id === id)?.label ?? '其他';
}

async function readStore(env: Env): Promise<RawStore> {
  const raw = await env.FEEDBACK_KV?.get(KV_KEY);
  if (!raw) return { entries: [] };
  try {
    const j = JSON.parse(raw) as Partial<RawStore>;
    return { entries: Array.isArray(j.entries) ? j.entries : [] };
  } catch {
    return { entries: [] };
  }
}

async function writeStore(env: Env, store: RawStore): Promise<void> {
  await env.FEEDBACK_KV?.put(KV_KEY, JSON.stringify(store));
}

function toItem(e: RawEntry, clientId: string): FeedbackItem {
  return {
    id: e.id,
    category: e.category,
    text: e.text,
    likes: e.voters.length,
    mine: e.voters.includes(clientId),
    createdAt: e.createdAt,
  };
}

export async function listFeedback(env: Env, clientId: string): Promise<FeedbackItem[]> {
  const store = await readStore(env);
  return store.entries
    .map((e) => toItem(e, clientId))
    .sort((a, b) => b.likes - a.likes || b.createdAt - a.createdAt);
}

/**
 * LLM moderation: reject abuse / ads / off-topic / gibberish before persisting.
 * Fail-open: when the judge channel is unconfigured or errors, let it through.
 */
async function moderate(env: Env, text: string): Promise<boolean> {
  if (!env.RESEARCH_BASE_URL || !env.RESEARCH_API_KEY || !env.RESEARCH_MODEL) return true;
  const judge = { baseUrl: env.RESEARCH_BASE_URL, apiKey: env.RESEARCH_API_KEY, model: env.RESEARCH_MODEL };
  try {
    const { content } = await chatJson(judge, {
      model: judge.model,
      messages: [{
        role: 'user',
        content: `你是「LLM API 渠道体检工具」反馈栏目的内容审核员。下面是一条用户提交的反馈原文。正常的批评、吐槽、建议、愿望都放行；以下才拦截：谩骂或人身攻击、广告或引流、与本工具完全无关、无意义灌水或乱码。只输出一个词：OK 或 BLOCK。\n\n反馈原文：\n${text}`,
      }],
      max_tokens: 8,
    });
    const w = content.trim().toUpperCase();
    return w.includes('OK') && !w.includes('BLOCK');
  } catch {
    return true;
  }
}

export async function addFeedback(
  env: Env,
  categoryId: string,
  text: string,
  clientId: string,
): Promise<FeedbackItem[]> {
  const clean = text.trim().slice(0, TEXT_MAX);
  if (!clean) throw new Error('empty');
  if (!(await moderate(env, clean))) throw new Error('rejected_by_moderation');
  const cat = FEEDBACK_CATEGORIES.find((c) => c.id === categoryId) ? categoryId : 'other';
  const store = await readStore(env);
  if (store.entries.length >= MAX_ENTRIES) store.entries.splice(0, store.entries.length - MAX_ENTRIES + 1);
  store.entries.push({
    id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    category: cat,
    text: clean,
    createdAt: Date.now(),
    voters: [clientId], // author implicitly supports their own post
  });
  await writeStore(env, store);
  return listFeedback(env, clientId);
}

export async function toggleVote(env: Env, id: string, clientId: string): Promise<FeedbackItem[] | null> {
  const store = await readStore(env);
  const entry = store.entries.find((e) => e.id === id);
  if (!entry) return null;
  const idx = entry.voters.indexOf(clientId);
  if (idx >= 0) entry.voters.splice(idx, 1);
  else if (entry.voters.length < MAX_VOTERS_PER_ITEM) entry.voters.push(clientId);
  await writeStore(env, store);
  return listFeedback(env, clientId);
}

export { categoryLabel };