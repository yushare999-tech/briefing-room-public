// =========================================================================
// 스마트 브리핑룸 (Smart Briefing Room) - Developed by YDE & DK - 총괄관리자 전용 감사 이력 관리(Audit Logger) 모듈
// =========================================================================

import { db, appId, MASTER_ADMIN_EMAIL, isMasterAdmin } from './config.js';
import { currentUser, authUser } from './state.js';
import { escapeHtml, showToast, downloadJsonFile } from './utils.js';
import { 
  collection, doc, addDoc, getDocs, query, orderBy, limit, startAfter, where, deleteDoc 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// 감사 로그 인메모리 캐시 및 페이징 상태
export let loadedActivityLogs = [];
export let isOfflineViewerMode = false;
let realTimeLogsBackup = [];
let offlineRawLogs = [];
let offlineFileName = '';
let lastVisibleLogDoc = null;
let currentCategoryFilter = 'ALL';
let currentSearchKeyword = '';
let isFetchingLogs = false;
let hasMoreLogs = true;

/**
 * 사용자 행위 감사 로그 기록 (Append-Only 불변 원장)
 * 논블로킹 백그라운드 실행으로 사용자 UI 흐름을 일절 방해하지 않음
 */
export async function logActivity({ category, action, target = null, details = {} }) {
  if (!db || !appId) return;

  try {
    const now = new Date();
    const timestamp = now.getTime();
    const createdAt = now.toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });

    const isKakao = (currentUser.provider === 'kakao') || 
                    (currentUser.uid && String(currentUser.uid).startsWith('kakao_'));

    let displayIdentifier = '';
    if (isKakao) {
      const rawId = currentUser.kakaoId || (currentUser.uid ? String(currentUser.uid).replace('kakao_', '') : '');
      displayIdentifier = rawId ? `Kakao #${rawId.slice(-4)}` : 'Kakao 회원';
    } else {
      displayIdentifier = currentUser.email || authUser?.email || 'Google 사용자';
    }

    const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    const logEntry = {
      timestamp,
      createdAt,
      category: category || 'GENERAL',
      action: action || 'UNKNOWN',
      actor: {
        uid: currentUser.uid || authUser?.uid || 'guest',
        name: currentUser.name || '알 수 없음',
        role: currentUser.role || currentUser.grade || '부원',
        email: currentUser.email || authUser?.email || '',
        provider: isKakao ? 'kakao' : 'google',
        displayIdentifier
      },
      target: target ? {
        type: target.type || 'unknown',
        id: target.id || '',
        title: target.title || ''
      } : null,
      details: {
        summary: details.summary || '',
        before: details.before !== undefined ? details.before : null,
        after: details.after !== undefined ? details.after : null,
        extra: details.extra || null
      },
      clientInfo: {
        platform: isMobile ? 'Mobile' : 'PC'
      }
    };

    // Firestore 컬렉션에 비동기 단방향 추가
    const logsCol = collection(db, 'artifacts', appId, 'public', 'data', 'activity_logs');
    addDoc(logsCol, logEntry).catch(err => {
      console.warn('[logActivity] Firestore write silent warn:', err.message);
    });

  } catch (err) {
    console.warn('[logActivity] failed safely:', err);
  }
}

/**
 * 활동 이력 조회 (50건 페이징 & 카테고리 필터링)
 */
