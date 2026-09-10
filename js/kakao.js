// =========================================================================
// 스마트 브리핑룸 - 카카오톡 SDK, 카카오 OAuth 로그인 및 단톡방 공유 모듈
// =========================================================================

import { db, appId, kakaoJsKey, setKakaoJsKey, kakaoRestApiKey, setKakaoRestApiKey, kakaoClientSecret, setKakaoClientSecret } from './config.js';
import { currentUser, currentShareAgenda, setCurrentShareAgenda, agendas } from './state.js';
import { showToast } from './utils.js';
import { currentBranding } from './branding.js';
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

export { setKakaoRestApiKey, setKakaoClientSecret };

export function initKakaoSdk() {
  if (typeof Kakao !== 'undefined') {
    if (!Kakao.isInitialized() && kakaoJsKey) {
      try {
        Kakao.init(kakaoJsKey);
        console.log('Kakao SDK initialized successfully.');
      } catch (e) {
        console.warn('Kakao SDK initialization error:', e);
      }
    }
  }
}

export function updateKakaoKeyUI() {
  const adminInput = document.getElementById('admin-kakao-key-input');
  const cfgInput = document.getElementById('cfg-kakao-key');
  const statusText = document.getElementById('admin-kakao-status-text');
  const indicator = document.getElementById('admin-kakao-status-indicator');

  if (adminInput && (!adminInput.value || (document.activeElement !== adminInput && adminInput.value !== kakaoJsKey))) {
    adminInput.value = kakaoJsKey || '';
  }
  if (cfgInput && (!cfgInput.value || (document.activeElement !== cfgInput && cfgInput.value !== kakaoJsKey))) {
    cfgInput.value = kakaoJsKey || '';
  }

  if (statusText && indicator) {
    const inputVal = adminInput ? adminInput.value.trim() : '';
    if (kakaoJsKey && kakaoJsKey.trim().length >= 10) {
      if (inputVal && inputVal !== kakaoJsKey) {
        statusText.textContent = "새 키 입력됨: [클라우드 저장 및 전체 부원 배포] 버튼을 클릭해 적용해 주세요 🔄";
        statusText.className = "text-blue-700 font-semibold";
        indicator.className = "w-2 h-2 rounded-full bg-blue-500 animate-pulse";
      } else {
        const masked = kakaoJsKey.slice(0, 6) + '...' + kakaoJsKey.slice(-4);
        statusText.textContent = `등록 완료: ${masked} (모든 부원에게 실시간 활성화됨 ✅)`;
        statusText.className = "text-emerald-700 font-semibold";
        indicator.className = "w-2 h-2 rounded-full bg-emerald-500";
      }
    } else {
      if (inputVal && inputVal.length >= 10) {
        statusText.textContent = "새 키 입력됨: [클라우드 저장 및 전체 부원 배포] 버튼을 클릭해 등록을 완료해 주세요 🔄";
        statusText.className = "text-blue-700 font-semibold";
        indicator.className = "w-2 h-2 rounded-full bg-blue-500 animate-pulse";
      } else {
        statusText.textContent = "키 미등록 (카카오톡 공유 비활성화 상태 ⚠️)";
        statusText.className = "text-amber-700 font-medium";
        indicator.className = "w-2 h-2 rounded-full bg-amber-400";
      }
    }
  }
}

export async function saveKakaoKeyFromAdmin() {
  if (!currentUser.isAdmin) {
    showToast('관리자만 카카오톡 공유 키를 변경할 수 있습니다.', 'warning');
    return;
  }
  const keyInput = document.getElementById('admin-kakao-key-input');
  const key = keyInput ? keyInput.value.trim() : '';
  if (!key) {
    showToast('카카오 JavaScript 키를 입력해 주세요.', 'warning');
    return;
  }

  try {
    if (db) {
      const configDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'config', 'settings');
      await setDoc(configDocRef, {
        kakaoJsKey: key,
        updatedAt: Date.now(),
        updatedBy: currentUser.email || '관리자'
      }, { merge: true });
    }

    setKakaoJsKey(key);
    try {
      localStorage.setItem('doksan_kakao_js_key', key);
    } catch (e) {}
    initKakaoSdk();
    updateKakaoKeyUI();

    showToast('카카오톡 키가 클라우드에 저장되어 모든 부원에게 실시간 배포되었습니다.', 'success');
  } catch (err) {
    console.error('Error saving Kakao key:', err);
    showToast('키 저장 실패: ' + err.message, 'warning');
  }
}

