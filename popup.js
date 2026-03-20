import { API_BASE, getAuthToken, setAuthToken, logout } from './server-config.js';
import { trackEvent } from './analytics.js';

// --- 全局交互状态 ---
let memoToUnlock = null; // 存储当前尝试解锁的笔记记录

// --- DOM 元素引用 ---
const views = {
  login: document.getElementById('login-view'),
  app: document.getElementById('app-view')
};

const els = {
  // 提示容器
  toastContainer: document.getElementById('toast-container'),
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
  logoutBtn: document.getElementById('logout-link'),
  // 安全与加锁相关
  lockCheck: document.getElementById('lock-checkbox'), 
  resetPwdBtn: document.getElementById('reset-pwd-link'),
  // 密码设置弹窗
  setupModal: document.getElementById('password-setup-modal'),
  setupCode: document.getElementById('setup-code-input'),
  setupPwd: document.getElementById('setup-pwd-input'),
  savePwdBtn: document.getElementById('save-pwd-btn'),
  getSetupCodeBtn: document.getElementById('get-setup-code-btn'),
  closeSetupBtn: document.getElementById('close-setup-btn'),
  // 验证主密码弹窗 (替代 prompt)
  verifyModal: document.getElementById('password-verify-modal'),
  verifyInput: document.getElementById('verify-pwd-input'),
  confirmVerifyBtn: document.getElementById('confirm-verify-btn'),
  closeVerifyBtn: document.getElementById('close-verify-btn')
};

/**
 * 提示系统：代替原生 alert
 */
function showToast(msg, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = msg;
    els.toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 400);
    }, 2500);
}

/**
 * 初始化界面：检查登录状态并切换视图
 */
async function initView() {
  const token = await getAuthToken();
  if (token) {
    views.login.style.display = 'none';
    views.app.style.display = 'block';
    
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
  if (!email || !email.includes('@')) return showToast("请输入有效的邮箱地址", "error");

  els.sendBtn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/auth/send-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();

    if (res.ok) {
      showToast("验证码已发送", "success");
      els.otpGroup.style.display = 'block';
      els.loginBtn.style.display = 'inline-block';
      startCountdown(60, els.sendBtn);
    } else {
      showToast(data.error || "验证码发送失败", "error");
      els.sendBtn.disabled = false;
    }
  } catch (e) {
    showToast("无法连接服务器", "error");
    els.sendBtn.disabled = false;
  }
};

/**
 * 通用验证码倒计时
 */
function startCountdown(s, btn) {
  let count = s;
  const originalText = btn.innerText;
  const timer = setInterval(() => {
    count--;
    btn.innerText = `重发 (${count}s)`;
    btn.disabled = true;
    if (count <= 0) {
      clearInterval(timer);
      btn.disabled = false;
      btn.innerText = originalText;
    }
  }, 1000);
}

/**
 * 登录逻辑
 */
els.loginBtn.onclick = async () => {
  const email = els.email.value.trim();
  const code = els.code.value.trim();
  if (code.length < 6) return showToast("请输入6位验证码", "error");

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
      showToast("欢迎回来", "success");
      trackEvent('login_success');
    } else {
      showToast(data.error || "验证失败", "error");
    }
  } catch (e) {
    showToast("登录请求失败", "error");
  }
};

/**
 * 保存随手记 (支持加锁状态)
 */
