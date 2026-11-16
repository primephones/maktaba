import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'za.co.primephones.maktaba',
  appName: 'Maktaba',
  webDir: 'dist',
  android: { backgroundColor: '#F6F4EF' },
  server: { androidScheme: 'https' },
};

export default config;
