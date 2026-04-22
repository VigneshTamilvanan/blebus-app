import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useBusDetection } from '../hooks/useBusDetection';
import { DetectionState, SignalTrend } from '../ble/detection';

// ── Namma Yatri palette ───────────────────────────────────────────────────────
const NY_YELLOW  = '#FFD000';
const NY_GREEN   = '#00A651';
const NY_RED     = '#E53935';
const NY_GREY    = '#9E9E9E';
const NY_DARK    = '#212121';
const NY_SUBTEXT = '#757575';

const STATE_CFG: Record<DetectionState, { label: string; sub: string; color: string }> = {
  scanning:  { label: 'Scanning',   sub: 'Looking for nearby buses',  color: NY_GREY   },
  candidate: { label: 'Detecting',  sub: 'Hold still — verifying…',   color: NY_YELLOW },
  confirmed: { label: 'Boarded',    sub: 'You are on the bus',         color: NY_GREEN  },
  lost:      { label: 'Deboarded',  sub: 'You have left the bus',      color: NY_RED    },
};

const TREND_CFG: Record<SignalTrend, { symbol: string; label: string; color: string }> = {
  approaching: { symbol: '↑', label: 'Getting closer', color: NY_GREEN  },
  receding:    { symbol: '↓', label: 'Moving away',    color: NY_RED    },
  stable:      { symbol: '—', label: 'Stable signal',  color: NY_GREY   },
};

// ── Background ramp ───────────────────────────────────────────────────────────
const C_IDLE = { r: 248, g: 248, b: 248 };
const C_FAR  = { r: 255, g: 253, b: 220 };
const C_NEAR = { r: 218, g: 242, b: 226 };
const C_LOST = { r: 255, g: 235, b: 235 };

function lerp(a: number, b: number, t: number) { return Math.round(a + (b - a) * t); }

function getBgColor(score: number, state: DetectionState): string {
  if (state === 'scanning') return `rgb(${C_IDLE.r},${C_IDLE.g},${C_IDLE.b})`;
  if (state === 'lost')     return `rgb(${C_LOST.r},${C_LOST.g},${C_LOST.b})`;
  return `rgb(${lerp(C_FAR.r,C_NEAR.r,score)},${lerp(C_FAR.g,C_NEAR.g,score)},${lerp(C_FAR.b,C_NEAR.b,score)})`;
}

// ── Radar ring component (scanning state) ─────────────────────────────────────
function RadarRings() {
  const anims = [0, 1, 2].map(() => useRef(new Animated.Value(0)).current);

  useEffect(() => {
    const loops = anims.map((a, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 500),
          Animated.timing(a, { toValue: 1, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(a, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      )
    );
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, []);

  return (
    <View style={styles.radarWrap}>
      {anims.map((a, i) => (
        <Animated.View
          key={i}
          style={[styles.radarRing, {
            transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.3, 2.2] }) }],
            opacity:   a.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.35, 0] }),
            borderColor: NY_GREY,
          }]}
        />
      ))}
      <View style={styles.radarDot} />
    </View>
  );
}

