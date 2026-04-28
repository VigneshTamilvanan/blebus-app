const TX_POWER_1M      = -90.0;  // calibrated: ESP32-D0WD-V3 +9dBm TX, measured -90 dBm at 1m
const PATH_LOSS_N      = 2.5;
const BOARD_DISTANCE_M = 5.0;

// ── Detection thresholds ──────────────────────────────────────────────────────
// Recalibrated for TX_POWER_1M=-90 (ESP32-D0WD-V3 PCB antenna):
//   1m → -90 dBm | 2m → -97.5 | 3m → -102 | 4m → -105 | 6m → -109 | 8m → -113
const STRONG_THRESHOLD      = -105; // avg RSSI must exceed this to be a candidate (~4m range)
const STABILITY_SECONDS     = 6.0;  // candidate must be stable for this long to confirm
const SWITCH_WEAK_THRESHOLD = -98;
const SWITCH_RIVAL_MARGIN   = 5;
const SWITCH_RIVAL_SECONDS  = 5.0;
const EXIT_RSSI_THRESHOLD   = -109; // exit when signal drops below ~6m equivalent
const EXIT_SECONDS          = 5.0;

// ── Passing-bus / noisy-signal guards ────────────────────────────────────────
// If the candidate signal is receding for this long, it's a passing bus — reset.
const PASSING_BUS_RECEDE_SECS = 4.0;
// Maximum RSSI variance (dBm²) allowed when confirming. A moving beacon has high
// variance; a stationary one (bus at stop, user inside) stays flat.
// Slightly relaxed from 10 → 15 because lower RSSI naturally has more noise.
const MAX_VARIANCE_TO_CONFIRM = 15.0;

// ── Trend / history ───────────────────────────────────────────────────────────
const TREND_WINDOW   = 6;    // samples (~6s at 1 scan/s)
const TREND_SLOPE_DB = 0.4;  // dBm/s needed to register approaching/receding

export type DetectionState = 'scanning' | 'candidate' | 'ambiguous' | 'confirmed' | 'pendingDeboard' | 'lost';
export type SignalTrend    = 'approaching' | 'receding' | 'stable';

export interface ScanResult {
  busId:     string;
  isBus:     boolean;  // true = real bus beacon (manufacturer data / NY-BUS- prefix)
  rawRssi:   number;
  avgRssi:   number;
  distanceM: number;
}

export interface DetectionResult {
  busId:         string | null;
  state:         DetectionState;
  confidence:    number;
  rawRssi:       number;
  avgRssi:       number;
  distanceM:     number;
  distanceScore: number;
  trend:         SignalTrend;
  boardedAtMs:      number | null;  // epoch ms when boarding confirmed (Android native only)
  candidates:       string[];       // populated when state === 'ambiguous'
  switchCandidate:  string | null;  // rival bus that has been stronger for SWITCH_RIVAL_SECONDS
}

// ── Math helpers ──────────────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function rssiToDistance(rssi: number): number {
  return Math.pow(10, (TX_POWER_1M - rssi) / (10 * PATH_LOSS_N));
}

function distanceToScore(d: number): number {
  return Math.round(clamp(1.0 - d / BOARD_DISTANCE_M, 0, 1) * 1000) / 1000;
}

function now(): number { return Date.now() / 1000; }

// Ordinary least-squares slope over y values spaced 1s apart
function rssiSlope(h: number[]): number {
  const n = h.length;
  if (n < 3) return 0;
  const mx = (n - 1) / 2;
  const my = h.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - mx) * (h[i] - my); den += (i - mx) ** 2; }
  return den === 0 ? 0 : num / den;
}

function rssiVariance(h: number[]): number {
  if (h.length < 2) return 0;
  const mean = h.reduce((a, b) => a + b, 0) / h.length;
  return h.reduce((a, b) => a + (b - mean) ** 2, 0) / h.length;
}

function toTrend(slope: number): SignalTrend {
  if (slope >  TREND_SLOPE_DB) return 'approaching';
  if (slope < -TREND_SLOPE_DB) return 'receding';
  return 'stable';
}

// ── Per-beacon track (used during searching phase) ────────────────────────────
interface BeaconTrack {
  firstSeen:    number;
  recedingSince: number | null;
  rssiHistory:  number[];
}

