// =========================================================================
// 스마트 브리핑룸 (Smart Briefing Room) - Developed by YDE & DK - 사용자 인증, 프로필 및 관리자 권한 모듈
// =========================================================================

import { 
  app, auth, db, initFirebase, appId,
  MASTER_ADMIN_EMAIL, CO_ADMIN_EMAIL, ADMIN_EMAILS,
  isMasterAdmin, getMasterAdminEmail,
  kakaoJsKey, setKakaoJsKey, geminiApiKey, setGeminiApiKey,
  isAdminDebugMode, setIsAdminDebugMode,
  setKakaoRestApiKey, setKakaoClientSecret
} from './config.js';
import { 
  currentUser, updateCurrentUser, resetCurrentUser, 
  authUser, setAuthUser, userDocUnsubscribe, setUserDocUnsubscribe 
} from './state.js';
import { 
  escapeHtml, showToast, showCustomConfirm, switchView,
  getProviderOfficialSymbolHtml, getProviderMiniBadgeHtml,
  getUnifiedUserAvatarHtml, checkAndNotifyUpdate 
} from './utils.js';
import { 
  initKakaoSdk, updateKakaoKeyUI,
  handleKakaoAuthCallback, restoreKakaoSession, handleKakaoLogout,
  updateKakaoOAuthKeyUI
} from './kakao.js';
import { updateGeminiKeyUI } from './gemini.js';
import { 
  startPresenceListener, startPresenceHeartbeat, 
  setupPresenceLifecycleEvents, syncPresenceToCloud,
  markOfflineImmediately
} from './presence.js';
import { renderAgendas, startAgendasListener } from './agendas.js';
import { populateBrandingForm } from './branding.js';
import { logActivity, loadActivityLogs } from './logger.js';

import { 
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, onSnapshot 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

export let allUsersList = [];
let allUsersUnsubscribe = null;
let hasStartedCoreListeners = false;

export async function initCloudSync() {
  const statusText = document.getElementById('cloud-status-text');
  const statusBadge = document.getElementById('cloud-status-badge');
  const footerUid = document.getElementById('footer-uid');

  try {
    const instances = initFirebase();
    const currentAuth = instances.auth;
    const currentDb = instances.db;

    initKakaoSdk();

    // --- 카카오 OAuth 콜백 처리 (URL에 code 파라미터가 있을 때) ---
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('code') || urlParams.get('error')) {
      // 카카오 리다이렉트 복귀: 카카오 콜백 처리 우선 실행
      await handleKakaoAuthCallback(async (kakaoUser) => {
        await handleKakaoUserAuthState(kakaoUser, statusText, footerUid);
      });
      // 카카오 콜백 처리 후 Firebase Auth 상태 리스너도 등록 (Google 로그인 세션 복원 대비)
    } else {
      // --- 카카오 세션 복원 (새로고침 시) ---
      const restored = await restoreKakaoSession(async (kakaoUser) => {
        await handleKakaoUserAuthState(kakaoUser, statusText, footerUid);
      });
      if (restored) {
        // 카카오 세션 복원 성공 — Firebase Auth 리스너도 등록 (Google 병행)
      }
    }

    // Firebase Google Auth 상태 리스너
    onAuthStateChanged(currentAuth, async (user) => {
      // 카카오 로그인 세션이 활성화된 경우 Firebase Auth 상태 무시 (로그인 풀림 원천 방지)
      const isKakaoSession = (localStorage.getItem('doksan_auth_provider') === 'kakao') || 
                             (sessionStorage.getItem('kakao_provider') === 'kakao') ||
                             (currentUser && currentUser.provider === 'kakao' && currentUser.isAuthenticated);
      if (isKakaoSession) {
        return;
      }

      if (!user) {
        setAuthUser(null);
        if (statusText) statusText.textContent = '로그인 대기';
        if (footerUid) footerUid.textContent = '미인증';
        resetCurrentUser();
        updateUserUI();
        switchView('logged-out');
        return;
      }

      setAuthUser(user);
      updateCurrentUser({
        uid: user.uid,
        email: user.email || '',
        name: user.displayName || '부원',
        photoURL: user.photoURL || '',
        provider: 'google'
      });

      if (footerUid) footerUid.textContent = user.email || user.uid;
      if (statusText) statusText.textContent = '실시간 동기화 활성';

      await handleUserAuthState(user);
    });

    // Start Realtime Cloud Config Listener (Kakao Key, Gemini Key, etc.)
    const configDocRef = doc(currentDb, 'artifacts', appId, 'public', 'data', 'config', 'settings');
    onSnapshot(configDocRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.kakaoJsKey) {
          setKakaoJsKey(data.kakaoJsKey);
          localStorage.setItem('doksan_kakao_js_key', data.kakaoJsKey);
          initKakaoSdk();
          updateKakaoKeyUI();
        }
        if (data.geminiApiKey) {
          setGeminiApiKey(data.geminiApiKey);
          localStorage.setItem('doksan_gemini_api_key', data.geminiApiKey);
          updateGeminiKeyUI();
        }
        if (typeof data.adminDebugMode !== 'undefined') {
          setIsAdminDebugMode(!!data.adminDebugMode);
          updateAdminDebugModeUI();
          if (typeof window.renderAgendas === 'function') {
            window.renderAgendas();
          }
        }
        // 카카오 OAuth 키/시크릿 실시간 동기화
        if (data.kakaoRestApiKey !== undefined) {
          setKakaoRestApiKey(data.kakaoRestApiKey || '');
        }
        if (data.kakaoClientSecret !== undefined) {
          setKakaoClientSecret(data.kakaoClientSecret || '');
        }
        // 배포 버전 실시간 감지 및 라이브 업데이트 알림 (전 부원 0.1초 동기화)
        if (data.deployedVersion) {
          checkAndNotifyUpdate(data.deployedVersion, data.deployedChangelog || '새로운 기능이 배포되었습니다. 지금 새로고침하세요!');
        }
        // 설정 탭이 열려 있는 경우 UI도 갱신
        const configView = document.getElementById('admin-view-config');
        if (configView && !configView.classList.contains('hidden')) {
          updateKakaoOAuthKeyUI();
        }
      }
    });

  } catch (err) {
    console.warn('Cloud sync initialization error. Falling back to local offline mode.', err);
    if (statusText) statusText.textContent = '로컬 전용 모드';
    if (statusBadge) statusBadge.className = "bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1";
    renderAgendas();
  }
}

/**
 * 카카오 로그인 사용자 인증 상태 처리
 * Google의 handleUserAuthState와 동일한 흐름으로 Firestore 기반 권한 판별
 */
async function handleKakaoUserAuthState(kakaoUser, statusText, footerUid) {
  try {
    // 가상 authUser 설정 (카카오 기반)
    setAuthUser({
      uid: kakaoUser.uid,
      email: kakaoUser.email || '',
      displayName: kakaoUser.name,
      photoURL: kakaoUser.photoURL || '',
      provider: 'kakao'
    });
    updateCurrentUser({
      uid: kakaoUser.uid,
      email: kakaoUser.email || '',
      name: kakaoUser.name,
      photoURL: kakaoUser.photoURL || '',
      provider: 'kakao'
    });

    if (footerUid) footerUid.textContent = kakaoUser.name || kakaoUser.uid;
    if (statusText) statusText.textContent = '실시간 동기화 활성';

    // Firestore 사용자 문서 기반 권한 판별 (Google 로그인과 동일 흐름)
    await handleUserAuthState({ 
      uid: kakaoUser.uid, 
      email: kakaoUser.email || '', 
      displayName: kakaoUser.name, 
      photoURL: kakaoUser.photoURL || '',
      provider: 'kakao'
    });
  } catch (err) {
    console.error('Kakao user auth state error:', err);
  }
}

export function openLoginModal() {
  handleGoogleLogin();
}

