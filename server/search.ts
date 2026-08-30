export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/** Minimal Tavily client. Docs: https://docs.tavily.com */
export async function tavilySearch(
  query: string,
  apiKey: string,
  maxResults = 5,
): Promise<SearchHit[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      search_depth: 'basic',
      max_results: maxResults,
      include_answer: false,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`tavily ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (json.results ?? []).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: (r.content ?? '').slice(0, 500),
  }));
}

/** Parse a date suffix like -0813 / -0905 at the end of a model id. */
export function parseDateSuffix(modelId: string): { base: string; mmdd: string | null } {
  const m = /^(.*?)-?(\d{4})$/.exec(modelId.trim());
  if (!m) return { base: modelId, mmdd: null };
  const { month, day } = { month: Number(m[2].slice(0, 2)), day: Number(m[2].slice(2)) };
  if (month < 1 || month > 12 || day < 1 || day > 31) return { base: modelId, mmdd: null };
  return { base: m[1], mmdd: m[2] };
}

export function yearForMmdd(mmdd: string, modelHintYear?: number): number {
  if (modelHintYear) return modelHintYear;
  const y = new Date().getFullYear();
  // Date suffix in the future for this year likely belongs to last year's cycle.
  const asThisYear = new Date(`${y}-${mmdd.slice(0, 2)}-${mmdd.slice(2)}`);
  return asThisYear.getTime() > Date.now() ? y - 1 : y;
}
