const MEASUREMENT_ID = 'G-VKPPFRGC6D'; 
const API_SECRET = 'X-jt_gjVQOy3RjcFpgTIfA'; 

export async function trackEvent(eventName, params = {}) {
  const userId = await new Promise((resolve) => {
    chrome.identity.getProfileUserInfo((userInfo) => {
      resolve(userInfo.id || 'anon_' + Date.now());
    });
  });

  const payload = {
    client_id: userId,
    events: [{ name: eventName, params: params }]
  };

  try {
    await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`,
      { method: 'POST', body: JSON.stringify(payload) }
    );
    console.log('📊 GA Tracked:', eventName);
  } catch (e) {
    console.error('📊 GA Error:', e);
  }
}