export function saveKakaoKey() {
  if (currentUser.isAdmin) {
    const keyInput = document.getElementById('cfg-kakao-key');
    const key = keyInput ? keyInput.value.trim() : '';
    const adminInput = document.getElementById('admin-kakao-key-input');
    if (adminInput) adminInput.value = key;
    saveKakaoKeyFromAdmin();
  } else {
    showToast('카카오톡 키 설정은 관리자만 변경할 수 있습니다.', 'info');
  }
}

export function getAgendaDeepLink(agenda) {
  if (!agenda) return (typeof window !== 'undefined' ? window.location.href : '');
  let baseOrigin = (typeof window !== 'undefined' && window.location.origin) ? window.location.origin : 'https://your-domain.web.app';
  if (typeof window !== 'undefined' && window.location && window.location.origin && !window.location.protocol.startsWith('file:')) {
    baseOrigin = window.location.origin;
  }
  const agendaId = agenda.id;
  // 쿼리(?agenda=...)와 해시(#agenda=...) 둘 다에 심어서 파라미터 유실 원천 차단
  return `${baseOrigin}/?agenda=${encodeURIComponent(agendaId)}#agenda=${encodeURIComponent(agendaId)}`;
}

export function isMobileDevice() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile/i.test(ua);
  const isIPadOS = (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return isMobileUA || isIPadOS;
}

export function openKakaoShareModal(agenda) {
  setCurrentShareAgenda(agenda);
  const titleEl = document.getElementById('share-modal-agenda-title');
  if (titleEl) titleEl.textContent = `[${agenda.category || '안건'}] ${agenda.title}`;

  // 모바일 기기(스마트폰/태블릿)이면서 Web Share API를 지원할 때만 "스마트폰 기본 공유" 노출 (PC 데스크톱에서는 100% 숨김)
  const nativeBtn = document.getElementById('btn-native-share');
  if (nativeBtn) {
    if (isMobileDevice() && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      nativeBtn.classList.remove('hidden');
    } else {
      nativeBtn.classList.add('hidden');
    }
  }

  const modal = document.getElementById('modal-kakao-share');
  if (modal) modal.classList.remove('hidden');
}

export function openKakaoShareModalById(agendaId) {
  if (typeof window.closeAllAgendaMenus === 'function') {
    window.closeAllAgendaMenus();
  }
  const agenda = agendas.find(a => a.id === agendaId);
  if (agenda) {
    openKakaoShareModal(agenda);
  }
}

export function closeKakaoShareModal() {
  const modal = document.getElementById('modal-kakao-share');
  if (modal) modal.classList.add('hidden');
  setCurrentShareAgenda(null);
}

export function copyAgendaLink() {
  if (!currentShareAgenda) return;
  const link = getAgendaDeepLink(currentShareAgenda);

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(() => {
      showToast('안건 링크가 클립보드에 복사되었습니다!', 'success');
      closeKakaoShareModal();
    }).catch(() => {
      fallbackCopyText(link);
    });
  } else {
    fallbackCopyText(link);
  }
}

function fallbackCopyText(text) {
  try {
    const input = document.createElement('textarea');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.focus();
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    showToast('안건 링크가 클립보드에 복사되었습니다!', 'success');
    closeKakaoShareModal();
  } catch (e) {
    prompt('아래 링크를 복사해 주세요:', text);
  }
}

