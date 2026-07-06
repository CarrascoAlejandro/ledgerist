/**
 * Hybrid Logical Clock (HLC) for P2P sync versioning.
 *
 * Encoded as a fixed-width, lexicographically sortable TEXT value so that
 * plain string comparison equals HLC comparison:
 *
 *   <physical millis, 15-digit zero-padded>-<logical counter, 4-hex>-<device id, first 8 chars>
 *   e.g. 001751803254123-0003-3f9a12bc
 *
 * See docs/sync/DESIGN.md §3.
 */

export interface HlcParts {
  physical: number;
  counter: number;
  device: string;
}

export const HLC_COUNTER_MAX = 0xffff;

const PHYSICAL_WIDTH = 15;
const HLC_RE = /^(\d{15})-([0-9a-f]{4})-(.{1,8})$/;

export function encodeHlc(physical: number, counter: number, deviceId: string): string {
  const phys = String(physical).padStart(PHYSICAL_WIDTH, '0');
  const cnt = counter.toString(16).padStart(4, '0');
  return `${phys}-${cnt}-${deviceId.slice(0, 8)}`;
}

export function parseHlc(hlc: string): HlcParts {
  const m = HLC_RE.exec(hlc);
  if (!m) {
    throw new Error(`Invalid HLC: ${hlc}`);
  }
  return { physical: Number(m[1]), counter: parseInt(m[2], 16), device: m[3] };
}

/** Plain string compare — exported to make call-site intent explicit. */
export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class HLC {
  private physical = 0;
  private counter = 0;
  private readonly device: string;
  private readonly nowFn: () => number;

  constructor(deviceId: string, nowFn: () => number = Date.now) {
    this.device = deviceId.slice(0, 8);
    this.nowFn = nowFn;
  }

  /** Issue a stamp strictly greater than every stamp previously issued or received. */
  now(): string {
    const wall = this.nowFn();
    if (wall > this.physical) {
      this.physical = wall;
      this.counter = 0;
    } else if (this.counter >= HLC_COUNTER_MAX) {
      // Counter overflow within one physical tick: borrow a millisecond.
      this.physical += 1;
      this.counter = 0;
    } else {
      this.counter += 1;
    }
    return encodeHlc(this.physical, this.counter, this.device);
  }

  /**
   * Advance past a stamp seen from a remote device, so that any later local
   * edit orders after everything this device has observed — this is what
   * defuses wall-clock skew.
   */
  receive(remoteHlc: string): void {
    const remote = parseHlc(remoteHlc);
    if (remote.physical > this.physical) {
      this.physical = remote.physical;
      this.counter = remote.counter;
    } else if (remote.physical === this.physical && remote.counter > this.counter) {
      this.counter = remote.counter;
    }
  }

  /** Startup seeding from the highest stamp persisted locally (or null). */
  seed(maxSeen: string | null): void {
    if (maxSeen) {
      this.receive(maxSeen);
    }
    const wall = this.nowFn();
    if (wall > this.physical) {
      this.physical = wall;
      this.counter = 0;
    }
  }
}

// ── Process-wide sync context ─────────────────────────────────────────────
// Settable (not module-frozen) so tests can host several "devices" in one
// process by swapping the active context alongside setDB().

export interface SyncContext {
  deviceId: string;
  hlc: HLC;
}

let _ctx: SyncContext | null = null;

export function setSyncContext(ctx: SyncContext): void {
  _ctx = ctx;
}

export function getSyncContext(): SyncContext {
  if (!_ctx) {
    throw new Error(
      'Sync context not initialized. runMigrations() must complete before mutating synced tables.',
    );
  }
  return _ctx;
}

export function hasSyncContext(): boolean {
  return _ctx !== null;
}
