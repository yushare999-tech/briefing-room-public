// =========================================================================
// 스마트 브리핑룸 (Smart Briefing Room) - Developed by YDE & DK - 안건(Agenda), 투표 및 댓글 관리 모듈
// =========================================================================

import { db, appId, isAdminDebugMode } from './config.js';
import { 
  currentUser, authUser, agendas, setAgendas, currentFilter, setCurrentFilter, 
  expandedAgendaIds, agendasUnsubscribe, setAgendasUnsubscribe,
  activeRestoreData, setActiveRestoreData 
} from './state.js';
import { 
  escapeHtml, cleanAiSummaryText, showToast, showCustomConfirm,
  getProviderOfficialSymbolHtml, getProviderMiniBadgeHtml, getUnifiedUserAvatarHtml,
  downloadJsonFile, copyToClipboard 
} from './utils.js';
import { openKakaoShareModal } from './kakao.js';
import { requestAiSummary } from './gemini.js';
import { openMemberProfileModalByUid, allUsersList } from './auth.js';
import { logActivity } from './logger.js';
import { 
  doc, setDoc, updateDoc, deleteDoc, collection, onSnapshot, getDocs, writeBatch 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

let latestAddedCommentId = null;

// =========================================================================
// 관리자 테스트 페르소나 (학생회 5대 부서 1·2학년 부원 풀)
// =========================================================================
export const DEMO_PERSONAS = [
  // 1. 행사기획부
  { author: '박기획', role: '1학년 행사기획부' },
  { author: '최기획', role: '2학년 행사기획부' },
  { author: '김선배', role: '2학년 행사기획부' },
  { author: '이후배', role: '1학년 행사기획부' },
  // 2. 운영지원부
  { author: '김지원', role: '1학년 운영지원부' },
  { author: '이지원', role: '2학년 운영지원부' },
  { author: '박지원', role: '1학년 운영지원부' },
  { author: '최지원', role: '2학년 운영지원부' },
  // 3. 편집소통부
  { author: '정소통', role: '1학년 편집소통부' },
  { author: '강소통', role: '2학년 편집소통부' },
  // 4. 미디어홍보부
  { author: '조홍보', role: '1학년 미디어홍보부' },
  { author: '윤홍보', role: '2학년 미디어홍보부' },
  // 5. 자치선도부
  { author: '임선도', role: '1학년 자치선도부' },
  { author: '한선도', role: '2학년 자치선도부' }
];

const currentAgendaPersonas = {};

export function getRandomPersona() {
  const idx = Math.floor(Math.random() * DEMO_PERSONAS.length);
  return { ...DEMO_PERSONAS[idx] };
}

export function getOrInitAgendaPersona(agendaId) {
  if (!currentAgendaPersonas[agendaId]) {
    currentAgendaPersonas[agendaId] = getRandomPersona();
  }
  return currentAgendaPersonas[agendaId];
}

export function rerollPersona(agendaId) {
  const oldPersona = currentAgendaPersonas[agendaId];
  let newPersona = getRandomPersona();
  if (oldPersona && DEMO_PERSONAS.length > 1) {
    let attempts = 0;
    while (newPersona.author === oldPersona.author && attempts < 5) {
      newPersona = getRandomPersona();
      attempts++;
    }
  }
  currentAgendaPersonas[agendaId] = newPersona;

  const authorInput = document.getElementById(`debug-author-${agendaId}`);
  const roleInput = document.getElementById(`debug-role-${agendaId}`);
  if (authorInput) authorInput.value = newPersona.author;
  if (roleInput) roleInput.value = newPersona.role;
}

export function checkAuthOrPrompt() {
  if (!currentUser.isAuthenticated || currentUser.status !== 'approved') {
    showToast('승인된 학생회 부원만 투표 및 의견을 등록할 수 있습니다.', 'warning');
    return false;
  }
  return true;
}

export function toggleAgendaDetails(agendaId) {
  if (expandedAgendaIds.has(agendaId)) {
    expandedAgendaIds.delete(agendaId);
  } else {
    expandedAgendaIds.clear();
    expandedAgendaIds.add(agendaId);
  }
  renderAgendas();
}

/**
 * AI 요약 내용 클립보드 복사 (원클릭 복사 및 버튼 시각적 피드백)
 */
export async function copyAiSummary(agendaId, btnEl = null) {
  const agenda = (agendas || []).find(a => a.id === agendaId);
  if (!agenda) {
    showToast('해당 안건을 찾을 수 없습니다.', 'warning');
    return;
  }

  const rawSummary = (agenda.aiSummary || '').replace(/\*\*/g, '').trim();
  if (!rawSummary) {
    showToast('복사할 AI 요약 내용이 없습니다.', 'warning');
    return;
  }

  const success = await copyToClipboard(rawSummary, 'AI 요약이 클립보드에 복사되었습니다.');

  if (success) {
    logActivity({
      category: 'AI',
      action: 'AI_SUMMARY_COPY',
      target: { type: 'agenda', id: agenda.id, title: agenda.title },
      details: { summary: `"${agenda.title}" 안건의 회의 대비 AI 요약 본문을 클립보드에 복사함` }
    });

    if (btnEl) {
      const originalHtml = btnEl.innerHTML;
      const originalClasses = btnEl.className;
      btnEl.innerHTML = `
        <svg class="w-3 h-3 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
        <span class="text-emerald-700 font-bold">복사됨!</span>
      `;
      btnEl.classList.add('bg-emerald-50', 'border-emerald-200');
      setTimeout(() => {
        btnEl.innerHTML = originalHtml;
        btnEl.className = originalClasses;
      }, 1500);
    }
  }
}

export function renderAgendas() {
  const container = document.getElementById('agendas-container');
  const emptyState = document.getElementById('empty-state');

  const countAll = document.getElementById('count-all');
  const countActive = document.getElementById('count-active');
  const countClosed = document.getElementById('count-closed');

  const activeCount = agendas.filter(a => a.status === 'active').length;
  const closedCount = agendas.filter(a => a.status === 'closed').length;

  if (countAll) countAll.textContent = agendas.length;
  if (countActive) countActive.textContent = activeCount;
  if (countClosed) countClosed.textContent = closedCount;

  if (typeof window.updateAdminDebugModeUI === 'function') {
    window.updateAdminDebugModeUI();
  }

  let filtered = agendas;
  if (currentFilter === 'active') filtered = agendas.filter(a => a.status === 'active');
  if (currentFilter === 'closed') filtered = agendas.filter(a => a.status === 'closed');

  if (filtered.length === 0) {
    if (container) container.innerHTML = '';
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }
  if (emptyState) emptyState.classList.add('hidden');

  if (!container) return;

  container.innerHTML = filtered.map(agenda => {
    const options = agenda.options || [];
    const totalVotes = options.reduce((sum, opt) => sum + (opt.votes ? opt.votes.length : 0), 0);

    const userVotedOpt = options.find(opt => {
      const list = opt.votes || [];
      return list.includes(currentUser.name) || (currentUser.uid && list.includes(currentUser.uid));
    });

    const comments = agenda.comments || [];
    const isExpanded = expandedAgendaIds.has(agenda.id);
    const hasManagePermission = canManageAgenda(agenda);
    const isClosed = agenda.status === 'closed';

    return `
      <div class="bg-white rounded-2xl shadow-xs border transition-all duration-200 ${isExpanded ? 'border-blue-400 ring-1 ring-blue-100 p-4' : 'border-slate-200 hover:border-slate-300 p-3.5 sm:p-4'}" id="agenda-card-${agenda.id}">
        <!-- Header Badges with 3-Dots Menu -->
        <div class="flex items-center justify-between gap-1.5 mb-2">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="px-2 py-0.5 rounded-md text-[10px] sm:text-[11px] font-bold bg-slate-100 text-slate-700">${escapeHtml(agenda.category)}</span>
            <span class="text-[10px] sm:text-[11px] text-slate-400">• ${escapeHtml(agenda.author)} (${escapeHtml(agenda.authorRole)})</span>
          </div>
          
          <div class="flex items-center gap-1.5 relative flex-wrap sm:flex-nowrap">
            ${agenda.status === 'active' 
              ? (options.length > 0 
                  ? `<span class="px-1.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-bold bg-amber-100 text-amber-800 flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping"></span> 투표중</span>`
                  : `<span class="px-1.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-bold bg-blue-100 text-blue-800 flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span> 의견수렴</span>`)
              : `<span class="px-1.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-bold bg-slate-100 text-slate-600">의결완료</span>`
            }

            <!-- 안건 공유 버튼 (1단계 범용 공유 버튼) -->
            <button type="button" onclick="openKakaoShareModalById('${agenda.id}')" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] sm:text-[10px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200/80 transition shadow-2xs shrink-0 cursor-pointer" title="안건 공유">
              <svg class="w-3 h-3 text-slate-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg>
              <span>공유</span>
            </button>

            ${hasManagePermission ? `
              <!-- 3-Dots Trigger Button (관리자 및 안건 등록자 전용) -->
              <button type="button" onclick="toggleAgendaMenu(event, '${agenda.id}')" title="안건 메뉴" class="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path></svg>
              </button>

              <!-- 3-Dots Dropdown Popup (1, 2, 3 기능) -->
              <div id="agenda-menu-${agenda.id}" class="agenda-dropdown-menu hidden absolute right-0 top-full mt-1 w-32 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-30 divide-y divide-slate-100">
                <div class="py-1">
                  <button type="button" onclick="openEditAgendaModal('${agenda.id}')" class="w-full px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer">
                    <svg class="w-3.5 h-3.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                    1. 수정
                  </button>
                  <button type="button" onclick="confirmDeleteAgenda('${agenda.id}')" class="w-full px-3 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50 flex items-center gap-2 cursor-pointer">
                    <svg class="w-3.5 h-3.5 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    2. 삭제
                  </button>
                </div>
                <div class="py-1">
                  <button type="button" onclick="toggleAgendaStatus('${agenda.id}')" class="w-full px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer">
                    <svg class="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    3. ${agenda.status === 'active' ? '의결 완료' : (options.length > 0 ? '투표 진행중' : '의견 수렴중')}
                  </button>
                  <button type="button" onclick="exportSingleAgendaJson('${agenda.id}')" class="w-full px-3 py-2 text-left text-xs font-semibold text-blue-600 hover:bg-blue-50 flex items-center gap-2 cursor-pointer">
                    <svg class="w-3.5 h-3.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                    4. 안건 백업 (JSON)
                  </button>
                </div>
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Title Header Button (Click to Expand / Collapse All) -->
        <div onclick="toggleAgendaDetails('${agenda.id}')" class="cursor-pointer group flex items-start justify-between gap-2.5 select-none rounded-xl p-1 -m-1 hover:bg-slate-50/80 transition">
          <div class="flex-1">
            <h3 class="text-sm sm:text-base font-bold text-slate-900 leading-snug tracking-tight group-hover:text-blue-600 transition flex items-center gap-1.5 flex-wrap">
              <span>${escapeHtml(agenda.title)}</span>
            </h3>
            
            <!-- Quick Meta Summary Bar (Visible Always) -->
            <div class="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
              <span class="inline-flex items-center gap-1 text-slate-600 font-medium">
                <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                부서: ${escapeHtml(agenda.targetDept || '전체')}
              </span>
              <span>•</span>
              <span class="inline-flex items-center gap-1 text-slate-600 font-medium">
                <svg class="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                ${escapeHtml(agenda.createdAt || '최근')}
              </span>
            </div>
          </div>

          <!-- Chevron Expand Indicator Button -->
          <div class="flex items-center gap-1 mt-0.5 px-2 py-1 rounded-lg text-xs font-semibold ${isExpanded ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-600 group-hover:bg-slate-200'} transition shrink-0">
            <span class="text-[11px]">${isExpanded ? '접기' : '상세보기'}</span>
            <svg class="w-3.5 h-3.5 transform transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
          </div>
        </div>

        <!-- Collapsible Content Wrapper -->
        ${isExpanded ? `
          <div class="mt-3 pt-3 border-t border-slate-100 space-y-3.5 animate-fadeIn">
            <!-- Full Description -->
            <div class="bg-slate-50/70 p-3 rounded-xl border border-slate-100 text-xs text-slate-700 leading-relaxed whitespace-pre-line">
              ${escapeHtml(agenda.desc || '내용이 없습니다.')}
            </div>

            <!-- Vote Section (Optional) -->
            ${options.length > 0 ? `
              <div class="space-y-2">
                <div class="flex items-center justify-between text-[11px] font-bold text-slate-700">
                  <span class="flex items-center gap-1">
                    <svg class="w-3.5 h-3.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    의결 투표 참여
                  </span>
                  <span class="text-slate-400 font-normal">총 ${totalVotes}명 참여</span>
                </div>

                <div class="space-y-1.5">
                  ${options.map(opt => {
                    const votes = opt.votes || [];
                    const vCount = votes.length;
                    const pct = totalVotes > 0 ? Math.round((vCount / totalVotes) * 100) : 0;
                    const isMyChoice = votes.includes(currentUser.name) || (currentUser.uid && votes.includes(currentUser.uid));
                    const isClosed = agenda.status === 'closed';

                    return `
                      <button type="button" 
                              onclick="${isClosed ? '' : `submitVote('${agenda.id}', '${opt.id}')`}" 
                              ${isClosed ? 'disabled' : ''}
                              class="w-full relative overflow-hidden rounded-xl border p-2.5 text-left transition ${isMyChoice ? 'border-blue-500 bg-blue-50/40 font-bold' : 'border-slate-200 hover:border-slate-300 bg-white'} ${isClosed ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}">
                        <!-- Progress Bar Fill -->
                        <div class="absolute inset-0 bg-blue-100/60 pointer-events-none transition-all duration-300" style="width: ${pct}%"></div>

                        <div class="relative flex items-center justify-between z-10 text-xs">
                          <div class="flex items-center gap-2">
                            <span class="w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${isMyChoice ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'}">
                              ${isMyChoice ? '✓' : ''}
                            </span>
                            <span class="text-slate-800">${escapeHtml(opt.text)}</span>
                          </div>
                          <div class="flex items-center gap-1.5 font-mono text-[11px] text-slate-600 shrink-0">
                            <span>${vCount}표</span>
                            <span class="font-bold text-blue-700">(${pct}%)</span>
                          </div>
                        </div>
                      </button>
                    `;
                  }).join('')}
                </div>
              </div>
            ` : ''}

            <!-- AI Summary Section -->
            <div class="bg-indigo-50/70 border border-indigo-100 p-2.5 sm:p-3 rounded-xl">
              <div class="flex items-center justify-between gap-1.5 mb-1.5">
                <div class="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold text-indigo-900 flex-wrap">
                  <div class="flex items-center gap-1">
                    <svg class="w-3.5 h-3.5 text-indigo-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                    <span>회의 대비 AI 요약</span>
                  </div>
                  ${agenda.aiSummaryUpdatedTime ? `
                    <span class="text-[9px] font-semibold text-indigo-600 bg-white/95 border border-indigo-200/80 px-1.5 py-0.2 rounded-md inline-flex items-center gap-1 shadow-2xs" title="${agenda.aiSummaryUpdatedAt ? new Date(agenda.aiSummaryUpdatedAt).toLocaleString('ko-KR') : ''}">
                      <svg class="w-2.5 h-2.5 text-indigo-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      <span>마지막 요약: ${escapeHtml(agenda.aiSummaryUpdatedTime)}</span>
                    </span>
                  ` : ''}
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  <button onclick="copyAiSummary('${agenda.id}', this)" class="px-1.5 py-0.5 rounded-md bg-white hover:bg-indigo-100 text-[10px] font-semibold text-indigo-700 border border-indigo-200 shadow-2xs transition flex items-center gap-1 shrink-0 cursor-pointer active:scale-95" title="AI 요약 본문 클립보드 복사">
                    <svg class="w-3 h-3 text-indigo-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 8h2a2 2 0 012 2v8a2 2 0 01-2 2H10a2 2 0 01-2-2v-2"></path></svg>
                    <span>요약 복사</span>
                  </button>
                  ${isClosed ? `
                    <span class="px-2 py-0.5 rounded-md bg-slate-100 text-[10px] font-semibold text-slate-500 border border-slate-200 shadow-2xs inline-flex items-center gap-1 shrink-0 select-none cursor-not-allowed" title="의결 완료된 안건은 AI 요약이 마감되었습니다.">
                      <svg class="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                      <span>요약 마감</span>
                    </span>
                  ` : `
                    <button onclick="requestAiSummary('${agenda.id}', true)" class="px-1.5 py-0.5 rounded-md bg-white hover:bg-indigo-100 text-[10px] font-semibold text-indigo-700 border border-indigo-200 shadow-2xs transition flex items-center gap-1 shrink-0 cursor-pointer">
                      ${agenda.isGeneratingSummary ? `
                        <svg class="w-3 h-3 animate-spin text-indigo-600" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>
                        분석중
                      ` : `
                        <svg class="w-3 h-3 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                        요약 갱신
                      `}
                    </button>
                  `}
                </div>
              </div>
              <div class="text-[11px] sm:text-xs text-slate-700 whitespace-pre-line leading-relaxed bg-white/80 p-2 sm:p-2.5 rounded-lg border border-indigo-100/70 font-sans">
                ${cleanAiSummaryText(agenda.aiSummary)}
              </div>
            </div>

            <!-- Comments Section -->
            <div class="border-t border-slate-100 pt-2.5">
              <div class="flex items-center justify-between text-[11px] font-bold text-slate-700 mb-1.5">
                <span>부원 의견 피드백 (${comments.length}개)</span>
              </div>

              <div class="space-y-1.5 max-h-36 sm:max-h-44 overflow-y-auto custom-scrollbar pr-1 mb-2" id="comment-list-${agenda.id}">
                ${comments.length === 0 ? `
                  <p class="text-[10px] text-slate-400 text-center py-1.5">등록된 의견이 없습니다. 첫 의견을 남겨보세요!</p>
                ` : comments.map(c => {
                  const isPersonaComment = Boolean(
                    c.isPersona === true ||
                    (c.uid && (c.uid.startsWith('persona-') || c.uid.startsWith('test-'))) ||
                    !c.uid ||
                    (c.id && c.id.startsWith('c-d')) ||
                    ['c-1', 'c-2', 'c-3'].includes(c.id)
                  );

                  // 본인 작성 댓글: 페르소나가 아니면서 내 UID 또는 이름과 일치
                  const isMyComment = !isPersonaComment && ((currentUser.uid && c.uid === currentUser.uid) || (currentUser.name && c.author === currentUser.name));
                  const isJustAdded = c.id === latestAddedCommentId;
                  const isHidden = Boolean(c.isHidden);
                  const isKakao = (c.provider === 'kakao') || (c.uid && String(c.uid).startsWith('kakao_')) || (isMyComment && currentUser.provider === 'kakao');

                  let avatarMarkup = '';
                  if (isPersonaComment) {
                    const deptEmojis = ['📘', '📙', '📗', '🎨', '🛡️'];
                    const hash = Math.abs((c.author || '').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)) % deptEmojis.length;
                    avatarMarkup = `
                      <div class="w-6 h-6 rounded-full bg-purple-100 border border-purple-300 flex items-center justify-center text-xs shrink-0 select-none shadow-2xs" title="테스트 페르소나">
                        ${deptEmojis[hash]}
                      </div>
                    `;
                  } else {
                    let authorUser = null;
                    if (isMyComment) {
                      authorUser = {
                        uid: currentUser.uid || c.uid,
                        name: currentUser.name || c.author,
                        provider: currentUser.provider || c.provider || 'google',
                        avatarType: currentUser.avatarType || (currentUser.customPhotoURL ? 'custom' : (currentUser.photoURL ? 'oauth' : 'provider')),
                        photoURL: currentUser.photoURL || c.photoURL || '',
                        customPhotoURL: currentUser.customPhotoURL || c.customPhotoURL || ''
                      };
                    } else {
                      const member = (allUsersList || []).find(u => (u.uid && u.uid === c.uid) || (u.id && u.id === c.uid) || (u.name && u.name === c.author));
                      if (member) {
                        authorUser = {
                          uid: member.uid || member.id || c.uid,
                          name: member.name || c.author,
                          provider: member.provider || c.provider || 'google',
                          avatarType: member.avatarType || (member.customPhotoURL ? 'custom' : (member.photoURL ? 'oauth' : (c.avatarType || 'provider'))),
                          photoURL: member.photoURL || c.photoURL || '',
                          customPhotoURL: member.customPhotoURL || c.customPhotoURL || ''
                        };
                      } else {
                        authorUser = {
                          uid: c.uid,
                          name: c.author,
                          provider: c.provider || 'google',
                          avatarType: c.avatarType || (c.customPhotoURL ? 'custom' : (c.photoURL ? 'oauth' : 'provider')),
                          photoURL: c.photoURL || '',
                          customPhotoURL: c.customPhotoURL || ''
                        };
                      }
                    }
                    avatarMarkup = getUnifiedUserAvatarHtml(authorUser, 'w-6 h-6', 'rounded-full');
                  }

                  const authorClickAttr = currentUser.isAdmin
                    ? (isPersonaComment
                        ? `onclick="openMemberProfileModalByUid('', '${escapeHtml(c.author)}', true)" class="cursor-pointer hover:underline inline-flex items-center gap-1.5"`
                        : `onclick="openMemberProfileModalByUid('${c.uid || ''}', '${escapeHtml(c.author)}', false)" class="cursor-pointer hover:underline text-indigo-700 hover:text-indigo-900 inline-flex items-center gap-1.5" title="[관리자] 부원 프로필 확인 및 관리"`)
                    : `class="inline-flex items-center gap-1.5"`;

                  // 1) 관리자에 의해 숨김(블라인드) 처리된 댓글
                  if (isHidden) {
                    if (!currentUser.isAdmin) {
                      return `
                        <div class="bg-slate-100/90 border border-slate-200/70 p-2 rounded-lg text-[11px] text-slate-400 flex items-center justify-between gap-2" id="comment-item-${c.id}">
                          <div class="flex items-center gap-1.5 italic">
                            <svg class="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"></path></svg>
                            <span>🔒 관리자에 의해 숨김 처리된 의견입니다.</span>
                          </div>
                          <span class="text-[9px] text-slate-400">${escapeHtml(c.time || '')}</span>
                        </div>
                      `;
                    } else {
                      // 관리자 화면: 블라인드 상태 표시 및 [숨김 해제] 가능
                      return `
                        <div class="bg-amber-50/80 border border-amber-200 p-2 rounded-lg text-[11px] relative transition-all" id="comment-item-${c.id}">
                          <div class="flex items-center justify-between text-[9px] text-amber-800 mb-1">
                            <div class="flex items-center gap-1.5">
                              ${avatarMarkup}
                              <span ${authorClickAttr}>
                                <span class="font-bold text-slate-600 line-through opacity-70">${escapeHtml(c.author)}</span>
                                <span class="font-normal text-slate-400">(${escapeHtml(c.role || '부원')})</span>
                              </span>
                              <span class="px-1.5 py-0.2 rounded bg-amber-200 text-amber-800 text-[9px] font-bold">🔒 관리자 숨김됨</span>
                            </div>
                            <div class="flex items-center gap-1.5">
                              <span>${escapeHtml(c.time || '')}</span>
                              <button type="button" onclick="toggleHideComment('${agenda.id}', '${c.id}')" class="text-amber-700 hover:text-amber-900 font-bold underline text-[10px]">숨김 해제</button>
                            </div>
                          </div>
                          <div class="text-slate-600 line-through opacity-75 text-[10px]">
                            <p class="leading-snug whitespace-pre-line">${escapeHtml(c.text)}</p>
                          </div>
                        </div>
                      `;
                    }
                  }

                  // 2) 정상 공개 상태인 댓글
                  return `
                    <div class="${isJustAdded ? 'comment-pop-in ring-2 ring-blue-500 bg-blue-50/90 shadow-md shadow-blue-500/10' : 'bg-slate-50 border-slate-100'} p-2 rounded-lg border text-[11px] group relative transition-all duration-700" id="comment-item-${c.id}">
                      <div class="flex items-center justify-between text-[9px] text-slate-500 mb-1">
                        <div class="flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
                          ${avatarMarkup}
                          <span ${authorClickAttr}>
                            <span class="font-bold text-slate-800">${escapeHtml(c.author)}</span>
                            <span class="font-normal text-slate-400">(${escapeHtml(c.role || '부원')})</span>
                          </span>
                          ${!isPersonaComment ? (
                            isKakao 
                              ? `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#FEE500]/30 text-[#3C1E1E] text-[8px] font-bold border border-[#e6cf00]/50"><svg class="w-2.5 h-2.5 shrink-0" viewBox="0 0 24 24" fill="#191919"><path d="M12 3C6.477 3 2 6.477 2 10.767c0 2.766 1.874 5.188 4.688 6.556-.206.77-.745 2.784-.853 3.208-.135.534.195.526.41.383.17-.113 2.705-1.84 3.799-2.584.63.092 1.284.14 1.956.14 5.523 0 10-3.477 10-7.767C22 6.477 17.523 3 12 3z"/></svg> 카카오</span>`
                              : `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 text-[8px] font-bold border border-blue-200"><svg class="w-2.5 h-2.5 shrink-0" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"/><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"/><path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15s.7 5.3 1.9 7.7l3.7-2.9z"/><path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16c1.8 3.7 5.6 7 10.1 7z"/></svg> Google</span>`
                          ) : ''}
                          ${isPersonaComment ? `<span class="px-1.5 py-0.2 rounded bg-purple-100 text-purple-700 text-[9px] font-bold border border-purple-200">🧪 테스트</span>` : ''}
                          ${isJustAdded ? `<span class="px-1.5 py-0.5 rounded-full bg-blue-600 text-white text-[9px] font-bold animate-pulse shadow-xs">방금 등록 ✨</span>` : ''}
                        </div>
                        <div class="flex items-center gap-1.5">
                          <span>${escapeHtml(c.time)}</span>
                          ${isClosed ? `
                            <span class="text-[9px] text-slate-400 font-normal px-1 py-0.2 rounded bg-slate-100/90 border border-slate-200/60 select-none">의결완료</span>
                          ` : (isMyComment ? `
                            <div class="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition">
                              <button type="button" onclick="startEditComment('${agenda.id}', '${c.id}')" class="text-blue-600 hover:underline font-semibold">수정</button>
                              <span>·</span>
                              <button type="button" onclick="deleteComment('${agenda.id}', '${c.id}')" class="text-rose-600 hover:underline font-semibold">삭제</button>
                            </div>
                          ` : (currentUser.isAdmin ? `
                            <div class="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition">
                              ${isPersonaComment ? `
                                <button type="button" onclick="startEditComment('${agenda.id}', '${c.id}')" class="text-purple-600 hover:underline font-semibold" title="테스트 의견 수정">수정</button>
                                <span>·</span>
                                <button type="button" onclick="deleteComment('${agenda.id}', '${c.id}')" class="text-rose-600 hover:underline font-semibold" title="테스트 의견 삭제">삭제</button>
                              ` : `
                                <button type="button" onclick="toggleHideComment('${agenda.id}', '${c.id}')" class="text-amber-600 hover:underline font-semibold" title="공식 의견 숨김(블라인드)">숨김</button>
                              `}
                            </div>
                          ` : ''))}
                        </div>
                      </div>
                      <div id="comment-content-${c.id}">
                        <p class="text-slate-800 leading-snug whitespace-pre-line">${escapeHtml(c.text)}</p>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>

              <!-- Debug Persona Input (Admin Only) -->
              ${(currentUser.isAdmin && isAdminDebugMode && !isClosed) ? (() => {
                const persona = getOrInitAgendaPersona(agenda.id);
                return `
                <div class="mb-2 p-2.5 bg-gradient-to-r from-purple-50 via-indigo-50/50 to-purple-50 border border-purple-200/90 rounded-xl space-y-1.5 shadow-2xs">
                  <div class="flex items-center justify-between text-[10px] text-purple-950 font-bold">
                    <div class="flex items-center gap-1.5">
                      <span>🛠️ 관리자 테스트 페르소나 (임의 작성자 설정)</span>
                      <span class="text-[9px] text-purple-700 font-semibold bg-purple-100 border border-purple-200 px-1.5 py-0.2 rounded-md">디버그 활성</span>
                    </div>
                    <button type="button" onclick="rerollPersona('${agenda.id}')" class="text-[10px] text-purple-700 hover:text-purple-900 bg-white hover:bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-lg font-semibold inline-flex items-center gap-1 transition shadow-2xs active:scale-95" title="다른 부원으로 랜덤 변경">
                      <span>🎲 다른 부원 추천</span>
                    </button>
                  </div>
                  <div class="flex gap-1.5">
                    <input type="text" id="debug-author-${agenda.id}" placeholder="가상 이름 (예: 박기획)" value="${escapeHtml(persona.author)}" class="w-1/3 px-2.5 py-1 text-[11px] font-bold text-purple-900 rounded-lg border border-purple-200 bg-white focus:outline-none focus:ring-2 focus:ring-purple-400 placeholder:text-purple-300">
                    <input type="text" id="debug-role-${agenda.id}" placeholder="가상 직책 (예: 1학년 행사기획부)" value="${escapeHtml(persona.role)}" class="flex-1 px-2.5 py-1 text-[11px] text-purple-800 rounded-lg border border-purple-200 bg-white focus:outline-none focus:ring-2 focus:ring-purple-400 placeholder:text-purple-300">
                  </div>
                  <p class="text-[9px] text-purple-600/80">💡 추천된 이름과 부서를 자유롭게 수정할 수 있으며, 최종 수정된 값으로 댓글이 등록됩니다.</p>
                </div>
              `;})() : ''}

              <!-- Add Comment Form or Closed Notice -->
              ${isClosed ? `
                <div class="p-2.5 bg-slate-50/90 border border-slate-200 rounded-xl text-center text-xs text-slate-500 flex items-center justify-center gap-1.5 select-none">
                  <svg class="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                  <span>이 안건은 <strong class="font-semibold text-slate-700">의결이 완료</strong>되어 투표 및 의견 피드백이 마감되었습니다.</span>
                </div>
              ` : `
                <form onsubmit="handleCommentSubmit(event, '${agenda.id}')" class="flex gap-1.5">
                  <input type="text" id="comment-input-${agenda.id}" 
                         placeholder="${currentUser.name ? '의견 작성 (엔터 제출)' : '부원 등록 후 작성 가능'}" 
                         onclick="handleCommentInputClick()"
                         class="flex-1 px-2.5 py-1.5 text-[11px] rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  <button type="submit" class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-semibold shrink-0 transition shadow-xs">
                    등록
                  </button>
                </form>
              `}
            </div>

            <!-- Close / Collapse Button at bottom -->
            <div class="mt-3 pt-2 text-center border-t border-slate-100">
              <button type="button" onclick="toggleAgendaDetails('${agenda.id}')" class="text-[11px] text-slate-400 hover:text-slate-600 font-medium inline-flex items-center gap-1 transition">
                <span>안건 접기</span>
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"></path></svg>
              </button>
            </div>
          </div>
        ` : ''}

      </div>
    `;
  }).join('');

  // 딥링크 안건 자동 펼치기 및 포커스 이동 트리거
  if (!hasHandledDeepLink) {
    setTimeout(processDeepLinkAgenda, 50);
  }
}

let hasHandledDeepLink = false;

// URL 쿼리스트링 및 해시에서 안건 ID 추출 (카카오톡 파라미터 변형 100% 방어)
export function extractDeepLinkAgendaId() {
  try {
    if (typeof window === 'undefined') return null;

    // 1. 표준 쿼리스트링: ?agenda=ag-xxx 또는 ?agendaId=ag-xxx
    const urlParams = new URLSearchParams(window.location.search);
    const fromSearch = urlParams.get('agenda') || urlParams.get('agendaId');
    if (fromSearch) return fromSearch.trim();

    // 2. 해시 프래그먼트: #agenda=ag-xxx 또는 #ag-xxx
    const hash = window.location.hash || '';
    if (hash) {
      const cleanHash = hash.replace(/^#/, '');
      if (cleanHash.includes('=')) {
        const hashParams = new URLSearchParams(cleanHash);
        const fromHashParam = hashParams.get('agenda') || hashParams.get('agendaId');
        if (fromHashParam) return fromHashParam.trim();
      } else if (cleanHash.startsWith('ag-')) {
        return cleanHash.trim();
      }
    }

    // 3. 극단적 카카오 파라미터 변형 대비: 전체 URL에서 agenda 정규식 패턴 매칭
    const rawMatch = window.location.href.match(/agenda[=:]+(ag-[0-9a-zA-Z_-]+)/i) || window.location.href.match(/#(ag-[0-9a-zA-Z_-]+)/i);
    if (rawMatch && rawMatch[1]) {
      return rawMatch[1];
    }
  } catch (e) {
    console.warn('extractDeepLinkAgendaId error:', e);
  }
  return null;
}

// 딥링크 안건 자동 펼침 및 부드러운 스크롤/하이라이트 처리
export function processDeepLinkAgenda() {
  if (hasHandledDeepLink) return;

  const targetAgendaId = extractDeepLinkAgendaId();
  if (!targetAgendaId) return;

  // Firestore 비동기 데이터가 아직 로드되지 않았으면 대기 (로드 후 renderAgendas에서 재시도)
  if (!agendas || agendas.length === 0) return;

  const targetAgenda = agendas.find(a => a.id === targetAgendaId);
  if (!targetAgenda) return;

  hasHandledDeepLink = true;

  // 필터 탭으로 인해 안건이 숨겨져 있을 경우 필터를 'all'로 리셋
  if (currentFilter !== 'all') {
    if ((currentFilter === 'active' && targetAgenda.status !== 'active') ||
        (currentFilter === 'closed' && targetAgenda.status !== 'closed')) {
      filterAgendas('all');
    }
  }

  // 안건 상세 내용 자동 펼침
  expandedAgendaIds.add(targetAgendaId);
  renderAgendas();

  // DOM 렌더링 완료 후 해당 안건 카드로 부드럽게 스크롤 & 하이라이트 애니메이션
  setTimeout(() => {
    const cardEl = document.getElementById('agenda-card-' + targetAgendaId);
    if (cardEl) {
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      cardEl.classList.add('ring-4', 'ring-blue-500', 'border-blue-500', 'shadow-xl');
      showToast(`📌 공유받은 "${targetAgenda.title}" 안건으로 이동했습니다.`, 'info');

      setTimeout(() => {
        cardEl.classList.remove('ring-4', 'ring-blue-500', 'shadow-xl');
      }, 3500);
    }
  }, 180);
}

export function handleCommentInputClick() {
  if (!currentUser.name) {
    if (typeof window.openLoginModal === 'function') {
      window.openLoginModal();
    }
  }
}

export function toggleAgendaMenu(e, agendaId) {
  e.stopPropagation();
  const targetMenu = document.getElementById(`agenda-menu-${agendaId}`);
  if (!targetMenu) return;
  const isHidden = targetMenu.classList.contains('hidden');
  closeAllAgendaMenus();
  if (isHidden) {
    targetMenu.classList.remove('hidden');
  }
}

export function closeAllAgendaMenus() {
  document.querySelectorAll('.agenda-dropdown-menu').forEach(menu => {
    menu.classList.add('hidden');
  });
}

export function canManageAgenda(agenda) {
  if (!agenda) return false;
  if (!currentUser || !currentUser.isAuthenticated) return false;
  // 관리자 권한
  if (currentUser.isAdmin || currentUser.canApprove || currentUser.role === '총괄관리자' || currentUser.role === '공동관리자') {
    return true;
  }
  // 안건 등록자 UID 비교
  if (agenda.authorUid && (agenda.authorUid === currentUser.uid || (authUser && agenda.authorUid === authUser.uid))) {
    return true;
  }
  // 안건 등록자 이름 비교 (기존 안건 및 UID 미포함 안건 대응)
  if (agenda.author && currentUser.name && agenda.author.trim() === currentUser.name.trim()) {
    return true;
  }
  return false;
}

export function openEditAgendaModal(agendaId) {
  closeAllAgendaMenus();
  if (!checkAuthOrPrompt()) return;
  const agenda = agendas.find(a => a.id === agendaId);
  if (!agenda) return;

  if (!canManageAgenda(agenda)) {
    showToast('관리자 또는 안건 등록자만 수정할 수 있습니다.', 'warning');
    return;
  }

  document.getElementById('edit-agenda-id').value = agenda.id;
  document.getElementById('edit-agenda-category').value = agenda.category || '축제/행사';
  document.getElementById('edit-agenda-title').value = agenda.title || '';
  document.getElementById('edit-agenda-desc').value = agenda.desc || '';
  document.getElementById('edit-agenda-target-dept').value = agenda.targetDept || '행사기획부';

  const hasOptions = agenda.options && agenda.options.length > 0;
  const enableVoteCheckbox = document.getElementById('edit-agenda-enable-vote');
  if (enableVoteCheckbox) {
    enableVoteCheckbox.checked = hasOptions;
  }
  toggleEditVoteOptionsInput(hasOptions);

  const container = document.getElementById('edit-options-container');
  if (container) {
    container.innerHTML = '';
    const currentOptions = hasOptions 
      ? agenda.options 
      : [{ id: 'opt-' + Date.now() + '-0', text: '찬성', votes: [] }, { id: 'opt-' + Date.now() + '-1', text: '반대', votes: [] }];

    currentOptions.forEach(opt => {
      appendEditOptionRow(opt.id, opt.text, (opt.votes || []).length);
    });
  }

  document.getElementById('modal-edit-agenda').classList.remove('hidden');
}

export function toggleVoteOptionsInput(enabled) {
  const wrapper = document.getElementById('vote-options-wrapper');
  const notice = document.getElementById('vote-options-notice');
  const inputs = document.querySelectorAll('.agenda-opt-input');
  if (enabled) {
    if (wrapper) wrapper.classList.remove('hidden');
    if (notice) notice.classList.add('hidden');
    inputs.forEach(inp => inp.setAttribute('required', 'required'));
  } else {
    if (wrapper) wrapper.classList.add('hidden');
    if (notice) notice.classList.remove('hidden');
    inputs.forEach(inp => inp.removeAttribute('required'));
  }
}

export function toggleEditVoteOptionsInput(enabled) {
  const wrapper = document.getElementById('edit-vote-options-wrapper');
  const notice = document.getElementById('edit-vote-options-notice');
  const inputs = document.querySelectorAll('.edit-opt-input');
  if (enabled) {
    if (wrapper) wrapper.classList.remove('hidden');
    if (notice) notice.classList.add('hidden');
    inputs.forEach(inp => inp.setAttribute('required', 'required'));
  } else {
    if (wrapper) wrapper.classList.add('hidden');
    if (notice) notice.classList.remove('hidden');
    inputs.forEach(inp => inp.removeAttribute('required'));
  }
}

export function appendEditOptionRow(optId, optText, voteCount = 0) {
  const container = document.getElementById('edit-options-container');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'flex items-center gap-2 edit-opt-row';
  row.innerHTML = `
    <input type="text" data-opt-id="${optId || ''}" value="${escapeHtml(optText || '')}" required
           placeholder="선택지 문구 입력"
           class="edit-opt-input flex-1 px-3 py-1.5 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none">
    ${voteCount > 0 ? `<span class="text-[10px] text-blue-600 font-semibold bg-blue-50 px-2 py-1 rounded shrink-0">${voteCount}표 유지</span>` : ''}
    <button type="button" onclick="removeEditOptionRow(this)" title="선택지 삭제"
            class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition shrink-0">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
    </button>
  `;
  container.appendChild(row);
}

export function addEditOptionInput() {
  const container = document.getElementById('edit-options-container');
  const rows = container.querySelectorAll('.edit-opt-row');
  if (rows.length >= 10) {
    showToast('선택지는 최대 10개까지만 가능합니다.', 'info');
    return;
  }
  appendEditOptionRow('opt-' + Date.now() + '-' + rows.length, '', 0);
}

export function removeEditOptionRow(btn) {
  const container = document.getElementById('edit-options-container');
  const rows = container.querySelectorAll('.edit-opt-row');
  if (rows.length <= 2) {
    showToast('투표 선택지는 최소 2개 이상이어야 합니다.', 'warning');
    return;
  }
  btn.closest('.edit-opt-row').remove();
}

export function closeEditAgendaModal() {
  document.getElementById('modal-edit-agenda').classList.add('hidden');
}

export async function handleUpdateAgenda(e) {
  e.preventDefault();
  const id = document.getElementById('edit-agenda-id').value;
  const category = document.getElementById('edit-agenda-category').value;
  const title = document.getElementById('edit-agenda-title').value.trim();
  const desc = document.getElementById('edit-agenda-desc').value.trim();
  const targetDept = document.getElementById('edit-agenda-target-dept').value;

  const originalAgenda = agendas.find(a => a.id === id);
  if (!originalAgenda || !canManageAgenda(originalAgenda)) {
    showToast('관리자 또는 안건 등록자만 수정할 수 있습니다.', 'warning');
    return;
  }
  const originalOptions = originalAgenda ? (originalAgenda.options || []) : [];

  const enableVote = document.getElementById('edit-agenda-enable-vote')?.checked ?? true;
  let updatedOptions = [];

  if (enableVote) {
    const inputElements = document.querySelectorAll('#edit-options-container .edit-opt-input');
    for (const input of inputElements) {
      const text = input.value.trim();
      if (!text) continue;
      const optId = input.getAttribute('data-opt-id');
      const matched = originalOptions.find(o => o.id === optId);

      updatedOptions.push({
        id: optId || ('opt-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4)),
        text: text,
        votes: matched ? (matched.votes || []) : []
      });
    }

    if (updatedOptions.length < 2) {
      showToast('투표를 진행하려면 선택지를 최소 2개 이상 입력해 주세요. (또는 [투표 진행하기] 체크를 해제하세요)', 'warning');
      return;
    }
  }

  if (!title || !desc) {
    showToast('안건 제목과 상세 내용을 모두 입력해 주세요.', 'warning');
    return;
  }

  if (db && authUser) {
    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'agendas', id);
      await updateDoc(docRef, { category, title, desc, targetDept, options: updatedOptions });
      showToast('안건 내용이 실시간으로 수정되었습니다.', 'success');

      logActivity({
        category: 'AGENDA',
        action: 'AGENDA_EDIT',
        target: { type: 'agenda', id: id, title: title },
        details: {
          summary: `"${title}" 안건의 내용/선택지를 수정함`,
          before: originalAgenda.title,
          after: title
        }
      });
    } catch (err) {
      console.error('Update agenda failed:', err);
      showToast('안건 수정 중 오류가 발생했습니다.', 'warning');
    }
  } else {
    const target = agendas.find(a => a.id === id);
    if (target) {
      target.category = category;
      target.title = title;
      target.desc = desc;
      target.targetDept = targetDept;
      target.options = updatedOptions;
      renderAgendas();
    }
    showToast('안건 내용이 수정되었습니다.', 'success');
  }

  closeEditAgendaModal();
}

export function confirmDeleteAgenda(agendaId) {
  closeAllAgendaMenus();
  if (!checkAuthOrPrompt()) return;

  const agenda = agendas.find(a => a.id === agendaId);
  if (!agenda) return;
  if (!canManageAgenda(agenda)) {
    showToast('관리자 또는 안건 등록자만 삭제할 수 있습니다.', 'warning');
    return;
  }
  const title = agenda ? agenda.title : '선택한 안건';

  showCustomConfirm(`"${title}" 안건을 정말 삭제하시겠습니까?\n삭제 시 투표 집계 및 등록된 의견 댓글도 모두 함께 영구 삭제됩니다.`, async () => {
    if (db && authUser) {
      try {
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'agendas', agendaId);
        await deleteDoc(docRef);
        showToast('안건이 전체 부원 화면에서 완전히 삭제되었습니다.', 'info');

        logActivity({
          category: 'AGENDA',
          action: 'AGENDA_DELETE',
          target: { type: 'agenda', id: agendaId, title: title },
          details: {
            summary: `"${title}" 안건을 영구 삭제함 (투표 및 댓글 전체 삭제)`,
            before: title
          }
        });
      } catch (err) {
        console.error('Delete agenda failed:', err);
        showToast('안건 삭제 실패: 통신 상태를 확인하세요.', 'warning');
      }
    } else {
      setAgendas(agendas.filter(a => a.id !== agendaId));
      renderAgendas();
      showToast('안건이 삭제되었습니다.', 'info');
    }
  });
}

export async function toggleAgendaStatus(agendaId) {
  closeAllAgendaMenus();
  if (!checkAuthOrPrompt()) return;
  const agenda = agendas.find(a => a.id === agendaId);
  if (!agenda) return;
  if (!canManageAgenda(agenda)) {
    showToast('관리자 또는 안건 등록자만 상태를 변경할 수 있습니다.', 'warning');
    return;
  }

  const nextStatus = agenda.status === 'active' ? 'closed' : 'active';

  if (db && authUser) {
    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'agendas', agendaId);
      await updateDoc(docRef, { status: nextStatus });
      showToast(`안건 상태가 '${nextStatus === 'active' ? '투표 진행중' : '의결 완료'}'로 전환되었습니다.`, 'info');

      logActivity({
        category: 'AGENDA',
        action: nextStatus === 'closed' ? 'AGENDA_CLOSE' : 'AGENDA_REOPEN',
        target: { type: 'agenda', id: agendaId, title: agenda.title },
        details: {
          summary: nextStatus === 'closed' 
            ? `"${agenda.title}" 안건을 [의결 완료] 상태로 공식 마감함`
            : `"${agenda.title}" 안건의 의결 마감을 해제하고 [투표/의견수렴 진행중]으로 재개함`,
          before: agenda.status,
          after: nextStatus
        }
      });
    } catch (e) {
      console.error('Status toggle failed:', e);
    }
  } else {
    agenda.status = nextStatus;
    renderAgendas();
  }
}

