import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, FlatList, Modal, SafeAreaView, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { Trip, clearTrips, fetchTrips } from '../db/database';

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

function TripMapModal({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const mapRef = useRef<MapView>(null);

  const boardCoord = trip.board_lat !== null && trip.board_lng !== null
    ? { latitude: trip.board_lat, longitude: trip.board_lng }
    : null;

  const deboardCoord = trip.deboard_lat !== null && trip.deboard_lng !== null
    ? { latitude: trip.deboard_lat, longitude: trip.deboard_lng }
    : null;

  // Fit map to show both markers with padding
  const onMapReady = () => {
    const coords = [boardCoord, deboardCoord].filter(Boolean) as { latitude: number; longitude: number }[];
    if (coords.length === 0) return;
    if (coords.length === 1) {
      mapRef.current?.animateToRegion({
        ...coords[0],
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      }, 300);
    } else {
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 80, right: 60, bottom: 80, left: 60 },
        animated: true,
      });
    }
  };

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={mapStyles.root}>
        {/* Header */}
        <View style={mapStyles.header}>
          <View>
            <Text style={mapStyles.busId}>{trip.bus_id}</Text>
            <Text style={mapStyles.subtitle}>{formatTime(trip.boarded_at)}</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={mapStyles.closeBtn}>
            <Text style={mapStyles.closeTxt}>Done</Text>
          </TouchableOpacity>
        </View>

        {/* Map */}
        <MapView
          ref={mapRef}
          style={mapStyles.map}
          onMapReady={onMapReady}
          initialRegion={
            boardCoord
              ? { ...boardCoord, latitudeDelta: 0.01, longitudeDelta: 0.01 }
              : { latitude: 12.9716, longitude: 77.5946, latitudeDelta: 0.05, longitudeDelta: 0.05 }
          }
        >
          {boardCoord && (
            <Marker
              coordinate={boardCoord}
              title="Boarded"
              description={formatTime(trip.boarded_at)}
              pinColor={NY_GREEN}
            />
          )}
          {deboardCoord && (
            <Marker
              coordinate={deboardCoord}
              title="Deboarded"
              description={trip.deboarded_at ? formatTime(trip.deboarded_at) : ''}
              pinColor={NY_RED}
            />
          )}
          {boardCoord && deboardCoord && (
            <Polyline
              coordinates={[boardCoord, deboardCoord]}
              strokeColor={NY_YELLOW}
              strokeWidth={3}
              lineDashPattern={[8, 4]}
            />
          )}
        </MapView>

        {/* Legend */}
        <View style={mapStyles.legend}>
          <LegendRow color={NY_GREEN} label="Boarded" value={formatCoord(trip.board_lat, trip.board_lng)} />
          {trip.deboarded_at
            ? <LegendRow color={NY_RED} label="Deboarded" value={formatCoord(trip.deboard_lat, trip.deboard_lng)} />
            : <LegendRow color={NY_GREEN} label="Status" value="Trip active" />
          }
          {trip.duration_secs !== null && (
            <LegendRow color={NY_DARK} label="Duration" value={formatDuration(trip.duration_secs)} />
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <View style={mapStyles.legendRow}>
      <View style={[mapStyles.legendDot, { backgroundColor: color }]} />
      <Text style={mapStyles.legendLabel}>{label}</Text>
      <Text style={mapStyles.legendValue}>{value}</Text>
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
  const [trips, setTrips]       = useState<Trip[]>([]);
  const [loading, setLoading]   = useState(true);
  const [mapTrip, setMapTrip]   = useState<Trip | null>(null);

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
            <TripCard trip={item} onMapPress={() => setMapTrip(item)} />
          )}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          onRefresh={load}
          refreshing={loading}
        />
      )}

      {mapTrip && (
        <TripMapModal trip={mapTrip} onClose={() => setMapTrip(null)} />
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
  root:        { flex: 1, backgroundColor: '#fff' },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EEE' },
  busId:       { fontSize: 17, fontWeight: '800', color: NY_DARK },
  subtitle:    { fontSize: 12, color: NY_GREY, marginTop: 2 },
  closeBtn:    { backgroundColor: NY_YELLOW, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 },
  closeTxt:    { fontWeight: '700', color: NY_DARK, fontSize: 14 },
  map:         { flex: 1 },
  legend:      { padding: 16, borderTopWidth: 1, borderTopColor: '#EEE', gap: 10 },
  legendRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  legendDot:   { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { fontSize: 13, fontWeight: '700', color: NY_DARK, width: 80 },
  legendValue: { fontSize: 13, color: NY_GREY, flex: 1, fontFamily: 'monospace' },
});
