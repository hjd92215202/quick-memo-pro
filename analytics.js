import { UMAMI_ID, UMAMI_URL } from './server-config.js';

export async function trackEvent(eventName, params = {}) {
  try {
    const payload = {
      type: "event",
      payload: {
        website: UMAMI_ID,
        url: "/extension",
        event_name: eventName,
        event_data: params
      }
    };

    await fetch(UMAMI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log(`📊 Umami Tracked: [${eventName}]`);
  } catch (e) {
    console.error('📊 Umami Error:', e);
  }
}