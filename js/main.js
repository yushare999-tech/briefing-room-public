// =========================================================================
// 스마트 브리핑룸 (Smart Briefing Room) - Developed by YDE & DK - 메인 애플리케이션 진입점 (Application Entry Point)
// =========================================================================

import { 
  appId, firebaseConfig, initFirebase,
  MASTER_ADMIN_EMAIL, CO_ADMIN_EMAIL, ADMIN_EMAILS,
  kakaoJsKey, geminiApiKey, isAdminDebugMode 
} from './config.js';

import { 
  currentUser, authUser, currentFilter, 
  agendas, onlineUsers, expandedAgendaIds,
  activeRestoreData, setActiveRestoreData 
} from './state.js';

import { 
  escapeHtml, cleanAiSummaryText, showToast, showCustomConfirm, switchView,
  togglePasswordVisibility, dismissUpdateNotification, applyUpdateReload, startVersionChecker,
  copyToClipboard
} from './utils.js';

import { 
  initCloudSync, openLoginModal, handleGoogleLogin, handleLogout,
  loadLocalProfile, openNewProfileModal, handleNewProfileSubmit,
  openProfileEditModal, closeProfileEditModal, handleProfileEditSubmit,
  openAdminModal, closeAdminModal, switchAdminTab,
  openAuditModal, closeAuditModal, updateMasterAdminButtonUI,
  approveUser, rejectUser, toggleUserCanApprove, toggleUserAdmin,
  deleteUserMember, updateUserGrade, updateUserRole,
  toggleAdminDebugMode, updateAdminDebugModeUI,
  toggleAvatarUploadBox, handleCustomAvatarSelected,
  openMemberProfileModalByUid, closeAdminMemberViewModal, handleAdminMemberViewSave
} from './auth.js';

import { 
  renderAgendas, toggleAgendaDetails, toggleAgendaMenu, closeAllAgendaMenus,
  openEditAgendaModal, closeEditAgendaModal, handleUpdateAgenda, confirmDeleteAgenda,
  toggleAgendaStatus, submitVote, submitComment, handleCommentSubmit,
  startEditComment, saveEditedComment, deleteComment, toggleHideComment,
  closeEditCommentModal, saveEditedCommentFromModal,
  openNewAgendaModal, closeNewAgendaModal, addOptionInput, handleCreateAgenda,
  toggleVoteOptionsInput, toggleEditVoteOptionsInput, addEditOptionInput, removeEditOptionRow,
  filterAgendas, promptSeedDemoData, handleCommentInputClick, checkAuthOrPrompt, canManageAgenda,
  extractDeepLinkAgendaId, processDeepLinkAgenda, rerollPersona, DEMO_PERSONAS,
  addNewDemoAgendas, exportFullBackupJson, exportSingleAgendaJson,
  handleRestoreFileSelected, closeRestoreOptionsModal, executeRestoreBackup,
  copyAiSummary
} from './agendas.js';

import { 
  requestAiSummary, saveGeminiKeyFromAdmin, updateGeminiKeyUI 
} from './gemini.js';

import { 
  initKakaoSdk, updateKakaoKeyUI, saveKakaoKeyFromAdmin, saveKakaoKey,
  openKakaoShareModal, openKakaoShareModalById, closeKakaoShareModal, executeKakaoShare,
  copyAgendaLink, executeNativeShare,
  handleKakaoLogin, handleKakaoLogout, saveKakaoRestApiKey
} from './kakao.js';

import { toggleOnlineUsersModal } from './presence.js';
import { 
  initBrandingListener, handleThumbnailFileUpload, 
  saveBrandingSettings, resetBrandingToDefault, populateBrandingForm 
} from './branding.js';

import { 
  loadActivityLogs, filterActivityLogsByCategory, handleAuditLogSearch,
  exportAuditLogsJson, exportAuditLogsCsv,
  handleOfflineAuditFileSelected, exitOfflineAuditLogViewer,
  openAuditPurgeModal, closeAuditPurgeModal, executeAuditLogPurge
} from './logger.js';

