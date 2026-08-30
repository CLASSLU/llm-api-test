/** POST JSON and consume an SSE stream from the response body. */
export async function postSse(
  url: string,
  payload: unknown,
  onEvent: (data: any) => void,
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawDone = false;
  const emit = (data: any) => {
    if (data?.type === 'done') sawDone = true;
    onEvent(data);
  };
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop()!;
    for (const part of parts) {
      for (const line of part.split('\n')) {
        if (!line.startsWith('data:')) continue;
        try {
          emit(JSON.parse(line.slice(5).trim()));
        } catch {
          /* ignore malformed lines */
        }
      }
    }
  }
  if (!sawDone) throw new Error('SSE 连接提前中断，未收到完成信号');
}
