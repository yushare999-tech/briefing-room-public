// =========================================================================
// 스마트 브리핑룸 - 사이트 브랜딩, 로고 및 파비콘 동적 관리 모듈
// =========================================================================

import { db, appId, initFirebase } from './config.js';
import { currentUser } from './state.js';
import { showToast, showCustomConfirm } from './utils.js';
import { logActivity } from './logger.js';
import { doc, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

export const DEFAULT_BRANDING = {
  title: "스마트 브리핑룸",
  subtitle: "전체 부원 스마트폰 동시 접속 • 실시간 의결 시스템",
  logoEmoji: "🏛️",
  useCustomLogo: false,
  thumbnailUrl: "",
  faviconUrl: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🏛️</text></svg>"
};

export let currentBranding = { ...DEFAULT_BRANDING };
let brandingUnsubscribe = null;

/**
 * Firestore 브랜딩 실시간 동기화 구독 시작 (어떤 시점에 호출되어도 db 확보 보장)
 */
export function initBrandingListener() {
  let targetDb = db;
  if (!targetDb) {
    try {
      const instances = initFirebase();
      targetDb = instances?.db;
    } catch (e) {
      console.warn('initFirebase auto-call in initBrandingListener:', e);
    }
  }
  if (!targetDb) return;
  if (brandingUnsubscribe) brandingUnsubscribe();

  const brandingDocRef = doc(targetDb, 'artifacts', appId, 'public', 'data', 'config', 'branding');
  brandingUnsubscribe = onSnapshot(brandingDocRef, (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      currentBranding = {
        title: data.title || DEFAULT_BRANDING.title,
        subtitle: data.subtitle || DEFAULT_BRANDING.subtitle,
        logoEmoji: data.logoEmoji || DEFAULT_BRANDING.logoEmoji,
        useCustomLogo: Boolean(data.useCustomLogo),
        thumbnailUrl: data.thumbnailUrl || "",
        faviconUrl: data.faviconUrl || DEFAULT_BRANDING.faviconUrl
      };
    } else {
      currentBranding = { ...DEFAULT_BRANDING };
    }
    applyBrandingToDOM(currentBranding);
  }, (err) => {
    console.warn('Branding onSnapshot error:', err);
    applyBrandingToDOM(DEFAULT_BRANDING);
  });
}

/**
 * DOM에 브랜딩 정보 실시간 반영 (타이틀, 파비콘, 헤더 로고, 메타태그)
 */
