import {
  HLC,
  HLC_COUNTER_MAX,
  compareHlc,
  encodeHlc,
  getSyncContext,
  hasSyncContext,
  parseHlc,
  setSyncContext,
} from '../src/sync/hlc.js';

const DEVICE_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const DEVICE_B = 'bbbbbbbb-1111-2222-3333-444444444444';

describe('encodeHlc / parseHlc', () => {
  it('produces fixed-width sortable encoding and round-trips', () => {
    const s = encodeHlc(1751803254123, 3, DEVICE_A);
    expect(s).toBe('001751803254123-0003-aaaaaaaa');
    expect(parseHlc(s)).toEqual({ physical: 1751803254123, counter: 3, device: 'aaaaaaaa' });
  });

  it('rejects malformed values', () => {
    expect(() => parseHlc('not-an-hlc')).toThrow('Invalid HLC');
    expect(() => parseHlc('123-0003-aaaaaaaa')).toThrow('Invalid HLC');
  });

  it('orders lexicographically the same as (physical, counter, device) tuples', () => {
    const samples = [
      encodeHlc(999, 0xffff, DEVICE_B),
      encodeHlc(1000, 0, DEVICE_A),
      encodeHlc(1000, 0, DEVICE_B),
      encodeHlc(1000, 0x000f, DEVICE_A),
      encodeHlc(1000, 0x0010, DEVICE_A),
      encodeHlc(1001, 0, DEVICE_A),
    ];
    const sorted = [...samples].sort();
    expect(sorted).toEqual(samples);
    expect(compareHlc(samples[0], samples[1])).toBe(-1);
    expect(compareHlc(samples[1], samples[1])).toBe(0);
    expect(compareHlc(samples[5], samples[0])).toBe(1);
  });
});

describe('HLC.now()', () => {
  it('increments the counter under a frozen clock', () => {
    const hlc = new HLC(DEVICE_A, () => 5000);
    expect(hlc.now()).toBe(encodeHlc(5000, 0, DEVICE_A));
    expect(hlc.now()).toBe(encodeHlc(5000, 1, DEVICE_A));
    expect(hlc.now()).toBe(encodeHlc(5000, 2, DEVICE_A));
  });

  it('never goes backwards when the wall clock does', () => {
    let wall = 5000;
    const hlc = new HLC(DEVICE_A, () => wall);
    const first = hlc.now();
    wall = 4000; // clock jumped back
    const second = hlc.now();
    expect(second > first).toBe(true);
    expect(parseHlc(second).physical).toBe(5000);
  });

  it('borrows a millisecond on counter overflow', () => {
    const hlc = new HLC(DEVICE_A, () => 5000);
    for (let i = 0; i <= HLC_COUNTER_MAX; i++) hlc.now();
    const overflowed = hlc.now();
    expect(parseHlc(overflowed)).toMatchObject({ physical: 5001, counter: 0 });
  });

  it('advances physical and resets counter when the clock moves', () => {
    let wall = 5000;
    const hlc = new HLC(DEVICE_A, () => wall);
    hlc.now();
    hlc.now();
    wall = 6000;
    expect(parseHlc(hlc.now())).toMatchObject({ physical: 6000, counter: 0 });
  });
});

describe('HLC.receive()', () => {
  it('makes the next local stamp beat a remote from a fast clock', () => {
    const hlc = new HLC(DEVICE_A, () => 5000); // local clock is "slow"
    const remote = encodeHlc(5000 + 3_600_000, 7, DEVICE_B); // 1h ahead
    hlc.receive(remote);
    const next = hlc.now();
    expect(next > remote).toBe(true); // "saw your edit then edited" wins
  });

  it('ignores remotes behind local state', () => {
    const hlc = new HLC(DEVICE_A, () => 5000);
    const before = hlc.now();
    hlc.receive(encodeHlc(1000, 0xffff, DEVICE_B));
    const after = hlc.now();
    expect(after > before).toBe(true);
    expect(parseHlc(after).physical).toBe(5000);
  });

  it('adopts a higher remote counter at the same physical time', () => {
    const hlc = new HLC(DEVICE_A, () => 5000);
    hlc.now(); // physical 5000, counter 0
    hlc.receive(encodeHlc(5000, 9, DEVICE_B));
    expect(parseHlc(hlc.now())).toMatchObject({ physical: 5000, counter: 10 });
  });
});

describe('HLC.seed()', () => {
  it('seed(null) starts from the wall clock', () => {
    const hlc = new HLC(DEVICE_A, () => 7000);
    hlc.seed(null);
    expect(parseHlc(hlc.now())).toMatchObject({ physical: 7000 });
  });

  it('seed(maxSeen) adopts a persisted stamp ahead of the clock', () => {
    const hlc = new HLC(DEVICE_A, () => 7000);
    hlc.seed(encodeHlc(9000, 5, DEVICE_A));
    const next = hlc.now();
    expect(next > encodeHlc(9000, 5, DEVICE_A)).toBe(true);
  });
});

describe('total order across devices', () => {
  it('two devices can never issue equal stamps', () => {
    const a = new HLC(DEVICE_A, () => 5000);
    const b = new HLC(DEVICE_B, () => 5000);
    const stamps = new Set<string>();
    for (let i = 0; i < 100; i++) {
      stamps.add(a.now());
      stamps.add(b.now());
    }
    expect(stamps.size).toBe(200);
  });
});

describe('sync context', () => {
  it('setSyncContext/getSyncContext round-trip and hasSyncContext reflects state', () => {
    const hlc = new HLC(DEVICE_A);
    setSyncContext({ deviceId: DEVICE_A, hlc });
    expect(hasSyncContext()).toBe(true);
    expect(getSyncContext().deviceId).toBe(DEVICE_A);
    expect(getSyncContext().hlc).toBe(hlc);
  });
});
