# Monitoreo de recorridos y dispositivos cercanos

Aplicación móvil creada con Expo y React Native para registrar recorridos GPS, analizar movimiento mediante sensores y detectar dispositivos Bluetooth Low Energy cercanos.

## ¿Funciona con Expo Go?

No completamente. GPS, mapas, acelerómetro y giroscopio sí pueden ejecutarse con módulos del SDK de Expo, pero `react-native-ble-plx` incorpora código nativo que no está incluido en Expo Go. Para cumplir el escaneo BLE se utiliza un **development build de Expo** con `expo-dev-client`.

La experiencia de desarrollo sigue siendo la de Expo: Metro, recarga rápida, configuración mediante `app.json` y compilaciones con EAS. La única diferencia es que se instala el cliente personalizado en vez de abrir el proyecto en Expo Go.

## Funciones implementadas

- Ubicación actual sobre mapa interactivo.
- Inicio y finalización manual de recorridos.
- Ruta GPS, distancia, duración y velocidad media en tiempo real.
- Detección de movimiento con acelerómetro real.
- Cambios de orientación mediante giroscopio.
- Escaneo de dispositivos BLE con nombre, RSSI y proximidad aproximada.
- Selección de un dispositivo y registro de sus detecciones durante el recorrido.
- Hora y coordenadas asociadas a cada detección BLE.
- Historial local persistente y detalle de recorridos anteriores.
- Permisos diferenciados para Android 12+ y versiones anteriores.

## Ejecutar en GitHub Codespaces

1. Abre **Code → Codespaces → Create codespace on main**.
2. Ejecuta `npm run typecheck` para validar TypeScript.
3. Inicia Metro con `npx expo start --dev-client --tunnel`.
4. Abre el enlace o QR desde el development build instalado en el teléfono.

El Codespace no tiene acceso a los sensores, GPS o Bluetooth del equipo remoto. Estas funciones se prueban en un teléfono físico conectado al servidor Metro.

## Crear el development build

Instala EAS CLI e inicia sesión:

```bash
npm install --global eas-cli
eas login
eas build --profile development --platform android
```

Instala el APK generado en el teléfono. Después, los cambios de TypeScript se prueban sin recompilar mediante:

```bash
npx expo start --dev-client --tunnel
```

También puede compilarse localmente con `npx expo run:android` si Android Studio y el SDK están instalados.

## Validación

```bash
npm ci
npm run typecheck
npx expo-doctor@latest
npx expo export --platform android
```

## Consideraciones

- La proximidad BLE se clasifica a partir del RSSI y es solo orientativa; paredes, interferencias y el propio dispositivo alteran la señal.
- El escaneo funciona únicamente con dispositivos Bluetooth Low Energy.
- El registro actual utiliza ubicación en primer plano. La aplicación debe permanecer activa durante el recorrido.
- Los recorridos se conservan localmente en AsyncStorage.