export function applyBrandingToDOM(branding) {
  const b = branding || currentBranding;

  // 1. 브라우저 탭 타이틀 (document.title)
  document.title = b.title || DEFAULT_BRANDING.title;

  // 2. 브라우저 파비콘 (<link rel="icon">)
  let faviconLink = document.getElementById('site-favicon');
  if (!faviconLink) {
    faviconLink = document.querySelector("link[rel*='icon']");
  }
  if (!faviconLink) {
    faviconLink = document.createElement('link');
    faviconLink.id = 'site-favicon';
    faviconLink.rel = 'icon';
    document.head.appendChild(faviconLink);
  }
  faviconLink.href = b.faviconUrl || DEFAULT_BRANDING.faviconUrl;

  // 3. 헤더 좌측 로고/심볼
  const logoContainer = document.getElementById('header-logo-container');
  if (logoContainer) {
    if (b.useCustomLogo && b.thumbnailUrl) {
      logoContainer.innerHTML = `<img src="${b.thumbnailUrl}" class="w-full h-full object-cover rounded-xl shadow-inner" alt="로고" />`;
    } else {
      logoContainer.innerHTML = `<span class="text-xl sm:text-2xl select-none">${b.logoEmoji || '🏛️'}</span>`;
    }
  }

  // 3-b. 로그아웃 화면 히어로 카드 로고 및 타이틀
  const heroLogoContainer = document.getElementById('hero-logo-container');
  if (heroLogoContainer) {
    if (b.useCustomLogo && b.thumbnailUrl) {
      heroLogoContainer.innerHTML = `<img src="${b.thumbnailUrl}" class="w-full h-full object-cover rounded-2xl shadow-inner" alt="로고" />`;
    } else {
      heroLogoContainer.innerHTML = `<span class="text-3xl select-none">${b.logoEmoji || '🏛️'}</span>`;
    }
  }
  const heroTitleEl = document.getElementById('hero-site-title');
  if (heroTitleEl) heroTitleEl.textContent = b.title || DEFAULT_BRANDING.title;

  // 3-c. 팝업 모달 (부원 등록, 프로필 수정, 관리자 콘솔) 로고 및 타이틀 연동
  const modalLogoContainers = [
    'setup-modal-logo-container', 
    'edit-modal-logo-container',
    'admin-modal-logo-container'
  ];
  modalLogoContainers.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (b.useCustomLogo && b.thumbnailUrl) {
        el.innerHTML = `<img src="${b.thumbnailUrl}" class="w-full h-full object-cover rounded-xl shadow-inner" alt="로고" />`;
      } else {
        el.innerHTML = `<span class="text-2xl select-none">${b.logoEmoji || '🏛️'}</span>`;
      }
    }
  });

  const setupTitle = document.getElementById('setup-modal-title');
  if (setupTitle) setupTitle.textContent = `학생회 부원 등록`;

  const editTitle = document.getElementById('edit-modal-title');
  if (editTitle) editTitle.textContent = `내 프로필 수정`;

  const adminTitle = document.getElementById('admin-modal-title');
  if (adminTitle) adminTitle.textContent = `학생회 관리자 콘솔`;

  // 4. 헤더 메인 타이틀 및 서브 슬로건
  const titleEl = document.getElementById('header-site-title');
  if (titleEl) titleEl.textContent = b.title || DEFAULT_BRANDING.title;

  const subtitleEl = document.getElementById('header-site-subtitle');
  if (subtitleEl) subtitleEl.textContent = b.subtitle || DEFAULT_BRANDING.subtitle;

  // 5. OpenGraph 메타 태그
  const ogTitle = document.getElementById('og-title') || document.querySelector("meta[property='og:title']");
  if (ogTitle) ogTitle.setAttribute('content', b.title || DEFAULT_BRANDING.title);

  const ogDesc = document.getElementById('og-description') || document.querySelector("meta[property='og:description']");
  if (ogDesc) ogDesc.setAttribute('content', b.subtitle || DEFAULT_BRANDING.subtitle);

  const ogImage = document.getElementById('og-image') || document.querySelector("meta[property='og:image']");
  if (ogImage && b.thumbnailUrl) ogImage.setAttribute('content', b.thumbnailUrl);

  // 6. 푸터 브랜딩 텍스트
  const footerText = document.getElementById('footer-branding-text');
  if (footerText) footerText.textContent = `© ${b.title || DEFAULT_BRANDING.title}`;
}

/**
 * 업로드된 이미지 파일을 최적화 썸네일 & 64x64 파비콘으로 변환
 * @param {File} file 
 * @returns {Promise<{thumbnailUrl: string, faviconUrl: string}>}
 */