export async function loadActivityLogs(reset = false) {
  if (!db || !appId) return;

  if (isOfflineViewerMode) {
    const banner = document.getElementById('audit-offline-banner');
    if (banner) banner.classList.add('hidden');
    isOfflineViewerMode = false;
  }

  const userEmail = (currentUser.email || authUser?.email || '').trim().toLowerCase();
  if (userEmail !== MASTER_ADMIN_EMAIL.toLowerCase()) {
    console.warn('[loadActivityLogs] Unauthorized access attempt blocked');
    return;
  }

  if (isFetchingLogs) return;

  if (reset) {
    loadedActivityLogs = [];
    lastVisibleLogDoc = null;
    hasMoreLogs = true;
  }

  if (!hasMoreLogs && !reset) return;

  isFetchingLogs = true;
  updateAuditLogsLoadingUI(true);

  try {
    const logsCol = collection(db, 'artifacts', appId, 'public', 'data', 'activity_logs');
    const PAGE_SIZE = 50;

    let q;
    if (currentCategoryFilter && currentCategoryFilter !== 'ALL') {
      if (lastVisibleLogDoc) {
        q = query(logsCol, where('category', '==', currentCategoryFilter), orderBy('timestamp', 'desc'), startAfter(lastVisibleLogDoc), limit(PAGE_SIZE));
      } else {
        q = query(logsCol, where('category', '==', currentCategoryFilter), orderBy('timestamp', 'desc'), limit(PAGE_SIZE));
      }
    } else {
      if (lastVisibleLogDoc) {
        q = query(logsCol, orderBy('timestamp', 'desc'), startAfter(lastVisibleLogDoc), limit(PAGE_SIZE));
      } else {
        q = query(logsCol, orderBy('timestamp', 'desc'), limit(PAGE_SIZE));
      }
    }

    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      hasMoreLogs = false;
    } else {
      lastVisibleLogDoc = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.docs.length < PAGE_SIZE) {
        hasMoreLogs = false;
      }
      snapshot.forEach(docSnap => {
        loadedActivityLogs.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });
    }

    renderAuditLogsUI();
  } catch (err) {
    console.error('Failed to load activity logs:', err);
    showToast('감사 이력을 불러오는 중 오류가 발생했습니다: ' + err.message, 'warning');
  } finally {
    isFetchingLogs = false;
    updateAuditLogsLoadingUI(false);
  }
}

/**
 * 카테고리 필터 변경 핸들러
 */
export function filterActivityLogsByCategory(category) {
  currentCategoryFilter = category;
  if (isOfflineViewerMode) {
    if (category === 'ALL') {
      loadedActivityLogs = [...offlineRawLogs];
    } else {
      loadedActivityLogs = offlineRawLogs.filter(log => log.category === category);
    }
    renderAuditLogsUI();
    return;
  }
  loadActivityLogs(true);
}

/**
 * 검색 키워드 핸들러
 */
export function handleAuditLogSearch(keyword) {
  currentSearchKeyword = (keyword || '').trim().toLowerCase();
  renderAuditLogsUI();
}

/**
 * 카테고리별 컬러 뱃지 헬퍼
 */
