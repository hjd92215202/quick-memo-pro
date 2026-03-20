import { initializeApp } from './lib/firebase-app.js';
import { initializeFirestore  } from './lib/firebase-firestore.js';
import { getAuth, signInAnonymously } from './lib/firebase-auth.js'

const firebaseConfig = {
  apiKey: "AIzaSyC8_GXYBOzqTtjBYVnnLrQAfpgSDW_lcQE",
  authDomain: "my-wordbook-project.firebaseapp.com",
  projectId: "my-wordbook-project",
  storageBucket: "my-wordbook-project.firebasestorage.app",
  messagingSenderId: "825841120528",
  appId: "1:825841120528:web:02537f8105a5cd2b5a2195",
  measurementId: "G-E02XHC5KPN"
};

export const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true, // 强制使用长轮询模式，解决连接超时
});
export const auth = getAuth(app);
export const PLUGIN_ID = "quick_memo"; // 未来开发收藏夹时，只需改这个 ID

// 初始化时自动匿名登录
/**
 * 确保用户已登录 Firebase
 * @returns {Promise<string>} 返回用户的 UID
 */
export async function ensureAuth() {
  return new Promise((resolve, reject) => {
    // 1. 检查当前是否已经登录
    if (auth.currentUser) {
      resolve(auth.currentUser.uid);
      return;
    }

    // 2. 如果没登录，监听登录状态变化
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        unsubscribe();
        resolve(user.uid);
      } else {
        // 3. 执行匿名登录
        try {
          const result = await signInAnonymously(auth);
          unsubscribe();
          resolve(result.user.uid);
        } catch (error) {
          reject(error);
        }
      }
    });
  });
}