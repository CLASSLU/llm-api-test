export interface ChannelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface Env {
  ASSETS?: { fetch: (req: Request) => Promise<Response> };
  TAVILY_API_KEY?: string;
  FEEDBACK_KV?: { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> };
  RESEARCH_BASE_URL?: string;
  RESEARCH_API_KEY?: string;
  RESEARCH_MODEL?: string;
}

export interface UsageInfo {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export type ProbeEventType =
  | 'progress'
  | 'result'
  | 'done'
  | 'error';

export interface ProbeEvent {
  type: ProbeEventType;
  message?: string;
  data?: unknown;
}

export interface SpeedResult {
  model: string;
  ttfbMs: number | null;
  totalMs: number;
  completionTokens: number | null;
  promptTokens: number | null;
  tokensPerSecond: number | null;
}

export interface InputProbeAttempt {
  targetTokens: number;
  ok: boolean;
  measuredPromptTokens: number | null;
  errorKind: string | null;
  detail?: string;
  /** true = markers echoed (model provably read both ends); false = accepted but unproven. */
  echoOk?: boolean;
}

export interface InputProbeResult {
  maxSafeTokens: number | null;
  attempts: InputProbeAttempt[];
  /** The claim we validated against (official spec, user hint, or fallback). */
  claim?: number | null;
  claimSource?: string | null;
  /** false when capacity passed but echo checks never did — treat result as advisory. */
  echoVerified?: boolean;
}

export interface OutputProbeResult {
  requestedMaxTokens: number;
  achievedCompletionTokens: number | null;
  finishedByStop: boolean;
  totalMs: number;
  timedOut?: boolean;
  /** Provider-reported usage when it diverges wildly from the streamed text. */
  reportedCompletionTokens?: number;
  /** True when provider usage disagrees with observed stream by >25%. */
  tokenReportMismatched?: boolean;
  /** Where the requested max_tokens came from. */
  targetSource?: string | null;
  /** Officially advertised max output from web lookup, when found. */
  specClaimedMaxOutput?: number | null;
  /** finish_reason from the stream ('stop' | 'length' | ...), when reported. */
  finishReason?: string | null;
  /** Model voluntarily stopped after a tiny output — ceiling NOT probed. */
  selfStopped?: boolean;
}

export interface InputProbeOptions {
  /** User override; when absent the probe looks up the official spec online. */
  claimedMaxContextTokens?: number;
  budgetTokens: number;
  maxAttempts?: number;
}

export interface OutputProbeOptions {
  /** User override; when absent the probe asks for the astronomical and reads the channel's reaction. */
  targetMaxOutputTokens?: number;
  timeoutMs?: number;
}
