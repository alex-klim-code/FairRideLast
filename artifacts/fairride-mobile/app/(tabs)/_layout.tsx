import React from 'react';
import { Tabs } from 'expo-router';
import { Footer } from '@/components/PassengerChrome';

export default function TabLayout() {
  return (
    <Tabs initialRouteName="go" tabBar={props => <Footer {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="ticket" options={{ title: 'Bilet' }} />
      <Tabs.Screen name="go" options={{ title: 'Go' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
