// =========================================================================
// 스마트 브리핑룸 (Smart Briefing Room) - Developed by YDE & DK - 시스템 환경 설정 및 Firebase 초기화 모듈
// =========================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

export const appId = typeof window !== 'undefined' && typeof window.__app_id !== 'undefined' ? window.__app_id : 'doksan-briefing-room';

// Current Client Application Build Version (Live Update Detection - Synced with window.APP_VERSION)
export const CURRENT_APP_VERSION = typeof window !== 'undefined' && window.APP_VERSION ? window.APP_VERSION : 'v3.0';

// 26th Doksan Student Council Production Config
export const productionFirebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
  measurementId: "YOUR_MEASUREMENT_ID"
};

let resolvedConfig = null;
if (typeof window !== 'undefined' && typeof window.__firebase_config !== 'undefined') {
  try {
    resolvedConfig = JSON.parse(window.__firebase_config);
  } catch (e) {
    console.warn('Failed to parse __firebase_config', e);
  }
}
if (!resolvedConfig) {
  resolvedConfig = productionFirebaseConfig;
}

export const firebaseConfig = resolvedConfig;

// Firebase Shared Singletons
export let app = null;
export let auth = null;
export let db = null;
export let isCloudReady = false;

export function initFirebase() {
  if (!app) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    isCloudReady = true;
  }
  return { app, auth, db };
}

// Master & Co-Administrator Configuration (SSOT with window.MASTER_ADMIN_EMAIL / window.CO_ADMIN_EMAIL)
export const DEFAULT_MASTER_EMAIL = typeof window !== 'undefined' && window.MASTER_ADMIN_EMAIL 
  ? window.MASTER_ADMIN_EMAIL 
  : "";

export function getMasterAdminEmail() {
  return (typeof window !== 'undefined' && window.MASTER_ADMIN_EMAIL) || DEFAULT_MASTER_EMAIL;
}

export function isMasterAdmin(user) {
  if (!user) return false;
  const masterEmail = getMasterAdminEmail().toLowerCase();
  if (!masterEmail) return false;
  const userEmail = (user.email || '').toLowerCase();
  return userEmail === masterEmail || user.isMasterAdmin === true || (user.role === '총괄관리자' && (!userEmail || userEmail === masterEmail));
}

export const MASTER_ADMIN_EMAIL = getMasterAdminEmail();
export const CO_ADMIN_EMAIL = (typeof window !== 'undefined' && window.CO_ADMIN_EMAIL) ? window.CO_ADMIN_EMAIL : "";
export const ADMIN_EMAILS = [MASTER_ADMIN_EMAIL, CO_ADMIN_EMAIL].filter(Boolean).map(e => e.toLowerCase());

// Global Default Keys
export const DEFAULT_KAKAO_JS_KEY = "ef7ff24ae4d10744cfa59d4d3b03f091";
export const DEFAULT_GEMINI_API_KEY = "AQ.Ab8RN6KqZw6ZD3MAVlYBfnBSbj32JRe2vmkGoApmoOhb7i-kew";

export let kakaoJsKey = DEFAULT_KAKAO_JS_KEY;
try {
  const savedKakao = localStorage.getItem('doksan_kakao_js_key');
  if (savedKakao) kakaoJsKey = savedKakao;
} catch (e) {}

export function setKakaoJsKey(val) {
  kakaoJsKey = val;
}

export let geminiApiKey = DEFAULT_GEMINI_API_KEY;
try {
  const savedGemini = localStorage.getItem('doksan_gemini_api_key');
  if (savedGemini) geminiApiKey = savedGemini;
} catch (e) {}

export function setGeminiApiKey(val) {
  geminiApiKey = val;
}

// 관리자 테스트 디버그 모드 (Firestore DB config/settings 기반 클라우드 공통 관리)
export let isAdminDebugMode = false;
try {
  isAdminDebugMode = localStorage.getItem('doksan_debug_mode') === 'true';
} catch (e) {}

export function setIsAdminDebugMode(val) {
  isAdminDebugMode = !!val;
  try {
    localStorage.setItem('doksan_debug_mode', isAdminDebugMode ? 'true' : 'false');
  } catch (e) {}
}

// 카카오 OAuth 키 (Firestore onSnapshot으로 실시간 동기화)
export let kakaoRestApiKey = '';
export let kakaoClientSecret = '';

export function setKakaoRestApiKey(val) {
  kakaoRestApiKey = val || '';
}

export function setKakaoClientSecret(val) {
  kakaoClientSecret = val || '';
}




