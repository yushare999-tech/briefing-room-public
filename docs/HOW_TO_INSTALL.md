# 🚀 브리핑룸 (Briefing Room) 설치 및 배포 가이드 (How-to-Install)

> **프로젝트**: 브리핑룸 (클라우드 기반 실시간 회의 의결 및 안건 협업 플랫폼)  
> **공식 개발자 (Authors)**: **YDE & DK**  
> **라이선스**: MIT License  
> **버전**: v2.9+ (범용 오픈소스 에디션)

---

## 📌 1. 개요 (Overview)

본 가이드는 브리핑룸(Briefing Room) 오픈소스 솔루션을 자신의 학교, 학과, 동아리, 소규모 조직에 맞추어 **5분 만에 무료로 설치하고 배포하는 전체 절차**를 안내합니다.

본 솔루션은 별도의 백엔드 서버 구축 없이 **Google Firebase (서버리스 클라우드)** 기반으로 구동되며, 완전 무료 티어(Spark Plan) 내에서 수백 명의 동시 접속과 실시간 투표를 안정적으로 지원합니다.

---

## 🚨 [초특급 중요] 초기 총괄관리자(MASTER_ADMIN_EMAIL) 설정의 작동 원리와 치명적 중요성

> [!CAUTION]
> **OAuth 구축 전 명시적으로 설정하는 이메일 주소는 시스템의 '마스터 키(Master Key)'입니다!**
> 
> 브리핑룸은 미승인 사용자의 무단 투표 및 시스템 변조를 막기 위해 엄격한 **'부원 가입 승인 게이트키퍼'** 체계를 갖추고 있습니다.
> 즉, 일반 사용자가 가입하면 총괄관리자가 승인해주기 전까지 아무것도 할 수 없습니다.
>
> 그렇다면 **맨 처음 설치한 관리자는 누가 승인해 주는가?**라는 근본적인 닭과 달걀 문제가 발생합니다.
>
> 브리핑룸은 이 보안 딜레마를 해결하기 위해 다음과 같은 **'신뢰 기반 부트스트랩'** 방식을 사용합니다:
> 
> 1. **작동 메커니즘**:
>    - 시스템 기동 전, 소유자는 index.html 최상단에 window.MASTER_ADMIN_EMAIL = 'admin@gmail.com'을 명시합니다.
>    - 이후 사용자가 **[Google 계정으로 로그인]**을 누르면, 구글 공식 인증 서버(OAuth 2.0)가 해당 사용자의 이메일 진위 여부를 암호학적으로 보증하며 토큰을 반환합니다.
>    - 브리핑룸 클라이언트는 구글 서버가 보증한 사용자의 실제 이메일과 MASTER_ADMIN_EMAIL을 대조하여, **일치하는 순간 별도의 승인 절차 없이 시스템 최고 권한(Super Admin / Root)을 즉시 부여**합니다.
>
> 2. **오타 발생 시 대참사 (주의!)**:
>    - 만약 이 이메일 주소에 **단 한 글자의 오타, 불필요한 공백, 잘못된 도메인**이 입력되어 배포될 경우:
>    - 구글 로그인은 정상적으로 성공하지만, 시스템은 당신을 '관리자'가 아닌 **'일반 부원'으로 간주하여 [승인 대기 중(Pending)] 화면에 영구히 가둬버립니다.**
>    - 이 상태에서는 본인이 관리자 콘솔을 열어 스스로를 승인할 수도 없게 되므로, 코드를 다시 고쳐 재배포해야 하는 치명적인 불편을 겪게 됩니다.
>
> 3. **작성 가이드**:
>    - 반드시 본인이 브라우저에서 실제로 로그인할 구글 계정(Gmail 또는 Google Workspace 계정)의 정확한 주소를 입력하세요.
>    - 영문 대소문자는 시스템이 자동으로 소문자로 정규화하여 검사하므로 안심하셔도 됩니다.

---

## 🛠️ 2. 사전 준비물 (Prerequisites)

1. **Google 계정**: Firebase 프로젝트 생성 및 최초 총괄관리자 Google 로그인 연동에 필요합니다.
2. **Node.js (v18 이상 권장)**: 배포 도구(Firebase CLI) 실행에 필요합니다.
3. **GitHub 계정**: 소스 코드 복제(Clone/Fork)에 필요합니다.

---

## ⚡ 3. 4단계 퀵스타트 설치 과정 (Quick Start)

### 1단계: 소스 코드 복제 (Clone)
터미널에서 오픈소스 저장소를 클론합니다:
```bash
git clone https://github.com/yushare999-tech/briefing-room-public.git
cd briefing-room-public
```

---