// ── Engine ────────────────────────────────────────────────────────────────────
export class BusDetectionEngine {
  private state:        DetectionState = 'scanning';
  private confirmedBus: string | null  = null;
  private lostSince:    number | null  = null;
  private rivalSince:   number | null  = null;
  private rivalId:      string | null  = null;

  // Multi-beacon candidate tracking: each beacon above the noise floor gets
  // its own independent track. We confirm whichever one has been stable the
  // longest without being a passing bus.
  private tracks: Map<string, BeaconTrack> = new Map();

  // History for the confirmed beacon (used in handleConfirmed)
  private rssiHistory: number[] = [];

  update(scanResults: ScanResult[]): DetectionResult {
    const t = now();
    if (this.state === 'scanning' || this.state === 'candidate') {
      return this.handleSearching(scanResults, t);
    } else if (this.state === 'confirmed') {
      return this.handleConfirmed(scanResults, t);
    } else {
      return this.handleLost(scanResults, t);
    }
  }

  private handleSearching(results: ScanResult[], t: number): DetectionResult {
    // ── Priority filter ────────────────────────────────────────────────────
    // If any real bus beacon (manufacturer data / NY-BUS- prefix) is above
    // the noise floor, ignore custom test-device entries entirely.
    // This prevents a nearby printer/watch interfering with a real bus beacon.
    const aboveFloor = results.filter(r => r.avgRssi > STRONG_THRESHOLD);
    const busBeacons = aboveFloor.filter(r => r.isBus);
    const active     = busBeacons.length > 0 ? busBeacons : aboveFloor;

    if (active.length === 0) {
      this.tracks.clear();
      this.state = 'scanning';
      return this.idle();
    }

    // ── Update per-beacon tracks ───────────────────────────────────────────
    const activeIds = new Set(active.map(r => r.busId));

    // Remove tracks for beacons that dropped out of range
    for (const id of this.tracks.keys()) {
      if (!activeIds.has(id)) this.tracks.delete(id);
    }

    // Update or create a track for each active beacon; apply passing-bus guard
    const surviving: ScanResult[] = [];
    for (const beacon of active) {
      let track = this.tracks.get(beacon.busId);
      if (!track) {
        track = { firstSeen: t, recedingSince: null, rssiHistory: [] };
        this.tracks.set(beacon.busId, track);
      }

      track.rssiHistory.push(beacon.avgRssi);
      if (track.rssiHistory.length > TREND_WINDOW) track.rssiHistory.shift();

      const trend = toTrend(rssiSlope(track.rssiHistory));

      // Passing-bus guard: if this beacon has been receding for too long it's
      // a bus driving past — drop its track so it can't confirm.
      if (trend === 'receding') {
        if (track.recedingSince === null) track.recedingSince = t;
        if (t - track.recedingSince >= PASSING_BUS_RECEDE_SECS) {
          console.log('[BLE] Passing-bus —', beacon.busId, '— dropping track');
          this.tracks.delete(beacon.busId);
          continue;
        }
      } else {
        track.recedingSince = null;
      }

      surviving.push(beacon);
    }

    if (surviving.length === 0) {
      this.state = 'scanning';
      return this.idle();
    }

    // ── Pick the best candidate ────────────────────────────────────────────
    // Primary sort: longest continuous time above the threshold (user is
    // staying near this beacon). Tiebreak: highest average RSSI.
    surviving.sort((a, b) => {
      const elapsedA = t - this.tracks.get(a.busId)!.firstSeen;
      const elapsedB = t - this.tracks.get(b.busId)!.firstSeen;
      if (Math.abs(elapsedA - elapsedB) > 2) return elapsedB - elapsedA;
      return b.avgRssi - a.avgRssi;
    });

    const best  = surviving[0];
    const track = this.tracks.get(best.busId)!;
    const elapsed = t - track.firstSeen;
    const trend   = toTrend(rssiSlope(track.rssiHistory));
    const dist    = rssiToDistance(best.avgRssi);
    const dscore  = distanceToScore(dist);
    const conf    = this.confidence(dscore, elapsed);

    // ── Boarding confirmation ──────────────────────────────────────────────
    if (elapsed >= STABILITY_SECONDS) {
      const variance = rssiVariance(track.rssiHistory);
      if (variance <= MAX_VARIANCE_TO_CONFIRM) {
        this.state        = 'confirmed';
        this.confirmedBus = best.busId;
        this.rssiHistory  = [...track.rssiHistory];
        this.lostSince    = null;
        this.rivalSince   = null;
        this.tracks.clear();
        return { busId: best.busId, state: 'confirmed', confidence: conf, rawRssi: best.rawRssi, avgRssi: best.avgRssi, distanceM: dist, distanceScore: dscore, trend };
      }
      // Signal still too noisy — reset this beacon's timer and wait for it to settle
      console.log('[BLE] Variance too high (', variance.toFixed(1), ') for', best.busId, '— deferring');
      track.firstSeen = t;
    }

    this.state = 'candidate';
    return { busId: best.busId, state: 'candidate', confidence: conf, rawRssi: best.rawRssi, avgRssi: best.avgRssi, distanceM: dist, distanceScore: dscore, trend };
  }