export async function handleGoogleLogin() {
  const ua = navigator.userAgent || navigator.vendor || window.opera || '';
  const isKakao = /KAKAOTALK/i.test(ua);

  // 카카오톡 인앱 브라우저 감지 시: 구글 로그인 차단 방지를 위해 외부 브라우저(Chrome/Safari)로 탈출 및 카톡 웹뷰 닫기
  if (isKakao) {
    showToast('구글 로그인을 위해 스마트폰 전용 브라우저(Chrome/Safari)로 안전하게 이동합니다.', 'info');
    
    const isAndroid = /Android/i.test(ua);
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const currentUrl = window.location.href;

    // 1. 기기별 외부 브라우저(Android: Chrome / iOS: Safari) 강제 호출
    if (isAndroid) {
      window.location.href = 'intent://' + currentUrl.replace(/https?:\/\//i, '') + '#Intent;scheme=https;package=com.android.chrome;end';
    } else if (isIOS) {
      window.location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(currentUrl);
    } else {
      window.open(currentUrl, '_system');
    }

    // 2. 외부 브라우저 전환 직후 카카오톡 인앱 웹뷰 자동 닫기 (채팅방 복귀)
    setTimeout(() => {
      try {
        if (isAndroid) {
          window.location.href = 'kakaotalk://inappbrowser/close';
        } else if (isIOS) {
          window.location.href = 'kakaoweb://closeBrowser';
        }
      } catch(e) {}
      setTimeout(() => {
        try {
          if (window.history.length > 1) {
            window.history.back();
          } else {
            window.close();
          }
        } catch(e) {}
      }, 300);
    }, 800);

    return;
  }

  // 일반 PC / 스마트폰 일반 브라우저: 표준 Firebase Google 로그인 팝업 실행
  if (!auth) {
    showToast('Firebase 인증 서비스를 초기화하는 중입니다. 잠시 후 다시 시도해 주세요.', 'warning');
    return;
  }
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, provider);
  } catch (err) {
    console.error('Google Sign-in error:', err);
    if (err.code !== 'auth/popup-closed-by-user') {
      showToast(`로그인 실패: ${err.message}`, 'warning');
    }
  }
}

// 카카오톡 웹뷰에서 외부 브라우저로 전환 후 다시 카톡으로 복귀했을 때 백그라운드 웹뷰 자동 닫기 안전장치
if (typeof window !== 'undefined' && /KAKAOTALK/i.test(navigator.userAgent || '')) {
  let hasLeftKakao = false;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hasLeftKakao = true;
    } else if (document.visibilityState === 'visible' && hasLeftKakao) {
      try {
        if (/Android/i.test(navigator.userAgent || '')) {
          window.location.href = 'kakaotalk://inappbrowser/close';
        } else {
          window.location.href = 'kakaoweb://closeBrowser';
        }
      } catch(e) {}
    }
  });
}

export async function handleLogout() {
  try {
    logActivity({
      category: 'AUTH',
      action: 'AUTH_LOGOUT',
      details: { summary: `${currentUser.name || '부원'}님이 로그아웃함` }
    });

    // 카카오 로그인 세션도 함께 정리
    handleKakaoLogout();
    if (auth) await signOut(auth);
    resetCurrentUser();
    updateUserUI();
    switchView('logged-out');
    showToast('로그아웃되었습니다.', 'info');
  } catch (err) {
    console.error('Logout error:', err);
  }
}

export async function handleUserAuthState(user) {
  if (!db || !user) return;
  const userEmail = (user.email || '').toLowerCase();
  const userDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', user.uid);
  const isMasterAdmin = Boolean(MASTER_ADMIN_EMAIL) && (userEmail === MASTER_ADMIN_EMAIL.toLowerCase());
  const isCoAdmin = Boolean(CO_ADMIN_EMAIL) && (userEmail === CO_ADMIN_EMAIL.toLowerCase());
  const isBuiltinAdmin = isMasterAdmin || isCoAdmin;

  try {
    const snap = await getDoc(userDocRef);
    if (snap.exists()) {
      const data = snap.data();
      updateCurrentUser({
        uid: user.uid,
        email: user.email || data.email || '',
        status: isBuiltinAdmin ? 'approved' : (data.status || 'pending'),
        isAdmin: isBuiltinAdmin || Boolean(data.isAdmin),
        canApprove: isBuiltinAdmin || Boolean(data.canApprove || data.isAdmin),
        name: data.name || user.displayName || (isMasterAdmin ? '총괄관리자' : (isCoAdmin ? '공동관리자' : '부원')),
        grade: data.grade || '2학년',
        classNum: data.classNum || '1반',
        department: data.department || (isBuiltinAdmin ? '회장단' : '행사기획부'),
        role: data.role || (isMasterAdmin ? '총괄관리자' : (isCoAdmin ? '공동관리자' : '부원')),
        photoURL: data.photoURL || user.photoURL || '',
        avatarType: data.avatarType || currentUser.avatarType || 'oauth',
        customPhotoURL: data.customPhotoURL || currentUser.customPhotoURL || '',
        isAuthenticated: true
      });
      updateMasterAdminButtonUI();

      if (isBuiltinAdmin && (!data.isAdmin || !data.canApprove || data.status !== 'approved')) {
        await updateDoc(userDocRef, {
          isAdmin: true,
          canApprove: true,
          status: 'approved',
          role: data.role || (isMasterAdmin ? '총괄관리자' : '공동관리자'),
          department: data.department || '회장단'
        });
      }
    } else {
      if (isBuiltinAdmin) {
        const adminData = {
          uid: user.uid,
          email: user.email,
          name: user.displayName || (isMasterAdmin ? '총괄관리자' : '공동관리자'),
          photoURL: user.photoURL || '',
          grade: '2학년',
          classNum: '본부',
          department: '회장단',
          role: isMasterAdmin ? '총괄관리자' : '공동관리자',
          status: 'approved',
          isAdmin: true,
          canApprove: true,
          createdAt: Date.now()
        };
        await setDoc(userDocRef, adminData);
        updateCurrentUser(adminData);
        currentUser.isAuthenticated = true;
        showToast(`${isMasterAdmin ? '총괄관리자' : '공동관리자'} 권한으로 승인되었습니다.`, 'success');
      } else {
        openNewProfileModal(user);
        return;
      }
    }

    listenToUserDoc(userDocRef, isBuiltinAdmin);

  } catch (err) {
    console.error('Error handling user auth state:', err);
  }
}

export function openNewProfileModal(user) {
  const modal = document.getElementById('modal-profile-setup');
  const nameInput = document.getElementById('setup-name');
  const gradeInput = document.getElementById('setup-grade');
  const roleInput = document.getElementById('setup-role');

  let savedName = user.displayName || '';
  let savedGrade = '2학년';
  let savedRole = '행사기획부';

  try {
    const saved = localStorage.getItem('doksan_user_profile');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.name) savedName = parsed.name;
      if (parsed.grade) savedGrade = parsed.grade;
      if (parsed.role) savedRole = parsed.role;
    }
  } catch (e) {}

  if (nameInput) nameInput.value = savedName;
  if (gradeInput) gradeInput.value = savedGrade;
  if (roleInput) roleInput.value = savedRole;

  // Setup Avatar Previews
  const setupOauthImg = document.getElementById('setup-avatar-preview-oauth');
  const setupProviderDiv = document.getElementById('setup-avatar-preview-provider');
  if (setupOauthImg) {
    setupOauthImg.src = user.photoURL || ('https://api.dicebear.com/7.x/bottts/svg?seed=' + encodeURIComponent(user.uid));
  }
  if (setupProviderDiv) {
    const isKakao = (user.provider === 'kakao') || (user.uid && user.uid.startsWith('kakao_'));
    setupProviderDiv.innerHTML = getProviderOfficialSymbolHtml(isKakao, 'w-6 h-6');
  }
  const defaultRadio = document.querySelector('input[name="setup-avatar-type"][value="oauth"]');
  if (defaultRadio) defaultRadio.checked = true;

  if (modal) modal.classList.remove('hidden');
}

