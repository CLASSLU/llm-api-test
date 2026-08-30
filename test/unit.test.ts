import { describe, expect, it } from 'vitest';
import { classifyError } from '../server/openai';
import { padToTokenCount } from '../server/probe';

describe('classifyError', () => {
  it('identifies auth errors', () => {
    expect(classifyError(401, '')).toBe('auth_error');
    expect(classifyError(403, 'forbidden')).toBe('auth_error');
  });
  it('identifies rate limits', () => {
    expect(classifyError(429, 'slow down')).toBe('rate_limited');
  });
  it('identifies context limit by message', () => {
    expect(classifyError(400, 'This model maximum context length is 8192')).toBe('context_limit');
    expect(classifyError(400, 'please reduce the length of the messages')).toBe('context_limit');
  });
  it('identifies model not found', () => {
    expect(classifyError(404, '{"error":"model not found"}')).toBe('model_not_found');
  });
  it('falls back to unknown', () => {
    expect(classifyError(400, 'weird failure')).toBe('unknown_error');
  });
});

describe('padToTokenCount', () => {
  it('scales text proportionally to ratio', () => {
    const small = padToTokenCount(1000, 2);
    const large = padToTokenCount(2000, 2);
    expect(large.length).toBe(Math.round(small.length * 2));
  });
});
