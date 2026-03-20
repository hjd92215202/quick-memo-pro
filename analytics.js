const MEASUREMENT_ID = 'G-VKPPFRGC6D'; 
const API_SECRET = 'X-jt_gjVQOy3RjcFpgTIfA'; 

// 开发阶段建议设为 true，可以在 GA 后台的 DebugView 实时看到
const DEBUG_MODE = false; 

/**
 * 获取或创建一个永久的 Client ID
 * 确保统计数据的用户唯一性
 */
async function getOrCreateClientId() {
  const result = await chrome.storage.local.get('ga_client_id');
  if (result.ga_client_id) {
    return result.ga_client_id;
  }

  // 如果本地没存过 ID，尝试从身份信息获取，或者生成一个随机 UUID
  const userInfo = await new Promise((resolve) => {
    chrome.identity.getProfileUserInfo((info) => resolve(info));
  });

  const newId = userInfo.id || crypto.randomUUID();
  await chrome.storage.local.set({ ga_client_id: newId });
  return newId;
}

/**
 * 发送事件到 Google Analytics 4
 * @param {string} eventName 事件名称 (只允许下划线和字母)
 * @param {object} params 附加参数 (可选)
 */
export async function trackEvent(eventName, params = {}) {
  try {
    const clientId = await getOrCreateClientId();

    const payload = {
      client_id: clientId,
      events: [{
        name: eventName,
        params: {
          ...params,
          // 如果开启调试模式，GA 后台的 DebugView 才能实时捕捉
          debug_mode: DEBUG_MODE ? 1 : undefined 
        },
      }]
    };

    // 构建请求 URL
    let url = `https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`;
    if (DEBUG_MODE) {
      url += `&debug_mode=1`;
    }

    const response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (response.status === 204) {
      console.log(`📊 GA Tracked: [${eventName}]`);
    } else {
      console.warn(`📊 GA Warning: Received status ${response.status}`);
    }
  } catch (e) {
    // 统计报错不应影响插件核心功能执行
    console.error('📊 GA Network Error:', e);
  }
}