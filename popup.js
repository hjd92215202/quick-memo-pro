import { db, PLUGIN_ID, ensureAuth } from './firebase-config.js';
import { collection, addDoc, serverTimestamp, query, where, getDocs, orderBy, limit, deleteDoc, doc } from './lib/firebase-firestore.js';
import { trackEvent } from './analytics.js';

// DOM 元素引用
const input = document.getElementById('memo-input');
const saveBtn = document.getElementById('save-btn');
const list = document.getElementById('memo-list');
const charCount = document.getElementById('char-count');
const exportBtn = document.getElementById('export-md-btn');

/**
 * 更新字符计数器
 */
function updateCharCount() {
  if (charCount) {
    charCount.textContent = `${input.value.length} 字`;
  }
}

/**
 * 安全地保存随手记
 */
async function handleSave() {
  const content = input.value.trim();
  if (!content) return;

  try {
    saveBtn.disabled = true;
    const originalBtnText = saveBtn.innerText;
    saveBtn.innerText = "同步中...";
    
    // 1. 获取通过 Firebase Auth 验证的 UID
    const uid = await ensureAuth();
    
    // 2. 写入云端
    await addDoc(collection(db, "user_content"), {
      userId: uid,
      pluginId: PLUGIN_ID,
      type: "text",
      content: content,
      timestamp: serverTimestamp() // 服务器时间
    });
    
    // 3. UI 清理与反馈
    input.value = '';
    updateCharCount(); 
    saveBtn.innerText = originalBtnText;
    
    await loadMemos(); // 刷新预览列表
    trackEvent('memo_saved_popup', { length: content.length });
    
  } catch (e) {
    console.error("保存失败:", e);
    alert("保存失败，请检查网络或控制台报错");
    saveBtn.innerText = "保存记录";
  } finally {
    saveBtn.disabled = false;
  }
}

/**
 * 加载最近记录 (安全渲染版)
 */
async function loadMemos() {
  try {
    const uid = await ensureAuth();
    
    const q = query(
      collection(db, "user_content"),
      where("userId", "==", uid),
      where("pluginId", "==", PLUGIN_ID),
      orderBy("timestamp", "desc"),
      limit(3) // 只显示最近 3 条
    );

    const snapshot = await getDocs(q);
    list.innerHTML = ''; // 清空列表
    
    if (snapshot.empty) {
      list.innerHTML = '<li style="text-align:center; color:#999; font-size:12px; padding:20px;">还没有记录，开始写第一条吧！</li>';
      return;
    }

    snapshot.forEach(memoDoc => {
      const data = memoDoc.data();
      const li = document.createElement('li');
      li.className = 'memo-item';
      
      // 1. 创建内容容器（使用 textContent 预防 XSS）
      const contentEl = document.createElement('div');
      contentEl.className = 'memo-content';
      contentEl.textContent = data.content; 
      
      // 2. 处理时间戳
      const timeStr = data.timestamp ? data.timestamp.toDate().toLocaleString() : '云端同步中...';
      const timeEl = document.createElement('span');
      timeEl.className = 'memo-time';
      timeEl.textContent = timeStr;
      
      // 3. 创建操作按钮栏
      const actionsEl = document.createElement('div');
      actionsEl.className = 'item-actions';
      actionsEl.innerHTML = `
        <button class="action-link copy-btn">复制</button>
        <button class="action-link del del-btn" data-id="${memoDoc.id}">删除</button>
      `;
      
      // 4. 组装元素
      li.appendChild(contentEl);
      li.appendChild(timeEl);
      li.appendChild(actionsEl);
      
      // 绑定“复制”点击事件（闭包处理，避免 data-attribute 泄露内容）
      li.querySelector('.copy-btn').onclick = async (e) => {
        await navigator.clipboard.writeText(data.content);
        const btn = e.target;
        btn.textContent = '已复制';
        setTimeout(() => btn.textContent = '复制', 1000);
      };

      list.appendChild(li);
    });
  } catch (e) {
    console.error("加载失败:", e);
    if (e.message.includes("index")) {
      list.innerHTML = '<li style="color:#dc322f; font-size:11px; padding:10px;">需建立索引，请右键“检查”查看控制台链接</li>';
    }
  }
}

/**
 * 导出 Markdown
 */
async function exportToMarkdown() {
  try {
    exportBtn.innerText = "生成中...";
    const uid = await ensureAuth();
    
    const q = query(
      collection(db, "user_content"),
      where("userId", "==", uid),
      where("pluginId", "==", PLUGIN_ID),
      orderBy("timestamp", "asc")
    );

    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      alert("没有可导出的数据");
      return;
    }

    let md = `# 我的随手记合集\n\n> 导出时间：${new Date().toLocaleString()}\n\n---\n\n`;

    snapshot.forEach(doc => {
      const data = doc.data();
      const time = data.timestamp ? data.timestamp.toDate().toLocaleString() : '未知时间';
      md += `### 📅 ${time}\n\n${data.content}\n\n`;
      if (data.source) md += `*来源: [查看原网页](${data.source})*\n`;
      md += `\n---\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `My_Memos_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    
    trackEvent('export_md_success');
  } catch (e) {
    console.error("导出失败:", e);
    alert("导出失败，请检查网络连接");
  } finally {
    exportBtn.innerText = "📤 导出 MD";
  }
}

// --- 事件绑定 ---

// 保存按钮
saveBtn.addEventListener('click', handleSave);

// 导出按钮
exportBtn.addEventListener('click', exportToMarkdown);

// 输入框动态计数
input.addEventListener('input', updateCharCount);

// 快捷键支持 (Ctrl/Cmd + Enter)
input.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    handleSave();
  }
});

// 处理全局点击（针对动态生成的删除按钮）
document.addEventListener('click', async (e) => {
  if (e.target.classList.contains('del-btn')) {
    const docId = e.target.dataset.id;
    if (confirm('确定要从云端删除这条灵感吗？')) {
      try {
        await deleteDoc(doc(db, "user_content", docId));
        await loadMemos(); // 重新加载
        trackEvent('memo_deleted');
      } catch (err) {
        console.error("删除失败:", err);
      }
    }
  }
});

// 首次打开自动加载
loadMemos();