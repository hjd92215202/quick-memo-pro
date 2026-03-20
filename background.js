import { db, PLUGIN_ID, ensureAuth } from './firebase-config.js';
import { collection, addDoc, serverTimestamp } from './lib/firebase-firestore.js';
import { trackEvent } from './analytics.js';

// 1. 插件安装时创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "saveAsMemo",
    title: "存入随手记: '%s'",
    contexts: ["selection"]
  });
});

// 2. 监听右键点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "saveAsMemo") {
    const selectedText = info.selectionText;
    if (selectedText) {
      await saveMemo(selectedText, tab.url);
    }
  }
});

// 3. 执行云端保存逻辑
async function saveMemo(content, url) {
  try {
    // 【优化】使用 Firebase Auth 确保登录并获取 UID
    const uid = await ensureAuth();
    
    // 存入统一的 user_content 集合
    await addDoc(collection(db, "user_content"), {
      userId: uid,           // Firebase 真正的 UID
      pluginId: PLUGIN_ID,     // "quick_memo"
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
    
    console.log('✅ 随手记云端保存成功');
  } catch (e) {
    console.error('❌ 保存失败:', e);
  }
}