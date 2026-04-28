import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, Linking, Modal, Platform, SafeAreaView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { DetectionResult, DetectionState, ScanResult, SignalTrend } from '../ble/detection';
import { Breadcrumb, Trip, fetchBreadcrumbs, fetchTrip } from '../db/database';
import TripMap, { Coord } from '../components/TripMap';

// ── Namma Yatri palette ───────────────────────────────────────────────────────
const NY_YELLOW  = '#FFD000';
const NY_GREEN   = '#00A651';
const NY_RED     = '#E53935';
const NY_GREY    = '#9E9E9E';
const NY_DARK    = '#212121';
const NY_SUBTEXT = '#757575';

const STATE_CFG: Record<DetectionState, { label: string; sub: string; color: string }> = {
  scanning:       { label: 'Scanning',         sub: 'Looking for nearby buses',         color: NY_GREY   },
  candidate:      { label: 'Detecting',        sub: 'Hold still — verifying…',          color: NY_YELLOW },
  ambiguous:      { label: 'Multiple Buses',   sub: 'Select the bus you are boarding',  color: NY_YELLOW },
  confirmed:      { label: 'Boarded',          sub: 'You are on the bus',               color: NY_GREEN  },
  pendingDeboard: { label: 'Did you deboard?', sub: 'Confirm if you have left the bus', color: NY_RED    },
  lost:           { label: 'Deboarded',        sub: 'You have left the bus',            color: NY_RED    },
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatElapsed(secs: number): string {
  const h  = Math.floor(secs / 3600);
  const m  = Math.floor((secs % 3600) / 60);
  const s  = secs % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}
function formatCoord(lat: number | null, lng: number | null): string {
  if (lat === null || lng === null) return 'No GPS';
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60), s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ── Post-trip map modal ───────────────────────────────────────────────────────
function PostTripMap({ trip, breadcrumbs, onClose }: { trip: Trip; breadcrumbs: Breadcrumb[]; onClose: () => void }) {
  const toCoord = (lat: number | null, lng: number | null): Coord | null =>
    lat !== null && lng !== null ? { lat, lng } : null;
  const statusBarH = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 0;

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={ptStyles.root}>
        <View style={[ptStyles.header, { paddingTop: ptStyles.header.paddingTop + statusBarH }]}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={ptStyles.busId}>{trip.bus_id}</Text>
            <Text style={ptStyles.duration}>
              {trip.duration_secs != null ? formatDuration(trip.duration_secs) + ' ride' : 'Trip route'}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={ptStyles.closeBtn}>
            <Text style={ptStyles.closeTxt}>Done</Text>
          </TouchableOpacity>
        </View>

        <TripMap
          style={{ flex: 1 }}
          boardCoord={toCoord(trip.board_lat, trip.board_lng)}
          deboardCoord={toCoord(trip.deboard_lat, trip.deboard_lng)}
          breadcrumbs={breadcrumbs.map(b => ({ lat: b.lat, lng: b.lng }))}
        />

        <View style={ptStyles.panel}>
          <View style={ptStyles.panelRow}>
            <View style={[ptStyles.dot, { backgroundColor: NY_GREEN }]} />
            <View style={{ flex: 1 }}>
              <View style={ptStyles.panelRowTop}>
                <Text style={ptStyles.panelLabel}>Boarded</Text>
                <Text style={ptStyles.panelTime}>{formatTime(trip.boarded_at)}</Text>
              </View>
              <Text style={ptStyles.panelCoord}>{formatCoord(trip.board_lat, trip.board_lng)}</Text>
            </View>
          </View>

          <View style={ptStyles.panelDivider} />

          <View style={ptStyles.panelRow}>
            <View style={[ptStyles.dot, { backgroundColor: trip.deboarded_at ? NY_RED : NY_GREY }]} />
            <View style={{ flex: 1 }}>
              <View style={ptStyles.panelRowTop}>
                <Text style={ptStyles.panelLabel}>{trip.deboarded_at ? 'Deboarded' : 'Status'}</Text>
                <Text style={ptStyles.panelTime}>
                  {trip.deboarded_at ? formatTime(trip.deboarded_at) : 'Active'}
                </Text>
              </View>
              <Text style={ptStyles.panelCoord}>
                {trip.deboarded_at ? formatCoord(trip.deboard_lat, trip.deboard_lng) : '—'}
              </Text>
            </View>
          </View>

          {(trip.duration_secs != null || breadcrumbs.length > 0) && (
            <>
              <View style={ptStyles.panelDivider} />
              <View style={ptStyles.statsRow}>
                {trip.duration_secs != null && (
                  <View style={ptStyles.chip}>
                    <Text style={ptStyles.chipLabel}>Duration</Text>
                    <Text style={ptStyles.chipValue}>{formatDuration(trip.duration_secs)}</Text>
                  </View>
                )}
                {breadcrumbs.length > 0 && (
                  <View style={ptStyles.chip}>
                    <Text style={ptStyles.chipLabel}>Route pts</Text>
                    <Text style={ptStyles.chipValue}>{breadcrumbs.length}</Text>
                  </View>
                )}
              </View>
            </>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
interface Props {
  result: DetectionResult;
  rawScans: ScanResult[];
  error: string | null;
  lastCompletedTripId: number | null;
  btOn: boolean;
  locationOn: boolean;
  onSelectBus: (busId: string) => void;
  onConfirmDeboard: () => void;
  onCancelDeboard: () => void;
  onConfirmSwitch: (busId: string) => void;
  onDismissSwitch: () => void;
}

export default function HomeScreen({ result, rawScans, error, lastCompletedTripId, btOn, locationOn, onSelectBus, onConfirmDeboard, onCancelDeboard, onConfirmSwitch, onDismissSwitch }: Props) {
  const cfg    = STATE_CFG[result.state];
  const active = result.state === 'candidate' || result.state === 'confirmed';

  // Post-trip map state
  const [mapTrip,        setMapTrip]        = useState<Trip | null>(null);
  const [mapBreadcrumbs, setMapBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [showMap,        setShowMap]        = useState(false);

  const openTripMap = useCallback(async (tripId: number) => {
    const [trip, crumbs] = await Promise.all([fetchTrip(tripId), fetchBreadcrumbs(tripId)]);
    if (!trip) return;
    setMapTrip(trip);
    setMapBreadcrumbs(crumbs);
    setShowMap(true);
  }, []);

  // Show post-trip card when a new trip completes
  const prevTripId = useRef<number | null>(null);
  const [postTripId, setPostTripId] = useState<number | null>(null);
  useEffect(() => {
    if (lastCompletedTripId !== null && lastCompletedTripId !== prevTripId.current) {
      prevTripId.current = lastCompletedTripId;
      setPostTripId(lastCompletedTripId);
    }
  }, [lastCompletedTripId]);

  // Dismiss post-trip card when user boards again
  useEffect(() => {
    if (result.state === 'confirmed') setPostTripId(null);
  }, [result.state]);

  // Boarding elapsed timer — uses boardedAtMs from native service so it survives app reopen
  const boardedAtRef = useRef<number | null>(null);
  const [elapsedSecs, setElapsedSecs] = useState(0);

  useEffect(() => {
    if (result.state === 'confirmed') {
      if (boardedAtRef.current === null) {
        boardedAtRef.current = result.boardedAtMs ?? Date.now();
        setElapsedSecs(Math.floor((Date.now() - boardedAtRef.current) / 1000));
      }
    } else {
      boardedAtRef.current = null;
      setElapsedSecs(0);
    }
  }, [result.state, result.boardedAtMs]);

  useEffect(() => {
    if (result.state !== 'confirmed') return;
    const id = setInterval(() => {
      if (boardedAtRef.current !== null) {
        setElapsedSecs(Math.floor((Date.now() - boardedAtRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [result.state]);

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

  const servicesOk = btOn && locationOn;

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

      {/* ── Boarding timer ── */}
      {result.state === 'confirmed' && (
        <Text style={styles.boardingTimer}>{formatElapsed(elapsedSecs)}</Text>
      )}

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
                {s.busId}{'  '}avg {s.avgRssi.toFixed(1)} dBm{'  '}~{(s.distanceM ?? 0).toFixed(1)} m{'  '}raw {s.rawRssi} dBm
              </Text>
            ))
        }
      </View>

      {/* ── Services status banner — below debug panel, disappears when both on ── */}
      {!servicesOk && (
        <View style={styles.servicesBanner}>
          <ServiceChip
            label="Bluetooth"
            on={btOn}
            onPress={() => {
              Linking.sendIntent('android.bluetooth.adapter.action.REQUEST_ENABLE').catch(() =>
                Alert.alert('Bluetooth is off', 'Please enable Bluetooth to detect buses.', [
                  { text: 'Open Settings', onPress: () => Linking.openSettings() },
                ])
              );
            }}
          />
          <ServiceChip
            label="Location"
            on={locationOn}
            onPress={() => {
              Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS').catch(() =>
                Linking.openSettings()
              );
            }}
          />
        </View>
      )}

      {/* ── Scan hint ── */}
      {result.state === 'scanning' && (
        <Text style={styles.scanHint}>Keep Bluetooth and Location ON for automatic bus detection</Text>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      {/* ── Ambiguous: bus selection sheet ── */}
      {result.state === 'ambiguous' && result.candidates.length > 0 && (
        <View style={styles.ambiguousSheet}>
          <Text style={styles.ambiguousTitle}>Multiple buses detected</Text>
          <Text style={styles.ambiguousSub}>Which bus are you boarding?</Text>
          <View style={styles.ambiguousBtns}>
            {result.candidates.map(busId => (
              <TouchableOpacity key={busId} style={styles.ambiguousBtn} onPress={() => onSelectBus(busId)} activeOpacity={0.8}>
                <Text style={styles.ambiguousBtnTxt}>{busId}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* ── Pending deboard: confirmation banner ── */}
      {result.state === 'pendingDeboard' && result.busId && (
        <View style={styles.deboardBanner}>
          <Text style={styles.deboardTitle}>Did you leave {result.busId}?</Text>
          <Text style={styles.deboardSub}>Signal lost — confirm if you deboarded</Text>
          <View style={styles.deboardBtns}>
            <TouchableOpacity style={styles.deboardYes} onPress={onConfirmDeboard} activeOpacity={0.8}>
              <Text style={styles.deboardYesTxt}>Yes, I deboarded</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.deboardNo} onPress={onCancelDeboard} activeOpacity={0.8}>
              <Text style={styles.deboardNoTxt}>No, still on bus</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Bus switch confirmation banner ── */}
      {result.state === 'confirmed' && result.switchCandidate && (
        <View style={styles.switchBanner}>
          <Text style={styles.switchTitle}>Stronger bus detected</Text>
          <Text style={styles.switchSub}>Switch to {result.switchCandidate}?</Text>
          <View style={styles.switchBtns}>
            <TouchableOpacity style={styles.switchYes} onPress={() => onConfirmSwitch(result.switchCandidate!)} activeOpacity={0.8}>
              <Text style={styles.switchYesTxt}>Yes, switch</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.switchNo} onPress={onDismissSwitch} activeOpacity={0.8}>
              <Text style={styles.switchNoTxt}>Stay on {result.busId}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Post-trip card ── */}
      {postTripId !== null && (
        <View style={styles.postTripCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.postTripTitle}>Trip complete</Text>
            <Text style={styles.postTripSub}>See where you boarded and deboarded</Text>
          </View>
          <TouchableOpacity
            style={styles.postTripBtn}
            onPress={() => openTripMap(postTripId)}
          >
            <Text style={styles.postTripBtnTxt}>View route</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setPostTripId(null)} style={styles.postTripClose}>
            <Text style={{ color: NY_GREY, fontSize: 16 }}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Post-trip map modal ── */}
      {showMap && mapTrip && (
        <PostTripMap
          trip={mapTrip}
          breadcrumbs={mapBreadcrumbs}
          onClose={() => setShowMap(false)}
        />
      )}
    </View>
  );
}

function ServiceChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.serviceChip, { borderColor: on ? NY_GREEN : NY_RED, backgroundColor: on ? '#E8F5E9' : '#FFEBEE' }]}
      onPress={on ? undefined : onPress}
      activeOpacity={on ? 1 : 0.7}
    >
      <Text style={{ fontSize: 13, color: on ? NY_GREEN : NY_RED }}>{on ? '✓' : '✕'}</Text>
      <Text style={[styles.serviceChipLabel, { color: on ? NY_GREEN : NY_RED }]}>{label}</Text>
      {!on && <Text style={{ fontSize: 10, color: NY_RED }}>Tap to fix</Text>}
    </TouchableOpacity>
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
  stateSub:      { fontSize: 14, color: NY_SUBTEXT, marginBottom: 12 },
  boardingTimer: { fontSize: 28, fontWeight: '200', color: NY_GREEN, fontFamily: 'monospace', letterSpacing: 3, marginBottom: 12 },
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

  // Services banner
  servicesBanner:   { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#ffffffcc', borderRadius: 16, justifyContent: 'center' },
  serviceChip:      { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5 },
  serviceChipLabel: { fontSize: 12, fontWeight: '700' },

  // Scan hint
  scanHint:      { fontSize: 11, color: NY_SUBTEXT, textAlign: 'center', paddingHorizontal: 32 },

  // Ambiguous bus selection
  ambiguousSheet:   { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 32, elevation: 12, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: -4 } },
  ambiguousTitle:   { fontSize: 18, fontWeight: '800', color: NY_DARK, marginBottom: 4 },
  ambiguousSub:     { fontSize: 13, color: NY_SUBTEXT, marginBottom: 20 },
  ambiguousBtns:    { gap: 10 },
  ambiguousBtn:     { backgroundColor: NY_YELLOW, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  ambiguousBtnTxt:  { fontSize: 16, fontWeight: '800', color: NY_DARK, letterSpacing: 1 },

  // Pending deboard confirmation
  deboardBanner:    { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 32, elevation: 12, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: -4 } },
  deboardTitle:     { fontSize: 18, fontWeight: '800', color: NY_DARK, marginBottom: 4 },
  deboardSub:       { fontSize: 13, color: NY_SUBTEXT, marginBottom: 20 },
  deboardBtns:      { flexDirection: 'row', gap: 10 },
  deboardYes:       { flex: 1, backgroundColor: NY_RED, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  deboardYesTxt:    { fontSize: 14, fontWeight: '700', color: '#fff' },
  deboardNo:        { flex: 1, backgroundColor: '#F5F5F5', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  deboardNoTxt:     { fontSize: 14, fontWeight: '700', color: NY_DARK },

  // Bus switch confirmation
  switchBanner:     { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 32, elevation: 12, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: -4 } },
  switchTitle:      { fontSize: 18, fontWeight: '800', color: NY_DARK, marginBottom: 4 },
  switchSub:        { fontSize: 13, color: NY_SUBTEXT, marginBottom: 20 },
  switchBtns:       { flexDirection: 'row', gap: 10 },
  switchYes:        { flex: 1, backgroundColor: NY_YELLOW, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  switchYesTxt:     { fontSize: 14, fontWeight: '700', color: NY_DARK },
  switchNo:         { flex: 1, backgroundColor: '#F5F5F5', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  switchNoTxt:      { fontSize: 14, fontWeight: '700', color: NY_DARK },

  // Post-trip card
  postTripCard:    { position: 'absolute', bottom: 16, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 14, elevation: 4, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, gap: 8 },
  postTripTitle:   { fontSize: 14, fontWeight: '800', color: NY_DARK },
  postTripSub:     { fontSize: 11, color: NY_GREY, marginTop: 2 },
  postTripBtn:     { backgroundColor: NY_YELLOW, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  postTripBtnTxt:  { fontWeight: '700', color: NY_DARK, fontSize: 13 },
  postTripClose:   { padding: 4 },
});

const ptStyles = StyleSheet.create({
  root:         { flex: 1, backgroundColor: '#fff' },
  header:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#EEE', backgroundColor: '#fff' },
  busId:        { fontSize: 20, fontWeight: '800', color: NY_DARK, letterSpacing: 0.5 },
  duration:     { fontSize: 13, color: NY_GREY, marginTop: 2, fontWeight: '500' },
  closeBtn:     { backgroundColor: NY_YELLOW, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  closeTxt:     { fontWeight: '700', color: NY_DARK, fontSize: 14 },
  panel:        { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#EEE', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 20 },
  panelRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 2 },
  panelRowTop:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  panelLabel:   { fontSize: 13, fontWeight: '700', color: NY_DARK },
  panelTime:    { fontSize: 13, fontWeight: '600', color: NY_DARK },
  panelCoord:   { fontSize: 11, color: NY_GREY, fontFamily: 'monospace' },
  panelDivider: { height: 1, backgroundColor: '#F0F0F0', marginVertical: 10 },
  dot:          { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  statsRow:     { flexDirection: 'row', gap: 10 },
  chip:         { flex: 1, backgroundColor: '#F5F5F5', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  chipLabel:    { fontSize: 10, color: NY_GREY, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  chipValue:    { fontSize: 14, fontWeight: '800', color: NY_DARK },
});
