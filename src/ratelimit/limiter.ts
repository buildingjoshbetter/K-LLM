interface TokenBucket {
  tokens: number;
  lastRefill: number;
  maxTokens: number;
  refillRate: number; // tokens per ms
}

export class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  private globalBucket: TokenBucket;
  private pending: Promise<void> = Promise.resolve();

  constructor(perModelRpm: number, globalRpm: number) {
    this.globalBucket = this.createBucket(globalRpm);
  }

  private createBucket(rpm: number): TokenBucket {
    return {
      tokens: rpm,
      lastRefill: Date.now(),
      maxTokens: rpm,
      refillRate: rpm / 60000, // per ms
    };
  }

  private refillBucket(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(
      bucket.maxTokens,
      bucket.tokens + elapsed * bucket.refillRate
    );
    bucket.lastRefill = now;
  }

  private async consumeToken(bucket: TokenBucket): Promise<void> {
    this.refillBucket(bucket);
    if (bucket.tokens < 1) {
      if (bucket.refillRate <= 0) {
        throw new Error("Rate limit RPM is 0; cannot acquire token.");
      }
      const waitMs = Math.ceil((1 - bucket.tokens) / bucket.refillRate);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      this.refillBucket(bucket);
    }
    bucket.tokens -= 1;
  }

  async acquire(modelId: string, perModelRpm: number): Promise<void> {
    if (!this.buckets.has(modelId)) {
      this.buckets.set(modelId, this.createBucket(perModelRpm));
    }
    const modelBucket = this.buckets.get(modelId)!;

    // Serialize access to prevent race conditions where concurrent
    // callers both see tokens >= 1 and both decrement, going negative.
    this.pending = this.pending.then(async () => {
      await Promise.all([
        this.consumeToken(modelBucket),
        this.consumeToken(this.globalBucket),
      ]);
    });
    await this.pending;
  }
}
