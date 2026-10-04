import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { mapOrigin, mapPage, mapPayload, type PassengerMapProps } from './map-props';
import { useColors } from '@/hooks/useColors';

// Expo browser preview reuses the actual Chrome Google map on its authorized
// web origin, not a drawn substitute or a non-Google basemap.
export default function NativePassengerMap(props: PassengerMapProps) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const c = useColors();
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin === mapOrigin && event.source === frame.current?.contentWindow &&
          event.data?.type === 'fairride-map-ready') setReady(true);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  useEffect(() => {
    if (ready && mapOrigin) frame.current?.contentWindow?.postMessage(mapPayload(props), mapOrigin);
  }, [ready, props.origin, props.destination, props.route, props.selectedStep, props.bottomInset]);
  if (!mapPage) return <View style={{ flex: 1, padding: 16, backgroundColor: c.card }}>
    <Text style={{ color: c.destructive }}>Brak adresu serwera map. Nie używamy mapy zastępczej.</Text>
  </View>;
  return React.createElement('iframe', {
    ref: frame, src: mapPage, title: 'Mapa Google FairRide', 'data-testid': 'passenger-google-map',
    style: { width: '100%', height: '100%', border: 0, display: 'block' },
  });
}