export async function executeNativeShare() {
  if (!currentShareAgenda) return;
  const link = getAgendaDeepLink(currentShareAgenda);
  const title = (currentBranding && currentBranding.title) 
    ? `[${currentBranding.title}] ${currentShareAgenda.title}` 
    : `[브리핑룸] ${currentShareAgenda.title}`;
  const text = `부원 여러분, 브리핑룸에서 안건 투표 및 의견을 남겨주세요!\n안건: ${currentShareAgenda.title}`;

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: title,
        text: text,
        url: link
      });
      closeKakaoShareModal();
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('Native share failed, fallback to copy:', err);
        copyAgendaLink();
      }
    }
  } else {
    copyAgendaLink();
  }
}

export function executeKakaoShare() {
  if (!currentShareAgenda) return;

  if (!kakaoJsKey || (typeof Kakao !== 'undefined' && !Kakao.isInitialized())) {
    showToast('설정(톱니바퀴)에서 카카오 JavaScript 키를 먼저 등록해 주세요.', 'warning');
    closeKakaoShareModal();
    if (typeof window.openConfigModal === 'function') {
      window.openConfigModal();
    }
    return;
  }

  try {
    const deepLinkUrl = getAgendaDeepLink(currentShareAgenda);
    const shareTitle = (currentBranding && currentBranding.title) 
      ? `📌 [${currentBranding.title}] 새 안건 등록!` 
      : `📌 [스마트 브리핑룸] 새 안건 등록!`;
    const shareThumb = (currentBranding && currentBranding.thumbnailUrl && currentBranding.thumbnailUrl.startsWith('http'))
      ? currentBranding.thumbnailUrl
      : 'https://placehold.co/600x315/1e40af/ffffff?text=Doksan+Briefing+Room';

    Kakao.Share.sendDefault({
      objectType: 'feed',
      content: {
        title: shareTitle,
        description: `"${currentShareAgenda.title}"\n부원 여러분, 브리핑룸에서 투표 또는 의견을 남겨주세요! (${currentShareAgenda.targetDept || '전체 부서'})`,
        imageUrl: shareThumb,
        link: {
          mobileWebUrl: deepLinkUrl,
          webUrl: deepLinkUrl
        }
      },
      buttons: [
        {
          title: '브리핑룸에서 투표 / 의견 남기기',
          link: {
            mobileWebUrl: deepLinkUrl,
            webUrl: deepLinkUrl
          }
        }
      ]
    });
    closeKakaoShareModal();
    showToast('카카오톡 공유 창이 열렸습니다.', 'success');
  } catch (err) {
    console.error('Kakao share error:', err);
    showToast('카카오톡 공유 중 오류가 발생했습니다: ' + err.message, 'warning');
  }
}

// =========================================================================
// 카카오 OAuth 로그인 기능
// =========================================================================

/**
 * 카카오 OAuth 로그인 시작
 * 리다이렉트 방식 사용 (인앱 브라우저 및 일반 브라우저 모두 호환)
 */
export function handleKakaoLogin() {
  if (typeof Kakao === 'undefined' || !Kakao.isInitialized()) {
    showToast('카카오 SDK가 아직 초기화되지 않았습니다. 잠시 후 다시 시도해 주세요.', 'warning');
    return;
  }

  const ua = navigator.userAgent || '';
  const isKakao = /KAKAOTALK/i.test(ua);

  if (isKakao) {
    // 카카오 인앱 브라우저: 카카오 로그인 직접 실행 (인앱 탈출 불필요)
    showToast('카카오 로그인을 시작합니다.', 'info');
  }

  // 리다이렉트 방식으로 카카오 로그인 (팝업보다 안정적, 인앱 호환)
  try {
    Kakao.Auth.authorize({
      redirectUri: window.location.origin + window.location.pathname,
      scope: 'profile_nickname,profile_image'
    });
  } catch (err) {
    console.error('Kakao Auth authorize error:', err);
    showToast('카카오 로그인 시작 실패: ' + err.message, 'warning');
  }
}

/**
 * 카카오 로그아웃
 */
