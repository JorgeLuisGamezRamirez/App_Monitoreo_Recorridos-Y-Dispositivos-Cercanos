import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { Accelerometer, Gyroscope } from 'expo-sensors';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, PermissionsAndroid, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { BleManager, State as BluetoothState } from 'react-native-ble-plx';
import { distanceBetween, formatDuration, proximityFromRssi } from './src/geo';
import { loadTrips, saveTrips } from './src/storage';
import type { Coordinate, NearbyDevice, Trip } from './src/types';

type Tab = 'route' | 'bluetooth' | 'history';

const emptyTrip = (device: NearbyDevice | null): Trip => ({
  id: `${Date.now()}`,
  startedAt: Date.now(),
  endedAt: null,
  durationSeconds: 0,
  distanceMeters: 0,
  averageSpeedMps: 0,
  points: [],
  motionEvents: [],
  bleDetections: [],
  selectedDeviceId: device?.id ?? null,
  selectedDeviceName: device?.name ?? null,
});

const toCoordinate = (location: Location.LocationObject): Coordinate => ({
  latitude: location.coords.latitude,
  longitude: location.coords.longitude,
  altitude: location.coords.altitude,
  accuracy: location.coords.accuracy,
  speed: location.coords.speed,
  timestamp: location.timestamp,
});