// =========================================================================
// Window Global Exports for HTML inline event handlers
// =========================================================================
window.appId = appId;
window.currentUser = currentUser;
window.expandedAgendaIds = expandedAgendaIds;

// UI Helpers
window.escapeHtml = escapeHtml;
window.cleanAiSummaryText = cleanAiSummaryText;
window.showToast = showToast;
window.showCustomConfirm = showCustomConfirm;
window.switchView = switchView;
window.togglePasswordVisibility = togglePasswordVisibility;
window.copyToClipboard = copyToClipboard;
window.copyAiSummary = copyAiSummary;

// Auth & Profiles
window.openLoginModal = openLoginModal;
window.handleGoogleLogin = handleGoogleLogin;
window.handleLogout = handleLogout;
window.openProfileEditModal = openProfileEditModal;
window.closeProfileEditModal = closeProfileEditModal;
window.handleProfileEditSubmit = handleProfileEditSubmit;
window.handleNewProfileSubmit = handleNewProfileSubmit;
window.toggleAvatarUploadBox = toggleAvatarUploadBox;
window.handleCustomAvatarSelected = handleCustomAvatarSelected;
window.openMemberProfileModalByUid = openMemberProfileModalByUid;
window.closeAdminMemberViewModal = closeAdminMemberViewModal;
window.handleAdminMemberViewSave = handleAdminMemberViewSave;

// Admin Console & Audit Log
window.openAdminModal = openAdminModal;
window.closeAdminModal = closeAdminModal;
window.switchAdminTab = switchAdminTab;
window.openAuditModal = openAuditModal;
window.closeAuditModal = closeAuditModal;
window.updateMasterAdminButtonUI = updateMasterAdminButtonUI;
window.approveUser = approveUser;
window.rejectUser = rejectUser;
window.toggleUserCanApprove = toggleUserCanApprove;
window.toggleUserAdmin = toggleUserAdmin;
window.deleteUserMember = deleteUserMember;
window.updateUserGrade = updateUserGrade;
window.updateUserRole = updateUserRole;
window.toggleAdminDebugMode = toggleAdminDebugMode;
window.updateAdminDebugModeUI = updateAdminDebugModeUI;

// Site Branding & Favicon
window.handleThumbnailFileUpload = handleThumbnailFileUpload;
window.saveBrandingSettings = saveBrandingSettings;
window.resetBrandingToDefault = resetBrandingToDefault;
window.populateBrandingForm = populateBrandingForm;

// Agendas, Voting & Comments
window.renderAgendas = renderAgendas;
window.toggleAgendaDetails = toggleAgendaDetails;
window.toggleAgendaMenu = toggleAgendaMenu;
window.closeAllAgendaMenus = closeAllAgendaMenus;
window.openEditAgendaModal = openEditAgendaModal;
window.closeEditAgendaModal = closeEditAgendaModal;
window.handleUpdateAgenda = handleUpdateAgenda;
window.confirmDeleteAgenda = confirmDeleteAgenda;
window.toggleAgendaStatus = toggleAgendaStatus;
window.submitVote = submitVote;
window.submitComment = submitComment;
window.handleCommentSubmit = handleCommentSubmit;
window.startEditComment = startEditComment;
window.saveEditedComment = saveEditedComment;
window.closeEditCommentModal = closeEditCommentModal;
window.saveEditedCommentFromModal = saveEditedCommentFromModal;
window.deleteComment = deleteComment;
window.toggleHideComment = toggleHideComment;
window.rerollPersona = rerollPersona;
window.openNewAgendaModal = openNewAgendaModal;
window.closeNewAgendaModal = closeNewAgendaModal;
window.addOptionInput = addOptionInput;
window.handleCreateAgenda = handleCreateAgenda;
window.toggleVoteOptionsInput = toggleVoteOptionsInput;
window.toggleEditVoteOptionsInput = toggleEditVoteOptionsInput;
window.addEditOptionInput = addEditOptionInput;
window.removeEditOptionRow = removeEditOptionRow;
window.filterAgendas = filterAgendas;
window.promptSeedDemoData = promptSeedDemoData;
window.handleCommentInputClick = handleCommentInputClick;
window.checkAuthOrPrompt = checkAuthOrPrompt;
window.canManageAgenda = canManageAgenda;
window.extractDeepLinkAgendaId = extractDeepLinkAgendaId;
window.processDeepLinkAgenda = processDeepLinkAgenda;
window.copyAiSummary = copyAiSummary;