export function convertImageFileToDataUrls(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      return reject(new Error('유효한 이미지 파일이 아닙니다.'));
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('이미지 로드 실패'));
      img.onload = () => {
        try {
          // 1. 대표 썸네일 생성 (최대 800x800 최적화 압축)
          const maxThumbDim = 800;
          let thumbWidth = img.width;
          let thumbHeight = img.height;
          if (thumbWidth > maxThumbDim || thumbHeight > maxThumbDim) {
            if (thumbWidth > thumbHeight) {
              thumbHeight = Math.round((thumbHeight * maxThumbDim) / thumbWidth);
              thumbWidth = maxThumbDim;
            } else {
              thumbWidth = Math.round((thumbWidth * maxThumbDim) / thumbHeight);
              thumbHeight = maxThumbDim;
            }
          }
          const thumbCanvas = document.createElement('canvas');
          thumbCanvas.width = thumbWidth;
          thumbCanvas.height = thumbHeight;
          const thumbCtx = thumbCanvas.getContext('2d');
          thumbCtx.drawImage(img, 0, 0, thumbWidth, thumbHeight);
          const thumbnailUrl = thumbCanvas.toDataURL('image/jpeg', 0.85);

          // 2. 파비콘 자동 생성 (64x64 정사각형 중앙 크롭)
          const favCanvas = document.createElement('canvas');
          favCanvas.width = 64;
          favCanvas.height = 64;
          const favCtx = favCanvas.getContext('2d');

          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;

          favCtx.drawImage(img, sx, sy, minDim, minDim, 0, 0, 64, 64);
          const faviconUrl = favCanvas.toDataURL('image/png');

          resolve({ thumbnailUrl, faviconUrl });
        } catch (err) {
          reject(err);
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * 이미지 URL을 기반으로 64x64 파비콘 자동 변환
 * @param {string} url 
 * @returns {Promise<string>} favicon Data URL
 */
export function convertImageUrlToFavicon(url) {
  return new Promise((resolve) => {
    if (!url || !url.startsWith('http')) {
      return resolve(DEFAULT_BRANDING.faviconUrl);
    }
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      try {
        const favCanvas = document.createElement('canvas');
        favCanvas.width = 64;
        favCanvas.height = 64;
        const favCtx = favCanvas.getContext('2d');
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        favCtx.drawImage(img, sx, sy, minDim, minDim, 0, 0, 64, 64);
        resolve(favCanvas.toDataURL('image/png'));
      } catch (e) {
        resolve(DEFAULT_BRANDING.faviconUrl);
      }
    };
    img.onerror = () => resolve(DEFAULT_BRANDING.faviconUrl);
    img.src = url;
  });
}

/**
 * 관리자 브랜딩 설정 폼에 현재 데이터 채우기 및 미리보기 갱신
 */
export function populateBrandingForm() {
  const titleInput = document.getElementById('branding-title-input');
  const subtitleInput = document.getElementById('branding-subtitle-input');
  const emojiInput = document.getElementById('branding-emoji-input');
  const customLogoCheck = document.getElementById('branding-use-custom-logo');
  const urlInput = document.getElementById('branding-thumb-url-input');
  const fileInput = document.getElementById('branding-thumb-file-input');
  const uploadStatus = document.getElementById('branding-upload-status');

  if (titleInput) titleInput.value = currentBranding.title || '';
  if (subtitleInput) subtitleInput.value = currentBranding.subtitle || '';
  if (emojiInput) emojiInput.value = currentBranding.logoEmoji || '🏛️';
  if (customLogoCheck) customLogoCheck.checked = Boolean(currentBranding.useCustomLogo);
  if (urlInput) urlInput.value = currentBranding.thumbnailUrl ? (currentBranding.thumbnailUrl.startsWith('data:') ? '(업로드된 이미지 파일 적용 중)' : currentBranding.thumbnailUrl) : '';
  if (fileInput) fileInput.value = '';
  if (uploadStatus && !currentBranding.thumbnailUrl) uploadStatus.textContent = '';

  updateBrandingLivePreview(currentBranding);
}

/**
 * 관리자 폼 내 실시간 미리보기 렌더링
 */
export function updateBrandingLivePreview(previewData) {
  const b = previewData || currentBranding;

  // 헤더 미리보기
  const prevLogo = document.getElementById('branding-preview-logo');
  if (prevLogo) {
    if (b.useCustomLogo && b.thumbnailUrl) {
      prevLogo.innerHTML = `<img src="${b.thumbnailUrl}" class="w-full h-full object-cover rounded-xl" alt="미리보기" />`;
    } else {
      prevLogo.innerHTML = `<span class="text-xl select-none">${b.logoEmoji || '🏛️'}</span>`;
    }
  }

  const prevTitle = document.getElementById('branding-preview-title');
  if (prevTitle) prevTitle.textContent = b.title || DEFAULT_BRANDING.title;

  const prevSubtitle = document.getElementById('branding-preview-subtitle');
  if (prevSubtitle) prevSubtitle.textContent = b.subtitle || DEFAULT_BRANDING.subtitle;

  // 파비콘 미리보기
  const prevFavicon = document.getElementById('branding-preview-favicon');
  if (prevFavicon) {
    prevFavicon.src = b.faviconUrl || DEFAULT_BRANDING.faviconUrl;
  }

  // 썸네일 미리보기
  const prevThumb = document.getElementById('branding-preview-thumb');
  if (prevThumb) {
    if (b.thumbnailUrl) {
      prevThumb.src = b.thumbnailUrl;
      prevThumb.classList.remove('hidden');
    } else {
      prevThumb.src = '';
      prevThumb.classList.add('hidden');
    }
  }
}

/**
 * 관리자가 썸네일 파일을 업로드했을 때 처리 (자동 파비콘 생성 포함)
 */
export async function handleThumbnailFileUpload(file) {
  if (!file) return;

  const statusText = document.getElementById('branding-upload-status');
  if (statusText) statusText.textContent = '이미지 최적화 및 파비콘 생성 중...';

  try {
    const { thumbnailUrl, faviconUrl } = await convertImageFileToDataUrls(file);

    // 폼 상태 갱신
    const customLogoCheck = document.getElementById('branding-use-custom-logo');
    if (customLogoCheck) customLogoCheck.checked = true;

    const urlInput = document.getElementById('branding-thumb-url-input');
    if (urlInput) urlInput.value = `(업로드 파일: ${file.name})`;

    // 임시 캐시에 반영
    window.__stagedThumbnailUrl = thumbnailUrl;
    window.__stagedFaviconUrl = faviconUrl;

    // 실시간 미리보기 갱신
    updateBrandingLivePreview({
      ...currentBranding,
      title: document.getElementById('branding-title-input')?.value || currentBranding.title,
      subtitle: document.getElementById('branding-subtitle-input')?.value || currentBranding.subtitle,
      logoEmoji: document.getElementById('branding-emoji-input')?.value || '🏛️',
      useCustomLogo: true,
      thumbnailUrl,
      faviconUrl
    });

    if (statusText) statusText.textContent = '✅ 이미지 압축 및 파비콘 32x32 자동 생성 완료!';
    showToast('썸네일 및 파비콘 자동 생성이 완료되었습니다. [설정 저장]을 누르면 적용됩니다.', 'success');
  } catch (err) {
    console.error('File conversion failed:', err);
    if (statusText) statusText.textContent = `❌ 오류: ${err.message}`;
    showToast(`이미지 처리 오류: ${err.message}`, 'error');
  }
}

/**
 * 관리자 브랜딩 설정 클라우드 저장
 */
export async function saveBrandingSettings() {
  if (!currentUser.isAdmin) {
    showToast('관리자만 브랜딩 설정을 변경할 수 있습니다.', 'warning');
    return;
  }

  const titleInput = document.getElementById('branding-title-input');
  const subtitleInput = document.getElementById('branding-subtitle-input');
  const emojiInput = document.getElementById('branding-emoji-input');
  const customLogoCheck = document.getElementById('branding-use-custom-logo');
  const urlInput = document.getElementById('branding-thumb-url-input');

  const title = (titleInput?.value || '').trim() || DEFAULT_BRANDING.title;
  const subtitle = (subtitleInput?.value || '').trim() || DEFAULT_BRANDING.subtitle;
  const logoEmoji = (emojiInput?.value || '').trim() || DEFAULT_BRANDING.logoEmoji;
  const useCustomLogo = Boolean(customLogoCheck?.checked);

  let thumbnailUrl = currentBranding.thumbnailUrl || "";
  let faviconUrl = currentBranding.faviconUrl || DEFAULT_BRANDING.faviconUrl;

  // 만약 방금 새 파일이 업로드되어 스테이징된 데이터가 있다면 사용
  if (window.__stagedThumbnailUrl) {
    thumbnailUrl = window.__stagedThumbnailUrl;
    faviconUrl = window.__stagedFaviconUrl;
  } else if (urlInput && urlInput.value && !urlInput.value.startsWith('(')) {
    const enteredUrl = urlInput.value.trim();
    if (enteredUrl !== currentBranding.thumbnailUrl) {
      thumbnailUrl = enteredUrl;
      faviconUrl = await convertImageUrlToFavicon(enteredUrl);
    }
  }

  try {
    const brandingDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'config', 'branding');
    const payload = {
      title,
      subtitle,
      logoEmoji,
      useCustomLogo,
      thumbnailUrl,
      faviconUrl,
      updatedAt: Date.now(),
      updatedBy: currentUser.email || currentUser.name || 'admin'
    };

    await setDoc(brandingDocRef, payload, { merge: true });

    window.__stagedThumbnailUrl = null;
    window.__stagedFaviconUrl = null;

    // 감사 로그 기록
    try {
      await logActivity({
        category: 'ADMIN',
        action: 'BRANDING_UPDATE',
        details: {
          summary: `[브랜딩 설정 변경] 타이틀: "${title}", 슬로건: "${subtitle}", 로고: ${useCustomLogo ? '커스텀이미지' : logoEmoji}`
        }
      });
    } catch (logErr) {
      console.warn('Audit log recording failed:', logErr);
    }

    showToast('사이트 브랜딩 설정이 성공적으로 저장되었습니다.', 'success');
  } catch (err) {
    console.error('Failed to save branding:', err);
    showToast(`저장 실패: ${err.message}`, 'error');
  }
}