function getCategoryBadge(category) {
  const map = {
    VOTE: { label: '투표', bg: 'bg-amber-100 text-amber-800 border-amber-200' },
    AGENDA: { label: '안건', bg: 'bg-blue-100 text-blue-800 border-blue-200' },
    COMMENT: { label: '의견댓글', bg: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
    AI: { label: 'AI서기', bg: 'bg-purple-100 text-purple-800 border-purple-200' },
    MEMBER: { label: '부원관리', bg: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
    ADMIN: { label: '시스템관리', bg: 'bg-rose-100 text-rose-800 border-rose-200' },
    AUTH: { label: '인증접속', bg: 'bg-slate-100 text-slate-800 border-slate-200' }
  };
  const c = map[category] || { label: category, bg: 'bg-slate-100 text-slate-700 border-slate-200' };
  return `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold border shrink-0 ${c.bg}">${escapeHtml(c.label)}</span>`;
}

/**
 * 감사 이력 리스트 렌더링
 */
export function renderAuditLogsUI() {
  const container = document.getElementById('audit-logs-container');
  const countBadge = document.getElementById('audit-log-count');
  const loadMoreBtn = document.getElementById('btn-audit-load-more');

  if (!container) return;

  let filtered = loadedActivityLogs;
  if (currentSearchKeyword) {
    filtered = filtered.filter(log => {
      const actorName = (log.actor?.name || '').toLowerCase();
      const actorRole = (log.actor?.role || '').toLowerCase();
      const displayId = (log.actor?.displayIdentifier || '').toLowerCase();
      const targetTitle = (log.target?.title || '').toLowerCase();
      const summary = (log.details?.summary || '').toLowerCase();
      const action = (log.action || '').toLowerCase();
      return actorName.includes(currentSearchKeyword) ||
             actorRole.includes(currentSearchKeyword) ||
             displayId.includes(currentSearchKeyword) ||
             targetTitle.includes(currentSearchKeyword) ||
             summary.includes(currentSearchKeyword) ||
             action.includes(currentSearchKeyword);
    });
  }

  if (countBadge) {
    countBadge.textContent = `${filtered.length}건`;
  }

  if (loadMoreBtn) {
    loadMoreBtn.classList.toggle('hidden', !hasMoreLogs || Boolean(currentSearchKeyword) || isOfflineViewerMode);
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center text-slate-400 text-xs">
        <svg class="w-8 h-8 mx-auto mb-2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
        <p>조회된 활동 이력이 없습니다.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(log => {
    const isKakao = log.actor?.provider === 'kakao';
    const providerBadge = isKakao 
      ? `<span class="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-md bg-[#FEE500] text-[9px] font-bold text-[#3C1E1E] border border-amber-300 shadow-2xs">🟡 ${escapeHtml(log.actor.displayIdentifier || 'Kakao')}</span>`
      : `<span class="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-md bg-blue-50 text-[9px] font-bold text-blue-700 border border-blue-200 shadow-2xs">🔵 ${escapeHtml(log.actor.displayIdentifier || log.actor.email || 'Google')}</span>`;

    const platformBadge = log.clientInfo?.platform === 'Mobile'
      ? `<span class="text-[9px] text-slate-400 font-mono" title="모바일 접속">📱 Mobile</span>`
      : `<span class="text-[9px] text-slate-400 font-mono" title="PC 웹 접속">💻 PC</span>`;

    const hasDiff = (log.details?.before !== null && log.details?.before !== undefined) || 
                    (log.details?.after !== null && log.details?.after !== undefined);

    return `
      <div class="p-3 bg-white hover:bg-slate-50/80 rounded-xl border border-slate-200/90 shadow-2xs transition">
        <div class="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
          <div class="flex items-center gap-1.5 flex-wrap">
            ${getCategoryBadge(log.category)}
            <span class="font-bold text-xs text-slate-800">${escapeHtml(log.actor?.name || '익명')}</span>
            <span class="text-[10px] text-slate-500 font-medium">${escapeHtml(log.actor?.role || '')}</span>
            ${providerBadge}
          </div>
          <div class="flex items-center gap-2 text-[10px] text-slate-400 font-mono shrink-0">
            ${platformBadge}
            <span>${escapeHtml(log.createdAt || '')}</span>
          </div>
        </div>

        ${log.target?.title ? `
          <div class="text-[11px] font-semibold text-slate-700 mb-1 flex items-center gap-1">
            <span class="text-slate-400">📌</span>
            <span class="text-blue-900">${escapeHtml(log.target.title)}</span>
          </div>
        ` : ''}

        <div class="text-xs text-slate-700 leading-relaxed font-sans">
          ${escapeHtml(log.details?.summary || log.action || '')}
        </div>

        ${hasDiff ? `
          <div class="mt-2 pt-2 border-t border-slate-100 text-[10px] flex items-center gap-2 flex-wrap font-mono">
            ${log.details.before !== null ? `
              <span class="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-100">
                <b>이전:</b> ${escapeHtml(String(log.details.before))}
              </span>
            ` : ''}
            <span class="text-slate-400">➔</span>
            ${log.details.after !== null ? `
              <span class="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100">
                <b>변경:</b> ${escapeHtml(String(log.details.after))}
              </span>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function updateAuditLogsLoadingUI(loading) {
  const spinner = document.getElementById('audit-logs-spinner');
  if (spinner) {
    spinner.classList.toggle('hidden', !loading);
  }
}

/**
 * 전체 감사 이력 JSON 다운로드
 */
export function exportAuditLogsJson() {
  if (!isMasterAdmin(currentUser || authUser)) {
    showToast('감사 이력 다운로드는 총괄관리자만 가능합니다.', 'warning');
    return;
  }
  if (loadedActivityLogs.length === 0) {
    showToast('다운로드할 감사 이력이 없습니다.', 'warning');
    return;
  }
  const filename = `doksan_audit_logs_${new Date().toISOString().slice(0, 10)}.json`;
  const exportPayload = {
    type: "doksan_audit_logs",
    version: "1.0",
    exportedAt: new Date().toISOString(),
    exportedBy: currentUser.name || '총괄관리자',
    totalCount: loadedActivityLogs.length,
    logs: loadedActivityLogs
  };
  downloadJsonFile(filename, exportPayload);
  showToast(`감사 이력 ${loadedActivityLogs.length}건이 JSON 파일로 다운로드되었습니다.`, 'success');
}

/**
 * 전체 감사 이력 CSV 다운로드
 */
export function exportAuditLogsCsv() {
  if (!isMasterAdmin(currentUser || authUser)) {
    showToast('감사 이력 다운로드는 총괄관리자만 가능합니다.', 'warning');
    return;
  }
  if (loadedActivityLogs.length === 0) {
    showToast('다운로드할 감사 이력이 없습니다.', 'warning');
    return;
  }

  const headers = ['일시', '카테고리', '액션', '부원명', '직책', '인증제공자', '식별자', '대상유형', '대상제목', '상세요약', '기기'];
  const rows = loadedActivityLogs.map(log => [
    `"${log.createdAt || ''}"`,
    `"${log.category || ''}"`,
    `"${log.action || ''}"`,
    `"${(log.actor?.name || '').replace(/"/g, '""')}"`,
    `"${(log.actor?.role || '').replace(/"/g, '""')}"`,
    `"${log.actor?.provider || ''}"`,
    `"${(log.actor?.displayIdentifier || '').replace(/"/g, '""')}"`,
    `"${log.target?.type || ''}"`,
    `"${(log.target?.title || '').replace(/"/g, '""')}"`,
    `"${(log.details?.summary || '').replace(/"/g, '""')}"`,
    `"${log.clientInfo?.platform || ''}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `doksan_audit_logs_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('감사 이력 CSV 파일이 다운로드되었습니다.', 'success');
}

/**
 * 오프라인 백업 JSON 파일 브라우저 즉시 열람
 */
export function handleOfflineAuditFileSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const json = JSON.parse(e.target.result);
      let logs = [];
      if (Array.isArray(json)) {
        logs = json;
      } else if (json && Array.isArray(json.logs)) {
        logs = json.logs;
      } else if (json && Array.isArray(json.data)) {
        logs = json.data;
      } else {
        showToast('유효한 감사 이력 JSON 형식이 아닙니다.', 'warning');
        return;
      }

      if (logs.length === 0) {
        showToast('백업 파일 내에 감사 이력 데이터가 없습니다.', 'warning');
        return;
      }

      if (!isOfflineViewerMode) {
        realTimeLogsBackup = [...loadedActivityLogs];
      }
      isOfflineViewerMode = true;
      offlineRawLogs = [...logs];
      loadedActivityLogs = [...logs];
      offlineFileName = file.name;

      const banner = document.getElementById('audit-offline-banner');
      const filenameBadge = document.getElementById('audit-offline-filename');
      if (banner) banner.classList.remove('hidden');
      if (filenameBadge) filenameBadge.textContent = file.name;

      // 카테고리 셀렉트 및 검색창 초기화
      const catSelect = document.getElementById('audit-category-select');
      if (catSelect) catSelect.value = 'ALL';
      currentCategoryFilter = 'ALL';
      currentSearchKeyword = '';
      const searchInput = document.getElementById('audit-search-input');
      if (searchInput) searchInput.value = '';

      renderAuditLogsUI();
      showToast(`오프라인 백업 파일 (${file.name})에서 ${logs.length}건을 로드했습니다.`, 'success');
    } catch (err) {
      console.error('Failed to parse offline audit JSON:', err);
      showToast('JSON 파일을 읽는 중 오류가 발생했습니다: ' + err.message, 'warning');
    } finally {
      event.target.value = ''; // 동일 파일 재선택 가능하도록 리셋
    }
  };
  reader.readAsText(file, 'utf-8');
}

/**
 * 오프라인 뷰어 모드 종료 및 실시간 DB 복귀
 */
export function exitOfflineAuditLogViewer() {
  const banner = document.getElementById('audit-offline-banner');
  if (banner) banner.classList.add('hidden');
  isOfflineViewerMode = false;
  offlineRawLogs = [];
  offlineFileName = '';

  const catSelect = document.getElementById('audit-category-select');
  if (catSelect) catSelect.value = 'ALL';
  currentCategoryFilter = 'ALL';
  currentSearchKeyword = '';
  const searchInput = document.getElementById('audit-search-input');
  if (searchInput) searchInput.value = '';

  showToast('실시간 클라우드 감사 원장으로 복귀했습니다.', 'info');
  loadActivityLogs(true);
}

/**
 * 안전 정리(Purge) 모달 열기
 */
export function openAuditPurgeModal() {
  if (!isMasterAdmin(currentUser || authUser)) {
    showToast('감사 이력 정리는 총괄관리자만 가능합니다.', 'warning');
    return;
  }

  const modal = document.getElementById('modal-audit-purge');
  const confirmInput = document.getElementById('audit-purge-confirm-input');
  if (confirmInput) confirmInput.value = '';
  if (modal) modal.classList.remove('hidden');
}

/**
 * 안전 정리(Purge) 모달 닫기
 */
export function closeAuditPurgeModal() {
  const modal = document.getElementById('modal-audit-purge');
  if (modal) modal.classList.add('hidden');
}

/**
 * 백업 강제 선행 후 안전 정리 실행
 */
export async function executeAuditLogPurge() {
  if (!isMasterAdmin(currentUser || authUser)) {
    showToast('감사 이력 정리는 총괄관리자만 가능합니다.', 'warning');
    return;
  }

  const confirmInput = document.getElementById('audit-purge-confirm-input');
  const confirmText = (confirmInput?.value || '').trim();
  if (confirmText !== '정리') {
    showToast('실행 확인을 위해 [정리]를 정확히 입력해 주세요.', 'warning');
    if (confirmInput) confirmInput.focus();
    return;
  }

  const rangeRadio = document.querySelector('input[name="audit-purge-range"]:checked');
  const range = rangeRadio ? rangeRadio.value : '30days';

  // 1단계: 전체 로그 강제 자동 백업 다운로드
  exportAuditLogsJson();
  showToast('데이터 유실 방지를 위해 전체 JSON 백업 파일을 먼저 다운로드했습니다.', 'info');

  const btnSubmit = document.getElementById('btn-audit-purge-submit');
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<span>정리 진행 중...</span>';
  }

  try {
    const logsCol = collection(db, 'artifacts', appId, 'public', 'data', 'activity_logs');
    const now = Date.now();
    let cutoffTime = now;
    let rangeDesc = '전체 이력';

    if (range === '30days') {
      cutoffTime = now - (30 * 24 * 60 * 60 * 1000);
      rangeDesc = '30일 이전 이력';
    } else if (range === '90days') {
      cutoffTime = now - (90 * 24 * 60 * 60 * 1000);
      rangeDesc = '90일 이전 이력';
    } else {
      cutoffTime = now + 10000;
      rangeDesc = '전체 이력 초기화';
    }

    // Firestore에서 대상 문서 조회
    const q = query(logsCol, where('timestamp', '<=', cutoffTime));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      showToast(`정리 대상 기간(${rangeDesc})에 해당하는 감사 로그가 없습니다.`, 'info');
      closeAuditPurgeModal();
      return;
    }

    const deletePromises = snapshot.docs.map(docSnap => deleteDoc(docSnap.ref));
    await Promise.all(deletePromises);

    const deletedCount = snapshot.size;

    // 정리 완료 감사 로그 1건 신규 기록 (불변 추적성 보존)
    await logActivity({
      category: 'ADMIN',
      action: 'AUDIT_PURGED',
      details: {
        summary: `감사 원장 정리 수행: ${rangeDesc} (${deletedCount}건 삭제 완료, JSON 백업 보존됨)`,
        before: `${deletedCount}건`,
        after: '정리 완료',
        extra: { range, deletedCount }
      }
    });

    closeAuditPurgeModal();
    showToast(`감사 이력 ${deletedCount}건이 안전하게 정리되었습니다. (백업 파일 저장 완료)`, 'success');
    
    // 화면 새로고침
    await loadActivityLogs(true);

  } catch (err) {
    console.error('Audit purge error:', err);
    showToast('감사 이력 정리 중 오류가 발생했습니다: ' + err.message, 'warning');
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = `
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
        <span>백업 다운로드 & 정리 실행</span>
      `;
    }
  }
}

