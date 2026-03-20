import { API_BASE, getAuthToken, setAuthToken, logout } from './server-config.js';
import { trackEvent } from './analytics.js';

// --- 全局交互状态 ---
let memoToUnlock = null; // 存储当前尝试解锁的笔记记录

// --- DOM 元素引用 ---
const els = {
  // 提示容器
  toastContainer: document.getElementById('toast-container'),
  // 视图容器 (修复此处，确保 initView 引用正确)
  loginView: document.getElementById('login-view'),
  appView: document.getElementById('app-view'),
  // 登录相关
  email: document.getElementById('email-input'),
  code: document.getElementById('code-input'),
  sendBtn: document.getElementById('send-code-btn'),
  loginBtn: document.getElementById('login-btn'),
  otpGroup: document.getElementById('otp-group'),
  // 主界面相关
  userEmail: document.getElementById('user-email'),
  titleInput: document.getElementById('memo-title'), // 标题输入
  input: document.getElementById('memo-input'),      // 内容输入
  saveBtn: document.getElementById('save-btn'),
  list: document.getElementById('memo-list'),
  charCount: document.getElementById('char-count'),
  exportBtn: document.getElementById('export-md-btn'),
  logoutBtn: document.getElementById('logout-link'),
  // 安全与加锁相关
  lockCheck: document.getElementById('lock-checkbox'), 
  resetPwdBtn: document.getElementById('reset-pwd-link'),
  // 主密码设置弹窗 (Setup Modal)
  setupModal: document.getElementById('password-setup-modal'),
  setupCodeInput: document.getElementById('setup-code-input'),
  setupPwdInput: document.getElementById('setup-pwd-input'),
  savePwdBtn: document.getElementById('save-pwd-btn'),
  getSetupCodeBtn: document.getElementById('get-setup-code-btn'),
  closeSetupBtn: document.getElementById('close-setup-btn'),
  // 验证主密码弹窗 (Verify Modal - 替代原 prompt)
  verifyModal: document.getElementById('password-verify-modal'),
  verifyInput: document.getElementById('verify-pwd-input'),
  confirmVerifyBtn: document.getElementById('confirm-verify-btn'),
  closeVerifyBtn: document.getElementById('close-verify-btn')
};

/**
 * 提示系统：代替原生 alert
 * @param {string} msg 
 * @param {'info'|'success'|'error'} type 
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
 */
async function initView() {
  const token = await getAuthToken();
  
  // 健壮性检查
  if (!els.loginView || !els.appView) return;

  if (token) {
    els.loginView.style.display = 'none';
    els.appView.style.display = 'block';
    
    // 显示用户邮箱
    const res = await chrome.storage.local.get('user_email');
    if (res.user_email && els.userEmail) els.userEmail.innerText = res.user_email;
    
    loadMemos();
  } else {
    els.loginView.style.display = 'block';
    els.appView.style.display = 'none';
  }
}

/**
 * 验证码获取逻辑
 */
els.sendBtn.onclick = async () => {
  const email = els.email.value.trim();
  if (!email || !email.includes('@')) return showToast("请输入有效的邮箱地址", "error");

  els.sendBtn.disabled = true;
  els.sendBtn.innerText = "正在发送...";
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
      // 启动倒计时，但因为 sendBtn 被隐藏，逻辑在 startCountdown 里处理
      startCountdown(60, els.sendBtn); 
    } else {
      showToast(data.error || "验证码发送失败", "error");
      els.sendBtn.disabled = false;
      els.sendBtn.innerText = "获取验证码";
    }
  } catch (e) {
    showToast("连接服务器失败", "error");
    els.sendBtn.disabled = false;
    els.sendBtn.innerText = "获取验证码";
  }
};

/**
 * 通用验证码倒计时
 */
function startCountdown(s, btn) {
  let count = s;
  const originalText = "获取验证码";
  const timer = setInterval(() => {
    count--;
    btn.innerText = `重发 (${count}s)`;
    btn.disabled = true;
    if (count <= 0) {
      clearInterval(timer);
      btn.disabled = false;
      btn.innerText = originalText;
      btn.style.display = 'block'; // 如果之前隐藏了，重新显示
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
      showToast("登录成功，欢迎使用", "success");
      trackEvent('login_success');
    } else {
      showToast(data.error || "验证码错误", "error");
    }
  } catch (e) {
    showToast("登录请求失败", "error");
  }
};

/**
 * 保存随手记 (支持标题、加锁和 Toast 反馈)
 */
async function handleSave() {
  const title = els.titleInput.value.trim();
  const content = els.input.value.trim();
  if (!content) return;
  if (content.length > 20000) return showToast("字数超出限制", "error");

  const token = await getAuthToken();
  const is_locked = els.lockCheck ? els.lockCheck.checked : false;

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
      showToast("已安全保存至云端", "success");
      trackEvent('memo_saved_popup', { locked: is_locked });
    } else {
      const data = await res.json();
      if (res.status === 401) return handleLogout();
      showToast(data.error || "云端同步失败", "error");
    }
  } catch (e) {
    showToast("无法连接云端，请检查网络", "error");
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
    els.list.innerHTML = '<li style="text-align:center; color:#dc322f; font-size:11px; padding:10px;">连接云端失败</li>';
  }
}

