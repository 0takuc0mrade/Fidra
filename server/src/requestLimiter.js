export class RequestLimiter {
  constructor({ limit = 12, windowMs = 60_000, now = Date.now } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.entries = new Map();
  }

  consume(keys) {
    const timestamp = this.now();
    for (const key of keys.filter(Boolean)) {
      const recent = (this.entries.get(key) ?? []).filter((value) => timestamp - value < this.windowMs);
      if (recent.length >= this.limit) return false;
      recent.push(timestamp);
      this.entries.set(key, recent);
    }
    return true;
  }
}
