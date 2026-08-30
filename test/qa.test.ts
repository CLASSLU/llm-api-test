import { describe, expect, it } from 'vitest';
import { gradeSvg, gradeCandy } from '../server/qa';

const richSvg = `<svg viewBox="0 0 100 60" xmlns="http://www.w3.org/2000/svg">
  <g><ellipse cx="40" cy="30" rx="14" ry="10"/><circle cx="30" cy="18" r="6"/>
  <path d="M24 18 L10 20 Z"/><rect x="42" y="34" width="3" height="12"/>
  <polygon points="36,46 44,46 40,54"/><circle cx="28" cy="50" r="6"/>
  <circle cx="52" cy="50" r="6"/><line x1="28" y1="50" x2="52" y2="50"/>
  <text x="80" y="10">pelican</text></g>
</svg>`;

describe('gradeSvg', () => {
  it('validates a rich artwork and scores elements', () => {
    const g = gradeSvg(richSvg);
    expect(g.isValidSvg).toBe(true);
    expect(g.hasViewBox).toBe(true);
    expect(g.elementCount).toBeGreaterThanOrEqual(8);
    expect(g.richnessScore).toBeGreaterThanOrEqual(40);
    expect(g.details.circles).toBe(3);
  });
  it('rejects text without svg tags', () => {
    const g = gradeSvg('抱歉，我不能画图。');
    expect(g.isValidSvg).toBe(false);
    expect(g.elementCount).toBe(0);
  });
  it('rejects broken structure', () => {
    const g = gradeSvg('<svg viewBox="0 0 10 10"><circle cx="1"/>');
    expect(g.isValidSvg).toBe(false);
  });
});

describe('gradeCandy', () => {
  it('marks 21 as advanced', () => {
    expect(gradeCandy('经过分析…最终答案：21 个。').verdict).toBe('advanced');
  });
  it('marks 29 as close (missed touch-distinguishable shapes)', () => {
    expect(gradeCandy('最坏情况是取出 29 个。').verdict).toBe('close');
  });
  it('fails other numbers', () => {
    expect(gradeCandy('答案是 25。').verdict).toBe('failed');
    expect(gradeCandy('无法确定').detectedNumber).toBeNull();
  });
});
