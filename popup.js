import { API_BASE, getAuthToken, setAuthToken, logout } from './server-config.js';
import { trackEvent } from './analytics.js';

// DOM 元素
const views = {
  login: document.getElementById('login-view'),
  app: document.getElementById('app-view')
};
const els = {
  input: document.getElementById('memo-input'),
  saveBtn: document.getElementById('save-btn'),
  list: document.getElementById('memo-list'),
  email: document.getElementById('email-input'),
  code: document.getElementById('code-input'),
  sendBtn: document.getElementById('send-code-btn'),
  loginBtn: document.getElementById('login-btn'),
  otpGroup: document.getElementById('otp-group'),
  charCount: document.getElementById('char-count')
};

/**
 * 界面切换控制
 */
async function initView() {
  const token = await getAuthToken();
  if (token) {
    views.login.style.display = 'none';
    views.app.style.display = 'block';
    loadMemos();
  } else {
    views.login.style.display = 'block';
    views.app.style.display = 'none';
  }
}

/**
 * 验证码逻辑
 */
els.sendBtn.onclick = async () => {
  const email = els.email.value.trim();
  if (!email) return alert("请输入邮箱");

  els.sendBtn.disabled = true;
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
      els.sendBtn.innerText = "重新发送(60s)";
      startCountdown(60);
    } else {
      alert(data.error);
      els.sendBtn.disabled = false;
    }
  } catch (e) {
    alert("网络请求失败");
    els.sendBtn.disabled = false;
  }
};

function startCountdown(s) {
  let count = s;
  const timer = setInterval(() => {
    count--;
    els.sendBtn.innerText = `重新发送(${count}s)`;
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
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code })
    });
    const data = await res.json();
    if (res.ok) {
      await setAuthToken(data.token);
      initView();
      trackEvent('login_success');
    } else {
      alert(data.error);
    }
  } catch (e) { alert("登录请求失败"); }
};

/**
 * 笔记保存
 */
async function handleSave() {
  const content = els.input.value.trim();
  if (!content) return;
  if (content.length > 20000) return alert("超出2万字限制");

  const token = await getAuthToken();
  els.saveBtn.disabled = true;
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
      alert(data.error || "保存失败");
    }
  } catch (e) { alert("同步失败，请检查服务器"); }
  finally {
    els.saveBtn.disabled = false;
    els.saveBtn.innerText = "保存记录";
  }
}

/**
 * 加载笔记
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
  } catch (e) { console.error("Load error", e); }
}

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
      <div class="memo-content">${memo.content}</div>
      <span class="memo-time">${new Date(memo.created_at).toLocaleString()}</span>
      <div class="item-actions">
        <button class="action-link del-btn" data-id="${memo.id}">删除</button>
      </div>
    `;
    li.querySelector('.del-btn').onclick = () => handleDelete(memo.id);
    els.list.appendChild(li);
  });
}

async function handleDelete(id) {
  if (!confirm("确定删除？")) return;
  const token = await getAuthToken();
  await fetch(`${API_BASE}/notes/${id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  loadMemos();
}

function handleLogout() {
  logout();
  initView();
}

function updateCharCount() {
  els.charCount.textContent = `${els.input.value.length} 字 / 2万字`;
}

// 绑定事件
els.saveBtn.onclick = handleSave;
document.getElementById('logout-link').onclick = handleLogout;
els.input.oninput = updateCharCount;
initView();