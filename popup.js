import { API_BASE, getAuthToken, setAuthToken, logout } from './server-config.js';
import { trackEvent } from './analytics.js';

// --- 全局交互状态 ---
let memoToUnlock = null; // 存储当前正在尝试解锁的记录对象

// --- DOM 元素引用 (统一管理，确保不出现 undefined) ---
const els = {
  // 提示与全局容器
  toastContainer: document.getElementById('toast-container'),
  loginView: document.getElementById('login-view'),
  appView: document.getElementById('app-view'),
  // 登录界面元素
  email: document.getElementById('email-input'),
  code: document.getElementById('code-input'),
  sendBtn: document.getElementById('send-code-btn'),
  loginBtn: document.getElementById('login-btn'),
  otpGroup: document.getElementById('otp-group'),
  // 主应用界面元素
  userEmail: document.getElementById('user-email'),
  titleInput: document.getElementById('memo-title'),
  input: document.getElementById('memo-input'),
  saveBtn: document.getElementById('save-btn'),
  list: document.getElementById('memo-list'),
  charCount: document.getElementById('char-count'),
  lockCheck: document.getElementById('lock-checkbox'),
  exportBtn: document.getElementById('export-md-btn'),
  logoutBtn: document.getElementById('logout-link'),
  resetPwdBtn: document.getElementById('reset-pwd-link'),
  // 主密码设置弹窗 (Setup Modal)
  setupModal: document.getElementById('password-setup-modal'),
  setupCodeInput: document.getElementById('setup-code-input'),
  setupPwdInput: document.getElementById('setup-pwd-input'),
  savePwdBtn: document.getElementById('save-pwd-btn'),
  getSetupCodeBtn: document.getElementById('get-setup-code-btn'),
  closeSetupBtn: document.getElementById('close-setup-btn'),
  // 验证主密码弹窗 (Verify Modal)
  verifyModal: document.getElementById('password-verify-modal'),
  verifyInput: document.getElementById('verify-pwd-input'),
  confirmVerifyBtn: document.getElementById('confirm-verify-btn'),
  closeVerifyBtn: document.getElementById('close-verify-btn')
};

/**
 * 自定义提示系统 (替代原生 alert)
 */
function showToast(msg, type = 'info') {
    if (!els.toastContainer) return;
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
 * 修复了变量引用不一致导致的 style 报错问题
 */
async function initView() {
  // 统计页面访问
  trackEvent('view_popup');
  
  const token = await getAuthToken();
  
  // 防御性检查
  if (!els.loginView || !els.appView) return;

  if (token) {
    els.loginView.style.display = 'none';
    els.appView.style.display = 'block';
    
    // 加载并显示用户邮箱
    const res = await chrome.storage.local.get('user_email');
    if (res.user_email && els.userEmail) els.userEmail.innerText = res.user_email;
    
    loadMemos();
  } else {
    els.loginView.style.display = 'block';
    els.appView.style.display = 'none';
  }
}

// --- 身份验证逻辑 ---

els.sendBtn.onclick = async () => {
  const email = els.email.value.trim();
  if (!email || !email.includes('@')) return showToast("请输入有效的邮箱地址", "error");

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
      showToast("验证码已发往邮箱", "success");
      els.otpGroup.style.display = 'block';
      els.loginBtn.style.display = 'block';
      els.sendBtn.style.display = 'none';
      startCountdown(60, els.sendBtn); 
    } else {
      showToast(data.error || "验证码发送失败", "error");
      els.sendBtn.disabled = false;
      els.sendBtn.innerText = "获取验证码";
    }
  } catch (e) {
    showToast("无法连接服务器", "error");
    els.sendBtn.disabled = false;
  }
};

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
      showToast("登录成功", "success");
      trackEvent('login_success');
    } else {
      showToast(data.error || "验证码错误", "error");
    }
  } catch (e) { showToast("登录失败", "error"); }
};

// --- 随手记核心业务逻辑 ---