export async function handleNewProfileSubmit(e) {
  e.preventDefault();
  if (!authUser || !db) return;

  const nameInput = document.getElementById('setup-name');
  const gradeInput = document.getElementById('setup-grade');
  const roleInput = document.getElementById('setup-role');

  const name = nameInput ? nameInput.value.trim() : (authUser.displayName || '부원');
  const grade = gradeInput ? gradeInput.value : '2학년';
  const role = roleInput ? roleInput.value : '행사기획부';

  // 아바타 선택 유형 (oauth: 소셜 계정 사진, provider: 기본 심볼 아이콘)
  const avatarRadio = document.querySelector('input[name="setup-avatar-type"]:checked');
  const avatarType = avatarRadio ? avatarRadio.value : 'oauth';

  const userEmail = (authUser.email || '').toLowerCase();
  const isMasterAdmin = Boolean(MASTER_ADMIN_EMAIL) && (userEmail === MASTER_ADMIN_EMAIL.toLowerCase());
  const isCoAdmin = Boolean(CO_ADMIN_EMAIL) && (userEmail === CO_ADMIN_EMAIL.toLowerCase());
  const isBuiltinAdmin = isMasterAdmin || isCoAdmin;

  try {
    localStorage.setItem('doksan_user_profile', JSON.stringify({ name, grade, role }));
  } catch (e) {}

  const userDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', authUser.uid);
  const newUserData = {
    uid: authUser.uid,
    email: authUser.email || '',
    name: name,
    photoURL: authUser.photoURL || '',
    customPhotoURL: '',
    avatarType: avatarType,
    grade: grade,
    classNum: '',
    department: role,
    role: role,
    status: isBuiltinAdmin ? 'approved' : 'pending',
    isAdmin: isBuiltinAdmin,
    canApprove: isBuiltinAdmin,
    provider: authUser.provider || (authUser.uid && authUser.uid.startsWith('kakao_') ? 'kakao' : 'google'),
    createdAt: Date.now()
  };

  try {
    await setDoc(userDocRef, newUserData);
    updateCurrentUser(newUserData);
    currentUser.isAuthenticated = true;

    const modal = document.getElementById('modal-profile-setup');
    if (modal) modal.classList.add('hidden');

    showToast('부원 등록 신청이 접수되었습니다.', 'success');
    listenToUserDoc(userDocRef, isBuiltinAdmin);
  } catch (err) {
    console.error('Profile setup submit error:', err);
    showToast('가입 신청 저장 실패: ' + err.message, 'warning');
  }
}

export function listenToUserDoc(userDocRef, isBuiltinAdmin) {
  if (userDocUnsubscribe) userDocUnsubscribe();
  const unsub = onSnapshot(userDocRef, (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    updateCurrentUser({
      status: isBuiltinAdmin ? 'approved' : (data.status || 'pending'),
      isAdmin: isBuiltinAdmin || Boolean(data.isAdmin),
      canApprove: isBuiltinAdmin || Boolean(data.canApprove || data.isAdmin),
      name: data.name || currentUser.name,
      grade: data.grade || currentUser.grade,
      classNum: data.classNum || currentUser.classNum,
      department: data.department || currentUser.department,
      role: data.role || currentUser.role,
      photoURL: data.photoURL || currentUser.photoURL,
      avatarType: data.avatarType || currentUser.avatarType || 'oauth',
      customPhotoURL: data.customPhotoURL || currentUser.customPhotoURL || '',
      isAuthenticated: true
    });

    updateUserUI();
    evaluateUserAccess();
    if (typeof window.renderAgendas === 'function') {
      window.renderAgendas();
    }
  });
  setUserDocUnsubscribe(unsub);
}

export function evaluateUserAccess() {
  if (currentUser.status === 'approved') {
    switchView('briefing-room');
    
    if (!hasStartedCoreListeners) {
      hasStartedCoreListeners = true;
      renderAgendas();
      startAgendasListener();
      startPresenceListener();
      startPresenceHeartbeat();
      setupPresenceLifecycleEvents();
      startAllUsersListener();
    }
    syncPresenceToCloud();

    if (currentUser.isAdmin || currentUser.canApprove) {
      setupAdminListeners();
    }
  } else if (currentUser.status === 'pending') {
    switchView('pending-approval');
    const pName = document.getElementById('pending-user-name');
    const pEmail = document.getElementById('pending-user-email');
    const pGrade = document.getElementById('pending-user-grade');
    const pRole = document.getElementById('pending-user-role');
    if (pName) pName.textContent = currentUser.name;
    if (pEmail) pEmail.textContent = currentUser.email;
    if (pGrade) pGrade.textContent = `${currentUser.grade} ${currentUser.classNum}`;
    if (pRole) pRole.textContent = `${currentUser.department} • ${currentUser.role}`;
  } else if (currentUser.status === 'rejected') {
    switchView('rejected');
  }
}

export function updateUserUI() {
  const badge = document.getElementById('user-badge');
  updateMasterAdminButtonUI();
  if (!badge) return;

  if (currentUser.isAuthenticated && currentUser.name) {
    const initial = currentUser.name.charAt(0);
    const isKakao = (currentUser.provider === 'kakao') || (currentUser.uid && String(currentUser.uid).startsWith('kakao_'));

    let avatarHtml = '';
    if (currentUser.avatarType === 'custom' && currentUser.customPhotoURL) {
      avatarHtml = `
        <div class="relative w-5 h-5 shrink-0">
          <img src="${currentUser.customPhotoURL}" class="w-5 h-5 rounded-full object-cover shrink-0" alt="avatar" />
          ${getProviderMiniBadgeHtml(isKakao)}
        </div>
      `;
    } else if (currentUser.avatarType === 'provider') {
      avatarHtml = getProviderOfficialSymbolHtml(isKakao, 'w-5 h-5');
    } else if (currentUser.photoURL) {
      avatarHtml = `
        <div class="relative w-5 h-5 shrink-0">
          <img src="${currentUser.photoURL}" class="w-5 h-5 rounded-full object-cover shrink-0" alt="avatar" />
          ${getProviderMiniBadgeHtml(isKakao)}
        </div>
      `;
    } else {
      avatarHtml = `<span class="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0">${initial}</span>`;
    }

    const adminBadgeHtml = currentUser.isAdmin
      ? `<span class="text-[9px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold shrink-0">관리자</span>`
      : '';

    badge.innerHTML = `
      <div class="inline-flex items-center gap-2 pl-2.5 pr-1.5 py-1 bg-white text-slate-800 rounded-xl text-xs font-semibold border border-slate-200 shadow-2xs">
        <div class="flex items-center gap-1.5">
          ${avatarHtml}
          <span class="max-w-[75px] sm:max-w-[110px] truncate font-bold text-slate-900">${escapeHtml(currentUser.name)}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 font-medium hidden md:inline">${escapeHtml(currentUser.department || currentUser.role)}</span>
          ${adminBadgeHtml}
        </div>
        <button type="button" onclick="openProfileEditModal()" class="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition" title="내 프로필 수정">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
        </button>
        <button type="button" onclick="handleLogout()" class="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition" title="로그아웃">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
        </button>
      </div>
    `;
  } else {
    badge.innerHTML = `
      <div class="inline-flex items-center gap-1.5">
        <button onclick="handleGoogleLogin()" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-bold shadow-xs transition whitespace-nowrap active:scale-95">
          <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"/><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"/><path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15s.7 5.3 1.9 7.7l3.7-2.9z"/><path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16c1.8 3.7 5.6 7 10.1 7z"/></svg>
          <span>Google 로그인</span>
        </button>
        <button onclick="handleKakaoLogin()" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#FEE500] hover:bg-[#f5db00] border border-[#e6cf00] text-[#3C1E1E] text-xs font-bold shadow-xs transition whitespace-nowrap active:scale-95">
          <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="#3C1E1E"><path d="M12 2C6.477 2 2 5.925 2 10.789c0 3.104 1.922 5.825 4.832 7.375l-1.23 4.58a.308.308 0 00.467.346l5.254-3.502A12.297 12.297 0 0012 19.578c5.523 0 10-3.925 10-8.789C22 5.925 17.523 2 12 2z"/></svg>
          <span>카카오 로그인</span>
        </button>
      </div>
    `;
  }
  updateAdminDebugModeUI();
}

