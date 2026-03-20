import { initializeApp } from './lib/firebase-app.js';
import { getFirestore } from './lib/firebase-firestore.js';
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
export const db = getFirestore(app);
export const auth = getAuth(app);
export const PLUGIN_ID = "quick_memo"; // 未来开发收藏夹时，只需改这个 ID

// 初始化时自动匿名登录
export async function ensureAuth() {
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  return auth.currentUser.uid;
}