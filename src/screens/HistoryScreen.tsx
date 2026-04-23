import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, FlatList, Modal, Platform, SafeAreaView, StatusBar,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import TripMap, { Coord } from '../components/TripMap';
import { Breadcrumb, Trip, clearTrips, fetchBreadcrumbs, fetchTrips } from '../db/database';

const NY_YELLOW = '#FFD000';
const NY_GREEN  = '#00A651';
const NY_RED    = '#E53935';
const NY_DARK   = '#212121';
const NY_GREY   = '#9E9E9E';
const NY_BG     = '#F8F8F8';

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('en-IN', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function formatDuration(secs: number | null): string {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatCoord(lat: number | null, lng: number | null): string {
  if (lat === null || lng === null) return 'No GPS';
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function hasCoords(trip: Trip): boolean {
  return trip.board_lat !== null && trip.board_lng !== null;
}

// ── Trip Map Modal ────────────────────────────────────────────────────────────

function TripMapModal({ trip, breadcrumbs, onClose }: { trip: Trip; breadcrumbs: Breadcrumb[]; onClose: () => void }) {
  const toCoord = (lat: number | null, lng: number | null): Coord | null =>
    lat !== null && lng !== null ? { lat, lng } : null;

  const statusBarH = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 0;

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={mapStyles.root}>
        {/* Header */}
        <View style={[mapStyles.header, { paddingTop: mapStyles.header.paddingTop + statusBarH }]}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={mapStyles.busId}>{trip.bus_id}</Text>
            <Text style={mapStyles.duration}>
              {trip.duration_secs != null ? formatDuration(trip.duration_secs) + ' ride' : 'Trip active'}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={mapStyles.closeBtn}>
            <Text style={mapStyles.closeTxt}>Done</Text>
          </TouchableOpacity>
        </View>

        {/* Map */}
        <TripMap
          style={{ flex: 1 }}
          boardCoord={toCoord(trip.board_lat, trip.board_lng)}
          deboardCoord={toCoord(trip.deboard_lat, trip.deboard_lng)}
          breadcrumbs={breadcrumbs.map(b => ({ lat: b.lat, lng: b.lng }))}
        />

        {/* Info panel */}
        <View style={mapStyles.panel}>
          {/* Boarded row */}
          <View style={mapStyles.panelRow}>
            <View style={[mapStyles.dot, { backgroundColor: NY_GREEN }]} />
            <View style={{ flex: 1 }}>
              <View style={mapStyles.panelRowTop}>
                <Text style={mapStyles.panelLabel}>Boarded</Text>
                <Text style={mapStyles.panelTime}>{formatTime(trip.boarded_at)}</Text>
              </View>
              <Text style={mapStyles.panelCoord}>{formatCoord(trip.board_lat, trip.board_lng)}</Text>
            </View>
          </View>

          <View style={mapStyles.panelDivider} />

          {/* Deboarded row */}
          <View style={mapStyles.panelRow}>
            <View style={[mapStyles.dot, { backgroundColor: trip.deboarded_at ? NY_RED : NY_GREY }]} />
            <View style={{ flex: 1 }}>
              <View style={mapStyles.panelRowTop}>
                <Text style={mapStyles.panelLabel}>{trip.deboarded_at ? 'Deboarded' : 'Status'}</Text>
                <Text style={mapStyles.panelTime}>
                  {trip.deboarded_at ? formatTime(trip.deboarded_at) : 'Active'}
                </Text>
              </View>
              <Text style={mapStyles.panelCoord}>
                {trip.deboarded_at ? formatCoord(trip.deboard_lat, trip.deboard_lng) : '—'}
              </Text>
            </View>
          </View>

          {/* Stats row */}
          {(trip.duration_secs != null || breadcrumbs.length > 0) && (
            <>
              <View style={mapStyles.panelDivider} />
              <View style={mapStyles.statsRow}>
                {trip.duration_secs != null && (
                  <StatChip label="Duration" value={formatDuration(trip.duration_secs)} />
                )}
                {breadcrumbs.length > 0 && (
                  <StatChip label="Route pts" value={String(breadcrumbs.length)} />
                )}
              </View>
            </>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <View style={mapStyles.chip}>
      <Text style={mapStyles.chipLabel}>{label}</Text>
      <Text style={mapStyles.chipValue}>{value}</Text>
    </View>
  );
}

// ── Trip Card ─────────────────────────────────────────────────────────────────

function TripCard({ trip, onMapPress }: { trip: Trip; onMapPress: () => void }) {
  const active = trip.deboarded_at === null;
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.busId}>{trip.bus_id}</Text>
          {active && <View style={[styles.statusDot, { backgroundColor: NY_GREEN }]} />}
        </View>
        {hasCoords(trip) && (
          <TouchableOpacity onPress={onMapPress} style={styles.mapBtn}>
            <Text style={styles.mapBtnText}>📍 Map</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.row}>
        <Col label="Boarded"   value={formatTime(trip.boarded_at)} />
        <Col label="Deboarded" value={trip.deboarded_at ? formatTime(trip.deboarded_at) : 'Active'} color={active ? NY_GREEN : undefined} />
        <Col label="Duration"  value={formatDuration(trip.duration_secs)} />
      </View>

      <View style={styles.divider} />

      <View style={styles.row}>
        <Col label="Board location"   value={formatCoord(trip.board_lat, trip.board_lng)} mono />
        <Col label="Deboard location" value={formatCoord(trip.deboard_lat, trip.deboard_lng)} mono />
      </View>
    </View>
  );
}

function Col({ label, value, color, mono }: { label: string; value: string; color?: string; mono?: boolean }) {
  return (
    <View style={styles.col}>
      <Text style={styles.colLabel}>{label}</Text>
      <Text style={[styles.colValue, mono && styles.mono, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function HistoryScreen() {
  const [trips, setTrips]             = useState<Trip[]>([]);
  const [loading, setLoading]         = useState(true);
  const [mapTrip, setMapTrip]         = useState<Trip | null>(null);
  const [mapCrumbs, setMapCrumbs]     = useState<Breadcrumb[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setTrips(await fetchTrips(100));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, []);

  const onClear = () => {
    Alert.alert('Clear history', 'Delete all trip records?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await clearTrips(); load(); } },
    ]);
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Trip History</Text>
        {trips.length > 0 && (
          <TouchableOpacity onPress={onClear}>
            <Text style={styles.clearBtn}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <Text style={styles.empty}>Loading…</Text>
      ) : trips.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyIcon}>🚌</Text>
          <Text style={styles.empty}>No trips recorded yet.</Text>
          <Text style={styles.emptySub}>Board a bus to start logging.</Text>
        </View>
      ) : (
        <FlatList
          data={trips}
          keyExtractor={t => String(t.id)}
          renderItem={({ item }) => (
            <TripCard trip={item} onMapPress={async () => {
              const crumbs = await fetchBreadcrumbs(item.id);
              setMapCrumbs(crumbs);
              setMapTrip(item);
            }} />
          )}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          onRefresh={load}
          refreshing={loading}
        />
      )}

      {mapTrip && (
        <TripMapModal trip={mapTrip} breadcrumbs={mapCrumbs} onClose={() => { setMapTrip(null); setMapCrumbs([]); }} />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:       { flex: 1, backgroundColor: NY_BG },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#EEEEEE' },
  title:      { fontSize: 20, fontWeight: '800', color: NY_DARK },
  clearBtn:   { fontSize: 14, color: NY_RED, fontWeight: '600' },

  card:       { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 12, elevation: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  busId:      { fontSize: 16, fontWeight: '800', color: NY_DARK, letterSpacing: 1 },
  statusDot:  { width: 8, height: 8, borderRadius: 4 },
  mapBtn:     { backgroundColor: '#F5F5F5', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  mapBtnText: { fontSize: 12, fontWeight: '700', color: NY_DARK },

  row:        { flexDirection: 'row', gap: 8 },
  col:        { flex: 1 },
  colLabel:   { fontSize: 10, color: NY_GREY, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  colValue:   { fontSize: 12, color: NY_DARK, fontWeight: '600' },
  mono:       { fontFamily: 'monospace', fontSize: 10, color: NY_GREY },

  divider:    { height: 1, backgroundColor: '#F0F0F0', marginVertical: 10 },

  emptyWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyIcon:  { fontSize: 48, marginBottom: 12 },
  empty:      { color: NY_GREY, fontSize: 15, fontWeight: '600' },
  emptySub:   { color: NY_GREY, fontSize: 13, marginTop: 4 },
});

const mapStyles = StyleSheet.create({
  root:          { flex: 1, backgroundColor: '#fff' },

  // Header
  header:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#EEE', backgroundColor: '#fff' },
  busId:         { fontSize: 20, fontWeight: '800', color: NY_DARK, letterSpacing: 0.5 },
  duration:      { fontSize: 13, color: NY_GREY, marginTop: 2, fontWeight: '500' },
  closeBtn:      { backgroundColor: NY_YELLOW, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  closeTxt:      { fontWeight: '700', color: NY_DARK, fontSize: 14 },

  // Info panel
  panel:         { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#EEE', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 20 },
  panelRow:      { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 2 },
  panelRowTop:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  panelLabel:    { fontSize: 13, fontWeight: '700', color: NY_DARK },
  panelTime:     { fontSize: 13, fontWeight: '600', color: NY_DARK },
  panelCoord:    { fontSize: 11, color: NY_GREY, fontFamily: 'monospace' },
  panelDivider:  { height: 1, backgroundColor: '#F0F0F0', marginVertical: 10 },
  dot:           { width: 10, height: 10, borderRadius: 5, marginTop: 4 },

  // Stats chips
  statsRow:      { flexDirection: 'row', gap: 10 },
  chip:          { flex: 1, backgroundColor: '#F5F5F5', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  chipLabel:     { fontSize: 10, color: NY_GREY, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  chipValue:     { fontSize: 14, fontWeight: '800', color: NY_DARK },
});