export function loadLocalProfile() {
  try {
    const saved = localStorage.getItem('doksan_user_profile');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.name) {
        updateCurrentUser({
          name: parsed.name,
          grade: parsed.grade || '2학년',
          role: parsed.role || '행사기획부',
          isAuthenticated: true
        });
      }
    }
  } catch (err) {
    console.warn('Failed to load profile from localStorage:', err);
  }
  updateUserUI();
  renderAgendas();
}

export function openProfileEditModal() {
  if (!currentUser.isAuthenticated) {
    showToast('로그인이 필요합니다.', 'warning');
    return;
  }
  const modal = document.getElementById('modal-profile-edit');
  const nameInput = document.getElementById('edit-profile-name');
  const gradeSelect = document.getElementById('edit-profile-grade');
  const roleSelect = document.getElementById('edit-profile-role');

  if (nameInput) nameInput.value = currentUser.name || '';
  if (gradeSelect) gradeSelect.value = currentUser.grade || '2학년';
  if (roleSelect) {
    const targetRole = currentUser.role || currentUser.department || '행사기획부';
    let exists = false;
    for (let i = 0; i < roleSelect.options.length; i++) {
      if (roleSelect.options[i].value === targetRole) {
        exists = true;
        break;
      }
    }
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = targetRole;
      opt.textContent = targetRole;
      roleSelect.appendChild(opt);
    }
    roleSelect.value = targetRole;
  }

  // Pre-populate Avatar Choice and Previews
  const currentAvatarType = currentUser.avatarType || 'oauth';
  const targetRadio = document.querySelector(`input[name="edit-avatar-type"][value="${currentAvatarType}"]`);
  if (targetRadio) targetRadio.checked = true;

  const editOauthImg = document.getElementById('edit-avatar-preview-oauth');
  if (editOauthImg) {
    editOauthImg.src = currentUser.photoURL || ('https://api.dicebear.com/7.x/bottts/svg?seed=' + encodeURIComponent(currentUser.uid));
  }
  const editProviderDiv = document.getElementById('edit-avatar-preview-provider');
  if (editProviderDiv) {
    const isKakao = (currentUser.provider === 'kakao') || (currentUser.uid && String(currentUser.uid).startsWith('kakao_'));
    editProviderDiv.innerHTML = getProviderOfficialSymbolHtml(isKakao, 'w-7 h-7');
  }
  const editCustomImg = document.getElementById('edit-avatar-preview-custom');
  const editCustomPlaceholder = document.getElementById('edit-avatar-preview-custom-placeholder');
  if (currentUser.customPhotoURL) {
    if (editCustomImg) {
      editCustomImg.src = currentUser.customPhotoURL;
      editCustomImg.classList.remove('hidden');
    }
    if (editCustomPlaceholder) editCustomPlaceholder.classList.add('hidden');
  } else {
    if (editCustomImg) editCustomImg.classList.add('hidden');
    if (editCustomPlaceholder) editCustomPlaceholder.classList.remove('hidden');
  }

  selectedCustomAvatarDataUrl = null;
  const fileNameLabel = document.getElementById('edit-avatar-file-name');
  if (fileNameLabel) fileNameLabel.textContent = currentUser.customPhotoURL ? '기존 등록된 커스텀 사진' : '선택된 파일 없음';

  toggleAvatarUploadBox(currentAvatarType === 'custom');

  if (modal) modal.classList.remove('hidden');
}

export function closeProfileEditModal() {
  const modal = document.getElementById('modal-profile-edit');
  if (modal) modal.classList.add('hidden');
}

export function toggleAvatarUploadBox(isCustom) {
  const box = document.getElementById('edit-avatar-upload-box');
  if (box) {
    if (isCustom) box.classList.remove('hidden');
    else box.classList.add('hidden');
  }
}

let selectedCustomAvatarDataUrl = null;

export function handleCustomAvatarSelected(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const fileNameLabel = document.getElementById('edit-avatar-file-name');
  if (fileNameLabel) fileNameLabel.textContent = file.name;

  const reader = new FileReader();
  reader.onload = (readerEvent) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX_SIZE = 300;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > MAX_SIZE) {
          height = Math.round((height * MAX_SIZE) / width);
          width = MAX_SIZE;
        }
      } else {
        if (height > MAX_SIZE) {
          width = Math.round((width * MAX_SIZE) / height);
          height = MAX_SIZE;
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      selectedCustomAvatarDataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const previewCustom = document.getElementById('edit-avatar-preview-custom');
      const previewPlaceholder = document.getElementById('edit-avatar-preview-custom-placeholder');
      if (previewCustom) {
        previewCustom.src = selectedCustomAvatarDataUrl;
        previewCustom.classList.remove('hidden');
      }
      if (previewPlaceholder) previewPlaceholder.classList.add('hidden');
      showToast('새 프로필 사진이 준비되었습니다. [프로필 저장]을 누르면 반영됩니다.', 'info');
    };
    img.src = readerEvent.target.result;
  };
  reader.readAsDataURL(file);
}

export async function handleProfileEditSubmit(e) {
  e.preventDefault();
  if (!authUser || !db) {
    showToast('로그인이 필요합니다.', 'warning');
    return;
  }

  const nameInput = document.getElementById('edit-profile-name');
  const gradeSelect = document.getElementById('edit-profile-grade');
  const roleSelect = document.getElementById('edit-profile-role');

  const newName = nameInput ? nameInput.value.trim() : '';
  const newGrade = gradeSelect ? gradeSelect.value : '2학년';
  const newRole = roleSelect ? roleSelect.value : '행사기획부';

  if (!newName) {
    showToast('이름을 입력해 주세요.', 'warning');
    return;
  }

  const avatarRadio = document.querySelector('input[name="edit-avatar-type"]:checked');
  const selectedAvatarType = avatarRadio ? avatarRadio.value : (currentUser.avatarType || 'oauth');

  try {
    const userDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', authUser.uid);
    const updatePayload = {
      name: newName,
      grade: newGrade,
      role: newRole,
      department: newRole,
      avatarType: selectedAvatarType,
      updatedAt: Date.now()
    };

    if (selectedAvatarType === 'custom' && selectedCustomAvatarDataUrl) {
      updatePayload.customPhotoURL = selectedCustomAvatarDataUrl;
    }

    await updateDoc(userDocRef, updatePayload);

    updateCurrentUser({
      name: newName,
      grade: newGrade,
      role: newRole,
      department: newRole,
      avatarType: selectedAvatarType,
      ...(updatePayload.customPhotoURL ? { customPhotoURL: updatePayload.customPhotoURL } : {})
    });

    try {
      localStorage.setItem('doksan_user_profile', JSON.stringify({ name: newName, grade: newGrade, role: newRole }));
    } catch (err) {}

    updateUserUI();
    syncPresenceToCloud();
    closeProfileEditModal();
    showToast('프로필 정보 및 아바타가 안전하게 변경되었습니다.', 'success');
    if (typeof window.renderAgendas === 'function') {
      window.renderAgendas();
    }
  } catch (err) {
    console.error('Profile update error:', err);
    showToast('프로필 변경 실패: ' + err.message, 'warning');
  }
}


export function startAllUsersListener() {
  if (allUsersUnsubscribe) return;
  const usersColRef = collection(db, 'artifacts', appId, 'public', 'data', 'users');
  allUsersUnsubscribe = onSnapshot(usersColRef, (snapshot) => {
    allUsersList = [];
    snapshot.forEach(docSnap => {
      allUsersList.push({ id: docSnap.id, ...docSnap.data() });
    });
    if (typeof window !== 'undefined') {
      window.allUsersList = allUsersList;
    }
    updateAdminBadgesAndLists();
    if (typeof window.renderAgendas === 'function') {
      window.renderAgendas();
    }
  });
}

