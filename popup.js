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
    
    const uid = await ensureAuth();
    
    await addDoc(collection(db, "user_content"), {
      userId: uid,
      pluginId: PLUGIN_ID,
      type: "text",
      content: content,
      timestamp: serverTimestamp()
    });
    
    input.value = '';
    updateCharCount(); 
    saveBtn.innerText = originalBtnText;
    
    await loadMemos(); 
    trackEvent('memo_saved_popup', { length: content.length });
    
  } catch (e) {
    console.error("保存失败:", e);
    alert("保存失败，请检查网络");
    saveBtn.innerText = "保存记录";
  } finally {
    saveBtn.disabled = false;
  }
}

/**
 * 处理两步确认删除逻辑
 * @param {HTMLElement} btn 点击的按钮元素
 */
async function handleDelete(btn) {
  const docId = btn.dataset.id;

  // 第一步：进入确认状态
  if (btn.dataset.confirm !== "true") {
    const originalText = btn.textContent;
    btn.dataset.confirm = "true";
    btn.textContent = "确定删除？";
    btn.style.color = "#dc322f"; // 变红
    btn.style.fontWeight = "bold";

    // 3秒后如果没有再次点击，恢复原状
    setTimeout(() => {
      if (btn && btn.isConnected) {
        btn.dataset.confirm = "false";
        btn.textContent = originalText;
        btn.style.color = "";
        btn.style.fontWeight = "";
      }
    }, 3000);
    return;
  }

  // 第二步：执行真正的删除逻辑
  try {
    btn.disabled = true;
    btn.textContent = "删除中...";
    await deleteDoc(doc(db, "user_content", docId));
    await loadMemos(); // 重新加载列表
    trackEvent('memo_deleted');
  } catch (err) {
    console.error("删除失败:", err);
    alert("删除失败，请重试");
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
      limit(3)
    );

    const snapshot = await getDocs(q);
    list.innerHTML = '';
    
    if (snapshot.empty) {
      list.innerHTML = '<li style="text-align:center; color:#999; font-size:12px; padding:20px;">还没有记录</li>';
      return;
    }

    snapshot.forEach(memoDoc => {
      const data = memoDoc.data();
      const li = document.createElement('li');
      li.className = 'memo-item';
      
      const contentEl = document.createElement('div');
      contentEl.className = 'memo-content';
      contentEl.textContent = data.content; 
      
      const timeStr = data.timestamp ? data.timestamp.toDate().toLocaleString() : '云端同步中...';
      const timeEl = document.createElement('span');
      timeEl.className = 'memo-time';
      timeEl.textContent = timeStr;
      
      const actionsEl = document.createElement('div');
      actionsEl.className = 'item-actions';
      actionsEl.innerHTML = `
        <button class="action-link copy-btn">复制</button>
        <button class="action-link del del-btn" data-id="${memoDoc.id}">删除</button>
      `;
      
      li.appendChild(contentEl);
      li.appendChild(timeEl);
      li.appendChild(actionsEl);
      
      // 复制事件绑定
      li.querySelector('.copy-btn').onclick = async (e) => {
        await navigator.clipboard.writeText(data.content);
        const copyBtn = e.target;
        copyBtn.textContent = '已复制';
        setTimeout(() => copyBtn.textContent = '复制', 1000);
      };

      // 删除事件绑定 (调用两步确认函数)
      li.querySelector('.del-btn').onclick = (e) => handleDelete(e.target);

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
  } finally {
    exportBtn.innerText = "📤 导出 MD";
  }
}

// --- 事件监听 ---

saveBtn.addEventListener('click', handleSave);
exportBtn.addEventListener('click', exportToMarkdown);
input.addEventListener('input', updateCharCount);

input.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    handleSave();
  }
});

// 初始加载
loadMemos();