import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimiter } from "../limiter.js";

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates per-model bucket on first acquire", async () => {
    const limiter = new RateLimiter(10, 30);
    // Should not throw - bucket auto-created
    await limiter.acquire("model-a", 10);
  });

  it("allows burst up to RPM limit without waiting", async () => {
    const limiter = new RateLimiter(5, 30);
    // Should be able to acquire 5 times immediately (burst capacity)
    for (let i = 0; i < 5; i++) {
      await limiter.acquire("model-a", 5);
    }
  });

  it("creates separate buckets per model", async () => {
    const limiter = new RateLimiter(2, 30);
    // Exhaust model-a's bucket
    await limiter.acquire("model-a", 2);
    await limiter.acquire("model-a", 2);
    // model-b should still have its own bucket
    await limiter.acquire("model-b", 2);
    await limiter.acquire("model-b", 2);
  });

  it("shares global bucket across models", async () => {
    // Global RPM = 3, so only 3 total acquires before waiting
    const limiter = new RateLimiter(10, 3);

    await limiter.acquire("model-a", 10);
    await limiter.acquire("model-b", 10);
    await limiter.acquire("model-c", 10);

    // 4th acquire should need to wait for global bucket
    const acquirePromise = limiter.acquire("model-d", 10);
    // Advance time to allow refill
    vi.advanceTimersByTime(30000);
    await acquirePromise;
  });

  it("refills tokens over time", async () => {
    const limiter = new RateLimiter(1, 30);
    await limiter.acquire("model-a", 1);
    // Bucket empty. Advance enough time for 1 token refill at 1/60000 per ms
    // Need 60000ms for 1 token
    vi.advanceTimersByTime(61000);
    await limiter.acquire("model-a", 1);
  });
});