export function handleKakaoLogout() {
  try {
    if (typeof Kakao !== 'undefined' && Kakao.isInitialized() && Kakao.Auth.getAccessToken()) {
      Kakao.Auth.logout(() => {
        console.log('Kakao logout complete.');
      });
    }
  } catch (e) {
    console.warn('Kakao logout error:', e);
  }
  // 영구 스토리지 및 세션 스토리지에서 카카오 인증 정보 완전 제거
  try {
    localStorage.removeItem('doksan_auth_provider');
    localStorage.removeItem('doksan_kakao_user');
    localStorage.removeItem('doksan_kakao_token');
    sessionStorage.removeItem('kakao_access_token');
    sessionStorage.removeItem('kakao_uid');
    sessionStorage.removeItem('kakao_provider');
  } catch (e) {}
}

/**
 * 카카오 OAuth 리다이렉트 콜백 처리
 * 페이지 로드 시 URL에 code 파라미터가 있으면 자동으로 처리
 * @param {Function} onSuccess - 카카오 유저 데이터를 받아 사용자 인증 상태를 처리하는 콜백
 */
export async function handleKakaoAuthCallback(onSuccess) {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');

  if (error) {
    console.warn('Kakao OAuth error:', error, params.get('error_description'));
    showToast('카카오 로그인이 취소되었습니다.', 'info');
    // URL 파라미터 정리
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
    return;
  }

  if (!code) return; // 카카오 콜백 아님, 일반 페이지 로드

  // URL 파라미터 정리 (뒤로가기 시 재처리 방지)
  const cleanUrl = window.location.origin + window.location.pathname;
  window.history.replaceState({}, document.title, cleanUrl);

  showToast('카카오 로그인 처리 중...', 'info');

  try {
    // 액세스 토큰 교환 (카카오 토큰 API 직접 호출)
    const { restApiKey: REST_API_KEY, clientSecret: CLIENT_SECRET } = await getKakaoConfig();
    if (!REST_API_KEY) {
      showToast('카카오 REST API 키가 설정되지 않았습니다. 관리자에게 문의하세요.', 'warning');
      return;
    }

    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: REST_API_KEY,
        redirect_uri: window.location.origin + window.location.pathname,
        code: code,
        ...(CLIENT_SECRET ? { client_secret: CLIENT_SECRET } : {})
      })
    });

    if (!tokenRes.ok) {
      const errData = await tokenRes.json().catch(() => ({}));
      throw new Error(`토큰 교환 실패: ${errData.error_description || tokenRes.status}`);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // 액세스 토큰으로 카카오 사용자 정보 조회
    const profileRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!profileRes.ok) {
      throw new Error(`사용자 정보 조회 실패: ${profileRes.status}`);
    }

    const profileData = await profileRes.json();
    const kakaoId = String(profileData.id);
    const nickname = profileData.kakao_account?.profile?.nickname || '카카오 사용자';
    const profileImageUrl = profileData.kakao_account?.profile?.profile_image_url || '';
    const kakaoEmail = profileData.kakao_account?.email || '';

    // Firestore 사용자 문서 생성 또는 조회용 객체
    const kakaoUser = {
      uid: `kakao_${kakaoId}`,
      kakaoId: kakaoId,
      email: kakaoEmail,
      name: nickname,
      photoURL: profileImageUrl,
      provider: 'kakao'
    };

    // 영구 스토리지(localStorage)에 유저 정보 및 토큰 저장 (브라우저 종료/새창/새로고침 무관 영구 유지)
    try {
      localStorage.setItem('doksan_auth_provider', 'kakao');
      localStorage.setItem('doksan_kakao_user', JSON.stringify(kakaoUser));
      localStorage.setItem('doksan_kakao_token', accessToken);
      sessionStorage.setItem('kakao_access_token', accessToken);
      sessionStorage.setItem('kakao_uid', kakaoId);
      sessionStorage.setItem('kakao_provider', 'kakao');
    } catch (e) {}

    // Kakao SDK에 액세스 토큰 설정 (공유 기능 유지)
    try {
      if (typeof Kakao !== 'undefined' && Kakao.isInitialized()) {
        Kakao.Auth.setAccessToken(accessToken);
      }
    } catch (e) {}

    // 신규 카카오 유저는 임의의 디폴트값으로 DB를 생성하지 않고, 구글과 동일하게 부원 등록 신청 모달을 거치도록 바로 콜백 호출
    if (typeof onSuccess === 'function') {
      onSuccess(kakaoUser);
    }

  } catch (err) {
    console.error('Kakao auth callback error:', err);
    showToast('카카오 로그인 처리 중 오류가 발생했습니다: ' + err.message, 'warning');
  }
}

