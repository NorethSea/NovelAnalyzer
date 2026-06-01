export class RateLimiter {
  private timestamps: number[] = [];
  private queue: Promise<void> = Promise.resolve();
  private rpmLimit: number;

  constructor(rpmLimit: number) {
    this.rpmLimit = rpmLimit;
  }

  updateLimit(rpmLimit: number) {
    this.rpmLimit = rpmLimit;
  }

  getLimit(): number {
    return this.rpmLimit;
  }

  waitIfNeeded(): Promise<void> {
    if (this.rpmLimit <= 0) return Promise.resolve();
    this.queue = this.queue.then(() => this.doWait());
    return this.queue;
  }

  private async doWait(): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    this.timestamps = this.timestamps.filter(t => t > oneMinuteAgo);

    if (this.timestamps.length >= this.rpmLimit) {
      const oldestInWindow = this.timestamps[0];
      const waitTime = oldestInWindow + 60000 - now + 100;
      if (waitTime > 0) {
        console.log(`[RateLimiter] 达到 ${this.rpmLimit} RPM 限制，等待 ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      this.timestamps = this.timestamps.filter(t => t > Date.now() - 60000);
    }

    this.timestamps.push(Date.now());
  }

  getStats(): { current: number; limit: number } {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    this.timestamps = this.timestamps.filter(t => t > oneMinuteAgo);
    return {
      current: this.timestamps.length,
      limit: this.rpmLimit,
    };
  }
}