  private handleConfirmed(results: ScanResult[], t: number): DetectionResult {
    const confirmed = this.confirmedBus!;
    const cur       = results.find(r => r.busId === confirmed) ?? null;

    if (!cur || cur.avgRssi < EXIT_RSSI_THRESHOLD) {
      if (this.lostSince === null) this.lostSince = t;
      if (t - this.lostSince >= EXIT_SECONDS) {
        this.state        = 'lost';
        this.confirmedBus = null;
        this.rssiHistory  = [];
        const raw = cur?.rawRssi ?? -99;
        const avg = cur?.avgRssi ?? -99;
        const d   = rssiToDistance(avg);
        return { busId: confirmed, state: 'lost', confidence: 0, rawRssi: raw, avgRssi: avg, distanceM: d, distanceScore: distanceToScore(d), trend: 'receding' };
      }
    } else {
      this.lostSince = null;
    }

    if (!cur) {
      return { busId: confirmed, state: 'confirmed', confidence: 0, rawRssi: -99, avgRssi: -99, distanceM: 99, distanceScore: 0, trend: 'receding' };
    }

    const dist   = rssiToDistance(cur.avgRssi);
    const dscore = distanceToScore(dist);
    const rival  = results.find(r => r.busId !== confirmed) ?? null;
    this.rssiHistory.push(cur.avgRssi);
    if (this.rssiHistory.length > TREND_WINDOW) this.rssiHistory.shift();
    const trend  = toTrend(rssiSlope(this.rssiHistory));

    // Bus-switch logic: only switch if current is weak AND rival is sustainedly stronger
    if (cur.avgRssi < SWITCH_WEAK_THRESHOLD && rival && (rival.avgRssi - cur.avgRssi) >= SWITCH_RIVAL_MARGIN) {
      if (this.rivalId !== rival.busId || this.rivalSince === null) {
        this.rivalSince = t;
        this.rivalId    = rival.busId;
      }
      if (t - this.rivalSince >= SWITCH_RIVAL_SECONDS) {
        this.confirmedBus = rival.busId;
        this.rivalSince   = null;
        this.rivalId      = null;
        this.lostSince    = null;
        this.rssiHistory  = [];
        const rd   = rssiToDistance(rival.avgRssi);
        const conf = this.confidence(distanceToScore(rd), STABILITY_SECONDS);
        return { busId: rival.busId, state: 'confirmed', confidence: conf, rawRssi: rival.rawRssi, avgRssi: rival.avgRssi, distanceM: rd, distanceScore: distanceToScore(rd), trend: 'approaching' };
      }
    } else {
      this.rivalSince = null;
      this.rivalId    = null;
    }

    const conf = this.confidence(dscore, STABILITY_SECONDS);
    return { busId: confirmed, state: 'confirmed', confidence: conf, rawRssi: cur.rawRssi, avgRssi: cur.avgRssi, distanceM: dist, distanceScore: dscore, trend };
  }

  private handleLost(results: ScanResult[], t: number): DetectionResult {
    this.tracks.clear();
    this.rssiHistory = [];
    this.lostSince   = null;
    this.state       = 'scanning';
    return this.handleSearching(results, t);
  }

  private idle(): DetectionResult {
    return { busId: null, state: 'scanning', confidence: 0, rawRssi: 0, avgRssi: 0, distanceM: 0, distanceScore: 0, trend: 'stable' };
  }

  // Confidence is now based on distance score × how long the beacon has been stable
  private confidence(dscore: number, stableSecs: number): number {
    const stabilityScore = clamp(stableSecs / STABILITY_SECONDS, 0, 1);
    return Math.round(dscore * stabilityScore * 1000) / 1000;
  }
}
