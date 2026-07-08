import { Platform } from 'react-native';

if (Platform.OS === 'android') {
  try {
    const TrackPlayer = require('react-native-track-player').default;
    if (TrackPlayer && typeof TrackPlayer.registerPlaybackService === 'function') {
      TrackPlayer.registerPlaybackService(() => require('./service'));
    }
  } catch (e) {
    console.warn('TrackPlayer not available — rebuild the Android app with `npx expo run:android`', e);
  }
}

import 'expo-router/entry';
