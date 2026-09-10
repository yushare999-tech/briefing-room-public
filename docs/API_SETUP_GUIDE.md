# 🔑 브리핑룸 API 연동 및 환경설정 가이드 (API Setup Guide)

> **프로젝트**: 브리핑룸 (Briefing Room)  
> **공식 개발자 (Authors)**: **YDE & DK**  
> **라이선스**: MIT License  

---

## 📌 1. 개요 (Overview)

브리핑룸의 모든 스마트 기능(Google OAuth 로그인, Gemini 생성형 AI 서기 요약, 카카오톡 단톡방 안건 공유)을 100% 활성화하기 위한 **외부 API 키 발급 및 설정 매뉴얼**입니다.

모든 API는 기본 무료 티어(Free Tier) 범위 내에서 비용 없이 사용할 수 있습니다.

---

## 🤖 2. Google Gemini AI API 키 발급 및 적용

브리핑룸은 부원들의 실시간 댓글 의견을 종합하여 1~2초 만에 정례 회의 안건 권고안을 생성하는 **Gemini AI 수석 서기 엔진**을 내장하고 있습니다.

### 발급 절차:
1. [Google AI Studio (aistudio.google.com)](https://aistudio.google.com/)에 구글 계정으로 로그인합니다.
2. 좌측 상단의 **[Get API key]** 버튼을 클릭합니다.
3. **[Create API key]**를 클릭하고 프로젝트를 선택하여 신규 API 키를 생성합니다.
4. 생성된 키(AIzaSy...)를 복사합니다.

### 브리핑룸 적용 방법 (2가지 중 택 1):
*   **방법 A (관리자 콘솔 동적 설정 - 권장)**:
    1. 브리핑룸 웹사이트에 총괄관리자로 로그인합니다.
    2. 상단 **[관리자 콘솔]** 버튼 클릭 -> **[API 키 및 보안 설정]** 탭 선택.
    3. Gemini API 키 입력란에 복사한 키를 붙여넣고 **[저장]**을 누릅니다.
    4. 즉시 Firestore 클라우드에 안전하게 동기화되어 모든 부원이 AI 요약 기능을 이용할 수 있습니다.
*   **방법 B (기본 소스코드 설정)**:
    - js/config.js 파일의 DEFAULT_GEMINI_API_KEY 변수에 키를 지정합니다.

---

## 💬 3. Kakao Developers JavaScript 키 발급 및 소셜 연동

카카오톡 로그인 및 안건 의결 결과를 단톡방으로 원클릭 공유하기 위해 필요한 설정입니다.

### 발급 절차:
1. [카카오 개발자센터 (developers.kakao.com)](https://developers.kakao.com/)에 로그인합니다.
2. 상단 **[내 애플리케이션]** -> **[애플리케이션 추가하기]** 클릭.
   - 앱 이름: 학생회 브리핑룸 (자유롭게 입력)
   - 사업자명: 학생회 (개인/단체명)
3. 생성된 앱 대시보드의 **[앱 키]** 항목에서 **JavaScript 키**를 복사합니다.

### 필수 플랫폼 도메인 등록:
1. 좌측 메뉴 **[플랫폼]** -> [Web] 플랫폼 등록 클릭.
2. 사이트 도메인에 본인의 Firebase 호스팅 주소를 등록합니다:
   - 예: https://your-project-id.web.app
   - 예: https://your-project-id.firebaseapp.com
   - (로컬 테스트 시: http://localhost:5000 등 추가)
3. 저장합니다.

### 카카오 로그인 활성화:
1. 좌측 메뉴 **[카카오 로그인]** -> 활성화 상태를 **[ON]**으로 변경.
2. [동의항목] 메뉴에서 **닉네임**, **프로필 사진**을 필수 또는 선택 동의로 설정합니다.

### 브리핑룸 적용 방법:
*   브리핑룸에 총괄관리자로 로그인 -> **[관리자 콘솔]** -> **[API 키 및 보안 설정]** 탭 -> **Kakao JavaScript Key**란에 붙여넣고 저장합니다.

---

## 🔒 4. Google Cloud Console OAuth 승인 URI 설정

구글 로그인 시 uth/unauthorized-domain 오류를 방지하기 위한 보안 도메인 승인 절차입니다.

1. [Firebase Console](https://console.firebase.google.com/) 접속 -> 해당 프로젝트 선택.
2. [Authentication] -> [Settings(설정)] -> **[승인된 도메인]** 탭 선택.
3. 배포된 호스팅 도메인(your-project-id.web.app)이 등록되어 있는지 확인합니다.
4. 커스텀 도메인(예: council.my-school.hs.kr)을 사용할 경우 **[도메인 추가]**를 눌러 해당 도메인을 등록합니다.

---

## 🛡️ 5. Cloud Firestore 보안 규칙 (Security Rules) 표준 템플릿

데이터 무결성 및 인가되지 않은 쓰기를 차단하기 위해 Firebase 콘솔의 **[Firestore Database] -> [규칙(Rules)]** 탭에 다음 규칙을 배포하는 것을 권장합니다:

`javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // 공개 읽기 및 인증된 부원 쓰기 허용
    match /artifacts/{appId}/public/data/{document=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    
    // 감사 이력 (불변 원장 - 삭제/수정 제한)
    match /artifacts/{appId}/public/data/auditLogs/{logId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update, delete: if request.auth.token.email == YOUR_MASTER_ADMIN_EMAIL;
    }
  }
}
`

---

## 👨‍💻 개발 및 기술 지원 (Authors)
*   **Authors & Core Architects**: **YDE & DK**
*   궁금한 점이나 기능 제안은 GitHub Issues를 통해 남겨주세요.

---
*Last Updated: 2026-09-11 | Managed by YDE & DK*