async function handleSave() {
  const title = els.titleInput.value.trim();
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
      body: JSON.stringify({ 
        title: title || '未命名记录', 
        content, 
        is_locked, 
        source_url: "" 
      })
    });

    if (res.ok) {
      els.input.value = '';
      els.titleInput.value = '';
      if (els.lockCheck) els.lockCheck.checked = false;
      updateCharCount();
      await loadMemos();
      showToast("已安全保存", "success");
      trackEvent('memo_saved', { locked: is_locked });
    } else {
      const data = await res.json();
      if (res.status === 401) return handleLogout();
      showToast(data.error || "保存失败", "error");
    }
  } catch (e) { showToast("连接云端异常", "error"); }
  finally {
    els.saveBtn.disabled = false;
    els.saveBtn.innerText = "保存记录";
  }
}

async function loadMemos() {
  const token = await getAuthToken();
  try {
    const res = await fetch(`${API_BASE}/notes`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.status === 401) return handleLogout();
    const data = await res.json();
    renderList(data);
  } catch (e) { showToast("加载记录失败", "error"); }
}

function renderList(memos) {
  els.list.innerHTML = '';
  if (!memos || memos.length === 0) {
    els.list.innerHTML = '<li style="text-align:center; color:#999; font-size:12px; padding:20px;">记录本是空的</li>';
    return;
  }

  memos.forEach(memo => {
    const li = document.createElement('li');
    li.className = 'memo-item';
    const isLocked = memo.is_locked;

    li.innerHTML = `
      <div class="memo-title-display"></div>
      <div class="memo-content ${isLocked ? 'is-locked' : ''}" id="txt-${memo.id}">
        ${isLocked ? '🔒 该记录已加锁，解锁后可查看' : ''}
      </div>
      <span class="memo-time">${new Date(memo.created_at).toLocaleString()}</span>
      <div class="item-actions">
        ${isLocked ? `<button class="action-link unlock-btn">解锁</button>` : ''}
        <button class="action-link copy-btn">复制</button>
        <button class="action-link del-btn" data-id="${memo.id}">删除</button>
      </div>
    `;
    
    // 安全填充数据
    li.querySelector('.memo-title-display').textContent = memo.title || '未命名记录';
    if (!isLocked) {
        li.querySelector('.memo-content').textContent = memo.content;
    } else {
        // 绑定自定义 Modal 解锁事件
        li.querySelector('.unlock-btn').onclick = () => {
            memoToUnlock = memo;
            els.verifyModal.style.display = 'flex';
            els.verifyInput.value = '';
            els.verifyInput.focus();
        };
    }

    // 复制功能 (带解密校验)
    li.querySelector('.copy-btn').onclick = async () => {
      const contentEl = document.getElementById(`txt-${memo.id}`);
      if (memo.is_locked && !contentEl.dataset.unlocked) return showToast("敏感内容请先解锁", "error");
      
      await navigator.clipboard.writeText(contentEl.textContent);
      showToast("内容已复制", "success");
    };

    // 二步确认删除逻辑
    const delBtn = li.querySelector('.del-btn');
    delBtn.onclick = () => {
      if (delBtn.dataset.confirm === "true") {
        executeDelete(memo.id, delBtn);
      } else {
        delBtn.dataset.confirm = "true";
        delBtn.innerText = "确定？";
        delBtn.style.color = "var(--danger)";
        delBtn.style.fontWeight = "bold";
        setTimeout(() => { 
          if (delBtn) { delBtn.dataset.confirm = "false"; delBtn.innerText = "删除"; delBtn.style.color = ""; delBtn.style.fontWeight = ""; } 
        }, 3000);
      }
    };
    els.list.appendChild(li);
  });
}

// --- 密码管理交互 (Modal) ---

