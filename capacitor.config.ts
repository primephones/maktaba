import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'za.co.primephones.maktaba',
  appName: 'Maktaba',
  webDir: 'dist',
  android: {
    backgroundColor: '#F6F4EF',
    // Lets the automated phone test inspect the app. Switched off before sync and AI keys arrive.
    webContentsDebuggingEnabled: true,
  },
  server: { androidScheme: 'https' },
};

export default config;
