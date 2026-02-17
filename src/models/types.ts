export interface AnalystConfig {
  model: string;
  maxTokens: number;
  label: string;
  icon: string;
  description: string;
}

export interface SynthesizerConfig {
  model: string;
  maxTokens: number;
  label: string;
  description: string;
}

export interface RateLimitConfig {
  perModelRpm: number;
  globalRpm: number;
  maxTokensPerCycle: number;
  maxCostPerCycle: number;
}

export interface OutputConfig {
  showIndividualAnalyses: boolean;
  showCostBreakdown: boolean;
  showTimings: boolean;
}

export interface Config {
  analysts: Record<string, AnalystConfig>;
  synthesizer: SynthesizerConfig;
  rateLimits: RateLimitConfig;
  output: OutputConfig;
}

export interface AnalystResult {
  role: string;
  label: string;
  icon: string;
  model: string;
  content: string;
  tokensUsed: number;
  durationMs: number;
}

export interface SynthesisResult {
  content: string;
  tokensUsed: number;
  durationMs: number;
}

export interface ConsensusResult {
  prompt: string;
  analyses: AnalystResult[];
  synthesis: SynthesisResult;
  totalTokens: number;
  totalDurationMs: number;
  estimatedCost: number;
}
