import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { setupNotifications } from './src/background/notifications';
import { promptBatteryOptimizationIfNeeded } from './src/utils/batteryOptimization';
import { useBusDetection } from './src/hooks/useBusDetection';
import { useLocation } from './src/hooks/useLocation';
import { useTripLogger } from './src/hooks/useTripLogger';
import HistoryScreen from './src/screens/HistoryScreen';
import HomeScreen from './src/screens/HomeScreen';
import SettingsScreen from './src/screens/SettingsScreen';

type Tab = 'home' | 'history' | 'settings';

export default function App() {
  const [tab, setTab] = useState<Tab>('home');

  useEffect(() => {
    setupNotifications();
    promptBatteryOptimizationIfNeeded();
  }, []);

  const { result, rawScans, error, btOn, locationOn, restartScan } = useBusDetection();
  const locationRef = useLocation();
  const { lastCompletedTripId } = useTripLogger(result, locationRef);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />

      <View style={styles.content}>
        {tab === 'home'     && <HomeScreen result={result} rawScans={rawScans} error={error} lastCompletedTripId={lastCompletedTripId} btOn={btOn} locationOn={locationOn} />}
        {tab === 'history'  && <HistoryScreen />}
        {tab === 'settings' && <SettingsScreen onSave={restartScan} />}
      </View>

      <View style={styles.tabBar}>
        <Tab label="Detect"  icon="◎" active={tab === 'home'}     onPress={() => setTab('home')} />
        <Tab label="History" icon="☰" active={tab === 'history'}  onPress={() => setTab('history')} />
        <Tab label="Settings" icon="⚙" active={tab === 'settings'} onPress={() => setTab('settings')} />
      </View>
    </View>
  );
}

function Tab({ label, icon, active, onPress }: { label: string; icon: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.tab} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.tabIcon, active && styles.tabActive]}>{icon}</Text>
      <Text style={[styles.tabLabel, active && styles.tabActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root:      { flex: 1, backgroundColor: '#fff' },
  content:   { flex: 1 },
  tabBar:    { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#EEEEEE', backgroundColor: '#fff', paddingBottom: 8, paddingTop: 4 },
  tab:       { flex: 1, alignItems: 'center', paddingVertical: 8, gap: 2 },
  tabIcon:   { fontSize: 18, color: '#9E9E9E' },
  tabLabel:  { fontSize: 11, fontWeight: '600', color: '#9E9E9E' },
  tabActive: { color: '#FFD000' },
});