async function handleSave() {
  const content = els.input.value.trim();
  if (!content) return;
  if (content.length > 20000) return showToast("超出2万字限制", "error");

  const token = await getAuthToken();
  const is_locked = els.lockCheck ? els.lockCheck.checked : false;

  els.saveBtn.disabled = true;
  els.saveBtn.innerText = "同步中...";

  try {
    const res = await fetch(`${API_BASE}/notes`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ content, is_locked, source_url: "" })
    });

    if (res.ok) {
      els.input.value = '';
      if (els.lockCheck) els.lockCheck.checked = false;
      updateCharCount();
      await loadMemos();
      showToast("已安全保存", "success");
      trackEvent('memo_saved_popup', { locked: is_locked });
    } else {
      const data = await res.json();
      if (res.status === 401) return handleLogout();
      showToast(data.error || "同步失败", "error");
    }
  } catch (e) {
    showToast("网络连接异常", "error");
  } finally {
    els.saveBtn.disabled = false;
    els.saveBtn.innerText = "保存记录";
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
 * 渲染记录列表 (处理锁定显示)
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
    const isLocked = memo.is_locked;

    li.innerHTML = `
      <div class="memo-content ${isLocked ? 'is-locked' : ''}" id="content-${memo.id}">
        ${isLocked ? '🔒 该记录已加锁，点击解锁查看' : ''}
      </div>
      <span class="memo-time">${new Date(memo.created_at).toLocaleString()}</span>
      <div class="item-actions">
        ${isLocked ? `<button class="action-link unlock-btn" data-id="${memo.id}">解锁</button>` : ''}
        <button class="action-link copy-btn">复制</button>
        <button class="action-link del-btn" data-id="${memo.id}">删除</button>
      </div>
    `;
    
    if (!isLocked) li.querySelector('.memo-content').textContent = memo.content;

    // 绑定解锁按钮
    if (isLocked) {
      li.querySelector('.unlock-btn').onclick = () => {
        memoToUnlock = memo;
        els.verifyModal.style.display = 'flex';
        els.verifyInput.value = '';
        els.verifyInput.focus();
      };
    }

    // 复制功能
    li.querySelector('.copy-btn').onclick = async () => {
      const contentEl = document.getElementById(`content-${memo.id}`);
      if (memo.is_locked && !contentEl.dataset.unlocked) return showToast("请先解锁内容", "error");
      
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
 * 解锁主密码逻辑 (Modal 确认)
 */
els.confirmVerifyBtn.onclick = async () => {
  const pwd = els.verifyInput.value;
  if (!pwd) return;

  const token = await getAuthToken();
  try {
    const res = await fetch(`${API_BASE}/notes/verify-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ password: pwd })
    });

    if (res.ok) {
      const contentEl = document.getElementById(`content-${memoToUnlock.id}`);
      contentEl.textContent = memoToUnlock.content;
      contentEl.classList.remove('is-locked');
      contentEl.dataset.unlocked = "true";
      els.verifyModal.style.display = 'none';
      showToast("已解锁", "success");
      trackEvent('memo_unlocked');
    } else {
      showToast("密码错误", "error");
    }
  } catch (e) {
    showToast("验证失败", "error");
  }
};

els.closeVerifyBtn.onclick = () => { els.verifyModal.style.display = 'none'; };

/**
 * 主密码管理逻辑
 */
if (els.resetPwdBtn) {
    els.resetPwdBtn.onclick = () => { els.setupModal.style.display = 'flex'; };
}

if (els.closeSetupBtn) {
    els.closeSetupBtn.onclick = () => { els.setupModal.style.display = 'none'; };
}

els.getSetupCodeBtn.onclick = async () => {
    const resData = await chrome.storage.local.get('user_email');
    const res = await fetch(`${API_BASE}/auth/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resData.user_email })
    });
    if (res.ok) {
        showToast("验证码已发送", "success");
        startCountdown(60, els.getSetupCodeBtn);
    }
};

els.savePwdBtn.onclick = async () => {
    const code = els.setupCode.value.trim();
    const newPassword = els.setupPwd.value.trim();
    const resData = await chrome.storage.local.get('user_email');
    
    if (newPassword.length < 4) return showToast("密码至少4位", "error");
    if (!code) return showToast("请输入验证码", "error");

    const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resData.user_email, code, newPassword })
    });

    if (res.ok) {
        showToast("主密码更新成功", "success");
        els.setupModal.style.display = 'none';
        els.setupCode.value = '';
        els.setupPwd.value = '';
    } else {
        const d = await res.json();
        showToast(d.error || "操作失败", "error");
    }
};

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
      showToast("已删除记录");
      trackEvent('memo_deleted');
    }
  } catch (e) {
    showToast("删除请求失败", "error");
  }
}

/**
 * 导出 Markdown 逻辑
 */
els.exportBtn.onclick = async () => {
  els.exportBtn.innerText = "生成中...";
  const token = await getAuthToken();
  try {
    const res = await fetch(`${API_BASE}/notes`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const memos = await res.json();
    
    if (!memos || memos.length === 0) return showToast("无记录可导出");

    let md = `# 我的随手记合集\n\n> 导出时间：${new Date().toLocaleString()}\n\n---\n\n`;
    memos.forEach(m => {
      const content = m.is_locked ? "[🔒 敏感记录 - 已加密]" : m.content;
      md += `### 📅 ${new Date(m.created_at).toLocaleString()}\n\n${content}\n\n`;
      if (m.source_url) md += `*来源: ${m.source_url}*\n`;
      md += `\n---\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Memo_Backup_${new Date().toISOString().slice(0,10)}.md`;
    a.click();
    showToast("导出成功", "success");
    trackEvent('export_success');
  } catch (e) {
    showToast("生成文件失败", "error");
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
    showToast("已退出登录");
  });
}

/**
 * 更新字符计数
 */
function updateCharCount() {
  const len = els.input.value.length;
  els.charCount.textContent = `${len} 字 / 2万字`;
  els.charCount.style.color = len > 20000 ? "var(--danger)" : "var(--text-dim)";
}

// --- 事件监听绑定 ---

els.saveBtn.onclick = handleSave;
els.logoutBtn.onclick = handleLogout;
els.input.oninput = updateCharCount;
els.input.onkeydown = (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSave();
};

// 启动初始化
initView();