/**
 * 브랜딩 기본값으로 초기화 (원클릭 복원)
 */
export async function resetBrandingToDefault() {
  if (!currentUser.isAdmin) {
    showToast('관리자만 설정을 초기화할 수 있습니다.', 'warning');
    return;
  }

  showCustomConfirm(
    '기본 브랜딩 복원',
    '사이트 로고(🏛️), 타이틀, 슬로건 및 파비콘을 초기 기본값으로 복원하시겠습니까?',
    async () => {
      try {
        const brandingDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'config', 'branding');
        const defaultPayload = {
          ...DEFAULT_BRANDING,
          updatedAt: Date.now(),
          updatedBy: currentUser.email || 'admin'
        };

        // 1. Firestore 클라우드 원격 저장
        await setDoc(brandingDocRef, defaultPayload);

        // 2. 로컬 메모리 상태 즉시 갱신 (비동기 스냅샷 도착 전 선제 리셋)
        currentBranding = { ...DEFAULT_BRANDING };
        window.__stagedThumbnailUrl = null;
        window.__stagedFaviconUrl = null;

        // 3. 관리자 모달 폼 및 썸네일 미리보기 리셋
        populateBrandingForm();

        // 4. 메인 화면 전체 UI(헤더 로고, 타이틀, 슬로건, 파비콘 등) 즉시 기본값 반영
        applyBrandingToUI(currentBranding);

        // 감사 로그 기록
        try {
          await logActivity({
            category: 'ADMIN',
            action: 'BRANDING_RESTORE',
            details: {
              summary: `[브랜딩 기본값 복원] 사이트 대표 심볼(🏛️) 및 기본 타이틀로 복원`
            }
          });
        } catch (logErr) {
          console.warn('Audit log recording failed:', logErr);
        }

        showToast('기본 브랜딩으로 복원되었습니다.', 'info');
      } catch (err) {
        showToast(`복원 실패: ${err.message}`, 'error');
      }
    }
  );
}



