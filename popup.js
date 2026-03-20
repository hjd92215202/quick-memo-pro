import { db, PLUGIN_ID, ensureAuth } from './firebase-config.js';
import { collection, addDoc, serverTimestamp, query, where, getDocs, orderBy, limit, deleteDoc, doc } from './lib/firebase-firestore.js';
import { trackEvent } from './analytics.js';

const input = document.getElementById('memo-input');
const saveBtn = document.getElementById('save-btn');
const list = document.getElementById('memo-list');

/**
 * 更新字符计数器
 */
function updateCharCount() {
  const countElement = document.getElementById('char-count');
  if (countElement) {
    countElement.innerText = `${input.value.length} 字`;
  }
}

/**
 * 保存逻辑
 */
async function handleSave() {
  const content = input.value.trim();
  if (!content) return;

  try {
    saveBtn.disabled = true;
    saveBtn.innerText = "保存中...";
    
    // 确保已匿名登录并获取 UID
    const uid = await ensureAuth();
    
    // 写入 Firestore
    await addDoc(collection(db, "user_content"), {
      userId: uid,
      pluginId: PLUGIN_ID,
      type: "text",
      content: content,
      timestamp: serverTimestamp()
    });
    
    // 清空输入框并重置计数器
    input.value = '';
    updateCharCount(); 
    
    // 刷新列表并记录统计
    await loadMemos();
    trackEvent('memo_saved_popup', { length: content.length });
    
  } catch (e) {
    console.error("保存失败:", e);
    alert("保存失败，请检查网络或配置");
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerText = "保存记录";
  }
}

/**
 * 加载最近 10 条记录
 */
async function loadMemos() {
  try {
    const uid = await ensureAuth();
    
    const q = query(
      collection(db, "user_content"),
      where("userId", "==", uid),
      where("pluginId", "==", PLUGIN_ID),
      orderBy("timestamp", "desc"),
      limit(10)
    );

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
      
      // 时间处理优化：如果是刚存入还没生成服务器时间的，显示“同步中...”
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
    // 提示用户可能需要建立索引
    if (e.message.includes("index")) {
      list.innerHTML = '<li style="color:red; font-size:11px;">请右键点击弹窗选择“检查”，并在控制台点击链接建立索引。</li>';
    }
  }
}

/**
 * 导出所有记录为 Markdown
 */
async function exportToMarkdown() {
  const exportBtn = document.getElementById('export-md-btn');
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
      alert("没有记录可导出");
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
    alert("导出失败");
  } finally {
    exportBtn.innerText = "📤 导出 MD";
  }
}

// --- 事件监听 ---

// 按钮点击
saveBtn.onclick = handleSave;
document.getElementById('export-md-btn').onclick = exportToMarkdown;

// 输入框输入时更新字数
input.oninput = updateCharCount;

// 快捷键 Ctrl+Enter 保存
input.onkeydown = (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    handleSave();
  }
};

// 全局点击监听（处理列表中的复制和删除按钮）
document.addEventListener('click', async (e) => {
  // 复制功能
  if (e.target.classList.contains('copy-btn')) {
    const text = e.target.dataset.text;
    await navigator.clipboard.writeText(text);
    const oldLabel = e.target.innerText;
    e.target.innerText = '已复制';
    setTimeout(() => e.target.innerText = oldLabel, 1000);
  }

  // 删除功能
  if (e.target.classList.contains('del-btn')) {
    const docId = e.target.dataset.id;
    if (confirm('确定从云端永久删除这条记录吗？')) {
      try {
        await deleteDoc(doc(db, "user_content", docId));
        await loadMemos(); 
        trackEvent('memo_deleted');
      } catch (err) {
        console.error("删除失败", err);
        alert("删除失败，请检查权限");
      }
    }
  }
});

// 初始加载列表
loadMemos();