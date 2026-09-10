// =========================================================================
// 스마트 브리핑룸 (Smart Briefing Room) - Developed by YDE & DK - 전역 상태(State) 관리 모듈
// =========================================================================

export let currentUser = {
  uid: '',
  email: '',
  name: '',
  photoURL: '',
  customPhotoURL: '',
  avatarType: 'oauth', // 'oauth' | 'provider' | 'custom'
  grade: '2학년',
  classNum: '1반',
  department: '행사기획부',
  role: '부원',
  status: '', // 'pending' | 'approved' | 'rejected'
  isAdmin: false,
  canApprove: false,
  isAuthenticated: false,
  provider: 'google' // 'google' | 'kakao'
};

export function updateCurrentUser(patch) {
  Object.assign(currentUser, patch);
  if (typeof window !== 'undefined') {
    window.currentUser = currentUser;
    try {
      localStorage.setItem('doksan_session_user', JSON.stringify(currentUser));
    } catch (e) {}
  }
}

export function resetCurrentUser() {
  currentUser = {
    uid: '',
    email: '',
    name: '',
    photoURL: '',
    customPhotoURL: '',
    avatarType: 'oauth',
    grade: '2학년',
    classNum: '1반',
    department: '행사기획부',
    role: '부원',
    status: '',
    isAdmin: false,
    canApprove: false,
    isAuthenticated: false,
    provider: 'google'
  };
  if (typeof window !== 'undefined') {
    window.currentUser = currentUser;
    try {
      localStorage.removeItem('doksan_session_user');
    } catch (e) {}
  }
}

export let authUser = null;
export function setAuthUser(user) {
  authUser = user;
}

export let currentFilter = 'all';
export function setCurrentFilter(val) {
  currentFilter = val;
}

export let agendas = [];
export function setAgendas(list) {
  agendas = list;
}

export let onlineUsers = [];
export function setOnlineUsers(list) {
  onlineUsers = list;
}

export let rawPresenceCache = [];
export function setRawPresenceCache(list) {
  rawPresenceCache = list;
}

export const expandedAgendaIds = new Set();
export let currentShareAgenda = null;
export function setCurrentShareAgenda(ag) {
  currentShareAgenda = ag;
}

export let presenceUnsubscribe = null;
export function setPresenceUnsubscribe(fn) {
  presenceUnsubscribe = fn;
}

export let agendasUnsubscribe = null;
export function setAgendasUnsubscribe(fn) {
  agendasUnsubscribe = fn;
}

export let userDocUnsubscribe = null;
export function setUserDocUnsubscribe(fn) {
  userDocUnsubscribe = fn;
}

export let activeRestoreData = null;
export function setActiveRestoreData(data) {
  activeRestoreData = data;
}



