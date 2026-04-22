const TX_POWER_1M      = -67.0;  // calibrated: ESP32 +9dBm TX, measured -74 dBm at 2m
const PATH_LOSS_N      = 2.5;
const BOARD_DISTANCE_M = 5.0;

// ── Detection thresholds ──────────────────────────────────────────────────────
const STRONG_THRESHOLD      = -87;  // avg RSSI must exceed this to be a candidate
const RELATIVE_MARGIN       = 5;    // dB lead over second-best required
const STABILITY_SECONDS     = 6.0;  // candidate must dominate stably for this long
const SWITCH_WEAK_THRESHOLD = -83;
const SWITCH_RIVAL_MARGIN   = 5;
const SWITCH_RIVAL_SECONDS  = 5.0;
const EXIT_RSSI_THRESHOLD   = -93;
const EXIT_SECONDS          = 5.0;

// ── Passing-bus / noisy-signal guards ────────────────────────────────────────
// If the candidate signal is receding for this long, it's a passing bus — reset.
const PASSING_BUS_RECEDE_SECS = 2.5;
// Maximum RSSI variance (dBm²) allowed when confirming. A moving beacon has high
// variance; a stationary one (bus at stop, user inside) stays flat.
const MAX_VARIANCE_TO_CONFIRM = 10.0;

// ── Trend / history ───────────────────────────────────────────────────────────
const TREND_WINDOW   = 6;    // samples (~6s at 1 scan/s)
const TREND_SLOPE_DB = 0.4;  // dBm/s needed to register approaching/receding

export type DetectionState = 'scanning' | 'candidate' | 'confirmed' | 'lost';
export type SignalTrend    = 'approaching' | 'receding' | 'stable';

export interface ScanResult {
  busId:   string;
  rawRssi: number;
  avgRssi: number;
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

// ── Engine ────────────────────────────────────────────────────────────────────
export class BusDetectionEngine {
  private state:          DetectionState = 'scanning';
  private confirmedBus:   string | null  = null;
  private candidateBus:   string | null  = null;
  private candidateSince: number | null  = null;
  private lostSince:      number | null  = null;
  private rivalSince:     number | null  = null;
  private rivalId:        string | null  = null;
  private rssiHistory:    number[]       = [];
  // Passing-bus guard: track how long candidate has been receding
  private recedingSince:  number | null  = null;

  private pushHistory(avgRssi: number): SignalTrend {
    this.rssiHistory.push(avgRssi);
    if (this.rssiHistory.length > TREND_WINDOW) this.rssiHistory.shift();
    return toTrend(rssiSlope(this.rssiHistory));
  }

  private clearHistory(): void {
    this.rssiHistory  = [];
    this.recedingSince = null;
  }

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
    const sorted = [...results].sort((a, b) => b.avgRssi - a.avgRssi);
    const best   = sorted[0] ?? null;
    const second = sorted[1] ?? null;

    if (!best) {
      this.resetCandidate();
      this.state = 'scanning';
      return this.idle();
    }

    const dist   = rssiToDistance(best.avgRssi);
    const dscore = distanceToScore(dist);

    // Rule A: signal must clear noise floor
    if (best.avgRssi <= STRONG_THRESHOLD) {
      this.resetCandidate();
      this.state = 'scanning';
      return this.idle();
    }

    // Rule B: must clearly lead over second-best (avoids ambiguous multi-bus scenarios)
    const lead = second ? best.avgRssi - second.avgRssi : 20;
    if (lead < RELATIVE_MARGIN) {
      this.resetCandidate();
      this.state = 'scanning';
      return { busId: null, state: 'scanning', confidence: 0, rawRssi: best.rawRssi, avgRssi: best.avgRssi, distanceM: dist, distanceScore: dscore, trend: 'stable' };
    }

    // New candidate or same candidate — start/continue tracking
    if (this.candidateBus !== best.busId) {
      this.candidateBus   = best.busId;
      this.candidateSince = t;
      this.clearHistory();
    }

    const elapsed = t - this.candidateSince!;
    const trend   = this.pushHistory(best.avgRssi);

    // ── Passing-bus guard ──────────────────────────────────────────────────
    // If the candidate is moving away from us during the dwell window, it's
    // a passing bus — reset so we don't falsely board.
    if (trend === 'receding') {
      if (this.recedingSince === null) this.recedingSince = t;
      if (t - this.recedingSince >= PASSING_BUS_RECEDE_SECS) {
        console.log('[BLE] Passing-bus detected — resetting candidate');
        this.resetCandidate();
        this.state = 'scanning';
        return this.idle();
      }
    } else {
      this.recedingSince = null;
    }

    const conf = this.confidence(dscore, lead, elapsed);

    // ── Boarding confirmation ──────────────────────────────────────────────
    // Requires: (1) dwell time, (2) low RSSI variance (stationary beacon).
    if (elapsed >= STABILITY_SECONDS) {
      const variance = rssiVariance(this.rssiHistory);
      if (variance <= MAX_VARIANCE_TO_CONFIRM) {
        this.state        = 'confirmed';
        this.confirmedBus = best.busId;
        this.lostSince    = null;
        this.rivalSince   = null;
        return { busId: best.busId, state: 'confirmed', confidence: conf, rawRssi: best.rawRssi, avgRssi: best.avgRssi, distanceM: dist, distanceScore: dscore, trend };
      }
      // Variance too high — still moving. Stay candidate, reset timer so we
      // wait another full STABILITY_SECONDS once signal settles.
      console.log('[BLE] Variance too high (', variance.toFixed(1), ') — deferring boarding confirmation');
      this.candidateSince = t;
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
        this.clearHistory();
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
    const trend  = this.pushHistory(cur.avgRssi);

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
        this.clearHistory();
        const rd   = rssiToDistance(rival.avgRssi);
        const conf = this.confidence(distanceToScore(rd), rival.avgRssi - cur.avgRssi, STABILITY_SECONDS);
        return { busId: rival.busId, state: 'confirmed', confidence: conf, rawRssi: rival.rawRssi, avgRssi: rival.avgRssi, distanceM: rd, distanceScore: distanceToScore(rd), trend: 'approaching' };
      }
    } else {
      this.rivalSince = null;
      this.rivalId    = null;
    }

    const lead = rival ? cur.avgRssi - rival.avgRssi : 20;
    const conf = this.confidence(dscore, lead, STABILITY_SECONDS);
    return { busId: confirmed, state: 'confirmed', confidence: conf, rawRssi: cur.rawRssi, avgRssi: cur.avgRssi, distanceM: dist, distanceScore: dscore, trend };
  }

  private handleLost(results: ScanResult[], t: number): DetectionResult {
    this.resetCandidate();
    this.lostSince = null;
    this.state     = 'scanning';
    return this.handleSearching(results, t);
  }

  private resetCandidate(): void {
    this.candidateBus   = null;
    this.candidateSince = null;
    this.clearHistory();
  }

  private idle(): DetectionResult {
    return { busId: null, state: 'scanning', confidence: 0, rawRssi: 0, avgRssi: 0, distanceM: 0, distanceScore: 0, trend: 'stable' };
  }

  private confidence(dscore: number, leadMargin: number, stableSecs: number): number {
    const leadScore      = clamp(leadMargin / 10, 0, 1);
    const stabilityScore = clamp(stableSecs / STABILITY_SECONDS, 0, 1);
    return Math.round(dscore * leadScore * stabilityScore * 1000) / 1000;
  }
}
