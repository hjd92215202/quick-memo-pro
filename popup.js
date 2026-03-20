import { API_BASE, getAuthToken, setAuthToken, logout } from './server-config.js';
import { trackEvent } from './analytics.js';

// --- DOM 元素引用 ---
const views = {
  login: document.getElementById('login-view'),
  app: document.getElementById('app-view')
};

const els = {
  // 登录相关
  email: document.getElementById('email-input'),
  code: document.getElementById('code-input'),
  sendBtn: document.getElementById('send-code-btn'),
  loginBtn: document.getElementById('login-btn'),
  otpGroup: document.getElementById('otp-group'),
  // 主界面相关
  userEmail: document.getElementById('user-email'),
  input: document.getElementById('memo-input'),
  saveBtn: document.getElementById('save-btn'),
  list: document.getElementById('memo-list'),
  charCount: document.getElementById('char-count'),
  exportBtn: document.getElementById('export-md-btn'),
  logoutBtn: document.getElementById('logout-link')
};

/**
 * 初始化界面：检查登录状态并切换视图
 */
async function initView() {
  const token = await getAuthToken();
  if (token) {
    views.login.style.display = 'none';
    views.app.style.display = 'block';
    
    // 显示用户邮箱
    const res = await chrome.storage.local.get('user_email');
    if (res.user_email) els.userEmail.innerText = res.user_email;
    
    loadMemos();
  } else {
    views.login.style.display = 'block';
    views.app.style.display = 'none';
  }
}

/**
 * 验证码获取逻辑
 */
els.sendBtn.onclick = async () => {
  const email = els.email.value.trim();
  if (!email || !email.includes('@')) return alert("请输入有效的邮箱地址");

  els.sendBtn.disabled = true;
  els.sendBtn.innerText = "发送中...";

  try {
    const res = await fetch(`${API_BASE}/auth/send-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();

    if (res.ok) {
      els.otpGroup.style.display = 'block';
      els.loginBtn.style.display = 'inline-block';
      startCountdown(60);
    } else {
      alert(data.error || "验证码发送失败");
      els.sendBtn.disabled = false;
      els.sendBtn.innerText = "获取验证码";
    }
  } catch (e) {
    alert("网络连接失败，请检查后端服务");
    els.sendBtn.disabled = false;
    els.sendBtn.innerText = "获取验证码";
  }
};

/**
 * 验证码倒计时
 */
function startCountdown(s) {
  let count = s;
  const timer = setInterval(() => {
    count--;
    els.sendBtn.innerText = `重发 (${count}s)`;
    if (count <= 0) {
      clearInterval(timer);
      els.sendBtn.disabled = false;
      els.sendBtn.innerText = "获取验证码";
    }
  }, 1000);
}

/**
 * 登录逻辑
 */
els.loginBtn.onclick = async () => {
  const email = els.email.value.trim();
  const code = els.code.value.trim();
  if (code.length < 6) return alert("请输入6位验证码");

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code })
    });
    const data = await res.json();

    if (res.ok) {
      await setAuthToken(data.token);
      await chrome.storage.local.set({ 'user_email': email });
      initView();
      trackEvent('login_success');
    } else {
      alert(data.error || "验证失败");
    }
  } catch (e) {
    alert("登录请求失败");
  }
};

/**
 * 保存随手记
 */
async function handleSave() {
  const content = els.input.value.trim();
  if (!content) return;
  if (content.length > 20000) return alert("超出2万字限制，请精简内容");

  const token = await getAuthToken();
  els.saveBtn.disabled = true;
  const originalText = els.saveBtn.innerText;
  els.saveBtn.innerText = "同步中...";

  try {
    const res = await fetch(`${API_BASE}/notes`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ content, source_url: "" })
    });

    if (res.ok) {
      els.input.value = '';
      updateCharCount();
      await loadMemos();
      trackEvent('memo_saved_popup');
    } else {
      const data = await res.json();
      if (res.status === 401) return handleLogout();
      alert(data.error || "同步失败");
    }
  } catch (e) {
    alert("同步失败，请检查服务器连接");
  } finally {
    els.saveBtn.disabled = false;
    els.saveBtn.innerText = originalText;
  }
}

/**
 * 加载最近记录
 */
async function loadMemos() {
  const token = await getAuthToken();
  try {
    const res = await fetch(`${API_BASE}/notes`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.status === 401) return handleLogout();
    
    const data = await res.json();
    renderList(data);
  } catch (e) {
    els.list.innerHTML = '<li style="text-align:center; color:#dc322f; font-size:11px; padding:10px;">无法连接到云端</li>';
  }
}

/**
 * 渲染记录列表
 */
function renderList(memos) {
  els.list.innerHTML = '';
  if (memos.length === 0) {
    els.list.innerHTML = '<li style="text-align:center; color:#999; font-size:12px; padding:20px;">还没有记录</li>';
    return;
  }

  memos.forEach(memo => {
    const li = document.createElement('li');
    li.className = 'memo-item';
    li.innerHTML = `
      <div class="memo-content"></div>
      <span class="memo-time">${new Date(memo.created_at).toLocaleString()}</span>
      <div class="item-actions">
        <button class="action-link copy-btn">复制</button>
        <button class="action-link del-btn" data-id="${memo.id}">删除</button>
      </div>
    `;
    
    // 使用 textContent 防止 XSS 攻击
    li.querySelector('.memo-content').textContent = memo.content;

    // 复制功能
    li.querySelector('.copy-btn').onclick = async () => {
      await navigator.clipboard.writeText(memo.content);
      const btn = li.querySelector('.copy-btn');
      btn.innerText = "已复制";
      setTimeout(() => btn.innerText = "复制", 1000);
    };

    // 两步确认删除逻辑
    const delBtn = li.querySelector('.del-btn');
    delBtn.onclick = async () => {
      if (delBtn.dataset.confirm === "true") {
        delBtn.disabled = true;
        delBtn.innerText = "...";
        await executeDelete(memo.id);
      } else {
        delBtn.dataset.confirm = "true";
        delBtn.innerText = "确定？";
        delBtn.style.color = "#dc322f";
        delBtn.style.fontWeight = "bold";
        setTimeout(() => {
          if (delBtn) {
            delBtn.dataset.confirm = "false";
            delBtn.innerText = "删除";
            delBtn.style.color = "";
            delBtn.style.fontWeight = "";
          }
        }, 3000);
      }
    };
    els.list.appendChild(li);
  });
}

/**
 * 执行删除请求
 */
async function executeDelete(id) {
  const token = await getAuthToken();
  try {
    const res = await fetch(`${API_BASE}/notes/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      await loadMemos();
      trackEvent('memo_deleted');
    }
  } catch (e) {
    alert("删除请求失败");
  }
}