// ── Pulse rings component (confirmed state) ───────────────────────────────────
function PulseRings({ color }: { color: string }) {
  const anims = [0, 1].map(() => useRef(new Animated.Value(0)).current);

  useEffect(() => {
    const loops = anims.map((a, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 700),
          Animated.timing(a, { toValue: 1, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(a, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      )
    );
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [color]);

  return (
    <>
      {anims.map((a, i) => (
        <Animated.View
          key={i}
          style={[StyleSheet.absoluteFill, styles.pulseRing, {
            borderColor: color,
            transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }],
            opacity:    a.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.5, 0] }),
          }]}
        />
      ))}
    </>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const { result, rawScans, error } = useBusDetection();
  const cfg    = STATE_CFG[result.state];
  const active = result.state === 'candidate' || result.state === 'confirmed';

  // Badge bounce + flash on state change
  const badgeScale   = useRef(new Animated.Value(1)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const prevState    = useRef<DetectionState>('scanning');

  useEffect(() => {
    if (prevState.current === result.state) return;
    prevState.current = result.state;
    badgeScale.setValue(0.4);
    Animated.spring(badgeScale, { toValue: 1, friction: 4, tension: 130, useNativeDriver: true }).start();
    flashOpacity.setValue(0.3);
    Animated.timing(flashOpacity, { toValue: 0, duration: 800, useNativeDriver: true }).start();
  }, [result.state]);

  const bg = getBgColor(result.distanceScore, result.state);

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>

      {/* State-change colour flash */}
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: cfg.color, opacity: flashOpacity }]} pointerEvents="none" />

      {/* ── Scanning state: radar rings ── */}
      {result.state === 'scanning' && <RadarRings />}

      {/* ── Candidate / confirmed / lost: badge ── */}
      {result.state !== 'scanning' && (
        <View style={styles.badgeWrap}>
          {result.state === 'confirmed' && <PulseRings color={NY_GREEN} />}
          <Animated.View style={[styles.badge, { backgroundColor: cfg.color, transform: [{ scale: badgeScale }] }]}>
            <Text style={styles.badgeIcon}>
              {result.state === 'confirmed' ? '✓' : result.state === 'lost' ? '↗' : '…'}
            </Text>
          </Animated.View>
        </View>
      )}

      {/* ── State label ── */}
      <Text style={[styles.stateLabel, { color: cfg.color }]}>{cfg.label}</Text>
      <Text style={styles.stateSub}>{cfg.sub}</Text>

      {/* ── Bus ID ── */}
      {result.busId && (
        <Text style={styles.busId}>{result.busId}</Text>
      )}

      {/* ── Candidate: dwell progress bar ── */}
      {result.state === 'candidate' && (
        <>
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, {
              width: `${Math.min(result.confidence * 100 * 2, 100)}%`,
              backgroundColor: NY_YELLOW,
            }]} />
          </View>
          <Text style={styles.progressHint}>Stay near the bus to confirm boarding</Text>
        </>
      )}

      {/* ── Trend ── */}
      {active && (() => {
        const tr = TREND_CFG[result.trend];
        return (
          <View style={[styles.trendChip, { borderColor: tr.color }]}>
            <Text style={[styles.trendSym, { color: tr.color }]}>{tr.symbol}</Text>
            <Text style={[styles.trendLbl, { color: tr.color }]}>{tr.label}</Text>
          </View>
        );
      })()}

      {/* ── Metrics card ── */}
      {result.busId && result.state !== 'scanning' && (
        <View style={styles.card}>
          <Row label="Distance"   value={`${result.distanceM.toFixed(1)} m`} />
          <Row label="Signal"     value={`${result.avgRssi.toFixed(0)} dBm`} />
          <Row label="Confidence" value={`${(result.confidence * 100).toFixed(0)}%`} last />
        </View>
      )}

      {/* ── Debug panel ── */}
      <View style={styles.debug}>
        <Text style={styles.debugTitle}>BLE · {rawScans.length} beacon{rawScans.length !== 1 ? 's' : ''} visible</Text>
        {rawScans.length === 0
          ? <Text style={styles.debugRow}>No NY-BUS beacons in range</Text>
          : rawScans.map(s => (
              <Text key={s.busId} style={styles.debugRow}>
                {s.busId}{'  '}raw {s.rawRssi} dBm{'  '}avg {s.avgRssi.toFixed(1)} dBm
              </Text>
            ))
        }
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const BADGE = 96;
const RADAR = 120;

const styles = StyleSheet.create({
  root:          { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },

  // Scanning radar
  radarWrap:     { width: RADAR, height: RADAR, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  radarRing:     { position: 'absolute', width: RADAR, height: RADAR, borderRadius: RADAR / 2, borderWidth: 1.5 },
  radarDot:      { width: 12, height: 12, borderRadius: 6, backgroundColor: NY_GREY },

  // State badge
  badgeWrap:     { width: BADGE, height: BADGE, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  badge:         { width: BADGE, height: BADGE, borderRadius: BADGE / 2, alignItems: 'center', justifyContent: 'center' },
  badgeIcon:     { fontSize: 36, color: '#fff', fontWeight: '800' },
  pulseRing:     { borderRadius: BADGE / 2, borderWidth: 2 },

  // Labels
  stateLabel:    { fontSize: 32, fontWeight: '800', letterSpacing: 0.3, marginBottom: 4 },
  stateSub:      { fontSize: 14, color: NY_SUBTEXT, marginBottom: 20 },
  busId:         { fontSize: 20, fontWeight: '700', color: NY_DARK, letterSpacing: 1.5, marginBottom: 12 },

  // Candidate progress
  progressTrack: { width: '72%', height: 5, backgroundColor: '#E0E0E0', borderRadius: 3, overflow: 'hidden', marginBottom: 6 },
  progressFill:  { height: '100%', borderRadius: 3 },
  progressHint:  { fontSize: 12, color: NY_SUBTEXT, marginBottom: 12 },

  // Trend
  trendChip:     { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 16, borderWidth: 1.5, marginBottom: 20 },
  trendSym:      { fontSize: 16, fontWeight: '700' },
  trendLbl:      { fontSize: 12, fontWeight: '500' },

  // Metrics card
  card:          { width: '85%', backgroundColor: '#ffffffdd', borderRadius: 14, padding: 4, elevation: 1, marginBottom: 20 },
  row:           { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  rowBorder:     { borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  rowLabel:      { color: NY_GREY, fontSize: 13 },
  rowValue:      { color: NY_DARK, fontSize: 13, fontWeight: '700' },

  // Debug panel
  debug:         { width: '85%', backgroundColor: '#1A1A1A', borderRadius: 10, padding: 12 },
  debugTitle:    { color: '#777', fontSize: 10, fontWeight: '700', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 1 },
  debugRow:      { color: '#00FF88', fontFamily: 'monospace', fontSize: 11, paddingVertical: 1 },

  error:         { marginTop: 12, color: NY_RED, fontSize: 12 },
});
