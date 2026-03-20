import { db, PLUGIN_ID } from './firebase-config.js';
import { collection, addDoc, serverTimestamp } from './lib/firebase-firestore.js';
import { trackEvent } from './analytics.js';

// 1. 获取用户唯一 ID (封装为 Promise)
function getUserId() {
  return new Promise((resolve) => {
    chrome.identity.getProfileUserInfo((userInfo) => {
      resolve(userInfo.id || "anonymous");
    });
  });
}

// 2. 创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "saveAsMemo",
    title: "存入随手记: '%s'",
    contexts: ["selection"]
  });
});

// 3. 监听右键点击事件
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "saveAsMemo") {
    const selectedText = info.selectionText;
    if (selectedText) {
      await saveMemo(selectedText, tab.url);
    }
  }
});

// 4. 执行保存逻辑
async function saveMemo(content, url) {
  try {
    const userId = await getUserId();
    
    // 存入统一的 user_content 集合
    await addDoc(collection(db, "user_content"), {
      userId: userId,
      pluginId: PLUGIN_ID, // "quick_memo"
      type: "text",
      content: content,
      source: url,
      timestamp: serverTimestamp()
    });
    
    // 发送桌面通知
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: '随手记：已保存',
      message: content.length > 40 ? content.substring(0, 40) + '...' : content
    });

    // GA4 统计
    trackEvent('memo_saved_context_menu', { length: content.length });
    
    console.log('✅ 随手记保存成功');
  } catch (e) {
    console.error('❌ 保存失败:', e);
  }
}