/**
 * 카카오 로그인 세션 복원 (페이지 새로고침, 창 다시 열기 시 영구 유지)
 * @param {Function} onSuccess - 복원 성공 시 실행할 콜백
 */
export async function restoreKakaoSession(onSuccess) {
  try {
    // 1. 영구 스토리지(localStorage) 우선 확인, 없을 경우 sessionStorage 확인
    let provider = localStorage.getItem('doksan_auth_provider') || sessionStorage.getItem('kakao_provider');
    if (provider !== 'kakao') return false;

    let kakaoUser = null;
    const rawUser = localStorage.getItem('doksan_kakao_user');
    if (rawUser) {
      try {
        kakaoUser = JSON.parse(rawUser);
      } catch (e) {}
    }

    const savedToken = localStorage.getItem('doksan_kakao_token') || sessionStorage.getItem('kakao_access_token');
    const savedKakaoId = (kakaoUser && kakaoUser.kakaoId) || sessionStorage.getItem('kakao_uid');

    if (!kakaoUser && savedKakaoId) {
      kakaoUser = {
        uid: `kakao_${savedKakaoId}`,
        kakaoId: savedKakaoId,
        email: '',
        name: '카카오 사용자',
        photoURL: '',
        provider: 'kakao'
      };
    }

    if (!kakaoUser) return false;

    // 2. 세션 스토리지에도 동기화 유지
    try {
      sessionStorage.setItem('kakao_provider', 'kakao');
      if (savedToken) sessionStorage.setItem('kakao_access_token', savedToken);
      if (savedKakaoId) sessionStorage.setItem('kakao_uid', savedKakaoId);
    } catch (e) {}

    // 3. Kakao SDK에 토큰 설정 시도 (공유 기능 등 호환)
    try {
      if (savedToken && typeof Kakao !== 'undefined' && Kakao.isInitialized()) {
        Kakao.Auth.setAccessToken(savedToken);
      }
    } catch (e) {}

    // 4. 즉시(0ms) 로그인 상태 복원 콜백 실행 -> 사용자 체감 지연 0%
    if (typeof onSuccess === 'function') {
      await onSuccess(kakaoUser);
    }

    // 5. 백그라운드에서 최신 프로필 정보 동기화 (실패하더라도 세션을 절대 삭제하지 않음)
    if (savedToken) {
      fetch('https://kapi.kakao.com/v2/user/me', {
        headers: { 'Authorization': `Bearer ${savedToken}` }
      }).then(res => res.ok ? res.json() : null).then(profileData => {
        if (profileData) {
          const nickname = profileData.kakao_account?.profile?.nickname;
          const profileImageUrl = profileData.kakao_account?.profile?.profile_image_url;
          if (nickname || profileImageUrl) {
            kakaoUser.name = nickname || kakaoUser.name;
            kakaoUser.photoURL = profileImageUrl || kakaoUser.photoURL;
            localStorage.setItem('doksan_kakao_user', JSON.stringify(kakaoUser));
          }
        }
      }).catch(err => {
        console.warn('Background Kakao profile refresh skipped:', err);
      });
    }

    return true;

  } catch (e) {
    console.warn('Kakao session restore error:', e);
    return false;
  }
}

/**
 * Firestore에서 카카오 OAuth 설정 (REST API 키 + 클라이언트 시크릿) 조회
 * 상태 변수에 이미 onSnapshot으로 동기화된 값을 우선 사용
 */
