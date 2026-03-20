import { db, PLUGIN_ID } from './firebase-config.js';
import { collection, addDoc, serverTimestamp, query, where, getDocs, orderBy, limit, deleteDoc, doc } from './lib/firebase-firestore.js';
import { trackEvent } from './analytics.js';

const input = document.getElementById('memo-input');
const saveBtn = document.getElementById('save-btn');
const list = document.getElementById('memo-list');

// 1. 获取用户 ID
async function getUserId() {
  const userInfo = await new Promise(resolve => {
    chrome.identity.getProfileUserInfo(u => resolve(u));
  });
  return userInfo.id || "anonymous";
}

// 2. 保存逻辑 (Popup 输入框)
async function handleSave() {
  const content = input.value.trim();
  if (!content) return;

  const uid = await getUserId();
  try {
    saveBtn.disabled = true;
    saveBtn.innerText = "保存中...";
    
    await addDoc(collection(db, "user_content"), {
      userId: uid,
      pluginId: PLUGIN_ID,
      type: "text",
      content: content,
      timestamp: serverTimestamp()
    });
    
    input.value = '';
    updateCharCount();
    loadMemos(); // 刷新最近列表
    trackEvent('memo_saved_popup', { length: content.length });
  } catch (e) {
    console.error("保存失败:", e);
    alert("保存失败，请检查网络");
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerText = "保存记录";
  }
}

// 3. 加载最近记录列表 (显示最近 10 条)
async function loadMemos() {
  const uid = await getUserId();
  const q = query(
    collection(db, "user_content"),
    where("userId", "==", uid),
    where("pluginId", "==", PLUGIN_ID),
    orderBy("timestamp", "desc"),
    limit(10)
  );

  try {
    const snapshot = await getDocs(q);
    list.innerHTML = '';
    
    if (snapshot.empty) {
      list.innerHTML = '<li style="text-align:center; color:#999; font-size:12px; padding:20px;">暂无记录</li>';
      return;
    }

    snapshot.forEach(memoDoc => {
      const data = memoDoc.data();
      const li = document.createElement('li');
      li.className = 'memo-item';
      
      // 时间处理（防止云端未同步完导致报错）
      const timeStr = data.timestamp ? data.timestamp.toDate().toLocaleString() : '同步中...';
      
      li.innerHTML = `
        <div class="memo-content">${data.content}</div>
        <span class="memo-time">${timeStr}</span>
        <div class="item-actions">
          <button class="action-link copy-btn" data-text="${data.content}">复制</button>
          <button class="action-link del del-btn" data-id="${memoDoc.id}">删除</button>
        </div>
      `;
      list.appendChild(li);
    });
  } catch (e) {
    console.error("加载列表失败:", e);
  }
}

// 4. 导出 Markdown 功能
async function exportToMarkdown() {
  const exportBtn = document.getElementById('export-md-btn');
  const uid = await getUserId();
  
  try {
    exportBtn.innerText = "生成中...";
    const q = query(
      collection(db, "user_content"),
      where("userId", "==", uid),
      where("pluginId", "==", PLUGIN_ID),
      orderBy("timestamp", "asc")
    );

    const snapshot = await getDocs(q);
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
  } finally {
    exportBtn.innerText = "📤 导出 MD";
  }
}

// 5. 事件监听绑定
saveBtn.onclick = handleSave;
document.getElementById('export-md-btn').onclick = exportToMarkdown;

// 字数统计与快捷键
input.oninput = updateCharCount;
function updateCharCount() {
  document.getElementById('char-count').innerText = `${input.value.length} 字`;
}

input.onkeydown = (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    handleSave();
  }
};

// 全局点击监听（处理复制和删除按钮）
document.addEventListener('click', async (e) => {
  // 处理复制
  if (e.target.classList.contains('copy-btn')) {
    const text = e.target.dataset.text;
    await navigator.clipboard.writeText(text);
    const oldText = e.target.innerText;
    e.target.innerText = '已复制';
    setTimeout(() => e.target.innerText = oldText, 1000);
  }

  // 处理删除
  if (e.target.classList.contains('del-btn')) {
    const docId = e.target.dataset.id;
    if (confirm('确定从云端永久删除这条记录吗？')) {
      try {
        await deleteDoc(doc(db, "user_content", docId));
        loadMemos(); // 刷新
        trackEvent('memo_deleted');
      } catch (err) {
        console.error("删除失败", err);
      }
    }
  }
});

// 初始加载列表
loadMemos();