export function updateAdminBadgesAndLists() {
  if (!allUsersList || allUsersList.length === 0) return;
  const pendingCount = allUsersList.filter(u => u.status === 'pending').length;
  const isMasterViewer = isMasterAdmin(authUser || currentUser);

  // 오직 총괄관리자 본인 계정으로 접근했을 때만 본인이 포함되고, 그 외 타인에게는 완전 스텔스
  const approvedCount = allUsersList.filter(u => {
    if (u.status !== 'approved') return false;
    const isMasterAccount = isMasterAdmin(u);
    if (isMasterAccount && !isMasterViewer) return false;
    return true;
  }).length;

  const badge = document.getElementById('admin-pending-badge');
  const tabPendingBadge = document.getElementById('tab-pending-count-badge');
  const tabMembersBadge = document.getElementById('tab-members-count-badge');

  if (badge) {
    if (pendingCount > 0) {
      badge.textContent = pendingCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
  if (tabPendingBadge) tabPendingBadge.textContent = pendingCount;
  if (tabMembersBadge) tabMembersBadge.textContent = approvedCount;

  updateMasterAdminButtonUI();

  if (currentUser.isAdmin || currentUser.canApprove) {
    renderAdminPendingList();
    renderAdminMembersList();
  }
}

export function updateMasterAdminButtonUI() {
  const isMaster = Boolean(currentUser.isAuthenticated && isMasterAdmin(currentUser || authUser));
  const btnHeaderAudit = document.getElementById('btn-header-audit');
  if (btnHeaderAudit) {
    btnHeaderAudit.classList.toggle('hidden', !isMaster);
  }
}

export function setupAdminListeners() {
  const btnAdmin = document.getElementById('btn-admin-console');
  if (btnAdmin) btnAdmin.classList.remove('hidden');
  startAllUsersListener();
  updateAdminBadgesAndLists();
  updateMasterAdminButtonUI();
}

/**
 * 총괄관리자 전용 독립 감사 원장 모달 제어
 */
export function openAuditModal() {
  const isMaster = Boolean(currentUser.isAuthenticated && isMasterAdmin(currentUser || authUser));
  if (!isMaster) {
    showToast('감사 이력 관리는 총괄관리자만 접근할 수 있습니다.', 'warning');
    return;
  }

  const modal = document.getElementById('modal-audit-log');
  if (modal) {
    modal.classList.remove('hidden');
    loadActivityLogs(true);
  }
}

export function closeAuditModal() {
  const modal = document.getElementById('modal-audit-log');
  if (modal) modal.classList.add('hidden');
}

export function openAdminModal() {
  if (!currentUser.isAdmin && !currentUser.canApprove) {
    showToast('관리자 또는 승인 권한이 필요합니다.', 'warning');
    return;
  }
  const modal = document.getElementById('modal-admin');
  if (modal) modal.classList.remove('hidden');

  const tabConfig = document.getElementById('admin-tab-config');
  if (tabConfig) {
    if (currentUser.isAdmin) {
      tabConfig.classList.remove('hidden');
    } else {
      tabConfig.classList.add('hidden');
    }
  }

  const tabBranding = document.getElementById('admin-tab-branding');
  if (tabBranding) {
    if (currentUser.isAdmin) {
      tabBranding.classList.remove('hidden');
    } else {
      tabBranding.classList.add('hidden');
    }
  }

  const tabBackup = document.getElementById('admin-tab-backup');
  if (tabBackup) {
    if (currentUser.isAdmin) {
      tabBackup.classList.remove('hidden');
    } else {
      tabBackup.classList.add('hidden');
    }
  }

  switchAdminTab('pending');
}

export function closeAdminModal() {
  const modal = document.getElementById('modal-admin');
  if (modal) modal.classList.add('hidden');
}

export function switchAdminTab(tab) {
  if (tab === 'config' && !currentUser.isAdmin) {
    showToast('카카오톡 키 관리는 관리자만 접근할 수 있습니다.', 'warning');
    return;
  }
  if (tab === 'branding' && !currentUser.isAdmin) {
    showToast('사이트 브랜딩 관리는 관리자만 접근할 수 있습니다.', 'warning');
    return;
  }
  if (tab === 'backup' && !currentUser.isAdmin) {
    showToast('데이터 백업 및 복원은 관리자만 접근할 수 있습니다.', 'warning');
    return;
  }

  const viewPending = document.getElementById('admin-view-pending');
  const viewMembers = document.getElementById('admin-view-members');
  const viewConfig = document.getElementById('admin-view-config');
  const viewBranding = document.getElementById('admin-view-branding');
  const viewBackup = document.getElementById('admin-view-backup');

  const tabPending = document.getElementById('admin-tab-pending');
  const tabMembers = document.getElementById('admin-tab-members');
  const tabConfig = document.getElementById('admin-tab-config');
  const tabBranding = document.getElementById('admin-tab-branding');
  const tabBackup = document.getElementById('admin-tab-backup');

  if (viewPending) viewPending.classList.toggle('hidden', tab !== 'pending');
  if (viewMembers) viewMembers.classList.toggle('hidden', tab !== 'members');
  if (viewConfig) viewConfig.classList.toggle('hidden', tab !== 'config');
  if (viewBranding) viewBranding.classList.toggle('hidden', tab !== 'branding');
  if (viewBackup) viewBackup.classList.toggle('hidden', tab !== 'backup');

  const activeClass = "px-3.5 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white transition flex items-center gap-1.5 shrink-0";
  const inactiveClass = "px-3.5 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 transition flex items-center gap-1.5 shrink-0";

  if (tabPending) tabPending.className = tab === 'pending' ? activeClass : inactiveClass;
  if (tabMembers) tabMembers.className = tab === 'members' ? activeClass : inactiveClass;
  if (tabConfig) tabConfig.className = tab === 'config' ? activeClass : inactiveClass;
  if (tabBranding) tabBranding.className = tab === 'branding' ? activeClass : inactiveClass;
  if (tabBackup) tabBackup.className = tab === 'backup' ? activeClass : inactiveClass;

  if (tab === 'pending') renderAdminPendingList();
  else if (tab === 'members') renderAdminMembersList();
  else if (tab === 'config') {
    updateKakaoKeyUI();
    updateGeminiKeyUI();
    updateAdminDebugModeUI();
    updateKakaoOAuthKeyUI();
  }
  else if (tab === 'branding') {
    populateBrandingForm();
  }
}

export async function toggleAdminDebugMode(enabled) {
  if (!currentUser.isAdmin) {
    showToast('관리자만 디버그 모드를 변경할 수 있습니다.', 'warning');
    updateAdminDebugModeUI();
    return;
  }

  setIsAdminDebugMode(enabled);
  updateAdminDebugModeUI();
  if (typeof window.renderAgendas === 'function') {
    window.renderAgendas();
  }

  try {
    if (db) {
      const configDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'config', 'settings');
      await setDoc(configDocRef, {
        adminDebugMode: !!enabled,
        updatedAt: Date.now(),
        updatedBy: currentUser.email || '관리자'
      }, { merge: true });
    }
    showToast(`디버그 모드가 클라우드에 ${enabled ? '활성화' : '비활성화'} 저장되었습니다.`, 'info');
  } catch (err) {
    console.error('Failed to sync adminDebugMode to cloud:', err);
    showToast('디버그 모드 클라우드 저장 중 오류가 발생했습니다.', 'warning');
  }
}

export function updateAdminDebugModeUI() {
  const toggle = document.getElementById('admin-debug-mode-toggle');
  const statusText = document.getElementById('admin-debug-status-text');
  if (toggle) {
    toggle.checked = !!isAdminDebugMode;
  }
  if (statusText) {
    if (isAdminDebugMode) {
      statusText.textContent = '현재 상태: 🛠️ 디버그 모드 활성화됨 (클라우드 공통 적용 - 관리자 댓글창에 임의 작성자 입력칸 노출)';
      statusText.className = 'text-xs font-semibold text-emerald-800 bg-emerald-100 px-3 py-1.5 rounded-xl border border-emerald-200';
    } else {
      statusText.textContent = '현재 상태: 디버그 모드 비활성화 (기본 관리자 계정으로 댓글 작성)';
      statusText.className = 'text-xs font-semibold text-purple-800 bg-purple-100 px-3 py-1.5 rounded-xl';
    }
  }

  // 관리자이면서 디버그 모드가 켜진 경우에만 "기본 예시 안건 올리기" 버튼 노출
  const seedBtn = document.getElementById('btn-seed-demo');
  const seedSeparator = document.getElementById('seed-demo-separator');
  const shouldShowSeed = Boolean(currentUser && currentUser.isAdmin && isAdminDebugMode);
  if (seedBtn) {
    if (shouldShowSeed) {
      seedBtn.classList.remove('hidden');
    } else {
      seedBtn.classList.add('hidden');
    }
  }
  if (seedSeparator) {
    if (shouldShowSeed) {
      seedSeparator.classList.remove('hidden');
    } else {
      seedSeparator.classList.add('hidden');
    }
  }

  // 관리자 권한이 있는 사용자에게만 푸터의 [관리자 운영 지침서] 링크 노출
  const footerAdminGuideLink = document.getElementById('footer-guide-admin-link');
  if (footerAdminGuideLink) {
    const isRealAdmin = currentUser && (currentUser.isAdmin || currentUser.canApprove);
    if (isRealAdmin || isAdminDebugMode) {
      footerAdminGuideLink.classList.remove('hidden');
      footerAdminGuideLink.style.display = 'inline-flex';
    } else {
      footerAdminGuideLink.classList.add('hidden');
      footerAdminGuideLink.style.display = 'none';
    }
  }
}

export function renderAdminPendingList() {
  const container = document.getElementById('admin-pending-list');
  if (!container) return;

  const pendingUsers = allUsersList.filter(u => u.status === 'pending');
  if (pendingUsers.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
        <svg class="w-8 h-8 mx-auto mb-2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        <p class="text-xs font-medium">현재 가입 승인 대기 중인 신청자가 없습니다.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = pendingUsers.map(user => {
    const uid = user.uid || user.id;
    const avatar = getUnifiedUserAvatarHtml(user, 'w-10 h-10', 'rounded-xl');

    const applyTime = user.createdAt ? new Date(user.createdAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

    return `
      <div class="p-3.5 bg-slate-50 hover:bg-white rounded-2xl border border-slate-200 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
        <div class="flex items-center gap-3 min-w-0">
          ${avatar}
          <div class="min-w-0">
            <div class="flex items-center gap-1.5 flex-wrap">
              <h4 class="font-bold text-slate-900 text-sm">${escapeHtml(user.name || '이름없음')}</h4>
              <span class="text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-100 text-blue-800">${escapeHtml(user.grade || '2학년')}</span>
              <span class="text-[11px] font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700">${escapeHtml(user.role || '행사기획부')}</span>
            </div>
            <div class="flex items-center gap-2 text-xs text-slate-500 mt-1">
              <span>${escapeHtml(user.email || '')}</span>
              <span>•</span>
              <span>신청: ${applyTime}</span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0 self-end sm:self-auto">
          <button onclick="rejectUser('${uid}')" class="px-3 py-1.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-semibold transition">
            반려
          </button>
          <button onclick="approveUser('${uid}')" class="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition flex items-center gap-1">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
            <span>승인</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

export function renderAdminMembersList() {
  const container = document.getElementById('admin-members-list');
  if (!container) return;

  const searchInput = document.getElementById('admin-member-search');
  const deptFilter = document.getElementById('admin-member-dept-filter');

  const queryText = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const filterDept = deptFilter ? deptFilter.value : 'all';

  const isMasterViewer = isMasterAdmin(authUser || currentUser);

  let approvedUsers = allUsersList.filter(u => {
    if (u.status !== 'approved') return false;
    const isMasterAccount = isMasterAdmin(u);
    // 오직 최고관리자 본인에게만 보이고, 다른 관리자/부원에게는 완전 은폐(스텔스)
    if (isMasterAccount && !isMasterViewer) {
      return false;
    }
    return true;
  });

  const tabMembersBadge = document.getElementById('tab-members-count-badge');
  if (tabMembersBadge) tabMembersBadge.textContent = approvedUsers.length;

  if (filterDept !== 'all') {
    approvedUsers = approvedUsers.filter(u => (u.role || '') === filterDept);
  }
  if (queryText) {
    approvedUsers = approvedUsers.filter(u => 
      (u.name && u.name.toLowerCase().includes(queryText)) ||
      (u.email && u.email.toLowerCase().includes(queryText))
    );
  }

  if (approvedUsers.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
        <p class="text-xs font-medium">검색 조건에 맞는 부원이 없습니다.</p>
      </div>
    `;
    return;
  }

  const grades = ['2학년', '1학년'];
  const roles = ['행사기획부', '운영지원부', '편집소통부', '전교회장', '전교부회장'];

  container.innerHTML = approvedUsers.map(user => {
    const uid = user.uid || user.id;
    const userEmail = (user.email || '').toLowerCase();
    const isMaster = Boolean(MASTER_ADMIN_EMAIL) && (userEmail === MASTER_ADMIN_EMAIL.toLowerCase());
    const isCoAdmin = Boolean(CO_ADMIN_EMAIL) && (userEmail === CO_ADMIN_EMAIL.toLowerCase());
    const avatar = getUnifiedUserAvatarHtml(user, 'w-10 h-10', 'rounded-xl');

    const gradeOptions = grades.map(g => `<option value="${g}" ${user.grade === g ? 'selected' : ''}>${g}</option>`).join('');
    const roleOptions = roles.map(r => `<option value="${r}" ${user.role === r ? 'selected' : ''}>${r}</option>`).join('');

    let adminBadgeOrToggle = '';
    let approveRoleToggle = '';
    let deleteBtn = '';
    let roleSelector = '';

    if (isMaster) {
      adminBadgeOrToggle = `<span class="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800 text-[11px] font-black shrink-0 shadow-2xs">⭐ 최고관리자</span>`;
      roleSelector = `<span class="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-900 border border-amber-200 text-xs font-bold shrink-0">총괄</span>`;
    } else if (isCoAdmin) {
      adminBadgeOrToggle = `<span class="px-2.5 py-1 rounded-lg bg-indigo-100 text-indigo-800 text-[11px] font-black shrink-0 shadow-2xs">⭐ 공동관리자</span>`;
      if (currentUser.isAdmin) {
        roleSelector = `
          <select onchange="updateUserRole('${uid}', this.value)" class="px-2 py-1 rounded-lg border border-slate-200 text-xs bg-slate-50 font-medium focus:ring-1 focus:ring-indigo-500 focus:outline-none" title="직책/부서 변경">
            ${roleOptions}
          </select>
        `;
      }
    } else if (currentUser.isAdmin) {
      roleSelector = `
        <select onchange="updateUserRole('${uid}', this.value)" class="px-2 py-1 rounded-lg border border-slate-200 text-xs bg-slate-50 font-medium focus:ring-1 focus:ring-indigo-500 focus:outline-none" title="직책/부서 변경">
          ${roleOptions}
        </select>
      `;

      approveRoleToggle = `
        <button onclick="toggleUserCanApprove('${uid}', ${Boolean(user.canApprove)})" class="px-2.5 py-1 rounded-lg text-xs font-semibold ${user.canApprove ? 'bg-purple-100 text-purple-800 hover:bg-purple-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'} transition shrink-0" title="신규 회원 승인 권한 토글">
          ${user.canApprove ? '🛡️ 승인권 회수' : '🛡️ 승인권 부여'}
        </button>
      `;

      adminBadgeOrToggle = `
        <button onclick="toggleUserAdmin('${uid}', ${Boolean(user.isAdmin)})" class="px-2.5 py-1 rounded-lg text-xs font-semibold ${user.isAdmin ? 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'} transition shrink-0" title="관리자 권한 토글">
          ${user.isAdmin ? '관리자 해제' : '관리자 임명'}
        </button>
      `;

      deleteBtn = `
        <button onclick="deleteUserMember('${uid}')" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition" title="부원 제명/삭제">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
        </button>
      `;
    }

    return `
      <div class="p-3 bg-white rounded-2xl border border-slate-200 hover:border-indigo-200 transition shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          ${avatar}
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h4 class="font-bold text-slate-900 text-sm truncate">${escapeHtml(user.name || '이름없음')}</h4>
              <span class="text-[11px] text-slate-500 font-medium">${escapeHtml(user.grade || '2학년')} ${escapeHtml(user.classNum || '')}</span>
              ${user.isAdmin ? '<span class="text-[10px] px-1.5 py-0.2 rounded bg-indigo-100 text-indigo-700 font-bold">Admin</span>' : ''}
              ${user.canApprove ? '<span class="text-[10px] px-1.5 py-0.2 rounded bg-purple-100 text-purple-700 font-bold flex items-center gap-0.5">🛡️ 승인권</span>' : ''}
            </div>
            <p class="text-xs text-slate-400 truncate">${escapeHtml(user.email || '')}</p>
          </div>
        </div>

        <div class="flex items-center gap-2 flex-wrap shrink-0">
          ${(currentUser.isAdmin && !isMaster) ? `
            <select onchange="updateUserGrade('${uid}', this.value)" class="px-2 py-1 rounded-lg border border-slate-200 text-xs bg-slate-50 font-medium focus:ring-1 focus:ring-indigo-500 focus:outline-none" title="학년 변경">
              ${gradeOptions}
            </select>
          ` : ''}
          ${roleSelector}
          ${approveRoleToggle}
          ${adminBadgeOrToggle}
          ${deleteBtn}
        </div>
      </div>
    `;
  }).join('');
}

export async function toggleUserCanApprove(uid, currentCanApprove) {
  if (!currentUser.isAdmin) {
    showToast('관리자만 승인 권한을 부여하거나 회수할 수 있습니다.', 'warning');
    return;
  }
  const targetUser = allUsersList.find(u => u.uid === uid || u.id === uid);
  if (targetUser && targetUser.email && ADMIN_EMAILS.includes(targetUser.email.toLowerCase())) {
    showToast('지정 관리자 계정은 항상 승인 권한을 보유합니다.', 'info');
    return;
  }
  const newState = !currentCanApprove;
  const targetName = targetUser ? targetUser.name : '해당 부원';
  const msg = newState
    ? `'${targetName}' 부원에게 신규 회원 가입 승인 권한을 부여하시겠습니까?\n(승인 권한 보유 시 관리자 콘솔에서 신규 회원을 승인할 수 있습니다.)`
    : `'${targetName}' 부원의 가입 승인 권한을 회수하시겠습니까?`;

  showCustomConfirm(msg, async () => {
    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', uid);
      await updateDoc(docRef, { canApprove: newState });
      showToast(`'${targetName}' 부원의 승인 권한이 ${newState ? '부여' : '회수'}되었습니다.`, 'success');

      logActivity({
        category: 'ADMIN',
        action: 'ADMIN_TOGGLE_APPROVER',
        target: { type: 'user', id: uid, title: targetName },
        details: {
          summary: `'${targetName}' 부원의 가입 승인 권한(canApprove)을 ${newState ? '부여' : '회수'}함`,
          before: !newState,
          after: newState
        }
      });
    } catch (err) {
      showToast('권한 변경 실패: ' + err.message, 'warning');
    }
  });
}

export async function approveUser(uid) {
  const targetUser = allUsersList.find(u => u.uid === uid || u.id === uid);
  const targetName = targetUser ? targetUser.name : '신규 신청자';

  try {
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', uid);
    await updateDoc(docRef, {
      status: 'approved',
      approvedAt: Date.now(),
      approvedBy: currentUser.email || '관리자'
    });
    showToast('부원 가입을 승인했습니다.', 'success');

    logActivity({
      category: 'MEMBER',
      action: 'MEMBER_APPROVE',
      target: { type: 'user', id: uid, title: targetName },
      details: {
        summary: `신규 부원 [${targetName}] 가입 신청을 승인함 (소속: ${targetUser?.role || '일반'})`,
        after: 'approved'
      }
    });
  } catch (err) {
    showToast('승인 실패: ' + err.message, 'warning');
  }
}

export async function rejectUser(uid) {
  const targetUser = allUsersList.find(u => u.uid === uid || u.id === uid);
  const targetName = targetUser ? targetUser.name : '신청자';

  showCustomConfirm('해당 부원의 가입 신청을 반려하시겠습니까?', async () => {
    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', uid);
      await updateDoc(docRef, {
        status: 'rejected',
        rejectedAt: Date.now()
      });
      showToast('가입 신청을 반려했습니다.', 'info');

      logActivity({
        category: 'MEMBER',
        action: 'MEMBER_REJECT',
        target: { type: 'user', id: uid, title: targetName },
        details: {
          summary: `부원 [${targetName}]의 가입 신청을 반려함`,
          after: 'rejected'
        }
      });
    } catch (err) {
      showToast('반려 실패: ' + err.message, 'warning');
    }
  });
}

