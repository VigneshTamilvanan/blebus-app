import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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

function TripCard({ trip }: { trip: Trip }) {
  const active = trip.deboarded_at === null;
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.busId}>{trip.bus_id}</Text>
        <View style={[styles.statusDot, { backgroundColor: active ? NY_GREEN : NY_GREY }]} />
      </View>

      <View style={styles.row}>
        <Col label="Boarded"   value={formatTime(trip.boarded_at)} />
        <Col label="Deboarded" value={trip.deboarded_at ? formatTime(trip.deboarded_at) : 'Active'} color={active ? NY_GREEN : undefined} />
        <Col label="Duration"  value={formatDuration(trip.duration_secs)} />
      </View>

      <View style={styles.divider} />

      <View style={styles.row}>
        <Col label="Board location"  value={formatCoord(trip.board_lat, trip.board_lng)} mono />
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

export default function HistoryScreen() {
  const [trips, setTrips]     = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);

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
          renderItem={({ item }) => <TripCard trip={item} />}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          onRefresh={load}
          refreshing={loading}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root:       { flex: 1, backgroundColor: NY_BG },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#EEEEEE' },
  title:      { fontSize: 20, fontWeight: '800', color: NY_DARK },
  clearBtn:   { fontSize: 14, color: NY_RED, fontWeight: '600' },

  card:       { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 12, elevation: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  busId:      { fontSize: 16, fontWeight: '800', color: NY_DARK, letterSpacing: 1 },
  statusDot:  { width: 8, height: 8, borderRadius: 4 },

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