// 1. 提交主密码进行解密
els.confirmVerifyBtn.onclick = async () => {
    const password = els.verifyInput.value;
    if (!password) return;

    const token = await getAuthToken();
    try {
        const res = await fetch(`${API_BASE}/notes/${memoToUnlock.id}/unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ password })
        });
        const data = await res.json();

        if (res.ok) {
            const el = document.getElementById(`txt-${memoToUnlock.id}`);
            el.textContent = data.content; // 接收后端传回的真实明文
            el.classList.remove('is-locked');
            el.dataset.unlocked = "true"; // 标记为已解锁，允许复制
            els.verifyModal.style.display = 'none';
            showToast("解密成功", "success");
            trackEvent('memo_unlocked');
        } else {
            showToast(data.error || "主密码错误", "error");
        }
    } catch (e) { showToast("解密异常", "error"); }
};

// 2. 主密码重置/设置流程
els.resetPwdBtn.onclick = () => { els.setupModal.style.display = 'flex'; };
els.closeSetupBtn.onclick = () => { els.setupModal.style.display = 'none'; };
els.closeVerifyBtn.onclick = () => { els.verifyModal.style.display = 'none'; };

els.getSetupCodeBtn.onclick = async () => {
    const resData = await chrome.storage.local.get('user_email');
    els.getSetupCodeBtn.disabled = true;
    try {
        const res = await fetch(`${API_BASE}/auth/send-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: resData.user_email })
        });
        if (res.ok) {
            showToast("验证码已发送至邮箱", "success");
            startCountdown(60, els.getSetupCodeBtn);
        } else { els.getSetupCodeBtn.disabled = false; }
    } catch (e) { els.getSetupCodeBtn.disabled = false; }
};

els.savePwdBtn.onclick = async () => {
    const code = els.setupCodeInput.value.trim();
    const newPassword = els.setupPwdInput.value.trim();
    const resData = await chrome.storage.local.get('user_email');
    
    if (newPassword.length < 4) return showToast("密码至少4位以上", "error");
    if (!code) return showToast("请输入验证码", "error");

    try {
        const res = await fetch(`${API_BASE}/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: resData.user_email, code, newPassword })
        });
        if (res.ok) {
            showToast("主密码更新成功！", "success");
            els.setupModal.style.display = 'none';
            els.setupCodeInput.value = '';
            els.setupPwdInput.value = '';
            trackEvent('master_password_changed');
        } else {
            const d = await res.json();
            showToast(d.error || "更新失败", "error");
        }
    } catch (e) { showToast("操作失败", "error"); }
};

// --- 其他通用辅助逻辑 ---

async function executeDelete(id, btn) {
  const token = await getAuthToken();
  btn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/notes/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      await loadMemos();
      showToast("已删除记录", "info");
      trackEvent('memo_deleted');
    }
  } catch (e) { showToast("删除请求失败", "error"); btn.disabled = false; }
}

els.exportBtn.onclick = async () => {
  els.exportBtn.innerText = "导出中...";
  const token = await getAuthToken();
  try {
    const res = await fetch(`${API_BASE}/notes`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const memos = await res.json();
    if (!memos || memos.length === 0) return showToast("无记录可导出", "info");

    let md = `# 我的随手记合集\n\n> 导出时间：${new Date().toLocaleString()}\n\n---\n\n`;
    memos.forEach(m => {
      const title = m.title || '未命名记录';
      const content = m.is_locked ? "[🔒 敏感内容 - 导出前请在插件内解锁]" : m.content;
      md += `### 📌 ${title}\n`;
      md += `> 📅 ${new Date(m.created_at).toLocaleString()}\n\n${content}\n\n---\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Memo_Backup_${new Date().toISOString().slice(0,10)}.md`;
    a.click();
    showToast("导出成功", "success");
    trackEvent('export_success');
  } catch (e) { showToast("生成文件失败", "error"); }
  finally { els.exportBtn.innerText = "📤 导出 MD"; }
};

function startCountdown(s, btn) {
    let count = s;
    const oldText = btn.innerText;
    const timer = setInterval(() => {
        count--;
        btn.innerText = `${count}s`;
        btn.disabled = true;
        if (count <= 0) {
            clearInterval(timer);
            btn.disabled = false;
            btn.innerText = oldText;
            btn.style.display = 'block';
        }
    }, 1000);
}

function handleLogout() {
  logout();
  chrome.storage.local.remove(['user_email', 'auth_token'], () => {
    initView();
    showToast("已退出登录");
  });
}

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

// --- 初始化启动 ---
initView();