export async function updateUserGrade(uid, newGrade) {
  const targetUser = allUsersList.find(u => u.uid === uid || u.id === uid);
  const targetName = targetUser ? targetUser.name : '해당 부원';

  try {
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', uid);
    await updateDoc(docRef, { grade: newGrade });
    showToast('학년이 변경되었습니다.', 'success');

    logActivity({
      category: 'MEMBER',
      action: 'MEMBER_ROLE_UPDATE',
      target: { type: 'user', id: uid, title: targetName },
      details: {
        summary: `[${targetName}] 부원의 학년을 '${newGrade}'(으)로 변경함`,
        before: targetUser?.grade,
        after: newGrade
      }
    });
  } catch (err) {
    showToast('학년 변경 실패: ' + err.message, 'warning');
  }
}

export async function updateUserRole(uid, newRole) {
  const targetUser = allUsersList.find(u => u.uid === uid || u.id === uid);
  const targetName = targetUser ? targetUser.name : '해당 부원';

  try {
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', uid);
    await updateDoc(docRef, { role: newRole });
    showToast('직책이 변경되었습니다.', 'success');

    logActivity({
      category: 'MEMBER',
      action: 'MEMBER_ROLE_UPDATE',
      target: { type: 'user', id: uid, title: targetName },
      details: {
        summary: `[${targetName}] 부원의 학생회 직책을 '${newRole}'(으)로 변경함`,
        before: targetUser?.role,
        after: newRole
      }
    });
  } catch (err) {
    showToast('직책 변경 실패: ' + err.message, 'warning');
  }
}

