import { initializeApp } from './lib/firebase-app.js';
import { initializeFirestore } from './lib/firebase-firestore.js';
import { getAuth, signInAnonymously } from './lib/firebase-auth.js';

// 1. Firebase 配置
const firebaseConfig = {
  apiKey: "AIzaSyC8_GXYBOzqTtjBYVnnLrQAfpgSDW_lcQE",
  authDomain: "my-wordbook-project.firebaseapp.com",
  projectId: "my-wordbook-project",
  storageBucket: "my-wordbook-project.firebasestorage.app",
  messagingSenderId: "825841120528",
  appId: "1:825841120528:web:02537f8105a5cd2b5a2195",
  measurementId: "G-E02XHC5KPN"
};

// 2. 初始化 Firebase 实例
export const app = initializeApp(firebaseConfig);

/**
 * 初始化 Firestore 并开启长轮询模式
 * 解决国内网络环境下 gRPC 握手导致的 10s 超时问题
 */
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true, 
});

export const auth = getAuth(app);

// 3. 插件唯一标识（用于全家桶数据隔离）
export const PLUGIN_ID = "quick_memo"; 

/**
 * 缓存登录状态的 Promise
 * 防止在登录中途再次发起登录请求
 */
let authPromise = null;

/**
 * 确保用户已登录 Firebase (使用 Promise 封装)
 * @returns {Promise<string>} 返回用户的受保护 UID
 */
export async function ensureAuth() {
  // A. 如果已经登录，直接返回 UID
  if (auth.currentUser) {
    return auth.currentUser.uid;
  }

  // B. 如果登录逻辑正在处理中，返回已有的 Promise 避免冲突
  if (authPromise) {
    return authPromise;
  }

  // C. 发起登录流程
  authPromise = new Promise((resolve, reject) => {
    // 监听初始化状态
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      try {
        if (user) {
          unsubscribe();
          resolve(user.uid);
        } else {
          // 如果没有用户，执行匿名登录
          const result = await signInAnonymously(auth);
          unsubscribe();
          resolve(result.user.uid);
        }
      } catch (error) {
        unsubscribe();
        console.error("Firebase Auth Error:", error);
        reject(error);
      }
    });
  });

  // 无论成功还是失败，执行完毕后清空缓存的 Promise
  return authPromise.finally(() => {
    authPromise = null;
  });
}