/**
 * 导出 Markdown 逻辑
 */
els.exportBtn.onclick = async () => {
  els.exportBtn.innerText = "导出中...";
  const token = await getAuthToken();
  try {
    // 重新获取全部记录（不带 Limit）
    const res = await fetch(`${API_BASE}/notes`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const memos = await res.json();
    
    if (!memos || memos.length === 0) return alert("没有记录可导出");

    let md = `# 我的随手记合集\n\n> 导出时间：${new Date().toLocaleString()}\n\n---\n\n`;
    memos.forEach(m => {
      md += `### 📅 ${new Date(m.created_at).toLocaleString()}\n\n${m.content}\n\n`;
      if (m.source_url) md += `*来源: ${m.source_url}*\n`;
      md += `\n---\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Memo_Export_${new Date().toISOString().slice(0,10)}.md`;
    a.click();
    trackEvent('export_success');
  } catch (e) {
    alert("生成文件失败");
  } finally {
    els.exportBtn.innerText = "📤 导出 MD";
  }
};

/**
 * 退出登录逻辑
 */
function handleLogout() {
  logout();
  chrome.storage.local.remove(['user_email', 'auth_token'], () => {
    initView();
  });
}

/**
 * 更新字符计数
 */
function updateCharCount() {
  const len = els.input.value.length;
  els.charCount.textContent = `${len} 字 / 2万字`;
  els.charCount.style.color = len > 20000 ? "#dc322f" : "#999";
}

// --- 事件监听绑定 ---

// 按钮点击
els.saveBtn.onclick = handleSave;
els.logoutBtn.onclick = handleLogout;

// 输入监听
els.input.oninput = updateCharCount;

// 快捷键支持：Ctrl/Cmd + Enter 保存
els.input.onkeydown = (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    handleSave();
  }
};

// 启动初始化
initView();