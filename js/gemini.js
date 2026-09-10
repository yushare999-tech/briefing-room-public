// =========================================================================
// 스마트 브리핑룸 - Gemini AI 수석 서기 회의 권고 결론 엔진 모듈
// =========================================================================

import { db, appId, geminiApiKey, setGeminiApiKey } from './config.js';
import { currentUser, authUser, agendas } from './state.js';
import { showToast } from './utils.js';
import { logActivity } from './logger.js';
import { doc, updateDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// 디바운스 타이머 및 진행 중인 HTTP 요청 AbortController 관리 맵
const debounceTimers = new Map(); // agendaId -> timerId
const activeAbortControllers = new Map(); // agendaId -> AbortController

/**
 * AI 요약 요청 (디바운싱 지원)
 * @param {string} agendaId - 안건 ID
 * @param {boolean} [immediate=false] - true일 경우 대기 없이 즉시 실행(수동 새로고침 버튼 등)
 */
export function requestAiSummary(agendaId, immediate = false) {
  const agenda = agendas.find(a => a.id === agendaId);
  if (!agenda) return;

  // 의결이 완료된 안건은 AI 요약 갱신 불가
  if (agenda.status === 'closed') {
    if (immediate) {
      showToast('의결이 완료된 안건은 AI 요약을 갱신할 수 없습니다.', 'info');
    }
    return;
  }

  // 기존 대기 중인 디바운스 타이머가 있다면 취소
  if (debounceTimers.has(agendaId)) {
    clearTimeout(debounceTimers.get(agendaId));
    debounceTimers.delete(agendaId);
  }

  if (immediate) {
    // 수동 갱신 등 즉시 실행 요청
    executeAiSummary(agendaId);
    return;
  }

  // 자동 트리거(투표, 댓글 작성/수정/삭제 등):
  // 사용자에게 즉시 "분석 준비/진행 중" 상태임을 시각적으로 표시
  agenda.isGeneratingSummary = true;
  if (typeof window.renderAgendas === 'function') {
    window.renderAgendas();
  }

  // 1500ms(1.5초) 디바운스 대기 후 최신 데이터로 요약 실행
  const timer = setTimeout(() => {
    debounceTimers.delete(agendaId);
    executeAiSummary(agendaId);
  }, 1500);

  debounceTimers.set(agendaId, timer);
}

/**
 * 실제 Gemini API 호출 및 요약 처리 (최신 데이터 기반 및 AbortController 제어)
 * @param {string} agendaId - 안건 ID
 */
async function executeAiSummary(agendaId) {
  const agenda = agendas.find(a => a.id === agendaId);
  if (!agenda || agenda.status === 'closed') return;

  // 1. 이미 동일 안건에 대해 진행 중인 Gemini API fetch 요청이 있다면 즉시 중단(Abort)
  if (activeAbortControllers.has(agendaId)) {
    console.log(`[Gemini AI] 이전 요청 취소 및 최신 데이터로 재요청: 안건 ID ${agendaId}`);
    try {
      activeAbortControllers.get(agendaId).abort();
    } catch (e) {}
    activeAbortControllers.delete(agendaId);
  }

  // 2. 새로운 AbortController 생성 및 등록
  const controller = new AbortController();
  activeAbortControllers.set(agendaId, controller);

  agenda.isGeneratingSummary = true;
  if (typeof window.renderAgendas === 'function') {
    window.renderAgendas();
  }

  const comments = agenda.comments || [];
  const options = agenda.options || [];
  const totalVotes = options.reduce((sum, opt) => sum + (opt.votes ? opt.votes.length : 0), 0);

  // 투표 현황 문자열
  let voteSummaryText = "투표 진행 안 함";
  if (options.length > 0) {
    voteSummaryText = options.map(o => {
      const vCount = (o.votes || []).length;
      const pct = totalVotes > 0 ? Math.round((vCount / totalVotes) * 100) : 0;
      return `- ${o.text}: ${vCount}표 (${pct}%)`;
    }).join('\n');
  }

  // 댓글 목록 문자열
  const commentsText = comments.length > 0
    ? comments.map(c => `- [${c.author || '부원'}(${c.role || ''})] "${c.text}"`).join('\n')
    : "(등록된 부원 댓글이 없습니다.)";

  // 데이터가 없는 경우 처리
  if (comments.length === 0 && totalVotes === 0) {
    const noDataMsg = "📊 [부원 의견 종합 분석]\n- 아직 등록된 부원 댓글이나 투표 참여 내역이 없습니다.\n\n🎯 [회의 권고 결론]\n- 부원들의 자유 의견 청취 및 첫 번째 투표 참여를 독려할 것을 권고함.";
    agenda.aiSummary = noDataMsg;
    if (db && authUser) {
      try {
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'agendas', agendaId);
        await updateDoc(docRef, { aiSummary: noDataMsg });
      } catch(e) {}
    }
    if (activeAbortControllers.get(agendaId) === controller) {
      activeAbortControllers.delete(agendaId);
      agenda.isGeneratingSummary = false;
      if (typeof window.renderAgendas === 'function') window.renderAgendas();
    }
    return;
  }

  const systemPrompt = `너는 브리핑룸의 수석 서기 AI다.
제공된 안건 내용, 현재 투표 득표율, 그리고 부원들의 댓글 피드백을 깊이 있게 종합 분석하여 학생회 정례 회의에서 임원진이 즉각 의결할 수 있는 핵심 요약 및 권고 결론을 작성하라.

[작성 규칙]
1. 반드시 아래 2개 섹션으로 명확히 구분하여 작성하라:
📊 [부원 의견 종합 분석]
- 찬성 및 지지 의견: (부원들의 긍정적인 의견과 아이디어를 핵심 요약)
- 우려 및 보완 요구: (부원들이 짚은 현실적 제약, 안전, 예산, 뒷정리 등)

🎯 [회의 권고 결론]
- 투표 결과 득표율과 부원들의 제안을 종합하여, 이번 회의에서 임원진이 채택해야 할 구체적인 최종 의결 권고안을 1~2문장으로 확정 제시하라. (예: '~안을 가결하되, ~대책을 세우는 조건부 통과 권고')

2. 문체는 정중하고 명확한 서기 보고 문체(~함, ~권고함)를 사용하라.
3. 군더더기 서론이나 인사말은 일절 생략하고 위 지정된 형식만 출력하라.`;

  const userQuery = `[안건 제목] ${agenda.title}
[안건 배경/내용] ${agenda.desc || '내용 없음'}

[현재 투표 득표율 (총 ${totalVotes}표)]
${voteSummaryText}

[부원 댓글 피드백 (${comments.length}개)]
${commentsText}

위 데이터를 종합 분석하여 정례 회의를 위한 [부원 의견 종합 분석]과 [회의 권고 결론]을 작성해줘.`;

  try {
    const payload = {
      contents: [{ parts: [{ text: userQuery }] }],
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2500
      }
    };

    // 최적 안정성 모델 순차 시도 (gemini-3.6-flash 최우선 -> 필요시 2.5-flash -> 3.7-flash -> 3.8-flash)
    const candidateModels = ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-3.7-flash', 'gemini-3.8-flash'];
    let generatedText = '';
    let lastError = null;

    for (const modelName of candidateModels) {
      if (controller.signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      try {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': geminiApiKey
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        if (controller.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        if (response.ok) {
          const resData = await response.json();
          const candidate = resData.candidates && resData.candidates[0];
          generatedText = candidate?.content?.parts?.[0]?.text || '';
          if (generatedText) {
            console.log(`Gemini AI Summary successfully generated using model: ${modelName}`);
            break;
          }
        } else {
          const errBody = await response.text();
          console.warn(`Model ${modelName} error (${response.status}):`, errBody);
          lastError = new Error(`Model ${modelName} returned ${response.status}`);
        }
      } catch (mErr) {
        if (mErr.name === 'AbortError' || controller.signal.aborted) {
          throw mErr;
        }
        console.warn(`Error attempting model ${modelName}:`, mErr);
        lastError = mErr;
      }
    }

    if (!generatedText) {
      throw lastError || new Error('모든 Gemini 모델 생성 시도에 실패했습니다.');
    }

    agenda.aiSummary = generatedText.trim();
  } catch (err) {
    if (err.name === 'AbortError' || controller.signal.aborted) {
      console.log(`[Gemini AI] 안건(${agendaId})에 대한 요약 요청이 최신 요청에 의해 안전하게 취소되었습니다.`);
      return; // 취소된 이전 요청은 데이터나 UI를 덮어쓰지 않고 조용히 종료
    }

    console.warn('AI summary generation error (using intelligent local fallback):', err);
    const commentsList = comments.length > 0
      ? comments.map(c => `- [${c.author || '부원'}(${c.role || ''})] "${c.text}"`).join('\n')
      : '- 등록된 부원 피드백이 없습니다.';
    
    const fallbackSummary = `📊 [부원 의견 종합 분석]\n${commentsList}\n\n🎯 [회의 권고 결론]\n- 총 ${totalVotes}표의 투표 현황과 부원 ${comments.length}명의 피드백을 종합하여, 정례 회의에서 안건에 대한 최종 가결 여부를 의결할 것을 권고함.`;
    agenda.aiSummary = fallbackSummary;
  } finally {
    // 오직 현재 실행(가장 최신 요청) 컨트롤러인 경우에만 DB 저장 및 상태 해제/렌더링
    if (activeAbortControllers.get(agendaId) === controller) {
      activeAbortControllers.delete(agendaId);
      
      const now = new Date();
      const timeStr = `${now.getHours()}:${now.getMinutes() < 10 ? '0' : ''}${now.getMinutes()}`;
      const updatedAtMs = Date.now();
      agenda.aiSummaryUpdatedAt = updatedAtMs;
      agenda.aiSummaryUpdatedTime = timeStr;

      if (db && authUser && agenda.aiSummary) {
        try {
          const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'agendas', agendaId);
          await updateDoc(docRef, { 
            aiSummary: agenda.aiSummary,
            aiSummaryUpdatedAt: updatedAtMs,
            aiSummaryUpdatedTime: timeStr
          });

          logActivity({
            category: 'AI',
            action: 'AI_SUMMARY_GENERATE',
            target: { type: 'agenda', id: agendaId, title: agenda.title },
            details: {
              summary: `"${agenda.title}" 안건의 회의 대비 AI 요약 분석을 갱신함`,
              after: timeStr
            }
          });
        } catch (dbErr) {
          console.error('Failed to persist aiSummary to Firestore:', dbErr);
        }
      }
      agenda.isGeneratingSummary = false;
      if (typeof window.renderAgendas === 'function') {
        window.renderAgendas();
      }
    }
  }
}

