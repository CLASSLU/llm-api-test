export interface SvgGrade {
  isValidSvg: boolean;
  elementCount: number;
  hasViewBox: boolean;
  richnessScore: number;
  details: {
    circles: number;
    ellipses: number;
    paths: number;
    rects: number;
    polygons: number;
    lines: number;
    texts: number;
    groups: number;
  };
}

const ELEMENT_NAMES = ['circle', 'ellipse', 'path', 'rect', 'polygon', 'line', 'text', 'g'] as const;

function countElement(svg: string, name: string): number {
  return svg.match(new RegExp(`<${name}[\\s>/]`, 'gi'))?.length ?? 0;
}

/** Structural + richness grading for generated SVG artwork. */
export function gradeSvg(raw: string): SvgGrade {
  const trimmed = raw.trim();
  const body = extractSvgBlock(trimmed);
  const lowerBody = body.toLowerCase();
  const openTag = /<svg[\s>]/.test(lowerBody);
  const closeTag = /<\/svg\s*>/.test(lowerBody);
  const unclosedTagPattern =
    /<(circle|ellipse|path|rect|polygon|line|text)\b(?![^<]*\/>)(?![^<]*<\/)/i;
  const balanced =
    body.length > 0 &&
    (body.match(/</g)?.length ?? 0) === (body.match(/>/g)?.length ?? 0) &&
    !unclosedTagPattern.test(body);
  const hasViewBox = /viewbox\s*=/i.test(body);
  const details: SvgGrade['details'] = {
    circles: countElement(body, 'circle'),
    ellipses: countElement(body, 'ellipse'),
    paths: countElement(body, 'path'),
    rects: countElement(body, 'rect'),
    polygons: countElement(body, 'polygon'),
    lines: countElement(body, 'line'),
    texts: countElement(body, 'text'),
    groups: countElement(body, 'g'),
  };
  let elementCount = 0;
  for (const n of ELEMENT_NAMES) elementCount += countElement(body, n);
  const richnessScore = Math.min(100, elementCount * 4 + (hasViewBox ? 10 : 0));
  return {
    isValidSvg: Boolean(openTag && closeTag && balanced),
    elementCount,
    hasViewBox,
    richnessScore,
    details,
  };
}

/** Extract the pure <svg>…</svg> block, stripping fences/prose. */
export function extractSvgBlock(raw: string): string {
  const lower = raw.toLowerCase();
  const start = lower.indexOf('<svg');
  const end = lower.lastIndexOf('</svg>');
  if (start === -1 || end <= start) return '';
  return raw.slice(start, end + 6);
}

export const SVG_PROMPT =
  '请用 SVG 代码画一只鹈鹕骑自行车。要求：只输出一个完整的 <svg>...</svg> 代码块，不要其他文字。' +
  '鹈鹕要有身体、长嘴、翅膀，自行车要有两个轮子、车架和把手。尽量使用多种图形元素（circle/ellipse/path/rect 等）。';

/**
 * The classic worst-case drawer-principle candy puzzle.
 * 21 = first tier (correct); 29 = second tier (typical partial analysis).
 */
export const CANDY_QUESTION = `在一个黑色的袋子里放有三种口味的糖果，每种糖果有两种不同的形状（圆形和五角星形）。数量如下：

- 苹果味：圆形 7 个，五角星形 7 个
- 桃子味：圆形 9 个，五角星形 6 个
- 西瓜味：圆形 8 个，五角星形 4 个

味道摸不出来，但形状靠手感可以分辨。参赛者需要在活动前就决定摸出的数目。问：最少取出多少个糖果，才能保证手中同时拥有"圆形苹果味配五角星形桃子味"或"五角星形苹果味配圆形桃子味"？请给出你的最终答案（一个数字）。`;

export interface CandyGrade {
  answer: string;
  verdict: 'advanced' | 'close' | 'failed';
  detectedNumber: number | null;
}

function extractNumbers(text: string): number[] {
  return [...text.matchAll(/\d+/g)].map((m) => parseInt(m[0], 10));
}

/** Tier the reply: 21 advanced (correct), 29 close (second tier), otherwise failed. */
export function gradeCandy(rawAnswer: string): CandyGrade {
  const text = rawAnswer.trim();
  const unitMatch = /\b(\d+)\s*(?:个|颗|粒)\b/.exec(text);
  const nums = extractNumbers(text);
  const detectedNumber = unitMatch ? Number(unitMatch[1]) : nums.at(-1) ?? null;
  if (detectedNumber === 21) return { answer: text, verdict: 'advanced', detectedNumber };
  if (detectedNumber === 29) return { answer: text, verdict: 'close', detectedNumber };
  return { answer: text, verdict: 'failed', detectedNumber };
}