export async function submitVote(agendaId, optionId) {
  if (!checkAuthOrPrompt()) return;

  const agenda = agendas.find(a => a.id === agendaId);
  if (!agenda) return;

  if (agenda.status === 'closed') {
    showToast('이미 의결이 완료된 안건입니다.', 'info');
    return;
  }

  const voterKey = currentUser.name;
  const previousOpt = (agenda.options || []).find(opt => (opt.votes || []).includes(voterKey) || (currentUser.uid && (opt.votes || []).includes(currentUser.uid)));
  const targetOpt = (agenda.options || []).find(opt => opt.id === optionId);
  const isVoteChange = previousOpt && previousOpt.id !== optionId;

  const updatedOptions = (agenda.options || []).map(opt => {
    const votes = (opt.votes || []).filter(v => v !== voterKey && v !== currentUser.uid);
    if (opt.id === optionId) {
      votes.push(voterKey);
    }
    return {
      ...opt,
      votes
    };
  });

  if (db && authUser) {
    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'agendas', agendaId);
      await updateDoc(docRef, { options: updatedOptions });
      showToast('실시간 투표가 전체 부원 화면에 반영되었습니다.', 'success');

      logActivity({
        category: 'VOTE',
        action: isVoteChange ? 'VOTE_CHANGE' : 'VOTE_SUBMIT',
        target: { type: 'agenda', id: agendaId, title: agenda.title },
        details: {
          summary: isVoteChange 
            ? `투표 선택지를 "${previousOpt.text}"에서 "${targetOpt?.text || ''}"(으)로 변경함`
            : `"${targetOpt?.text || ''}" 선택지에 투표를 행사함`,
          before: isVoteChange ? previousOpt.text : null,
          after: targetOpt?.text || null
        }
      });
    } catch (e) {
      console.error('Vote update failed:', e);
      showToast('투표 저장 중 통신 오류가 발생했습니다.', 'warning');
    }
  } else {
    agenda.options = updatedOptions;
    renderAgendas();
  }

  try {
    requestAiSummary(agendaId, false);
  } catch(e) {}
}