/**
 * 渲染记录列表 (处理标题与锁定显示)
 */
function renderList(memos) {
  els.list.innerHTML = '';
  if (!memos || memos.length === 0) {
    els.list.innerHTML = '<li style="text-align:center; color:#999; font-size:12px; padding:20px;">记录本还是空的</li>';
    return;
  }

  memos.forEach(memo => {
    const li = document.createElement('li');
    li.className = 'memo-item';
    const isLocked = memo.is_locked;

    li.innerHTML = `
      <div class="memo-title-display"></div>
      <div class="memo-content ${isLocked ? 'is-locked' : ''}" id="txt-${memo.id}">
        ${isLocked ? '🔒 该记录已加锁，解锁后可查看/复制' : ''}
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
    }

    // 绑定解锁
    if (isLocked) {
      li.querySelector('.unlock-btn').onclick = () => {
        memoToUnlock = memo;
        els.verifyModal.style.display = 'flex';
        els.verifyInput.value = '';
        els.verifyInput.focus();
      };
    }

    // 复制功能 (带锁校验)
    li.querySelector('.copy-btn').onclick = async () => {
      const contentEl = document.getElementById(`txt-${memo.id}`);
      if (memo.is_locked && !contentEl.dataset.unlocked) return showToast("敏感内容请先解锁", "error");
      
      await navigator.clipboard.writeText(memo.content);
      showToast("内容已复制", "success");
    };

    // 两步确认删除逻辑 (完整保留)
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
 * 解锁单条记录逻辑 (对接 Verify Modal)
 */
els.confirmVerifyBtn.onclick = async () => {
    const password = els.verifyInput.value;
    if (!password) return;

    const token = await getAuthToken();
    try {
        const res = await fetch(`${API_BASE}/notes/verify-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ password })
        });

        if (res.ok) {
            const contentEl = document.getElementById(`txt-${memoToUnlock.id}`);
            contentEl.textContent = memoToUnlock.content;
            contentEl.classList.remove('is-locked');
            contentEl.dataset.unlocked = "true"; // 允许复制
            els.verifyModal.style.display = 'none';
            showToast("解锁成功", "success");
            trackEvent('memo_unlocked');
        } else {
            showToast("主密码错误", "error");
        }
    } catch (e) {
        showToast("验证失败", "error");
    }
};

els.closeVerifyBtn.onclick = () => { els.verifyModal.style.display = 'none'; };

/**
 * 主密码管理逻辑 (设置/重置)
 */
if (els.resetPwdBtn) {
    els.resetPwdBtn.onclick = () => { els.setupModal.style.display = 'flex'; };
}

if (els.closeSetupBtn) {
    els.closeSetupBtn.onclick = () => { els.setupModal.style.display = 'none'; };
}

// 弹窗中发送验证码
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
            showToast("验证码已发往邮箱", "success");
            startCountdown(60, els.getSetupCodeBtn);
        } else { els.getSetupCodeBtn.disabled = false; }
    } catch (e) { els.getSetupCodeBtn.disabled = false; }
};

// 提交新密码
els.savePwdBtn.onclick = async () => {
    const code = els.setupCodeInput.value.trim();
    const newPassword = els.setupPwdInput.value.trim();
    const resData = await chrome.storage.local.get('user_email');
    
    if (newPassword.length < 4) return showToast("密码至少4位", "error");
    if (!code) return showToast("请输入验证码", "error");

    try {
        const res = await fetch(`${API_BASE}/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: resData.user_email, code, newPassword })
        });
        if (res.ok) {
            showToast("主密码已成功更新", "success");
            els.setupModal.style.display = 'none';
            els.setupCodeInput.value = '';
            els.setupPwdInput.value = '';
            trackEvent('master_password_changed');
        } else {
            const d = await res.json();
            showToast(d.error || "更新失败", "error");
        }
    } catch (e) { showToast("请求失败", "error"); }
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
      showToast("已成功删除记录");
      trackEvent('memo_deleted');
    }
  } catch (e) {
    showToast("删除请求失败", "error");
  }
}

/**
 * 导出 Markdown 逻辑 (包含标题)
 */
els.exportBtn.onclick = async () => {
  els.exportBtn.innerText = "生成中...";
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
      const content = m.is_locked ? "[🔒 敏感内容 - 导出前请先解锁]" : m.content;
      md += `### 📌 ${title}\n`;
      md += `> 📅 ${new Date(m.created_at).toLocaleString()}\n\n${content}\n\n`;
      if (m.source_url) md += `*来源: ${m.source_url}*\n`;
      md += `\n---\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Memos_Backup_${new Date().toISOString().slice(0,10)}.md`;
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