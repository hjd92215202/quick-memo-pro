export const API_BASE = "https://api.oneday.ren/api";
export const UMAMI_URL = "https://umami.oneday.ren/api/send";
export const UMAMI_ID = "40bfbf59-e909-4feb-ae67-a91c1e545147"; // 请在Umami后台创建网站后填入这里

// 获取持久化的 JWT Token
export async function getAuthToken() {
  const res = await chrome.storage.local.get('auth_token');
  return res.auth_token || null;
}

// 保存 JWT Token
export async function setAuthToken(token) {
  await chrome.storage.local.set({ 'auth_token': token });
}

// 退出登录
export async function logout() {
  await chrome.storage.local.remove('auth_token');
}