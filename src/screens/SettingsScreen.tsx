import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, FlatList, Keyboard, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { getCustomNames, saveCustomNames } from '../store/filterStore';

const NY_YELLOW  = '#FFD000';
const NY_GREEN   = '#00A651';
const NY_RED     = '#E53935';
const NY_DARK    = '#212121';
const NY_GREY    = '#9E9E9E';
const NY_SUBTEXT = '#757575';

interface Props { onSave: () => void; }

export default function SettingsScreen({ onSave }: Props) {
  const [names, setNames]     = useState<string[]>([]);
  const [input, setInput]     = useState('');
  const inputRef              = useRef<TextInput>(null);

  useEffect(() => {
    getCustomNames().then(setNames);
  }, []);

  const add = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (names.includes(trimmed)) {
      Alert.alert('Already added', `"${trimmed}" is already in the list.`);
      return;
    }
    const updated = [...names, trimmed];
    setNames(updated);
    await saveCustomNames(updated);
    setInput('');
    Keyboard.dismiss();
    onSave();
  }, [input, names, onSave]);

  const remove = useCallback(async (name: string) => {
    const updated = names.filter(n => n !== name);
    setNames(updated);
    await saveCustomNames(updated);
    onSave();
  }, [names, onSave]);

  const clearAll = () => {
    Alert.alert('Clear all', 'Remove all custom device names?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => {
        setNames([]);
        await saveCustomNames([]);
        onSave();
      }},
    ]);
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
        {names.length > 0 && (
          <TouchableOpacity onPress={clearAll}>
            <Text style={styles.clearBtn}>Clear all</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Default filter info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Default filter</Text>
        <View style={styles.infoCard}>
          <Text style={styles.infoText}>
            The app auto-detects any BLE device whose name starts with{' '}
            <Text style={styles.mono}>NY-BUS-</Text> or uses the beacon manufacturer format.
            {'\n\n'}
            For testing with other BLE devices, add the exact device name below.
          </Text>
        </View>
      </View>

      {/* Custom device names */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Custom device names (test mode)</Text>

        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="e.g. MyPhone, TestBeacon-01"
            placeholderTextColor={NY_GREY}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={add}
            autoCapitalize="none"
            returnKeyType="done"
          />
          <TouchableOpacity style={styles.addBtn} onPress={add}>
            <Text style={styles.addBtnText}>Add</Text>
          </TouchableOpacity>
        </View>

        {names.length === 0 ? (
          <Text style={styles.empty}>No custom devices added. App will only detect NY-BUS- beacons.</Text>
        ) : (
          <FlatList
            data={names}
            keyExtractor={n => n}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <View style={styles.nameRow}>
                <View style={styles.nameDot} />
                <Text style={styles.nameText}>{item}</Text>
                <TouchableOpacity onPress={() => remove(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.removeBtn}>✕</Text>
                </TouchableOpacity>
              </View>
            )}
          />
        )}
      </View>

      <View style={styles.note}>
        <Text style={styles.noteText}>
          Changes take effect immediately — the scanner restarts automatically when you add or remove a device.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: '#F8F8F8' },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#EEE' },
  title:       { fontSize: 20, fontWeight: '800', color: NY_DARK },
  clearBtn:    { fontSize: 14, color: NY_RED, fontWeight: '600' },

  section:     { margin: 16, marginBottom: 0 },
  sectionTitle:{ fontSize: 11, fontWeight: '700', color: NY_GREY, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },

  infoCard:    { backgroundColor: '#fff', borderRadius: 12, padding: 14, borderLeftWidth: 3, borderLeftColor: NY_YELLOW },
  infoText:    { fontSize: 13, color: NY_SUBTEXT, lineHeight: 20 },
  mono:        { fontFamily: 'monospace', color: NY_DARK, fontWeight: '600' },

  inputRow:    { flexDirection: 'row', gap: 8, marginBottom: 12 },
  input:       { flex: 1, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: NY_DARK, borderWidth: 1, borderColor: '#E0E0E0' },
  addBtn:      { backgroundColor: NY_YELLOW, borderRadius: 10, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  addBtnText:  { fontWeight: '700', color: NY_DARK, fontSize: 14 },

  nameRow:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 6, gap: 10 },
  nameDot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: NY_GREEN },
  nameText:    { flex: 1, fontSize: 14, color: NY_DARK, fontFamily: 'monospace' },
  removeBtn:   { fontSize: 14, color: NY_RED, fontWeight: '700' },

  empty:       { fontSize: 13, color: NY_GREY, fontStyle: 'italic', paddingVertical: 8 },

  note:        { margin: 16, marginTop: 24 },
  noteText:    { fontSize: 12, color: NY_GREY, lineHeight: 18 },
});