export default function App() {
  const [tab, setTab] = useState<Tab>('route');
  const [location, setLocation] = useState<Coordinate | null>(null);
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedHistory, setSelectedHistory] = useState<Trip | null>(null);
  const [moving, setMoving] = useState(false);
  const [acceleration, setAcceleration] = useState(0);
  const [orientation, setOrientation] = useState({ x: 0, y: 0, z: 0 });
  const [devices, setDevices] = useState<Record<string, NearbyDevice>>({});
  const [selectedDevice, setSelectedDevice] = useState<NearbyDevice | null>(null);
  const [scanning, setScanning] = useState(false);
  const [bluetoothStatus, setBluetoothStatus] = useState('Desconocido');
  const bleManager = useRef<BleManager | null>(null);
  const lastBleRecord = useRef<Record<string, number>>({});
  const lastMotionRecord = useRef(0);
  const lastGyroscopeTimestamp = useRef(Date.now());
  const activeTripRef = useRef<Trip | null>(null);
  const locationRef = useRef<Coordinate | null>(null);
  const orientationRef = useRef(orientation);

  useEffect(() => { activeTripRef.current = activeTrip; }, [activeTrip]);
  useEffect(() => { locationRef.current = location; }, [location]);
  useEffect(() => { orientationRef.current = orientation; }, [orientation]);
  useEffect(() => { loadTrips().then(setTrips); }, []);

  useEffect(() => {
    const manager = new BleManager();
    bleManager.current = manager;
    const subscription = manager.onStateChange((state) => {
      setBluetoothStatus(state === BluetoothState.PoweredOn ? 'Encendido' : state === BluetoothState.PoweredOff ? 'Apagado' : state);
    }, true);
    return () => { manager.stopDeviceScan(); subscription.remove(); manager.destroy(); bleManager.current = null; };
  }, []);

  useEffect(() => {
    let locationSubscription: Location.LocationSubscription | undefined;
    const setup = async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('Ubicación necesaria', 'Activa el permiso de ubicación para mostrar el mapa y registrar recorridos.');
        return;
      }
      const initial = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setLocation(toCoordinate(initial));
      locationSubscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 3, timeInterval: 2000 },
        (update) => {
          const point = toCoordinate(update);
          setLocation(point);
          setActiveTrip((current) => {
            if (!current) return current;
            const previous = current.points.at(-1);
            const increment = previous && (point.accuracy ?? 999) <= 50 ? distanceBetween(previous, point) : 0;
            if (increment > 100) return current;
            return { ...current, points: [...current.points, point], distanceMeters: current.distanceMeters + increment };
          });
        },
      );
    };
    setup();
    return () => locationSubscription?.remove();
  }, []);

  useEffect(() => {
    Accelerometer.setUpdateInterval(400);
    Gyroscope.setUpdateInterval(400);
    const accelerationSubscription = Accelerometer.addListener(({ x, y, z }) => {
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      const deviation = Math.abs(magnitude - 1);
      const isMoving = deviation > 0.08;
      setAcceleration(deviation);
      setMoving(isMoving);
      const now = Date.now();
      if (activeTripRef.current && now - lastMotionRecord.current >= 1000) {
        lastMotionRecord.current = now;
        setActiveTrip((current) => current ? { ...current, motionEvents: [...current.motionEvents, { timestamp: now, moving: isMoving, acceleration: deviation, orientation: orientationRef.current }] } : current);
      }
    });
    const gyroscopeSubscription = Gyroscope.addListener(({ x, y, z }) => {
      const now = Date.now();
      const seconds = Math.min((now - lastGyroscopeTimestamp.current) / 1000, 1);
      lastGyroscopeTimestamp.current = now;
      setOrientation((value) => ({ x: value.x + x * seconds, y: value.y + y * seconds, z: value.z + z * seconds }));
    });
    return () => { accelerationSubscription.remove(); gyroscopeSubscription.remove(); };
  }, []);

  useEffect(() => {
    if (!activeTrip) return;
    const timer = setInterval(() => {
      setActiveTrip((current) => current ? { ...current, durationSeconds: Math.floor((Date.now() - current.startedAt) / 1000) } : current);
    }, 1000);
    return () => clearInterval(timer);
  }, [activeTrip?.id]);

  const requestBluetoothPermissions = async () => {
    if (Platform.OS !== 'android') return true;
    if (Number(Platform.Version) >= 31) {
      const result = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      return Object.values(result).every((value) => value === PermissionsAndroid.RESULTS.GRANTED);
    }
    return (await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION)) === PermissionsAndroid.RESULTS.GRANTED;
  };

  const stopScan = useCallback(() => {
    bleManager.current?.stopDeviceScan();
    setScanning(false);
  }, []);

  const startScan = useCallback(async (continuous = false) => {
    if (!(await requestBluetoothPermissions())) {
      Alert.alert('Permiso requerido', 'Bluetooth necesita permiso para detectar dispositivos BLE cercanos.');
      return;
    }
    setDevices({});
    setScanning(true);
    bleManager.current?.startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
      if (error) { stopScan(); Alert.alert('No se pudo escanear', error.message); return; }
      if (!device || device.rssi == null) return;
      const nearby: NearbyDevice = { id: device.id, name: device.name ?? device.localName ?? 'Dispositivo sin nombre', rssi: device.rssi, proximity: proximityFromRssi(device.rssi), lastSeen: Date.now() };
      setDevices((current) => ({ ...current, [device.id]: nearby }));
      const trip = activeTripRef.current;
      const now = Date.now();
      if (trip?.selectedDeviceId === device.id && now - (lastBleRecord.current[device.id] ?? 0) >= 10_000) {
        lastBleRecord.current[device.id] = now;
        setActiveTrip((current) => current ? { ...current, bleDetections: [...current.bleDetections, { deviceId: device.id, name: nearby.name, rssi: nearby.rssi, proximity: nearby.proximity, timestamp: now, location: locationRef.current }] } : current);
      }
    });
    if (!continuous) setTimeout(stopScan, 12_000);
  }, [stopScan]);

  const beginTrip = () => {
    const trip = emptyTrip(selectedDevice);
    if (location) trip.points = [location];
    activeTripRef.current = trip;
    setActiveTrip(trip);
    startScan(true);
  };

  const finishTrip = async () => {
    if (!activeTrip) return;
    const duration = Math.max(1, Math.floor((Date.now() - activeTrip.startedAt) / 1000));
    const finished = { ...activeTrip, endedAt: Date.now(), durationSeconds: duration, averageSpeedMps: activeTrip.distanceMeters / duration };
    const updated = [finished, ...trips];
    setTrips(updated);
    await saveTrips(updated);
    stopScan();
    setActiveTrip(null);
    Alert.alert('Recorrido guardado', 'Puedes consultarlo en la pestaña Historial.');
  };

  const deviceList = useMemo(() => Object.values(devices).sort((a, b) => b.rssi - a.rssi), [devices]);
  const shownTrip = selectedHistory ?? activeTrip;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.title}>Monitoreo</Text>
        <Text style={styles.subtitle}>Recorridos y dispositivos cercanos</Text>
      </View>

      {tab === 'route' && (
        <ScrollView contentContainerStyle={styles.screen}>
          <View style={styles.mapCard}>
            {location ? (
              <MapView style={styles.map} region={{ latitude: location.latitude, longitude: location.longitude, latitudeDelta: 0.008, longitudeDelta: 0.008 }} showsUserLocation>
                <Marker coordinate={location} title="Ubicación actual" />
                {!!shownTrip?.points.length && <Polyline coordinates={shownTrip.points} strokeColor="#0E7C66" strokeWidth={5} />}
              </MapView>
            ) : <View style={styles.center}><Text>Obteniendo ubicación GPS…</Text></View>}
          </View>
          <View style={styles.metricsRow}>
            <Metric label="Distancia" value={`${((activeTrip?.distanceMeters ?? 0) / 1000).toFixed(2)} km`} />
            <Metric label="Duración" value={formatDuration(activeTrip?.durationSeconds ?? 0)} />
            <Metric label="Velocidad" value={`${(((activeTrip?.distanceMeters ?? 0) / Math.max(activeTrip?.durationSeconds ?? 1, 1)) * 3.6).toFixed(1)} km/h`} />
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sensores del dispositivo</Text>
            <Text style={[styles.motion, moving ? styles.moving : styles.stopped]}>{moving ? '● En movimiento' : '● Detenido'}</Text>
            <Text style={styles.detail}>Aceleración relativa: {acceleration.toFixed(3)} g</Text>
            <Text style={styles.detail}>Orientación acumulada: X {orientation.x.toFixed(1)} · Y {orientation.y.toFixed(1)} · Z {orientation.z.toFixed(1)} rad</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Dispositivo BLE asociado</Text>
            <Text style={styles.detail}>{selectedDevice ? `${selectedDevice.name} · ${selectedDevice.proximity}` : 'Ningún dispositivo seleccionado'}</Text>
            <Text style={styles.hint}>Las detecciones se registran con hora y ubicación mientras el recorrido está activo.</Text>
          </View>
          <Pressable style={[styles.primaryButton, activeTrip && styles.dangerButton]} onPress={activeTrip ? finishTrip : beginTrip}>
            <Text style={styles.primaryButtonText}>{activeTrip ? 'Finalizar y guardar recorrido' : 'Iniciar recorrido'}</Text>
          </Pressable>
        </ScrollView>
      )}

      {tab === 'bluetooth' && (
        <View style={styles.screenFill}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Bluetooth: {bluetoothStatus}</Text>
            <Text style={styles.hint}>La proximidad se estima con RSSI y no representa una distancia exacta.</Text>
            <Pressable style={styles.primaryButton} onPress={scanning ? stopScan : () => startScan(false)}><Text style={styles.primaryButtonText}>{scanning ? 'Detener escaneo' : 'Escanear dispositivos BLE'}</Text></Pressable>
          </View>
          <FlatList data={deviceList} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} ListEmptyComponent={<Text style={styles.empty}>No hay dispositivos detectados.</Text>} renderItem={({ item }) => (
            <Pressable style={[styles.device, selectedDevice?.id === item.id && styles.selectedDevice]} onPress={() => { setSelectedDevice(item); setActiveTrip((current) => current ? { ...current, selectedDeviceId: item.id, selectedDeviceName: item.name } : current); }}>
              <View style={styles.deviceText}><Text style={styles.cardTitle}>{item.name}</Text><Text numberOfLines={1} style={styles.detail}>{item.id}</Text></View>
              <View><Text style={styles.rssi}>{item.rssi} dBm</Text><Text style={styles.proximity}>{item.proximity}</Text></View>
            </Pressable>
          )} />
        </View>
      )}

      {tab === 'history' && (
        <View style={styles.screenFill}>
          {selectedHistory ? (
            <ScrollView contentContainerStyle={styles.screen}>
              <Pressable onPress={() => setSelectedHistory(null)}><Text style={styles.back}>‹ Volver al historial</Text></Pressable>
              <View style={styles.mapCard}><MapView style={styles.map} initialRegion={{ latitude: selectedHistory.points[0]?.latitude ?? 19.4326, longitude: selectedHistory.points[0]?.longitude ?? -99.1332, latitudeDelta: 0.02, longitudeDelta: 0.02 }}><Polyline coordinates={selectedHistory.points} strokeColor="#0E7C66" strokeWidth={5} /></MapView></View>
              <TripDetails trip={selectedHistory} />
            </ScrollView>
          ) : (
            <FlatList data={trips} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} ListEmptyComponent={<Text style={styles.empty}>Todavía no hay recorridos guardados.</Text>} renderItem={({ item }) => (
              <Pressable style={styles.tripCard} onPress={() => setSelectedHistory(item)}>
                <Text style={styles.cardTitle}>{new Date(item.startedAt).toLocaleString()}</Text>
                <Text style={styles.detail}>{(item.distanceMeters / 1000).toFixed(2)} km · {formatDuration(item.durationSeconds)} · {(item.averageSpeedMps * 3.6).toFixed(1)} km/h</Text>
                <Text style={styles.hint}>{item.points.length} ubicaciones · {item.motionEvents.length} eventos · {item.bleDetections.length} detecciones BLE</Text>
              </Pressable>
            )} />
          )}
        </View>
      )}

      <View style={styles.tabs}>
        <TabButton active={tab === 'route'} label="Recorrido" onPress={() => setTab('route')} />
        <TabButton active={tab === 'bluetooth'} label="Bluetooth" onPress={() => setTab('bluetooth')} />
        <TabButton active={tab === 'history'} label="Historial" onPress={() => setTab('history')} />
      </View>
    </SafeAreaView>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
function TabButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) { return <Pressable style={[styles.tab, active && styles.activeTab]} onPress={onPress}><Text style={[styles.tabText, active && styles.activeTabText]}>{label}</Text></Pressable>; }
function TripDetails({ trip }: { trip: Trip }) { return <View style={styles.card}><Text style={styles.cardTitle}>Resumen del recorrido</Text><Text style={styles.detail}>Distancia: {(trip.distanceMeters / 1000).toFixed(2)} km</Text><Text style={styles.detail}>Duración: {formatDuration(trip.durationSeconds)}</Text><Text style={styles.detail}>Velocidad media: {(trip.averageSpeedMps * 3.6).toFixed(1)} km/h</Text><Text style={styles.detail}>Dispositivo seleccionado: {trip.selectedDeviceName ?? 'Ninguno'}</Text><Text style={styles.detail}>Detecciones BLE: {trip.bleDetections.length}</Text><Text style={styles.detail}>Registros de movimiento: {trip.motionEvents.length}</Text>{trip.bleDetections.map((event, index) => <Text key={`${event.timestamp}-${index}`} style={styles.event}>• {new Date(event.timestamp).toLocaleTimeString()} · {event.name} · {event.rssi} dBm · {event.proximity}{event.location ? ` · ${event.location.latitude.toFixed(5)}, ${event.location.longitude.toFixed(5)}` : ''}</Text>)}</View>; }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F4F7F6' }, header: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 12, backgroundColor: '#FFFFFF' },
  title: { fontSize: 28, fontWeight: '800', color: '#102A25' }, subtitle: { color: '#61736F', marginTop: 2 }, screen: { padding: 14, gap: 12, paddingBottom: 24 }, screenFill: { flex: 1, padding: 14 },
  mapCard: { height: 310, borderRadius: 20, overflow: 'hidden', backgroundColor: '#DCE8E5' }, map: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  metricsRow: { flexDirection: 'row', gap: 8 }, metric: { flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center' }, metricValue: { fontWeight: '800', fontSize: 16, color: '#0E7C66' }, metricLabel: { color: '#61736F', fontSize: 12, marginTop: 3 },
  card: { backgroundColor: '#FFFFFF', padding: 16, borderRadius: 16, gap: 7 }, cardTitle: { fontSize: 16, fontWeight: '700', color: '#183C35' }, detail: { color: '#4E625E' }, hint: { color: '#71827E', fontSize: 12, lineHeight: 17 },
  motion: { fontSize: 18, fontWeight: '700' }, moving: { color: '#0E7C66' }, stopped: { color: '#B05A3C' },
  primaryButton: { backgroundColor: '#0E7C66', minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, marginTop: 7 }, dangerButton: { backgroundColor: '#B84B3E' }, primaryButtonText: { color: '#FFFFFF', fontWeight: '800' },
  list: { gap: 10, paddingBottom: 30 }, empty: { color: '#71827E', textAlign: 'center', marginTop: 40 }, device: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 15, padding: 15, borderWidth: 2, borderColor: 'transparent' }, selectedDevice: { borderColor: '#0E7C66', backgroundColor: '#E7F3F0' }, deviceText: { flex: 1, marginRight: 10 }, rssi: { fontWeight: '800', color: '#183C35', textAlign: 'right' }, proximity: { color: '#0E7C66', fontSize: 12, textAlign: 'right' },
  tripCard: { backgroundColor: '#FFFFFF', padding: 16, borderRadius: 16, gap: 6 }, back: { color: '#0E7C66', fontWeight: '700', fontSize: 16 }, event: { color: '#4E625E', fontSize: 12, lineHeight: 18 },
  tabs: { flexDirection: 'row', padding: 8, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#DEE7E5' }, tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 }, activeTab: { backgroundColor: '#E2F1ED' }, tabText: { color: '#71827E', fontWeight: '600' }, activeTabText: { color: '#0E7C66', fontWeight: '800' },
});