export async function toggleUserAdmin(uid, currentIsAdmin) {
  if (!currentUser.isAdmin) {
    showToast('관리자만 관리자 권한을 변경할 수 있습니다.', 'warning');
    return;
  }
  const targetUser = allUsersList.find(u => u.uid === uid || u.id === uid);
  if (targetUser && targetUser.email && ADMIN_EMAILS.includes(targetUser.email.toLowerCase())) {
    showToast('지정 관리자 계정의 권한은 변경할 수 없습니다.', 'info');
    return;
  }
  const newAdminState = !currentIsAdmin;
  const targetName = targetUser ? targetUser.name : '해당 부원';
  const msg = newAdminState ? '해당 부원에게 관리자 권한을 부여하시겠습니까?' : '해당 부원의 관리자 권한을 회수하시겠습니까?';
  showCustomConfirm(msg, async () => {
    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', uid);
      await updateDoc(docRef, { isAdmin: newAdminState });
      showToast(`관리자 권한이 ${newAdminState ? '부여' : '회수'}되었습니다.`, 'success');

      logActivity({
        category: 'ADMIN',
        action: 'ADMIN_TOGGLE_ADMIN',
        target: { type: 'user', id: uid, title: targetName },
        details: {
          summary: `[${targetName}] 부원에게 관리자 권한을 ${newAdminState ? '부여' : '회수'}함`,
          before: !newAdminState,
          after: newAdminState
        }
      });
    } catch (err) {
      showToast('권한 변경 실패: ' + err.message, 'warning');
    }
  });
}