export function updateGeminiKeyUI() {
  const adminInput = document.getElementById('admin-gemini-key-input');
  if (adminInput && geminiApiKey) {
    adminInput.value = geminiApiKey;
  }
}

export async function saveGeminiKeyFromAdmin() {
  if (!currentUser.isAdmin) {
    showToast('관리자만 Gemini AI 키를 변경할 수 있습니다.', 'warning');
    return;
  }
  const keyInput = document.getElementById('admin-gemini-key-input');
  const key = keyInput ? keyInput.value.trim() : '';
  if (!key) {
    showToast('Gemini API 키를 입력해 주세요.', 'warning');
    return;
  }

  try {
    if (db) {
      const configDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'config', 'settings');
      await setDoc(configDocRef, {
        geminiApiKey: key,
        updatedAt: Date.now(),
        updatedBy: currentUser.email || '관리자'
      }, { merge: true });
    }

    setGeminiApiKey(key);
    try {
      localStorage.setItem('doksan_gemini_api_key', key);
    } catch (e) {}
    updateGeminiKeyUI();

    showToast('Gemini AI 키가 클라우드에 저장되어 모든 부원에게 실시간 배포되었습니다.', 'success');
  } catch (err) {
    console.error('Error saving Gemini key:', err);
    showToast('키 저장 실패: ' + err.message, 'warning');
  }
}






