/** Serialize revisions across asynchronous IPC. A rejected revision stays at
 * the head so Ctrl+S can retry it before any dependent revisions. */
export class StagedWrites<T> {
  private pending: T[] = []
  private active?: Promise<void>

  private readonly write: (delta: T) => Promise<unknown>

  constructor(write: (delta: T) => Promise<unknown>) {
    this.write = write
  }

  stage(delta: T) {
    this.pending.push(delta)
    return this.drain()
  }

  drain(): Promise<void> {
    if (!this.pending.length) return Promise.resolve()
    return this.active ??= this.writePending()
  }

  private async writePending() {
    try {
      while (this.pending.length) {
        await this.write(this.pending[0])
        this.pending.shift()
      }
    } finally {
      this.active = undefined
    }
  }
}