export async function deleteUserMember(uid) {
  if (!currentUser.isAdmin) {
    showToast('관리자만 부원을 제명할 수 있습니다.', 'warning');
    return;
  }
  const targetUser = allUsersList.find(u => u.uid === uid || u.id === uid);
  if (targetUser && targetUser.email && ADMIN_EMAILS.includes(targetUser.email.toLowerCase())) {
    showToast('지정 관리자 계정은 삭제할 수 없습니다.', 'warning');
    return;
  }
  showCustomConfirm('해당 부원을 제명/삭제하시겠습니까? (삭제 시 브리핑룸 접근이 차단됩니다)', async () => {
    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', uid);
      await deleteDoc(docRef);
      showToast('부원 정보가 삭제되었습니다.', 'info');

      logActivity({
        category: 'MEMBER',
        action: 'MEMBER_DELETE',
        target: { type: 'user', id: uid, title: targetUser?.name || '부원' },
        details: {
          summary: `[${targetUser?.name || '부원'}] 부원을 명부에서 제명/삭제함 (이메일: ${targetUser?.email || '없음'})`,
          before: targetUser?.name || ''
        }
      });
    } catch (err) {
      showToast('삭제 실패: ' + err.message, 'warning');
    }
  });
}

/**
 * 댓글 작성자 클릭 시 관리자 전용 프로필 확인/수정 모달 열기
 * OAuth 가입 부원의 경우 프로필 모달 및 카카오/구글 제공자 뱃지 노출
 */
export async function openMemberProfileModalByUid(targetUid, authorName, isPersona) {
  if (isPersona === 'true' || isPersona === true) {
    showToast(`'${authorName}' 님은 사전 리허설용 가상 페르소나 부원입니다. 디버그 모드에서 댓글 수정/삭제가 가능합니다.`, 'info');
    return;
  }
  if (!currentUser || !currentUser.isAdmin) {
    showToast('부원 프로필 조회의 경우 관리자 권한이 필요합니다.', 'warning');
    return;
  }

  const modal = document.getElementById('modal-admin-member-view');
  if (!modal) return;

  // 캐시된 전체 부원 목록에서 탐색하거나 Firestore에서 직접 조회
  let targetUser = allUsersList.find(u => (u.uid === targetUid || u.id === targetUid));
  if (!targetUser && db) {
    try {
      const userSnap = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', targetUid));
      if (userSnap.exists()) {
        targetUser = { uid: targetUid, ...userSnap.data() };
      }
    } catch (e) {
      console.error('Fetch user for member view error:', e);
    }
  }

  if (!targetUser) {
    showToast('해당 부원의 프로필 정보를 찾을 수 없습니다.', 'warning');
    return;
  }

  const uidInput = document.getElementById('admin-member-view-uid');
  const uidText = document.getElementById('admin-member-view-uid-text');
  const nameInput = document.getElementById('admin-member-view-name');
  const gradeSelect = document.getElementById('admin-member-view-grade');
  const roleSelect = document.getElementById('admin-member-view-role');
  const emailSpan = document.getElementById('admin-member-view-email');
  const avatarImg = document.getElementById('admin-member-view-avatar');
  const providerIcon = document.getElementById('admin-member-view-provider-icon');
  const providerBadge = document.getElementById('admin-member-view-provider-badge');
  const roleBadge = document.getElementById('admin-member-view-role-badge');

  if (uidInput) uidInput.value = targetUser.uid || targetUid;
  if (uidText) uidText.textContent = targetUser.uid || targetUid;
  if (nameInput) nameInput.value = targetUser.name || authorName || '부원';
  if (gradeSelect) gradeSelect.value = targetUser.grade || '2학년';
  if (roleSelect) roleSelect.value = targetUser.role || targetUser.department || '행사기획부';
  if (emailSpan) emailSpan.textContent = targetUser.email || '(이메일 정보 없음)';

  const isKakao = (targetUser.provider === 'kakao') || (String(targetUid).startsWith('kakao_'));
  if (providerBadge) {
    providerBadge.className = isKakao 
      ? 'px-2.5 py-1 rounded-full text-[11px] font-bold inline-flex items-center gap-1.5 bg-[#FEE500]/30 text-[#3C1E1E] border border-[#e6cf00]/60 shadow-2xs'
      : 'px-2.5 py-1 rounded-full text-[11px] font-bold inline-flex items-center gap-1.5 bg-blue-50 text-blue-900 border border-blue-200 shadow-2xs';
    providerBadge.innerHTML = `
      <div class="w-3.5 h-3.5 shrink-0">
        ${isKakao 
          ? '<svg class="w-full h-full" viewBox="0 0 24 24" fill="#191919"><path d="M12 3C6.477 3 2 6.477 2 10.767c0 2.766 1.874 5.188 4.688 6.556-.206.77-.745 2.784-.853 3.208-.135.534.195.526.41.383.17-.113 2.705-1.84 3.799-2.584.63.092 1.284.14 1.956.14 5.523 0 10-3.477 10-7.767C22 6.477 17.523 3 12 3z"/></svg>' 
          : '<svg class="w-full h-full" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"/><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"/><path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15s.7 5.3 1.9 7.7l3.7-2.9z"/><path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16c1.8 3.7 5.6 7 10.1 7z"/></svg>'}
      </div>
      <span>${isKakao ? '카카오 공식 인증 계정' : 'Google 공식 인증 계정'}</span>
    `;
  }

  if (providerIcon) {
    providerIcon.innerHTML = getProviderMiniBadgeHtml(isKakao);
  }

  if (roleBadge) {
    const isAdmin = Boolean(targetUser.isAdmin || targetUser.canApprove);
    roleBadge.className = isAdmin
      ? 'px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800 border border-purple-200'
      : 'px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200';
    roleBadge.textContent = isAdmin ? '👑 관리자' : (targetUser.status === 'approved' ? '승인 부원' : '승인 대기');
  }

  const symbolWrap = document.getElementById('admin-member-view-symbol-wrap');
  const memberAvatarType = targetUser.avatarType || (targetUser.customPhotoURL ? 'custom' : (targetUser.photoURL ? 'oauth' : 'provider'));

  if (memberAvatarType === 'provider') {
    if (avatarImg) avatarImg.classList.add('hidden');
    if (symbolWrap) {
      symbolWrap.innerHTML = getProviderOfficialSymbolHtml(isKakao, 'w-16 h-16');
      symbolWrap.classList.remove('hidden');
    }
  } else {
    if (symbolWrap) symbolWrap.classList.add('hidden');
    if (avatarImg) {
      avatarImg.classList.remove('hidden');
      let photo = (memberAvatarType === 'custom' && targetUser.customPhotoURL) ? targetUser.customPhotoURL : targetUser.photoURL;
      if (!photo) {
        photo = 'https://api.dicebear.com/7.x/bottts/svg?seed=' + encodeURIComponent(targetUid);
      }
      avatarImg.src = photo;
    }
  }

  modal.classList.remove('hidden');
}

export function closeAdminMemberViewModal() {
  const modal = document.getElementById('modal-admin-member-view');
  if (modal) modal.classList.add('hidden');
}

export async function handleAdminMemberViewSave(e) {
  e.preventDefault();
  if (!currentUser || !currentUser.isAdmin || !db) {
    showToast('관리자 권한이 필요합니다.', 'warning');
    return;
  }

  const uidInput = document.getElementById('admin-member-view-uid');
  const nameInput = document.getElementById('admin-member-view-name');
  const gradeSelect = document.getElementById('admin-member-view-grade');
  const roleSelect = document.getElementById('admin-member-view-role');

  const targetUid = uidInput ? uidInput.value : '';
  if (!targetUid) return;

  const newName = nameInput ? nameInput.value.trim() : '';
  const newGrade = gradeSelect ? gradeSelect.value : '2학년';
  const newRole = roleSelect ? roleSelect.value : '행사기획부';

  try {
    const userDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', targetUid);
    await updateDoc(userDocRef, {
      name: newName,
      grade: newGrade,
      role: newRole,
      department: newRole,
      updatedAt: Date.now()
    });

    const cachedUser = allUsersList.find(u => (u.uid === targetUid || u.id === targetUid));
    if (cachedUser) {
      cachedUser.name = newName;
      cachedUser.grade = newGrade;
      cachedUser.role = newRole;
      cachedUser.department = newRole;
    }

    closeAdminMemberViewModal();
    showToast(`'${newName}' 부원의 소속 정보가 성공적으로 저장되었습니다.`, 'success');
    if (typeof window.renderAgendas === 'function') {
      window.renderAgendas();
    }
  } catch (err) {
    console.error('Admin member view save error:', err);
    showToast('부원 정보 저장 실패: ' + err.message, 'warning');
  }
}






