// =========================================================================
// 스마트 브리핑룸 (Smart Briefing Room) - Developed by YDE & DK - 공통 유틸리티 및 UI 도우미 모듈
// =========================================================================

import { CURRENT_APP_VERSION } from './config.js';

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function cleanAiSummaryText(text) {
  if (!text) return '아직 요약이 없습니다. 부원 피드백 작성 후 [요약 갱신]을 눌러보세요.';
  // 불필요한 마크다운 ** 기호 제거하여 가독성 높은 텍스트로 표출
  return escapeHtml(text.replace(/\*\*/g, '').trim());
}

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  const colors = {
    success: 'bg-emerald-800 text-white border-emerald-700',
    warning: 'bg-amber-800 text-white border-amber-700',
    info: 'bg-slate-900 text-white border-slate-800'
  };

  toast.className = `p-3 rounded-xl shadow-lg border text-xs flex items-center justify-between gap-3 pointer-events-auto transition transform translate-y-2 opacity-0 duration-200 ${colors[type] || colors.info}`;
  toast.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <button onclick="this.parentElement.remove()" class="opacity-70 hover:opacity-100 text-sm font-bold">×</button>
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    if (toast.parentElement) {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 200);
    }
  }, 4000);
}

export function showCustomConfirm(arg1, arg2, arg3) {
  let title = '확인 요청';
  let message = '';
  let onConfirm = null;

  if (typeof arg3 === 'function') {
    title = arg1 || '확인 요청';
    message = arg2 || '';
    onConfirm = arg3;
  } else {
    message = arg1 || '';
    onConfirm = arg2;
  }

  const modal = document.createElement('div');
  modal.className = "fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4";
  const hasWarning = message.includes('⚠️') || message.includes('주의') || message.includes('초기화') || message.includes('삭제');
  modal.innerHTML = `
    <div class="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 text-center animate-in fade-in duration-150">
      ${hasWarning ? `
        <div class="w-10 h-10 mx-auto mb-2.5 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-lg">
          ⚠️
        </div>
      ` : ''}
      <h4 class="text-sm font-bold text-slate-800 mb-2">${escapeHtml(title)}</h4>
      <div class="text-xs text-slate-600 mb-4 leading-relaxed whitespace-pre-line text-left bg-slate-50 p-3 rounded-xl border border-slate-100 font-sans">
        ${escapeHtml(message)}
      </div>
      <div class="flex gap-2">
        <button id="btn-confirm-cancel" class="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition">취소</button>
        <button id="btn-confirm-ok" class="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-xs transition">확인</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#btn-confirm-cancel').onclick = () => modal.remove();
  modal.querySelector('#btn-confirm-ok').onclick = () => {
    modal.remove();
    if (typeof onConfirm === 'function') onConfirm();
  };
}

/**
 * 텍스트를 클립보드에 안전하게 복사하는 유틸리티 (Clipboard API 및 execCommand textarea 폴백 지원)
 */
export async function copyToClipboard(text, successMessage = '클립보드에 복사되었습니다.') {
  if (!text) return false;
  let copied = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch (err) {
    console.warn('[copyToClipboard] navigator.clipboard failed, attempting textarea fallback:', err);
  }

  if (!copied) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.left = '-9999px';
      textarea.setAttribute('readonly', '');
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      copied = document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch (fallbackErr) {
      console.error('[copyToClipboard] textarea fallback failed:', fallbackErr);
    }
  }

  if (copied) {
    if (successMessage) showToast(successMessage, 'success');
    return true;
  } else {
    showToast('복사에 실패했습니다. 브라우저 설정을 확인해주세요.', 'warning');
    return false;
  }
}

export function getProviderOfficialSymbolHtml(isKakao, sizeClass = 'w-7 h-7') {
  if (isKakao) {
    return `<div class="${sizeClass} rounded-full bg-[#FEE500] border border-amber-300 flex items-center justify-center p-1 shrink-0 shadow-2xs" title="카카오 공식 심볼">
      <svg class="w-full h-full" viewBox="0 0 24 24" fill="#191919">
        <path d="M12 3C6.477 3 2 6.477 2 10.767c0 2.766 1.874 5.188 4.688 6.556-.206.77-.745 2.784-.853 3.208-.135.534.195.526.41.383.17-.113 2.705-1.84 3.799-2.584.63.092 1.284.14 1.956.14 5.523 0 10-3.477 10-7.767C22 6.477 17.523 3 12 3z"/>
      </svg>
    </div>`;
  } else {
    return `<div class="${sizeClass} rounded-full bg-white border border-slate-200 flex items-center justify-center p-1 shrink-0 shadow-2xs" title="Google 공식 심볼">
      <svg class="w-full h-full" viewBox="0 0 24 24">
        <path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"/>
        <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"/>
        <path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15s.7 5.3 1.9 7.7l3.7-2.9z"/>
        <path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16c1.8 3.7 5.6 7 10.1 7z"/>
      </svg>
    </div>`;
  }
}

export function getProviderMiniBadgeHtml(isKakao) {
  if (isKakao) {
    return `<span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#FEE500] border border-white flex items-center justify-center p-0.5 shadow-xs" title="카카오 공식 인증">
      <svg class="w-full h-full" viewBox="0 0 24 24" fill="#191919">
        <path d="M12 3C6.477 3 2 6.477 2 10.767c0 2.766 1.874 5.188 4.688 6.556-.206.77-.745 2.784-.853 3.208-.135.534.195.526.41.383.17-.113 2.705-1.84 3.799-2.584.63.092 1.284.14 1.956.14 5.523 0 10-3.477 10-7.767C22 6.477 17.523 3 12 3z"/>
      </svg>
    </span>`;
  } else {
    return `<span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-white border border-slate-200 flex items-center justify-center p-0.5 shadow-xs" title="Google 공식 인증">
      <svg class="w-full h-full" viewBox="0 0 24 24">
        <path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"/>
        <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"/>
        <path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15s.7 5.3 1.9 7.7l3.7-2.9z"/>
        <path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16c1.8 3.7 5.6 7 10.1 7z"/>
    </span>`;
  }
}

export function getUnifiedUserAvatarHtml(user, sizeClass = 'w-10 h-10', roundedClass = 'rounded-xl') {
  if (!user) return `<div class="${sizeClass} ${roundedClass} bg-slate-100 flex items-center justify-center text-slate-400">👤</div>`;
  const isKakao = (user.provider === 'kakao') || (user.uid && String(user.uid).startsWith('kakao_'));
  const avatarType = user.avatarType || (user.customPhotoURL ? 'custom' : (user.photoURL ? 'oauth' : 'provider'));

  if (avatarType === 'provider') {
    return getProviderOfficialSymbolHtml(isKakao, sizeClass);
  } else if (avatarType === 'custom' && user.customPhotoURL) {
    return `
      <div class="relative ${sizeClass} shrink-0">
        <img src="${escapeHtml(user.customPhotoURL)}" class="${sizeClass} ${roundedClass} object-cover border border-slate-200 shadow-2xs" alt="${escapeHtml(user.name || '')}" />
        ${getProviderMiniBadgeHtml(isKakao)}
      </div>
    `;
  } else if (user.photoURL) {
    return `
      <div class="relative ${sizeClass} shrink-0">
        <img src="${escapeHtml(user.photoURL)}" class="${sizeClass} ${roundedClass} object-cover border border-slate-200 shadow-2xs" alt="${escapeHtml(user.name || '')}" />
        ${getProviderMiniBadgeHtml(isKakao)}
      </div>
    `;
  } else {
    const initial = (user.name || '부').charAt(0);
    return `<div class="${sizeClass} ${roundedClass} bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm shrink-0 border border-blue-200 shadow-2xs">${escapeHtml(initial)}</div>`;
  }
}

export function downloadJsonFile(arg1, arg2) {
  let filename = '';
  let jsonData = null;

  if (typeof arg1 === 'string') {
    filename = arg1;
    jsonData = arg2;
  } else if (typeof arg2 === 'string') {
    filename = arg2;
    jsonData = arg1;
  } else {
    filename = `download_${Date.now()}.json`;
    jsonData = arg1 || arg2;
  }

  const jsonStr = typeof jsonData === 'string' ? jsonData : JSON.stringify(jsonData, null, 2);
  const cleanFilename = String(filename).endsWith('.json') ? String(filename) : `${filename}.json`;

  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = cleanFilename;
  a.setAttribute('download', cleanFilename);
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (a.parentElement) document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 2000);
}

export function switchView(viewName) {
  const vLoading = document.getElementById('view-loading');
  const vLoggedOut = document.getElementById('view-logged-out');
  const vPending = document.getElementById('view-pending-approval');
  const vRejected = document.getElementById('view-rejected');
  const vBriefing = document.getElementById('view-briefing-room');
  const header = document.getElementById('app-header');
  const footer = document.getElementById('app-footer');

  // 로딩 스플래시 중 헤더/푸터도 숨겨 완전한 스플래시 경험 제공 (Zero-Flicker)
  const isLoading = (viewName === 'loading');
  if (header) header.classList.toggle('hidden', isLoading);
  if (footer) footer.classList.toggle('hidden', isLoading);

  if (vLoading) vLoading.classList.toggle('hidden', !isLoading);
  if (vLoggedOut) vLoggedOut.classList.toggle('hidden', viewName !== 'logged-out');
  if (vPending) vPending.classList.toggle('hidden', viewName !== 'pending-approval');
  if (vRejected) vRejected.classList.toggle('hidden', viewName !== 'rejected');
  if (vBriefing) vBriefing.classList.toggle('hidden', viewName !== 'briefing-room' && viewName !== 'briefing');
}

export function togglePasswordVisibility(inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!input) return;

  if (input.type === 'password') {
    input.type = 'text';
    if (btn) {
      btn.title = '값 숨기기';
      btn.innerHTML = `
        <svg class="w-4 h-4 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
        </svg>
      `;
    }
  } else {
    input.type = 'password';
    if (btn) {
      btn.title = '값 보기';
      btn.innerHTML = `
        <svg class="w-4 h-4 text-slate-400 hover:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      `;
    }
  }
}