export async function submitComment(agendaId) {
  if (!checkAuthOrPrompt()) return;

  const input = document.getElementById(`comment-input-${agendaId}`);
  if (!input) return;
  const text = input.value.trim();
  if (!text) {
    showToast('의견 내용을 입력해 주세요.', 'warning');
    return;
  }

  const agenda = agendas.find(a => a.id === agendaId);
  if (!agenda) return;

  if (agenda.status === 'closed') {
    showToast('의결이 완료된 안건에는 새로운 의견을 등록할 수 없습니다.', 'warning');
    return;
  }

  const submitBtn = input.parentElement?.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <span class="inline-flex items-center gap-1">
        <svg class="w-3 h-3 animate-spin text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>
        <span>등록중</span>
      </span>
    `;
  }

  expandedAgendaIds.add(agendaId);

  const now = new Date();
  const timeString = `${now.getHours()}:${now.getMinutes() < 10 ? '0' : ''}${now.getMinutes()}`;

  let commentAuthor = currentUser.name || '학생회 부원';
  let commentRole = `${currentUser.grade || ''} ${currentUser.role || currentUser.department || ''}`.trim();
  let commentUid = currentUser.uid || authUser?.uid || ('u-' + Math.random().toString(36).substr(2, 6));
  let isPersonaComment = false;

  if (currentUser.isAdmin && isAdminDebugMode) {
    const customAuthor = document.getElementById(`debug-author-${agendaId}`)?.value.trim();
    const customRole = document.getElementById(`debug-role-${agendaId}`)?.value.trim();
    if (customAuthor) {
      commentAuthor = customAuthor;
      commentRole = customRole || '학생회 부원';
      commentUid = 'persona-' + Date.now();
      isPersonaComment = true;
    }
  }

  const commentId = 'c-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4);
  const newComment = {
    id: commentId,
    uid: commentUid,
    author: commentAuthor,
    role: commentRole,
    text,
    time: timeString,
    isPersona: isPersonaComment,
    isHidden: false,
    provider: isPersonaComment ? 'persona' : (currentUser.provider || 'google'),
    avatarType: isPersonaComment ? 'persona' : (currentUser.avatarType || 'oauth'),
    photoURL: isPersonaComment ? '' : (currentUser.photoURL || ''),
    customPhotoURL: isPersonaComment ? '' : (currentUser.customPhotoURL || '')
  };

  latestAddedCommentId = commentId;

  const updatedComments = [...(agenda.comments || []), newComment];
  agenda.comments = updatedComments;
  input.value = '';

  // 페르소나 댓글인 경우 다음 입력을 위해 자동으로 다음 랜덤 인물 추천
  if (isPersonaComment) {
    rerollPersona(agendaId);
  }

  renderAgendas();
  showToast(`${commentAuthor}님의 의견이 등록되었습니다.`, 'success');

  // 스크롤 및 포커스 액션
  setTimeout(() => {
    const commentListEl = document.getElementById(`comment-list-${agendaId}`);
    if (commentListEl) {
      commentListEl.scrollTo({ top: commentListEl.scrollHeight, behavior: 'smooth' });
    }
    const newCommentEl = document.getElementById(`comment-item-${commentId}`);
    if (newCommentEl) {
      newCommentEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 40);

  // 2.5초 후 하이라이트 부드럽게 해제
  setTimeout(() => {
    if (latestAddedCommentId === commentId) {
      latestAddedCommentId = null;
      const el = document.getElementById(`comment-item-${commentId}`);
      if (el) {
        el.classList.remove('ring-2', 'ring-blue-500', 'bg-blue-50/90', 'shadow-md', 'shadow-blue-500/10');
        el.classList.add('bg-slate-50', 'border-slate-100');
        const badge = el.querySelector('.animate-pulse');
        if (badge) badge.remove();
      }
    }
  }, 2500);

  if (db && authUser) {
    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'agendas', agendaId);
      await updateDoc(docRef, { comments: updatedComments });

      logActivity({
        category: 'COMMENT',
        action: 'COMMENT_CREATE',
        target: { type: 'agenda', id: agendaId, title: agenda.title },
        details: {
          summary: `"${agenda.title}" 안건에 새 의견 피드백을 등록함: "${text.length > 40 ? text.slice(0, 40) + '...' : text}"`,
          after: text
        }
      });
    } catch (dbErr) {
      console.error('Comment DB update failed:', dbErr);
    }
  }

  try {
    requestAiSummary(agendaId, false);
  } catch (aiErr) {
    console.warn('Background AI summary error (ignored):', aiErr);
  }
}

export function handleCommentSubmit(e, agendaId) {
  if (e && e.preventDefault) e.preventDefault();
  submitComment(agendaId);
}

let currentEditCommentContext = null; // { agendaId, commentId }

export function startEditComment(agendaId, commentId) {
  const agenda = agendas.find(a => a.id === agendaId);
  if (!agenda) return;

  if (agenda.status === 'closed') {
    showToast('의결이 완료된 안건의 의견은 수정할 수 없습니다.', 'warning');
    return;
  }

  const comments = agenda.comments || [];
  const comment = comments.find(c => c.id === commentId);
  if (!comment) return;

  const isPersonaComment = Boolean(
    comment.isPersona === true ||
    (comment.uid && (comment.uid.startsWith('persona-') || comment.uid.startsWith('test-'))) ||
    !comment.uid ||
    (comment.id && comment.id.startsWith('c-d')) ||
    ['c-1', 'c-2', 'c-3'].includes(comment.id)
  );

  const isMyComment = !isPersonaComment && ((currentUser.uid && comment.uid === currentUser.uid) || (currentUser.name && comment.author === currentUser.name));

  // 본인 댓글이 아니면서 관리자의 페르소나 댓글 수정도 아닌 경우 차단
  if (!isMyComment && !(currentUser.isAdmin && isPersonaComment)) {
    showToast('본인의 의견 또는 테스트 페르소나 의견만 수정할 수 있습니다.', 'warning');
    return;
  }

  currentEditCommentContext = { agendaId, commentId };

  const modal = document.getElementById('modal-comment-edit');
  const titleEl = document.getElementById('edit-comment-agenda-title');
  const authorEl = document.getElementById('edit-comment-author-info');
  const textarea = document.getElementById('edit-comment-modal-textarea');
  const charCountEl = document.getElementById('edit-comment-char-count');

  if (titleEl) titleEl.textContent = agenda.title || '안건';
  if (authorEl) {
    authorEl.textContent = `${comment.author || '부원'} (${comment.role || '부원'}) · ${comment.time || ''} ${isPersonaComment ? '[테스트 페르소나]' : ''}`;
  }
  if (textarea) {
    textarea.value = comment.text || '';
    if (charCountEl) charCountEl.textContent = `${textarea.value.length}자`;
    textarea.oninput = () => {
      if (charCountEl) charCountEl.textContent = `${textarea.value.length}자`;
    };
    textarea.onkeydown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        saveEditedCommentFromModal();
      }
    };
  }

  if (modal) {
    modal.classList.remove('hidden');
    setTimeout(() => {
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      }
    }, 50);
  }
}

export function closeEditCommentModal() {
  const modal = document.getElementById('modal-comment-edit');
  if (modal) modal.classList.add('hidden');
  currentEditCommentContext = null;
}

export async function saveEditedCommentFromModal() {
  if (!currentEditCommentContext) return;
  const { agendaId, commentId } = currentEditCommentContext;

  const textarea = document.getElementById('edit-comment-modal-textarea');
  if (!textarea) return;
  const newText = textarea.value.trim();
  if (!newText) {
    showToast('의견 내용을 입력해 주세요.', 'warning');
    return;
  }

  const agenda = agendas.find(a => a.id === agendaId);
  if (!agenda) return;

  expandedAgendaIds.add(agendaId);

  const updatedComments = (agenda.comments || []).map(c => {
    if (c.id === commentId) {
      return { ...c, text: newText };
    }
    return c;
  });

  const saveBtn = document.getElementById('btn-save-comment-edit');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.classList.add('opacity-50');
  }

  try {
    const oldComment = (agenda.comments || []).find(c => c.id === commentId);

    if (db && authUser) {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'agendas', agendaId);
      await updateDoc(docRef, { comments: updatedComments });
    } else {
      agenda.comments = updatedComments;
    }

    logActivity({
      category: 'COMMENT',
      action: 'COMMENT_EDIT',
      target: { type: 'agenda', id: agendaId, title: agenda.title },
      details: {
        summary: `"${agenda.title}" 안건의 본인 의견 피드백을 수정함`,
        before: oldComment?.text || '',
        after: newText
      }
    });

    closeEditCommentModal();
    renderAgendas();
    showToast('의견이 성공적으로 수정되었습니다.', 'success');

    try {
      requestAiSummary(agendaId, false);
    } catch(e) {}
  } catch (e) {
    console.error('Edit comment failed:', e);
    showToast('의견 수정 중 오류가 발생했습니다.', 'warning');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.classList.remove('opacity-50');
    }
  }
}

export function saveEditedComment(agendaId, commentId) {
  if (agendaId && commentId) {
    currentEditCommentContext = { agendaId, commentId };
  }
  saveEditedCommentFromModal();
}

/**
 * 의견 완전 삭제 (본인 댓글 또는 관리자의 테스트 페르소나 댓글)
 */
export function deleteComment(agendaId, commentId) {
  const agenda = agendas.find(a => a.id === agendaId);
  if (!agenda) return;

  if (agenda.status === 'closed') {
    showToast('의결이 완료된 안건의 의견은 삭제할 수 없습니다.', 'warning');
    return;
  }

  const comment = (agenda.comments || []).find(c => c.id === commentId);

  const isPersonaComment = comment && Boolean(
    comment.isPersona === true ||
    (comment.uid && (comment.uid.startsWith('persona-') || comment.uid.startsWith('test-'))) ||
    !comment.uid ||
    (comment.id && comment.id.startsWith('c-d')) ||
    ['c-1', 'c-2', 'c-3'].includes(comment.id)
  );

  const isMyComment = !isPersonaComment && comment && ((currentUser.uid && comment.uid === currentUser.uid) || (currentUser.name && comment.author === currentUser.name));

  if (!isMyComment && !(currentUser.isAdmin && isPersonaComment)) {
    showToast('본인의 의견 또는 테스트 페르소나 의견만 삭제할 수 있습니다.', 'warning');
    return;
  }

  const confirmMsg = isPersonaComment
    ? `[테스트 페르소나] ${comment ? comment.author : ''}님의 의견을 완전히 삭제하시겠습니까?`
    : '이 의견을 정말 삭제하시겠습니까?';

  showCustomConfirm(confirmMsg, async () => {
    expandedAgendaIds.add(agendaId);
    const updatedComments = (agenda.comments || []).filter(c => c.id !== commentId);

    if (db && authUser) {
      try {
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'agendas', agendaId);
        await updateDoc(docRef, { comments: updatedComments });
        showToast('의견이 삭제되었습니다.', 'info');

        logActivity({
          category: 'COMMENT',
          action: 'COMMENT_DELETE',
          target: { type: 'agenda', id: agendaId, title: agenda.title },
          details: {
            summary: `"${agenda.title}" 안건에 작성된 [${comment?.author || ''}] 부원의 의견을 삭제함`,
            before: comment?.text || ''
          }
        });
      } catch (e) {
        console.error('Delete comment failed:', e);
        showToast('의견 삭제 중 오류가 발생했습니다.', 'warning');
      }
    } else {
      agenda.comments = updatedComments;
      renderAgendas();
      showToast('의견이 삭제되었습니다.', 'info');
    }

    try {
      requestAiSummary(agendaId, false);
    } catch(e) {}
  });
}

/**
 * 실제 OAuth 부원 댓글 숨김(블라인드) 및 숨김 해제 토글 (관리자 전용)
 */
export async function toggleHideComment(agendaId, commentId) {
  if (!currentUser.isAdmin) {
    showToast('관리자만 의견 숨김/해제를 실행할 수 있습니다.', 'warning');
    return;
  }

  const agenda = agendas.find(a => a.id === agendaId);
  if (!agenda) return;
  const comment = (agenda.comments || []).find(c => c.id === commentId);
  if (!comment) return;

  const willHide = !comment.isHidden;
  const actionName = willHide ? '숨김(블라인드)' : '숨김 해제';

  const confirmMsg = willHide
    ? `[${comment.author}] 부원의 공식 의견을 숨김(블라인드) 처리하시겠습니까?\n\n회원 데이터 무결성을 위해 데이터는 영구 삭제되지 않으며 일반 부원 화면에서는 숨김 문구로 대체됩니다.`
    : `[${comment.author}] 부원의 의견 숨김을 해제하여 다시 정상 공개하시겠습니까?`;

  showCustomConfirm(confirmMsg, async () => {
    expandedAgendaIds.add(agendaId);
    const updatedComments = (agenda.comments || []).map(c => {
      if (c.id === commentId) {
        return {
          ...c,
          isHidden: willHide,
          hiddenBy: willHide ? (currentUser.name || '관리자') : null,
          hiddenAt: willHide ? new Date().toISOString() : null
        };
      }
      return c;
    });

    if (db && authUser) {
      try {
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'agendas', agendaId);
        await updateDoc(docRef, { comments: updatedComments });
        showToast(`의견이 ${actionName} 처리되었습니다.`, 'info');

        logActivity({
          category: 'COMMENT',
          action: willHide ? 'COMMENT_BLIND' : 'COMMENT_UNBLIND',
          target: { type: 'agenda', id: agendaId, title: agenda.title },
          details: {
            summary: `"${agenda.title}" 안건의 [${comment.author}] 부원 의견을 관리자 권한으로 ${actionName} 처리함`,
            before: comment.isHidden,
            after: willHide
          }
        });
      } catch (e) {
        console.error('Toggle hide comment failed:', e);
        showToast('처리 중 오류가 발생했습니다.', 'warning');
      }
    } else {
      agenda.comments = updatedComments;
      renderAgendas();
      showToast(`의견이 ${actionName} 처리되었습니다.`, 'info');
    }

    try {
      requestAiSummary(agendaId, false);
    } catch(e) {}
  });
}

export function openNewAgendaModal() {
  if (!checkAuthOrPrompt()) return;
  const modal = document.getElementById('modal-new-agenda');
  const container = document.getElementById('options-container');

  if (container) {
    container.innerHTML = `
      <input type="text" class="agenda-opt-input w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs" placeholder="선택지 1 (예: 찬성 / 원안 통과)" required>
      <input type="text" class="agenda-opt-input w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs" placeholder="선택지 2 (예: 반대 / 조건부 수정)" required>
    `;
  }

  const voteCheckbox = document.getElementById('agenda-enable-vote');
  if (voteCheckbox) {
    voteCheckbox.checked = true;
  }
  toggleVoteOptionsInput(true);

  if (modal) modal.classList.remove('hidden');
}

export function closeNewAgendaModal() {
  const modal = document.getElementById('modal-new-agenda');
  if (modal) modal.classList.add('hidden');
}

export function addOptionInput() {
  const container = document.getElementById('options-container');
  const inputs = container.querySelectorAll('.agenda-opt-input');
  if (inputs.length >= 10) {
    showToast('선택지는 최대 10개까지만 추가할 수 있습니다.', 'info');
    return;
  }
  const newInput = document.createElement('input');
  newInput.type = 'text';
  newInput.className = 'agenda-opt-input w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs';
  newInput.placeholder = `선택지 ${inputs.length + 1}`;
  newInput.required = true;
  container.appendChild(newInput);
}

export async function handleCreateAgenda(e) {
  e.preventDefault();
  if (!checkAuthOrPrompt()) return;

  const category = document.getElementById('agenda-category').value;
  const title = document.getElementById('agenda-title').value.trim();
  const desc = document.getElementById('agenda-desc').value.trim();
  const targetDept = document.getElementById('agenda-target-dept').value;

  const enableVote = document.getElementById('agenda-enable-vote')?.checked ?? true;
  let options = [];

  if (enableVote) {
    const optionInputs = document.querySelectorAll('.agenda-opt-input');
    options = Array.from(optionInputs)
      .map((input, idx) => ({
        id: 'opt-' + Date.now() + '-' + idx,
        text: input.value.trim(),
        votes: []
      }))
      .filter(opt => opt.text.length > 0);

    if (options.length < 2) {
      showToast('투표를 진행하려면 선택지를 최소 2개 이상 입력해 주세요. (투표가 필요 없다면 [투표 진행하기] 체크를 해제하세요)', 'warning');
      return;
    }
  }

  const newAgenda = {
    id: 'ag-' + Date.now(),
    category,
    title,
    desc,
    author: currentUser.name,
    authorRole: `${currentUser.grade} ${currentUser.role}`,
    authorUid: currentUser.uid || authUser?.uid || '',
    createdAtMs: Date.now(),
    createdAt: '방금 전',
    targetDept: targetDept || '전체 부서 (공통)',
    status: 'active',
    options,
    aiSummary: options.length > 0 
      ? "• [부원 피드백 대기중]: 안건이 게시되었습니다. 하단에 부원들의 의견 피드백이 등록되면 [AI 요약 갱신]을 눌러 핵심 내용을 요약할 수 있습니다."
      : "• [의견 수렴 안건]: 부원 의견 수렴 전용 안건입니다. 하단 댓글창에 의견이 모이면 [AI 요약 갱신]을 눌러 취합 결과를 요약할 수 있습니다.",
    isGeneratingSummary: false,
    comments: []
  };

  if (db && authUser) {
    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'agendas', newAgenda.id);
      await setDoc(docRef, newAgenda);
      showToast('새 안건이 전체 부원 브리핑룸에 실시간 등록되었습니다.', 'success');

      logActivity({
        category: 'AGENDA',
        action: 'AGENDA_CREATE',
        target: { type: 'agenda', id: newAgenda.id, title: newAgenda.title },
        details: {
          summary: `새 안건 "${newAgenda.title}"을(를) 발의 및 등록함 (선택지 ${options.length}개)`,
          after: newAgenda.title
        }
      });
    } catch (err) {
      console.error('Failed to save agenda to cloud:', err);
      showToast('안건 등록 실패: 통신 상태를 확인하세요.', 'warning');
    }
  } else {
    agendas.unshift(newAgenda);
    renderAgendas();
  }

  document.getElementById('agenda-title').value = '';
  document.getElementById('agenda-desc').value = '';
  closeNewAgendaModal();

  setTimeout(() => {
    openKakaoShareModal(newAgenda);
  }, 300);
}

export function filterAgendas(type) {
  setCurrentFilter(type);
  ['all', 'active', 'closed'].forEach(t => {
    const tab = document.getElementById(`tab-${t}`);
    if (tab) {
      if (t === type) {
        tab.className = 'filter-tab active px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white transition';
      } else {
        tab.className = 'filter-tab px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-slate-600 hover:bg-slate-100 border border-slate-200 transition';
      }
    }
  });
  renderAgendas();
}

export function startAgendasListener() {
  if (!db || !authUser) return;
  if (agendasUnsubscribe) agendasUnsubscribe();

  const agendasCol = collection(db, 'artifacts', appId, 'public', 'data', 'agendas');
  const unsub = onSnapshot(agendasCol, (snapshot) => {
    const list = [];
    snapshot.forEach(docSnap => {
      const item = docSnap.data();
      item.id = docSnap.id;
      list.push(item);
    });

    list.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
    setAgendas(list);
    renderAgendas();
  }, (err) => {
    console.warn('Agendas snapshot error:', err);
  });
  setAgendasUnsubscribe(unsub);
}

export async function seedInitialAgendasToCloud() {
  const initialDemos = getDemoAgendas();
  if (db && authUser) {
    for (const ag of initialDemos) {
      try {
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'agendas', ag.id);
        await setDoc(docRef, ag);
      } catch (e) {
        console.warn('Error seeding agenda:', e);
      }
    }
  } else {
    setAgendas(initialDemos);
    renderAgendas();
  }
}

export function promptSeedDemoData() {
  if (!checkAuthOrPrompt()) return;
  if (!currentUser.isAdmin) {
    showToast('관리자만 기본 예시 안건을 초기화/등록할 수 있습니다.', 'warning');
    return;
  }
  if (!isAdminDebugMode) {
    showToast('관리자 디버그 모드가 켜져 있을 때만 실행할 수 있습니다.', 'warning');
    return;
  }

  showCustomConfirm(
    '현재 회의실에 기본 예시 안건 2개를 실시간 업로드하시겠습니까?\n\n⚠️ [주의: 기존 데이터 덮어쓰기 및 초기화]\n기본 예시 안건을 새로 등록하면 기존 예시 안건(1학기 독산 버스킹, 우산 대여제)의 투표 내역과 등록된 모든 부원 의견 댓글이 초기 예시 상태로 완전히 초기화(덮어쓰기)됩니다.\n\n정말 기존 내용을 초기화하고 예시 안건을 다시 올리시겠습니까?',
    async () => {
      await seedInitialAgendasToCloud();
      showToast('예시 안건이 초기화되어 다시 등록되었습니다.', 'success');
    }
  );
}

/**
 * 부서별 1·2학년 후보 댓글 중 각 부서당 1개씩 무작위 추첨하여 반환
 */
function pickRandomDeptComments(departmentPairs) {
  return departmentPairs.map((pair, idx) => {
    const chosen = Math.random() < 0.5 ? pair[0] : pair[1];
    return {
      id: chosen.id || `c-rnd-${idx}-${Date.now()}`,
      author: chosen.author,
      role: chosen.role,
      text: chosen.text,
      time: chosen.time
    };
  });
}

export function getDemoAgendas() {
  // 1번 안건: 5개 부서별 1·2학년 후보 댓글 (각 부서당 1개씩 랜덤 선정)
  const agenda1DeptPairs = [
    // 1. 행사기획부
    [
      { id: 'c-d1-event-1', author: '박기획', role: '1학년 행사기획부', text: '버스킹 할 때 장비 대여 비용이나 세팅 시간도 미리 체크해두면 당일에 훨씬 수월할 것 같아요!', time: '15:20' },
      { id: 'c-d1-event-2', author: '최기획', role: '2학년 행사기획부', text: '뒷정리 전담 인원 2명 지정하는 건 적극 찬성입니다. 작년에도 마감 때 혼자 치우려면 벅찼거든요.', time: '15:22' }
    ],
    // 2. 운영지원부
    [
      { id: 'c-d1-support-1', author: '김지원', role: '1학년 운영지원부', text: '예산 25만 원 집행할 때 영수증 처리나 물품 구매 내역을 깔끔하게 정리해두겠습니다.', time: '15:45' },
      { id: 'c-d1-support-2', author: '이지원', role: '2학년 운영지원부', text: '포토존이랑 타코야키 부스 동선이 겹쳐서 학생들이 너무 몰리지 않게 안내선만 잘 설치하면 문제없어 보여요.', time: '15:48' }
    ],
    // 3. 편집소통부
    [
      { id: 'c-d1-comm-1', author: '정소통', role: '1학년 편집소통부', text: '학생들에게 공지 나갈 때 카드뉴스로 타코야키 메뉴랑 인생네컷 프레임 미리 살짝 공개하면 반응 훨씬 좋을 것 같아요!', time: '16:10' },
      { id: 'c-d1-comm-2', author: '강소통', role: '2학년 편집소통부', text: '점심시간 20분이 생각보다 짧아서 홍보를 미리 해두지 않으면 줄 서다가 끝날 수도 있으니 사전 안내를 철저히 해야 합니다.', time: '16:15' }
    ],
    // 4. 미디어홍보부
    [
      { id: 'c-d1-media-1', author: '조홍보', role: '1학년 미디어홍보부', text: '당일에 버스킹 공연이랑 부스 운영하는 모습 숏폼 영상으로 찍어서 학교 공식 계정에 바로 올리면 좋겠습니다.', time: '16:30' },
      { id: 'c-d1-media-2', author: '윤홍보', role: '2학년 미디어홍보부', text: '인생네컷 포토존 프레임 디자인 시안을 이번 주 내로 빠르게 뽑아서 피드백 받으면 일정 맞추기 넉넉할 듯합니다.', time: '16:35' }
    ],
    // 5. 자치선도부
    [
      { id: 'c-d1-lead-1', author: '임선도', role: '1학년 자치선도부', text: '점심시간에 학생들이 급식실로 가는 동선이랑 부스 줄 서는 동선이 엉키지 않게 안전 도우미 역할 잘 수행하겠습니다.', time: '17:05' },
      { id: 'c-d1-lead-2', author: '한선도', role: '2학년 자치선도부', text: '음향 소음 때문에 인근 교실 수업에 방해되지 않도록 스피커 방향을 운동장 쪽으로 향하게 배치하는 게 안전해요.', time: '17:10' }
    ]
  ];

  // 2번 안건: 5개 부서별 1·2학년 후보 댓글 (각 부서당 1개씩 랜덤 선정)
  const agenda2DeptPairs = [
    // 1. 운영지원부
    [
      { id: 'c-d2-support-1', author: '박지원', role: '1학년 운영지원부', text: '현금 1,000원 보증금은 잔돈 거슬러주기 번거로우니 학생증이나 명찰을 맡겨두는 방식이 관리하기 훨씬 편할 것 같아요.', time: '18:25' },
      { id: 'c-d2-support-2', author: '최지원', role: '2학년 운영지원부', text: '현재 남은 우산 12개 상태도 점검해서 살이 망가진 건 이번 분기 비품비로 10개 정도 보충 구매하는 방안도 추천합니다.', time: '18:28' }
    ],
    // 2. 행사기획부
    [
      { id: 'c-d2-event-1', author: '김기획', role: '1학년 행사기획부', text: '우산 손잡이에 학생회 번호 라벨을 큼직하게 붙여두면 대여 장부 쓸 때 번호만 적으면 돼서 훨씬 빠를 것 같아요!', time: '18:40' },
      { id: 'c-d2-event-2', author: '이기획', role: '2학년 행사기획부', text: '축제나 비 오는 날 교내 행사 때도 우산 대여 수요가 많으니, 이번 기회에 분실 방지 규칙을 확실히 잡아두면 좋겠습니다.', time: '18:45' }
    ],
    // 3. 편집소통부
    [
      { id: 'c-d2-comm-1', author: '정소통', role: '1학년 편집소통부', text: '인스타 카드뉴스로 \'우산 대여·반납 3대 규칙\'을 귀엽게 카드뉴스로 만들어 올리면 부원과 학생들 반응이 아주 좋을 듯해요!', time: '19:05' },
      { id: 'c-d2-comm-2', author: '강소통', role: '2학년 편집소통부', text: '미반납 방지를 위해 \'익일 1교시 전까지 반납\' 규칙을 두고, 연체 시 일주일간 대여 제한 페널티를 사전에 명확히 알려야 합니다.', time: '19:10' }
    ],
    // 4. 미디어홍보부
    [
      { id: 'c-d2-media-1', author: '조홍보', role: '1학년 미디어홍보부', text: '우산 대여함 앞에 눈에 띄는 반납 안내 포스터랑 모바일 체크용 QR 장부를 부착해 두면 반납률이 확실히 올라갈 것 같아요.', time: '19:30' },
      { id: 'c-d2-media-2', author: '윤홍보', role: '2학년 미디어홍보부', text: '비 오는 날 아침 등교 시간과 점심시간 교내 방송으로 우산 자율 반납 독려 멘트를 띄우는 것도 홍보에 효과적입니다.', time: '19:35' }
    ],
    // 5. 자치선도부
    [
      { id: 'c-d2-lead-1', author: '임선도', role: '1학년 자치선도부', text: '비 오는 날 아침 등교 시간에 우산 대여가 한꺼번에 몰릴 수 있으니, 중앙 현관에서 선도부가 질서 유지를 돕겠습니다.', time: '20:10' },
      { id: 'c-d2-lead-2', author: '한선도', role: '2학년 자치선도부', text: '학생증을 임시 보관할 전용 보관함에 잠금장치를 두고 당번 부원이 책임지고 인계하는 분실 방지 절차가 꼭 필요합니다.', time: '20:15' }
    ]
  ];

  const pickedAgenda1 = pickRandomDeptComments(agenda1DeptPairs);
  const pickedAgenda2 = pickRandomDeptComments(agenda2DeptPairs);

  return [
    {
      id: 'ag-demo-1',
      category: '축제/행사',
      title: '1학기 독산 버스킹 & 축제 부스 운영안 최종 의결',
      desc: '점심시간 20분을 활용한 교내 버스킹 공연 허용 여부 및 학생회 부스(타코야끼/인생네컷 포토존) 기획안입니다. 예산은 약 25만 원 소요 예정입니다.',
      author: '김회장',
      authorRole: '전교회장',
      createdAt: '어제',
      createdAtMs: Date.now() - 3600000,
      targetDept: '행사기획부',
      status: 'active',
      options: [
        { id: 'opt-d1-1', text: '찬성 (버스킹 + 포토존 부스 추진)', votes: ['김선배', '박부장', '이후배'] },
        { id: 'opt-d1-2', text: '수정안 (음향/안전 문제로 포토존만 진행)', votes: ['정총무'] },
        { id: 'opt-d1-3', text: '재검토 (다음 분기로 연기)', votes: [] }
      ],
      aiSummary: '[김선배] 작년 포토존 반응 고려해 버스킹과 병행 추진 제안\n[이후배] 점심시간 종료 후 5분 내 뒷정리 전담 부원 2명 지정 건의',
      aiSummaryUpdatedAt: Date.now() - 1800000,
      aiSummaryUpdatedTime: '15:10',
      isGeneratingSummary: false,
      comments: [
        { id: 'c-1', author: '김선배', role: '2학년 행사기획부', text: '작년에도 포토존 반응이 제일 좋았어서 버스킹이랑 묶는 게 확실히 홍보에 유리합니다.', time: '14:20' },
        { id: 'c-2', author: '이후배', role: '1학년 행사기획부', text: '점심시간 끝종 치고 5분 내로 뒷정리할 부원 2명만 미리 정해두면 선생님들도 문제없다고 하실 것 같아요!', time: '15:05' },
        ...pickedAgenda1
      ]
    },
    {
      id: 'ag-demo-2',
      category: '학생복지/시설',
      title: '비 오는 날 우산 대여 보증금 제도 신설 건',
      desc: '학생회 보관 우산 30개 중 18개가 미반납 분실된 상태입니다. 보증금 1,000원 또는 학생증 임시 보관제 도입을 제안합니다.',
      author: '박부장',
      authorRole: '2학년 운영지원부',
      createdAt: '2일 전',
      createdAtMs: Date.now() - 7200000,
      targetDept: '운영지원부',
      status: 'active',
      options: [
        { id: 'opt-d2-1', text: '학생증 또는 명찰 임시 보관제', votes: ['김회장', '김선배'] },
        { id: 'opt-d2-2', text: '카카오페이 보증금 1,000원제 (반납 시 환급)', votes: ['박부장'] },
        { id: 'opt-d2-3', text: '현행 유지 (자율 반납 강조 캠페인)', votes: [] }
      ],
      aiSummary: '[박부장] 분실 책임 방지를 위해 학생증 보관 방식이 안전하다고 제안',
      aiSummaryUpdatedAt: Date.now() - 3600000,
      aiSummaryUpdatedTime: '18:15',
      isGeneratingSummary: false,
      comments: [
        { id: 'c-3', author: '박부장', role: '2학년 운영지원부', text: '돈을 직접 받으면 분실 책임이 복잡해지니 학생증 맡기는 방식이 가장 안전할 듯합니다.', time: '18:10' },
        ...pickedAgenda2
      ]
    }
  ];
}

/**
 * 표준 신규 안건 2개 추가 등록 (누적 추가 - 기존 안건 보존)
 */
export async function addNewDemoAgendas() {
  if (!currentUser.isAdmin && !currentUser.canApprove) {
    showToast('관리자만 신규 표준 안건을 추가할 수 있습니다.', 'warning');
    return;
  }

  const now = Date.now();
  const newAgenda1 = {
    id: 'ag-demo-std-' + now + '-1',
    category: '학생복지/시설',
    title: '시험 기간 24시 자율학습실 연장 개방 및 야간 간식 배부 기획안',
    desc: '중간·기말고사 2주 전부터 특별실 자율학습실을 기존 21시에서 23시까지 연장 운영하고, 21:30에 학생회 주관으로 간단한 음료 및 간식 세트를 배부하는 방안입니다. 예산은 복지비에서 20만 원 소요 예정입니다.',
    author: '이복지',
    authorRole: '2학년 운영지원부',
    authorUid: 'seed-admin-std-1',
    createdAt: '방금 전',
    createdAtMs: now,
    targetDept: '운영지원부',
    status: 'active',
    options: [
      { id: 'opt-std1-1', text: '1안: 23시까지 연장 개방 + 간식 배부 (적극 추진)', votes: ['김지원', '박기획', '최지원'] },
      { id: 'opt-std1-2', text: '2안: 22시까지 개방만 진행 (간식 제외)', votes: ['정소통'] },
      { id: 'opt-std1-3', text: '3안: 안전 및 귀가 문제로 현행(21시) 유지', votes: [] }
    ],
    aiSummary: '[김지원] 귀가 안전을 위해 23시 퇴실 시 자치선도부 부원 동행 인솔 제안\n[정소통] 간식 메뉴 사전 설문조사를 통해 선호도 반영 건의',
    aiSummaryUpdatedAt: now,
    aiSummaryUpdatedTime: '방금',
    isGeneratingSummary: false,
    comments: [
      { id: 'c-std1-1', author: '김지원', role: '1학년 운영지원부', text: '자율학습실 좌석이 40석이라 사전 예약 명부를 온라인으로 받으면 자리 선점 싸움을 방지할 수 있습니다.', time: '14:10', isPersona: true },
      { id: 'c-std1-2', author: '최지원', role: '2학년 운영지원부', text: '간식 배부 시 쓰레기 분리수거 봉투를 출입구에 비치해 뒷정리 문제를 예방해야 합니다.', time: '14:15', isPersona: true },
      { id: 'c-std1-3', author: '박기획', role: '1학년 행사기획부', text: '학생증을 태그하고 입장하게 하면 비학생 이용이나 무단 퇴실도 체계적으로 통제할 수 있어요.', time: '14:20', isPersona: true },
      { id: 'c-std1-4', author: '최기획', role: '2학년 행사기획부', text: '연장 개방 시간 동안 소음 방지를 위해 슬리퍼 착용과 귓속말 자제 안내문을 부착하겠습니다.', time: '14:25', isPersona: true },
      { id: 'c-std1-5', author: '정소통', role: '1학년 편집소통부', text: '야간 간식 메뉴(바나나, 견과류, 초콜릿 등)를 인스타 투표로 정하면 부원 만족도가 훨씬 높을 것 같아요!', time: '14:30', isPersona: true },
      { id: 'c-std1-6', author: '강소통', role: '2학년 편집소통부', text: '귀가 시간에 부모님 안심 알림 문자가 연동될 수 있도록 학교 시스템과 협의해보는 것도 추천합니다.', time: '14:35', isPersona: true },
      { id: 'c-std1-7', author: '조홍보', role: '1학년 미디어홍보부', text: '도서관 앞 대형 모니터와 학생회 인스타에 이용 수칙 카드뉴스를 미리 배포해두겠습니다.', time: '14:40', isPersona: true },
      { id: 'c-std1-8', author: '윤홍보', role: '2학년 미디어홍보부', text: '자습실 내부 집중 분위기를 담은 숏폼 영상으로 홍보하면 많은 학생들이 규칙을 잘 지켜줄 것 같습니다.', time: '14:45', isPersona: true },
      { id: 'c-std1-9', author: '임선도', role: '1학년 자치선도부', text: '밤 23시 퇴실 시 정문과 버스 정류장까지 선도부원 2명이 안전 귀가 도우미로 상주하겠습니다.', time: '14:50', isPersona: true },
      { id: 'c-std1-10', author: '한선도', role: '2학년 자치선도부', text: '최종 퇴실 후 에어컨 및 조명 소등, 창문 잠금 상태를 철저히 점검하고 일지를 작성하겠습니다.', time: '14:55', isPersona: true }
    ]
  };

  const newAgenda2 = {
    id: 'ag-demo-std-' + (now + 1) + '-2',
    category: '자치선도/생활',
    title: '학생회 공식 인스타그램 릴스(숏폼) 및 익명 소통함 운영 규정안',
    desc: '학생회 주요 공지사항 및 교내 행사 하이라이트를 숏폼 릴스로 제작하여 소통을 강화하고, 온라인 익명 소통함을 통해 접수된 건의사항을 월 1회 정기 브리핑하는 운영 규정안입니다.',
    author: '윤소통',
    authorRole: '2학년 미디어홍보부',
    authorUid: 'seed-admin-std-2',
    createdAt: '방금 전',
    createdAtMs: now + 1,
    targetDept: '미디어홍보부',
    status: 'active',
    options: [
      { id: 'opt-std2-1', text: '원안 통과 (릴스 제작 + 월 1회 익명 소통 피드백)', votes: ['조홍보', '윤홍보', '강소통'] },
      { id: 'opt-std2-2', text: '수정안 (초상권 보호 위해 릴스만 진행)', votes: ['한선도'] },
      { id: 'opt-std2-3', text: '재검토 (교사 자문 후 재상정)', votes: [] }
    ],
    aiSummary: '[윤홍보] 학생 얼굴 노출 시 사전 동의서 서명 필수화 규칙 추가 제안\n[한선도] 익명 소통함 악성 비방 필터링 전담 위원회 구성 건의',
    aiSummaryUpdatedAt: now + 1,
    aiSummaryUpdatedTime: '방금',
    isGeneratingSummary: false,
    comments: [
      { id: 'c-std2-1', author: '조홍보', role: '1학년 미디어홍보부', text: '행사 숏폼 편집 템플릿을 미리 만들어두면 당일 저녁 7시 전으로 빠른 업로드가 가능합니다.', time: '15:10', isPersona: true },
      { id: 'c-std2-2', author: '윤홍보', role: '2학년 미디어홍보부', text: '영상에 등장하는 학생들에게 인스타 DM이나 구글폼으로 초상권 활용 동의를 반드시 받도록 하겠습니다.', time: '15:15', isPersona: true },
      { id: 'c-std2-3', author: '정소통', role: '1학년 편집소통부', text: '익명 소통함에 들어온 질문 중 공통 건의사항은 5개씩 묶어 Q&A 카드뉴스로 발행하면 소통 효과가 큽니다.', time: '15:20', isPersona: true },
      { id: 'c-std2-4', author: '강소통', role: '2학년 편집소통부', text: '특정 학생이나 교사에 대한 근거 없는 비방글은 즉시 비공개 및 필터링하는 원칙을 명시해야 합니다.', time: '15:25', isPersona: true },
      { id: 'c-std2-5', author: '박기획', role: '1학년 행사기획부', text: '축제 부스 준비 브이로그나 비하인드 릴스를 올리면 전교생의 축제 참여율이 훨씬 높아질 것 같아요.', time: '15:30', isPersona: true },
      { id: 'c-std2-6', author: '최기획', role: '2학년 행사기획부', text: '릴스 챌린지 이벤트를 열어 참여 학생들에게 매점 이용권을 소정 증정하는 연계 기획도 좋습니다.', time: '15:35', isPersona: true },
      { id: 'c-std2-7', author: '김지원', role: '1학년 운영지원부', text: '숏폼 제작용 삼각대와 핀마이크 구매비 3만 원 정도를 홍보비 예산으로 배정해두겠습니다.', time: '15:40', isPersona: true },
      { id: 'c-std2-8', author: '이지원', role: '2학년 운영지원부', text: '소통함 운영 내역과 답변 결과를 매달 학생회 회의록 부록으로 남겨 투명성을 보장하겠습니다.', time: '15:45', isPersona: true },
      { id: 'c-std2-9', author: '임선도', role: '1학년 자치선도부', text: '사이버 언어폭력 예방 캠페인 숏폼을 선도부와 미디어홍보부가 공동 제작하는 방향도 제안합니다.', time: '15:50', isPersona: true },
      { id: 'c-std2-10', author: '한선도', role: '2학년 자치선도부', text: '소통함 답변은 임의로 달지 않고 반드시 학생회 정기 회의 의결을 거친 공식 입장만 게시해야 합니다.', time: '15:55', isPersona: true }
    ]
  };

  showCustomConfirm(
    '기존 안건 및 데이터를 삭제하지 않고, 새로운 표준 안건 2건(자율학습실 연장 개방, SNS 릴스 운영안 각 10개 실전 댓글 포함)을 추가 등록하시겠습니까?',
    async () => {
      try {
        if (db && authUser) {
          await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'agendas', newAgenda1.id), newAgenda1);
          await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'agendas', newAgenda2.id), newAgenda2);
        } else {
          agendas.unshift(newAgenda2);
          agendas.unshift(newAgenda1);
          renderAgendas();
        }
        showToast('신규 표준 안건 2건이 기존 안건에 안전하게 추가되었습니다.', 'success');
      } catch (err) {
        console.error('Failed to add new demo agendas:', err);
        showToast('안건 추가 중 오류 발생: ' + err.message, 'warning');
      }
    }
  );
}

/**
 * 전체 안건 및 댓글 풀 백업 (JSON 파일 다운로드)
 */
export function exportFullBackupJson() {
  if (!currentUser.isAdmin && !currentUser.canApprove) {
    showToast('관리자 권한이 필요합니다.', 'warning');
    return;
  }
  if (!agendas || agendas.length === 0) {
    showToast('백업할 안건 데이터가 없습니다.', 'warning');
    return;
  }

  const totalComments = agendas.reduce((sum, a) => sum + (a.comments || []).length, 0);
  const backupObj = {
    type: "doksan_briefing_backup",
    version: "1.0",
    exportedAt: new Date().toISOString(),
    exportedBy: currentUser.name || '총괄관리자',
    agendaCount: agendas.length,
    commentCount: totalComments,
    data: agendas
  };

  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `doksan_briefing_full_backup_${dateStr}.json`;
  downloadJsonFile(filename, backupObj);

  showToast(`전체 안건 ${backupObj.agendaCount}건 및 댓글 ${backupObj.commentCount}개가 JSON 백업 파일로 다운로드되었습니다.`, 'success');
}

/**
 * 단일 안건 및 댓글 선택 백업 (카드 내 3-Dots 메뉴에서 호출)
 */
export function exportSingleAgendaJson(agendaId) {
  closeAllAgendaMenus();
  if (!currentUser.isAdmin && !currentUser.canApprove) {
    showToast('관리자 권한이 필요합니다.', 'warning');
    return;
  }

  const targetAgenda = agendas.find(a => a.id === agendaId);
  if (!targetAgenda) {
    showToast('해당 안건을 찾을 수 없습니다.', 'warning');
    return;
  }

  const commentCount = (targetAgenda.comments || []).length;
  const backupObj = {
    type: "doksan_briefing_single_backup",
    version: "1.0",
    exportedAt: new Date().toISOString(),
    exportedBy: currentUser.name || '관리자',
    agendaCount: 1,
    commentCount: commentCount,
    data: [targetAgenda]
  };

  const safeTitle = (targetAgenda.title || 'agenda')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .trim()
    .slice(0, 20);
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `doksan_agenda_${safeTitle}_${dateStr}.json`;
  downloadJsonFile(filename, backupObj);

  showToast(`'${targetAgenda.title}' 안건(댓글 ${commentCount}개 포함)이 JSON으로 백업되었습니다.`, 'success');
}

/**
 * 관리자 콘솔 백업 파일 선택 이벤트 핸들러
 */
export function handleRestoreFileSelected(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const parsed = JSON.parse(event.target.result);
      let agendaList = [];

      if (Array.isArray(parsed)) {
        agendaList = parsed;
      } else if (parsed && Array.isArray(parsed.data)) {
        agendaList = parsed.data;
      } else if (parsed && parsed.id && parsed.title) {
        agendaList = [parsed];
      } else {
        throw new Error('올바른 안건 목록 데이터(data)를 찾을 수 없습니다.');
      }

      if (agendaList.length === 0) {
        showToast('백업 파일에 포함된 안건 데이터가 없습니다.', 'warning');
        return;
      }

      const totalComments = agendaList.reduce((sum, a) => sum + (a.comments || []).length, 0);

      const restoreInfo = {
        fileName: file.name,
        date: parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString('ko-KR') : new Date().toLocaleString('ko-KR'),
        agendaCount: agendaList.length,
        commentCount: totalComments,
        agendas: agendaList
      };
      setActiveRestoreData(restoreInfo);

      // Update Modal Elements
      const fileNameEl = document.getElementById('restore-info-filename');
      const agendaCountEl = document.getElementById('restore-info-agenda-count');
      const commentCountEl = document.getElementById('restore-info-comment-count');
      const dateEl = document.getElementById('restore-info-date');

      if (fileNameEl) fileNameEl.textContent = file.name;
      if (agendaCountEl) agendaCountEl.textContent = `${agendaList.length}개`;
      if (commentCountEl) commentCountEl.textContent = `${totalComments}개`;
      if (dateEl) dateEl.textContent = restoreInfo.date;

      const modal = document.getElementById('modal-restore-options');
      if (modal) modal.classList.remove('hidden');

    } catch (err) {
      console.error('Failed to parse backup JSON:', err);
      showToast('백업 파일 파싱 실패: 브리핑룸 전용 JSON 파일이 아닙니다.', 'warning');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

/**
 * 복원 모달 닫기
 */
export function closeRestoreOptionsModal() {
  const modal = document.getElementById('modal-restore-options');
  if (modal) modal.classList.add('hidden');
  setActiveRestoreData(null);
}

/**
 * 백업 복원 실행 (Append 또는 Overwrite)
 */
export async function executeRestoreBackup(mode) {
  if (!activeRestoreData || !activeRestoreData.agendas || activeRestoreData.agendas.length === 0) {
    showToast('복원할 백업 데이터가 로드되지 않았습니다.', 'warning');
    return;
  }

  const restoreAgendas = activeRestoreData.agendas;
  const count = restoreAgendas.length;

  if (mode === 'overwrite') {
    showCustomConfirm(
      `⚠️ [주의: 전체 덮어쓰기 복원]\n\n현재 회의실에 존재하는 모든 기존 안건과 댓글이 완전히 삭제되고, 백업 파일의 ${count}개 안건으로 100% 교체 복원됩니다.\n\n정말 계속 진행하시겠습니까?`,
      async () => {
        try {
          if (db && authUser) {
            // 1. Delete all current agendas from Firestore
            const batch = writeBatch(db);
            const currentAgendasSnap = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'agendas'));
            currentAgendasSnap.forEach(d => {
              batch.delete(d.ref);
            });
            await batch.commit();

            // 2. Insert backup agendas
            for (const ag of restoreAgendas) {
              const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'agendas', ag.id);
              await setDoc(docRef, ag);
            }
          } else {
            setAgendas([...restoreAgendas]);
            renderAgendas();
          }

          closeRestoreOptionsModal();
          showToast(`백업 데이터 ${count}건으로 회의실 데이터가 덮어쓰기 복원되었습니다.`, 'success');
        } catch (err) {
          console.error('Overwrite restore failed:', err);
          showToast('덮어쓰기 복원 중 오류: ' + err.message, 'warning');
        }
      }
    );
  } else if (mode === 'append') {
    try {
      const now = Date.now();
      const existingIds = new Set(agendas.map(a => a.id));
      const newlyAppended = [];

      for (let i = 0; i < restoreAgendas.length; i++) {
        const ag = { ...restoreAgendas[i] };
        // If conflict with existing ID, create a new ID
        if (existingIds.has(ag.id)) {
          ag.id = `ag-appended-${now}-${i}`;
        }
        ag.createdAtMs = ag.createdAtMs || (now - i * 1000);

        if (db && authUser) {
          const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'agendas', ag.id);
          await setDoc(docRef, ag);
        } else {
          newlyAppended.push(ag);
        }
      }

      if (!db || !authUser) {
        setAgendas([...newlyAppended, ...agendas]);
        renderAgendas();
      }

      closeRestoreOptionsModal();
      showToast(`${count}건의 안건이 기존 목록에 성공적으로 누적 추가(Append)되었습니다.`, 'success');
    } catch (err) {
      console.error('Append restore failed:', err);
      showToast('추가 복원 중 오류: ' + err.message, 'warning');
    }
  }
}