async function getKakaoConfig() {
  // 상태 변수에 이미 값이 있으면 바로 반환 (onSnapshot 실시간 동기화)
  if (kakaoRestApiKey) {
    return { restApiKey: kakaoRestApiKey, clientSecret: kakaoClientSecret || null };
  }
  // 상태가 비어있으면 Firestore에서 직접 조회 (초기 로드 시)
  try {
    if (!db) return { restApiKey: null, clientSecret: null };
    const configDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'config', 'settings');
    const snap = await getDoc(configDocRef);
    if (snap.exists()) {
      const data = snap.data();
      return {
        restApiKey: data.kakaoRestApiKey || null,
        clientSecret: data.kakaoClientSecret || null
      };
    }
  } catch (e) {
    console.warn('getKakaoConfig error:', e);
  }
  return { restApiKey: null, clientSecret: null };
}

/**
 * 카카오 OAuth 키/시크릿 UI 갱신
 * 설정 탭 열릴 때 마스킹된 값을 표시
 */
export function updateKakaoOAuthKeyUI() {
  const restInput = document.getElementById('admin-kakao-rest-api-key-input');
  const secretInput = document.getElementById('admin-kakao-client-secret-input');

  // 포커스 중이 아닐 때만 갱신 (입력 중 덮어쓰기 방지)
  if (restInput && document.activeElement !== restInput) {
    restInput.value = kakaoRestApiKey || '';
    restInput.type = 'password'; // 항상 마스킹 상태로 표시
  }
  if (secretInput && document.activeElement !== secretInput) {
    secretInput.value = kakaoClientSecret || '';
    secretInput.type = 'password';
  }
}

/**
 * 카카오 로그인 사용자를 Firestore users 컬렉션에 등록/조회
 */
async function ensureKakaoUserInFirestore(kakaoUser) {
  if (!db) return;
  const userDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', kakaoUser.uid);
  const snap = await getDoc(userDocRef);

  if (!snap.exists()) {
    // 신규 카카오 사용자 — 기본 프로필로 pending 상태로 등록
    const newUserData = {
      uid: kakaoUser.uid,
      kakaoId: kakaoUser.kakaoId,
      email: kakaoUser.email || '',
      name: kakaoUser.name,
      photoURL: kakaoUser.photoURL || '',
      grade: '2학년',
      classNum: '',
      department: '행사기획부',
      role: '행사기획부',
      status: 'pending',
      isAdmin: false,
      canApprove: false,
      provider: 'kakao',
      createdAt: Date.now()
    };
    await setDoc(userDocRef, newUserData);
    console.log('New Kakao user registered to Firestore:', kakaoUser.uid);
  }
}

/**
 * 카카오 REST API 키 및 클라이언트 시크릿 관리자 저장 (설정 패널)
 */
export async function saveKakaoRestApiKey() {
  if (!currentUser.isAdmin) {
    showToast('관리자만 카카오 REST API 키를 변경할 수 있습니다.', 'warning');
    return;
  }
  const keyInput = document.getElementById('admin-kakao-rest-api-key-input');
  const secretInput = document.getElementById('admin-kakao-client-secret-input');
  const key = keyInput ? keyInput.value.trim() : '';
  const secret = secretInput ? secretInput.value.trim() : '';
  if (!key) {
    showToast('카카오 REST API 키를 입력해 주세요.', 'warning');
    return;
  }

  try {
    if (db) {
      const configDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'config', 'settings');
      const updateData = {
        kakaoRestApiKey: key,
        updatedAt: Date.now(),
        updatedBy: currentUser.email || '관리자'
      };
      // 클라이언트 시크릿도 입력된 경우 함께 저장
      if (secret) {
        updateData.kakaoClientSecret = secret;
      }
      await setDoc(configDocRef, updateData, { merge: true });
    }
    // 상태 변수에도 즉시 반영
    setKakaoRestApiKey(key);
    if (secret) setKakaoClientSecret(secret);
    // UI 갱신 (마스킹된 값으로 다시 표시)
    updateKakaoOAuthKeyUI();
    showToast('카카오 REST API 키가 클라우드에 저장되었습니다.', 'success');
  } catch (err) {
    console.error('Error saving Kakao REST API key:', err);
    showToast('키 저장 실패: ' + err.message, 'warning');
  }
}






