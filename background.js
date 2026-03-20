import { API_BASE, getAuthToken } from './server-config.js';
import { trackEvent } from './analytics.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "saveAsMemo",
    title: "存入随手记: '%s'",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "saveAsMemo") {
    const selectedText = info.selectionText;
    const token = await getAuthToken();
    
    if (!token) {
      chrome.notifications.create({
        type: 'basic', iconUrl: 'icons/icon48.png',
        title: '保存失败', message: '请先打开插件点击登录'
      });
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/notes`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ content: selectedText, source_url: tab.url })
      });

      if (res.ok) {
        chrome.notifications.create({
          type: 'basic', iconUrl: 'icons/icon48.png',
          title: '已存入随手记', message: '云端同步成功'
        });
        trackEvent('memo_saved_context_menu');
      }
    } catch (e) {
      console.error(e);
    }
  }
});