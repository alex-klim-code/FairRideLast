import React, { useEffect, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { mapOrigin, mapPage, mapPayload, type PassengerMapProps } from './map-props';
import { useColors } from '@/hooks/useColors';

export default function NativePassengerMap(props: PassengerMapProps) {
  const frame = useRef<WebView | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const latest = useRef(props); latest.current = props;
  const c = useColors();
  const send = () => {
    frame.current?.injectJavaScript(`window.FairRideMapUpdate && window.FairRideMapUpdate(${JSON.stringify(mapPayload(latest.current))});true;`);
  };
  useEffect(() => {
    if (ready) send();
  }, [ready, props.origin, props.destination, props.route, props.selectedStep, props.bottomInset]);
  if (!mapPage || failed) return <View style={{ flex: 1, padding: 16, backgroundColor: c.card }}>
    <Text style={{ color: c.destructive }}>Nie udało się wczytać mapy Google. Pomiar i check-out działają niezależnie od mapy.</Text>
  </View>;
  return <WebView ref={frame} source={{ uri: mapPage }} style={{ flex: 1, backgroundColor: c.background }}
    testID="passenger-google-map" originWhitelist={[mapOrigin!]}
    javaScriptEnabled domStorageEnabled sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false}
    geolocationEnabled={false} mixedContentMode="never"
    onMessage={event => {
      try { if (JSON.parse(event.nativeEvent.data)?.type === 'fairride-map-ready') setReady(true); }
      catch { /* The map bridge only recognizes its readiness message. */ }
    }}
    onShouldStartLoadWithRequest={request => {
      if (request.url === 'about:blank' || request.url.startsWith(`${mapOrigin}/native-map`)) return true;
      if (/^https:\/\//.test(request.url)) void Linking.openURL(request.url);
      return false;
    }}
    onOpenWindow={event => {
      if (/^https:\/\//.test(event.nativeEvent.targetUrl)) void Linking.openURL(event.nativeEvent.targetUrl);
    }}
    onError={() => setFailed(true)} onHttpError={() => setFailed(true)} />;
}