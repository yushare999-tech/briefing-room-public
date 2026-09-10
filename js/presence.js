// =========================================================================
// 스마트 브리핑룸 (Smart Briefing Room) - Developed by YDE & DK - 실시간 동시 접속자 (Presence) 감지 모듈
// =========================================================================

import { db, appId, MASTER_ADMIN_EMAIL, CO_ADMIN_EMAIL, ADMIN_EMAILS, isMasterAdmin } from './config.js';
import { currentUser, authUser, onlineUsers, setOnlineUsers, rawPresenceCache, setRawPresenceCache, presenceUnsubscribe, setPresenceUnsubscribe } from './state.js';
import { escapeHtml } from './utils.js';
import { doc, setDoc, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

let heartbeatTimer = null;
let presenceRecheckTimer = null;

export async function syncPresenceToCloud() {
  if (!db || !authUser || !currentUser.name) return;
  if (document.visibilityState === 'hidden') return;

  try {
    const presenceDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'presence', authUser.uid);
    await setDoc(presenceDocRef, {
      uid: authUser.uid,
      name: currentUser.name,
      grade: currentUser.grade,
      role: currentUser.role,
      email: (authUser.email || currentUser.email || '').toLowerCase(),
      isAdmin: Boolean(currentUser.isAdmin),
      canApprove: Boolean(currentUser.canApprove),
      lastSeen: Date.now(),
      isOnline: true
    }, { merge: true });
  } catch (e) {
    console.warn('Presence sync failed:', e);
  }
}

export async function markOfflineImmediately() {
  if (!db || !authUser || !currentUser.name) return;
  try {
    const presenceDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'presence', authUser.uid);
    await setDoc(presenceDocRef, {
      uid: authUser.uid,
      name: currentUser.name,
      isOnline: false,
      lastSeen: 0
    }, { merge: true });
  } catch (e) {
    console.warn('Offline signal failed:', e);
  }
}

export function setupPresenceLifecycleEvents() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      markOfflineImmediately();
    } else if (document.visibilityState === 'visible') {
      syncPresenceToCloud();
    }
  });

  window.addEventListener('pagehide', () => markOfflineImmediately());
  window.addEventListener('beforeunload', () => markOfflineImmediately());
  window.addEventListener('focus', () => syncPresenceToCloud());
  window.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.visibilityState === 'hidden') {
        markOfflineImmediately();
      }
    }, 100);
  });
}

export function startPresenceHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      syncPresenceToCloud();
    }
  }, 5000);

  if (presenceRecheckTimer) clearInterval(presenceRecheckTimer);
  presenceRecheckTimer = setInterval(() => {
    filterAndRenderActivePresence();
  }, 2000);
}

export function filterAndRenderActivePresence() {
  const now = Date.now();
  const activeList = [];
  const isMasterViewer = isMasterAdmin(authUser || currentUser);

  for (const data of rawPresenceCache) {
    if (!data) continue;
    const timeDiff = now - (data.lastSeen || 0);
    // 45초 이내 활동 및 최근 ping 확인 (기기간 시계 오차 허용)
    const isRecentlyActive = (data.lastSeen > 0) && (timeDiff > -60000) && (timeDiff < 45000);
    const isOnline = (data.isOnline === true || data.isOnline === 'true');

    if (isOnline && isRecentlyActive) {
      const itemEmail = (data.email || '').trim().toLowerCase();
      const isSelf = Boolean((authUser && data.uid === authUser.uid) || (currentUser && data.uid === currentUser.uid));
      const isItemAdmin = Boolean(
        data.isAdmin === true ||
        ADMIN_EMAILS.includes(itemEmail) ||
        data.role === '총괄관리자' ||
        data.role === '공동관리자'
      );

      // 총괄관리자 계정 스텔스 대상 여부 판별
      const isMasterStealthAccount = isMasterAdmin(data);

      // 총괄관리자 본인 이외 다른 계정(공동관리자 및 일반 부원)으로 접속 시 완전 숨김(스텔스)
      if (isMasterStealthAccount && !isMasterViewer) {
        continue;
      }

      activeList.push({
        uid: data.uid,
        name: data.name || (itemEmail ? itemEmail.split('@')[0] : '학생회 부원'),
        grade: data.grade || '2학년',
        role: data.role || '부원',
        email: itemEmail,
        isAdmin: isItemAdmin,
        isMasterStealth: isMasterStealthAccount,
        isSelf: isSelf
      });
    }
  }

  // 중복 계정 단일 집계 (UID 기준)
  const uniqueByUid = [];
  const seenUids = new Set();
  for (const u of activeList) {
    const key = u.uid || u.email || u.name;
    if (!seenUids.has(key)) {
      seenUids.add(key);
      uniqueByUid.push(u);
    }
  }

  uniqueByUid.sort((a, b) => (b.isSelf ? 1 : 0) - (a.isSelf ? 1 : 0));
  setOnlineUsers(uniqueByUid);
  renderOnlineUsers();
}

