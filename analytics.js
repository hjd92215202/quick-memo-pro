import { UMAMI_ID, UMAMI_URL } from './server-config.js';

/**
 * 内部统一上报函数 (确保不简化原本逻辑，增加类型支持)
 * @param {'event'|'view'} type 上报类型
 * @param {string} name 事件名或页面路径
 * @param {object} params 附加数据
 */
async function collect(type, name, params = {}) {
  try {
    // Umami v2 API 规范：外层 type 建议统一使用 "event"
    // 通过 payload 内部是否有 name 字段来区分 PageView 和 Event
    const payload = {
      type: "event", 
      payload: {
        website: UMAMI_ID,        // 网站 ID
        // 如果是 view 类型，url 使用传入的路径；如果是 event 类型，固定模拟一个上下文路径
        url: type === "view" ? name : "/extension-popup", 
        hostname: "oneday.ren",   // 重要：必须与 Umami 后台设置的域名一致
        // 【核心修复】：如果是 view 类型，name 必须传空字符串，才会增加“访客”计数
        name: type === "event" ? name : "", 
        // 只有 event 类型才发送具体的业务数据
        data: type === "event" ? params : undefined,    
        language: navigator.language || "zh-CN",
        screen: `${window.screen.width}x${window.screen.height}`,
        referrer: "https://oneday.ren/" // 模拟来源，有助于激活访客会话
      }
    };

    const response = await fetch(UMAMI_URL, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        // 指定 User-Agent 以便 Umami 解析浏览器和操作系统信息
        'User-Agent': navigator.userAgent 
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      // 优化控制台日志，方便通过图标区分
      const logType = type === 'event' ? '⚡️ Action' : '📄 PageView';
      console.log(`📊 Umami ${logType} Recorded: [${name}]`);
    } else {
      const errText = await response.text();
      console.warn(`📊 Umami Warning: ${response.status} - ${errText}`);
    }
  } catch (e) {
    console.error('📊 Umami Network Error:', e);
  }
}

/**
 * 发送事件到 Umami 统计
 * @param {string} eventName 事件名称
 * @param {object} params 附加参数 (可选)
 */
export async function trackEvent(eventName, params = {}) {
  await collect("event", eventName, params);
}

/**
 * 发送页面浏览记录 (核心修复：调用此函数将使主面板“访客”计数增加)
 * @param {string} path 模拟路径 (例如 "/popup")
 */
export async function trackView(path = "/extension-popup") {
  await collect("view", path);
}