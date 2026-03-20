import { UMAMI_ID, UMAMI_URL } from './server-config.js';

/**
 * 发送事件到 Umami 统计
 * @param {string} eventName 事件名称
 * @param {object} params 附加参数 (可选)
 */
export async function trackEvent(eventName, params = {}) {
  try {
    // Umami v2 API 要求 payload 必须包含以下结构
    const payload = {
      type: "event",
      payload: {
        website: UMAMI_ID,        // 网站 ID
        url: "/extension-popup",  // 模拟路径，方便在后台查看页面分布
        hostname: "oneday.ren",   // 重要：必须与 Umami 后台设置的域名一致
        name: eventName,          // 重要：Umami v2 必须使用 name 字段
        data: params,             // 重要：Umami v2 必须使用 data 字段
        language: navigator.language || "zh-CN",
        screen: `${window.screen.width}x${window.screen.height}`
      }
    };

    const response = await fetch(UMAMI_URL, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        // 显式指定 User-Agent 确保 Umami 能解析出浏览器和设备信息
        'User-Agent': navigator.userAgent 
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      console.log(`📊 Umami Tracked: [${eventName}]`);
    } else {
      // 如果报错，尝试读取错误详情
      const errText = await response.text();
      console.warn(`📊 Umami Warning: ${response.status} - ${errText}`);
    }
  } catch (e) {
    // 统计逻辑不应干扰业务逻辑
    console.error('📊 Umami Network Error:', e);
  }
}