### 2단계: Google Firebase 프로젝트 생성 및 설정

1. [Firebase Console](https://console.firebase.google.com/)에 접속하여 **[프로젝트 추가]**를 클릭합니다.
2. 프로젝트 이름을 입력합니다 (예: my-student-council).
3. Google 애널리틱스는 필요에 따라 활성화합니다 (선택 사항).
4. **웹 앱(Web App) 추가**:
   - 프로젝트 대시보드에서 웹 아이콘(</>)을 클릭하여 앱을 등록합니다.
   - 표시되는 irebaseConfig JSON 객체를 복사해 둡니다.
5. **Cloud Firestore 데이터베이스 생성**:
   - 좌측 메뉴 [빌드] -> [Firestore Database] 클릭 후 **[데이터베이스 만들기]** 클릭.
   - 위치: sia-northeast3 (서울) 선택 권장.
   - 보안 규칙: [테스트 모드로 시작] 또는 기본 모드로 생성.
6. **Authentication (사용자 인증) 활성화**:
   - 좌측 메뉴 [빌드] -> [Authentication] -> **[시작하기]** 클릭.
   - [로그인 방법] 탭에서 **Google** 공급업체를 활성화합니다.
   - 프로젝트 지원 이메일을 본인 이메일로 지정하고 저장합니다.

---

### 3단계: 환경설정 및 Firebase 배포

1. **Firebase 설정 파일 반영 (`js/config.js`)**:
   - 복사해 둔 Firebase 콘솔의 설정값을 `js/config.js` 상단의 `productionFirebaseConfig`에 붙여넣습니다:
   ```javascript
   export const productionFirebaseConfig = {
     apiKey: "YOUR_API_KEY",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project",
     storageBucket: "your-project.firebasestorage.app",
     messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
     appId: "YOUR_APP_ID"
   };
   ```

2. **총괄관리자(Super Admin) 이메일 지정 (`index.html`)**:
   - `index.html` 최상단 `<script>` 블록에서 최초 총괄관리자로 사용할 본인의 구글 이메일을 정확히 입력합니다:
   ```html
   <script>
     window.APP_VERSION = 'v3.0';
     // 🚨 [필수] 본인이 실제 Google 로그인에 사용할 계정 (오타 절대 주의!)
     window.MASTER_ADMIN_EMAIL = 'myname@gmail.com';
   </script>
   ```

3. **Firebase CLI를 통한 원클릭 호스팅 배포**:
   ```bash
   # Firebase 로그인 (최초 1회)
   npx firebase-tools login

   # 호스팅 배포 실행
   npx firebase-tools deploy --only hosting --project your-project-id
   ```
   - 배포가 완료되면 터미널에 표시되는 `Hosting URL: https://your-project-id.web.app` 주소로 즉시 접속 가능합니다.

---

### 4단계: 최초 접속 및 총괄관리자(Super Admin) 등록

1. 배포된 웹사이트(https://your-project-id.web.app)에 접속합니다.
2. 3단계에서 window.MASTER_ADMIN_EMAIL로 지정했던 구글 계정으로 **[Google 계정으로 로그인]**합니다.
3. 최초 로그인 시 구글 서버의 인증을 거쳐 **즉시 최고 총괄관리자 권한이 부여**됩니다.
4. 상단 헤더에 **[🕵️ 감사 이력]** 및 **[⚙️ 관리자 콘솔]** 버튼이 노출되며 시스템 운영을 즉시 시작할 수 있습니다.
5. [관리자 콘솔] -> [시스템 브랜딩] 탭에서 우리 학교/단체의 이름과 로고를 자유롭게 설정하세요!

---

## 🔑 4. 필수 API 및 소셜 기능 연동 가이드

기본적인 구글 로그인 및 실시간 투표 외에 **Gemini AI 회의 요약**과 **카카오톡 단톡방 공유** 기능을 활성화하려면 다음 상세 문서를 참조하세요:

*   📖 **[각종 API 발급 및 적용 상세 가이드 (API_SETUP_GUIDE.md)](./API_SETUP_GUIDE.md)**
    *   Google Gemini API Key 발급 및 적용 (무료 쿼터 지원)
    *   Kakao Developers JavaScript 키 발급 및 카카오 로그인/단톡방 공유 연동
    *   Google Cloud Console OAuth 승인 URI 설정

---

## 👨‍💻 5. 개발자 및 기여자 (Authors & Credits)

*   **Lead Architects & Core Developers**: **YDE & DK**
*   **Special Thanks**: 초기 테스트 파일럿 운영팀 및 오픈소스 기여자 여러분

---
*Last Updated: 2026-09-11 | Managed by YDE & DK*