// =========================================================================
// Netflix-Style Live App Update Checker & Notification
// =========================================================================
let isUpdateBannerVisible = false;

export function checkAndNotifyUpdate(newVersion, changelogText = '') {
  if (!newVersion || newVersion === CURRENT_APP_VERSION) return;
  
  // 사용자가 '나중에'를 눌렀고 아직 10분이 지나지 않은 경우 스킵
  try {
    const dismissedUntil = sessionStorage.getItem('doksan_update_dismissed_until');
    if (dismissedUntil && Date.now() < parseInt(dismissedUntil, 10)) {
      return;
    }
  } catch (e) {}

  const banner = document.getElementById('update-notification-banner');
  if (!banner) return;

  const versionTag = document.getElementById('update-version-tag');
  const descText = document.getElementById('update-desc-text');

  if (versionTag) versionTag.textContent = newVersion;
  if (descText && changelogText) descText.textContent = changelogText;

  banner.classList.remove('hidden');
  isUpdateBannerVisible = true;
}

export function dismissUpdateNotification() {
  const banner = document.getElementById('update-notification-banner');
  if (banner) {
    banner.classList.add('hidden');
  }
  isUpdateBannerVisible = false;
  try {
    // 10분간 다시 띄우지 않음
    sessionStorage.setItem('doksan_update_dismissed_until', String(Date.now() + 10 * 60 * 1000));
  } catch (e) {}
}

export function applyUpdateReload() {
  try {
    sessionStorage.removeItem('doksan_update_dismissed_until');
  } catch (e) {}
  // 브라우저 캐시를 건너뛰고 최신 스크립트를 로드하도록 새로고침
  window.location.reload();
}

/**
 * 정적 version.json 백그라운드 주기적 검사 (45초 주기 및 탭 포커스 시)
 */
export function startVersionChecker() {
  async function fetchVersion() {
    try {
      const res = await fetch(`version.json?_t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.version && data.version !== CURRENT_APP_VERSION) {
          checkAndNotifyUpdate(data.version, data.changelog || '새로운 기능이 배포되었습니다. 지금 새로고침하세요!');
        }
      }
    } catch (e) {
      // 오프라인이거나 fetch 실패 시 무시
    }
  }

  // 1. 초기 5초 후 1차 검사
  setTimeout(fetchVersion, 5000);

  // 2. 45초 주기 정기 폴링
  setInterval(fetchVersion, 45000);

  // 3. 브라우저 탭 활성화 시 즉시 검사
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      fetchVersion();
    }
  });
}