export function renderOnlineUsers() {
  const countEl = document.getElementById('active-users-count') || document.getElementById('online-count');
  const chipsContainer = document.getElementById('live-members-chips') || document.getElementById('online-users-container');
  const listContainer = document.getElementById('online-users-list') || document.getElementById('modal-online-list');

  if (countEl) countEl.textContent = onlineUsers.length;

  if (chipsContainer) {
    if (onlineUsers.length === 0) {
      chipsContainer.innerHTML = `<span class="text-xs text-slate-400">현재 접속 중인 부원이 없습니다.</span>`;
    } else {
      chipsContainer.innerHTML = onlineUsers.map(user => `
        <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${user.isSelf ? 'bg-blue-100 text-blue-800 border border-blue-200' : 'bg-slate-100 text-slate-700'}">
          <span class="w-1.5 h-1.5 rounded-full ${user.isSelf ? 'bg-blue-600' : (user.isMasterStealth ? 'bg-indigo-500' : 'bg-emerald-500')}"></span>
          <span>${escapeHtml(user.name)}</span>
          <span class="text-[10px] text-slate-400 font-normal">(${escapeHtml(user.grade)} ${escapeHtml(user.role)})</span>
          ${user.isSelf ? '<span class="text-[9px] bg-blue-600 text-white font-bold px-1 rounded">나</span>' : ''}
          ${user.isMasterStealth ? '<span class="text-[9px] bg-slate-600 text-white font-medium px-1 rounded" title="타인에게는 숨겨진 스텔스 계정">스텔스</span>' : ''}
        </div>
      `).join('');
    }
  }

  if (listContainer) {
    if (onlineUsers.length === 0) {
      listContainer.innerHTML = `<div class="py-8 text-center text-xs text-slate-400">접속 중인 부원이 없습니다.</div>`;
    } else {
      listContainer.innerHTML = onlineUsers.map(user => `
        <div class="flex items-center justify-between p-2.5 rounded-xl ${user.isSelf ? 'bg-blue-50 border border-blue-200' : 'bg-slate-50 border border-slate-100'}">
          <div class="flex items-center gap-2.5">
            <span class="w-2.5 h-2.5 rounded-full ${user.isSelf ? 'bg-blue-600' : (user.isMasterStealth ? 'bg-indigo-500' : 'bg-emerald-500')}"></span>
            <div>
              <div class="text-xs font-bold text-slate-800 flex items-center gap-1">
                ${escapeHtml(user.name)}
                ${user.isSelf ? '<span class="text-[10px] bg-blue-600 text-white font-bold px-1 rounded">나</span>' : ''}
                ${user.isMasterStealth ? '<span class="text-[9px] bg-slate-600 text-white font-medium px-1 rounded" title="타인에게는 숨겨진 스텔스 계정">스텔스</span>' : ''}
              </div>
              <div class="text-[11px] text-slate-500 mt-0.5">${escapeHtml(user.grade)} • ${escapeHtml(user.role)}</div>
            </div>
          </div>
          <span class="text-[10px] text-emerald-600 font-semibold bg-emerald-50 px-2 py-0.5 rounded-md flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            접속중
          </span>
        </div>
      `).join('');
    }
  }
}

export function startPresenceListener() {
  if (!db || !authUser) return;
  if (presenceUnsubscribe) presenceUnsubscribe();

  const presenceCol = collection(db, 'artifacts', appId, 'public', 'data', 'presence');
  const unsub = onSnapshot(presenceCol, (snapshot) => {
    const rawList = [];
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      if (data) {
        const email = (data.email || '').toLowerCase();
        const isAdmin = Boolean(data.isAdmin || ADMIN_EMAILS.includes(email) || data.role === '총괄관리자' || data.role === '공동관리자');
        rawList.push({
          uid: data.uid || docSnap.id,
          name: data.name,
          grade: data.grade,
          role: data.role,
          email: email,
          isAdmin: isAdmin,
          canApprove: Boolean(data.canApprove || isAdmin),
          lastSeen: data.lastSeen || 0,
          isOnline: data.isOnline === true
        });
      }
    });

    setRawPresenceCache(rawList);
    filterAndRenderActivePresence();
  }, (err) => {
    console.warn('Presence snapshot error:', err);
  });
  setPresenceUnsubscribe(unsub);
}

export function toggleOnlineUsersModal() {
  const modal = document.getElementById('modal-online-users');
  if (modal) {
    modal.classList.toggle('hidden');
  }
}






