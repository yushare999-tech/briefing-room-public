# 🚀 단일 글로벌 버전 기반 동적 Import Map 모듈 캐시 아키텍처 규격서 (MODULE_CACHE_AND_IMPORT_MAP_ARCHITECTURE.md)

> **문서 목적**: 순수 Vanilla ES 모듈 환경에서 개별 JS 소스 파일마다 버전을 수동 하드코딩하던 안티패턴을 청산하고, 브라우저 표준 `<script type="importmap">`과 단일 글로벌 변수(`window.APP_VERSION`)를 통해 전체 모듈의 캐시를 중앙 일괄 통제하는 공식 아키텍처를 정의합니다.

---

## 1. 기존 방식의 문제점 및 한계 (Problem Statement)

### 1.1 개별 파일 하드코딩 안티패턴
* 과거에는 배포 시 캐시 버스팅을 위해 `import { ... } from './config.js?v=53'`와 같이 각 파일마다 쿼리스트링을 직접 적었습니다.
* **문제점**:
  1. `main.js`의 버전만 올리고 `agendas.js`나 `auth.js` 내부의 상대 경로 쿼리스트링 수정을 누락할 경우, 브라우저가 `state.js?v=54`와 `state.js?v=53`을 별개의 독립 모듈로 인식하여 상태(State)가 2벌로 쪼개지는 **캐시 파편화 및 상태 불일치 대참사** 발생.
  2. 소스 수정 시마다 10여 개 파일의 상단 import 문을 찾아다니며 버전을 수동으로 수정해야 하는 비효율성.
  3. `config.js`의 `CURRENT_APP_VERSION`과 `version.json`의 버전 불일치로 인해, 이미 최신 버전임에도 **'최신 업데이트 출시' 새로고침 배너가 계속해서 뜨는 오작동** 유발.

---

## 2. 브라우저 표준 Import Map 아키텍처 (Core Architecture)

### 2.1 동작 원리
1. **`index.html` 최상단 단일 진입점 (`<head>` 직하단)**:
   - 다른 어떤 ES 모듈 스크립트가 실행되기 전에, 동적 Import Map 주입 스크립트를 즉시 실행합니다.
   - `window.APP_VERSION = 'v54'`라는 단 1개의 글로벌 변수를 정의합니다.
2. **동적 Import Map 생성**:
   - 브라우저 표준 `<script type="importmap">` 엘리먼트를 동적으로 생성하여 `<head>`에 등록합니다.
   - 프로젝트 내 11개 핵심 모듈(`main`, `config`, `state`, `utils`, `auth`, `agendas`, `gemini`, `kakao`, `presence`, `branding`, `logger`)에 대해:
     - 루트 상대 경로: `./js/{module}.js` ➔ `./js/{module}.js?v=${APP_VERSION}`
     - 절대 경로: `/js/{module}.js` ➔ `/js/{module}.js?v=${APP_VERSION}`
     - 디렉터리 내부 상대 경로: `./{module}.js` ➔ `./js/{module}.js?v=${APP_VERSION}`
     - Bare Specifier: `{module}` ➔ `./js/{module}.js?v=${APP_VERSION}`
     을 브라우저 모듈 로더에 100% 매핑합니다.
3. **순수 표준 ES 모듈 코드 유지**:
   - `js/*.js` 파일 내부에서는 지저분한 `?v=...`을 **완전히 0개로 제거**하고, 오직 순수한 상대 경로(`import { ... } from './config.js'`)만 작성합니다.
   - 브라우저가 모듈을 가져올 때 Import Map이 가로채서 백그라운드에서 자동으로 `?v=v54` 쿼리를 주입하여 서버에 요청합니다.

### 2.2 구현 코드 (`index.html`)
```html
<script>
  // =========================================================================
  // 🚀 [사무실-삼식이] 단일 글로벌 버전 기반 동적 Import Map 캐시 버스팅 아키텍처
  // 개별 JS 파일마다 버전을 하드코딩하지 않고, 오직 window.APP_VERSION 하나로 전체 모듈을 통제합니다.
  // =========================================================================
  window.APP_VERSION = 'v54';
  (function initModuleImportMap() {
    const modules = [
      'main', 'config', 'state', 'utils', 'auth', 'agendas',
      'gemini', 'kakao', 'presence', 'branding', 'logger'
    ];
    const im = { imports: {} };
    const v = window.APP_VERSION;
    modules.forEach(function(m) {
      im.imports['./js/' + m + '.js'] = './js/' + m + '.js?v=' + v;
      im.imports['/js/' + m + '.js'] = '/js/' + m + '.js?v=' + v;
      im.imports['js/' + m + '.js'] = './js/' + m + '.js?v=' + v;
      im.imports['./' + m + '.js'] = './js/' + m + '.js?v=' + v;
      im.imports[m] = './js/' + m + '.js?v=' + v;
    });
    const s = document.createElement('script');
    s.type = 'importmap';
    s.textContent = JSON.stringify(im);
    document.currentScript.after(s);
  })();
</script>
```

### 2.3 `js/config.js`의 버전 자동 동기화
```javascript
// Current Client Application Build Version (Live Update Detection - Synced with window.APP_VERSION)
export const CURRENT_APP_VERSION = typeof window !== 'undefined' && window.APP_VERSION ? window.APP_VERSION : 'v54';
```

---

## 3. Firebase Hosting 캐시 헤더 정책 (`firebase.json`)

루트 URL(`https://your-project.web.app/`)로 편법 쿼리스트링 없이 바로 접속하더라도 항상 최신 `index.html`과 `version.json`이 로드되도록 헤더를 지정합니다:

```json
"headers": [
  {
    "source": "/index.html",
    "headers": [
      { "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }
    ]
  },
  {
    "source": "/version.json",
    "headers": [
      { "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }
    ]
  }
]
```

---

## 4. 향후 신규 배포 시 3단계 표준 작업 가이드 (Developer Standard)

앞으로 새 버전을 릴리즈할 때는 **JS 소스 코드를 건드릴 필요가 전혀 없습니다**:

1. **`index.html`**:
   `window.APP_VERSION = 'v55';` (버전 번호만 1 올림)
2. **`version.json`**:
   `"version": "v55"` 및 업데이트 내역 작성
3. **동기화 및 배포**:
   `.\git_sync.ps1 -Message "..."` 실행 후 `npx firebase-tools deploy` 수행

> **효과**: 전체 11개 모듈이 완벽히 동일한 새 버전 쿼리로 일괄 갱신되며, 브라우저 이중 로드 및 불필요한 새로고침 배너가 원천 차단됩니다.