// Backup, Restore & Agenda Seeding
window.addNewDemoAgendas = addNewDemoAgendas;
window.exportFullBackupJson = exportFullBackupJson;
window.exportSingleAgendaJson = exportSingleAgendaJson;
window.handleRestoreFileSelected = handleRestoreFileSelected;
window.closeRestoreOptionsModal = closeRestoreOptionsModal;
window.executeRestoreBackup = executeRestoreBackup;

// Audit Logging (총괄관리자 감사 이력)
window.loadActivityLogs = loadActivityLogs;
window.filterActivityLogsByCategory = filterActivityLogsByCategory;
window.handleAuditLogSearch = handleAuditLogSearch;
window.exportAuditLogsJson = exportAuditLogsJson;
window.exportAuditLogsCsv = exportAuditLogsCsv;
window.handleOfflineAuditFileSelected = handleOfflineAuditFileSelected;
window.exitOfflineAuditLogViewer = exitOfflineAuditLogViewer;
window.openAuditPurgeModal = openAuditPurgeModal;
window.closeAuditPurgeModal = closeAuditPurgeModal;
window.executeAuditLogPurge = executeAuditLogPurge;

// Gemini AI
window.requestAiSummary = requestAiSummary;
window.saveGeminiKeyFromAdmin = saveGeminiKeyFromAdmin;
window.updateGeminiKeyUI = updateGeminiKeyUI;

// Kakao Integration
window.initKakaoSdk = initKakaoSdk;
window.updateKakaoKeyUI = updateKakaoKeyUI;
window.saveKakaoKeyFromAdmin = saveKakaoKeyFromAdmin;
window.saveKakaoKey = saveKakaoKey;
window.openKakaoShareModal = openKakaoShareModal;
window.openKakaoShareModalById = openKakaoShareModalById;
window.closeKakaoShareModal = closeKakaoShareModal;
window.executeKakaoShare = executeKakaoShare;
window.copyAgendaLink = copyAgendaLink;
window.executeNativeShare = executeNativeShare;
window.handleKakaoLogin = handleKakaoLogin;
window.handleKakaoLogout = handleKakaoLogout;
window.saveKakaoRestApiKey = saveKakaoRestApiKey;

// Presence & Modal Helpers
window.toggleOnlineUsersModal = toggleOnlineUsersModal;
window.dismissUpdateNotification = dismissUpdateNotification;
window.applyUpdateReload = applyUpdateReload;
window.openConfigModal = function() {
  const modal = document.getElementById('modal-config');
  if (modal) modal.classList.remove('hidden');
};
window.closeConfigModal = function() {
  const modal = document.getElementById('modal-config');
  if (modal) modal.classList.add('hidden');
};

// =========================================================================
// Application Lifecycle & Bootstrapping
// =========================================================================
function startApp() {
  // Zero-Flicker 부트 시퀀스
  // 1. 초기 로딩 스플래시로 시작 (FOUC/플리커 원천 차단)
  // 2. Firebase Auth onAuthStateChanged가 실제 상태 확인 후 최종 뷰로 전환
  switchView('loading');

  initFirebase();
  initKakaoSdk();
  initBrandingListener();
  loadLocalProfile();
  initCloudSync();          // 인증 리스너에서 onAuthStateChanged 후 switchView() 처리
  updateAdminDebugModeUI();
  startVersionChecker();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}



