# myPrograms Launcher

저장소의 모든 프로그램을 한 화면에서 실행·관리하는 통합 런처.
하나의 로컬 서버(포트 3100)가 저장소 전체를 **단일 origin**으로 서빙하여, 각 웹 프로그램을 iframe 탭으로 임베드한다.

**실행**: 저장소 루트의 `Launcher.bat` 더블클릭 → 브라우저에서 http://localhost:3100 열림
(또는 `python launcher/launcher_hub.py`)

---

## UI 구성

```
┌─────────────────────────────────────────────────────────────┐
│  ☰ myPrograms Launcher                        [ ⬇ Downloads ] │  ← 상단바
├──────────────┬──────────────────────────────┬───────────────┤
│  WEB APPS    │  [STEP][CAD ✕][Quarter ✕] …  │  Downloads    │
│   Vehicle…   │ ┌──────────────────────────┐ │   model.stl   │
│    • Quarter │ │                          │ │   formula.png │
│    • Half    │ │   실행된 프로그램         │ │   merged.pdf  │
│   Robotics   │ │   (iframe, 활성 탭)       │ │      …        │
│    • 2D Arm  │ │                          │ │               │
│   3D / CAD   │ │                          │ │ [ Open folder]│
│  ──────────  │ └──────────────────────────┘ │               │
│  STANDALONE  │                              │               │
│    • Conf.   │                              │               │
│  (왼쪽 패널)  │       (가운데 패널)           │  (오른쪽 패널) │
└──────────────┴──────────────────────────────┴───────────────┘
```

- **왼쪽 패널 (사이드바)** — 프로그램을 그룹/카테고리별로 나열.
  `programs.json`에 처음 등장하는 순서대로 그룹·카테고리가 정렬되고, 그룹 사이에는 구분선이 들어간다.
  항목을 클릭하면 가운데 패널에서 실행된다.
- **가운데 패널 (워크스페이스)** — Chrome 스타일 탭 스트립 + iframe 호스트.
  - 프로그램을 클릭하면 새 탭 + iframe(`/<folder>/`)이 생성된다.
  - 여러 프로그램을 동시에 열 수 있고, **탭을 전환해도 비활성 iframe은 DOM에 그대로 남아(숨김 처리만)** 각 프로그램의 상태가 유지된다.
  - 탭의 `✕`로 닫으면 탭과 iframe이 함께 제거되고, 활성 탭을 닫으면 다른 탭으로 폴백한다.
  - `mode: "cli"` 프로그램은 iframe 대신 명령어 안내 모달을 띄우고 터미널을 연다.
- **오른쪽 패널 (Downloads)** — 상단 `Downloads` 버튼으로 토글.
  사용자 다운로드 폴더의 최근 파일 40개를 시간·크기·타입 아이콘과 함께 표시.
  파일을 클릭하면 기본 앱으로 열리고, `Open folder`로 폴더를 연다.

---

## 코드 구성

```
launcher/
├── launcher_hub.py   # 백엔드: 정적 서빙 + JSON API (포트 3100)
├── programs.json     # 프로그램 레지스트리 (단일 진실 공급원 — 데이터)
├── index.html        # 셸 마크업
├── css/style.css     # 다크 테마 (기존 앱들과 동일 팔레트)
└── js/main.js        # 프론트엔드 로직
```

### `launcher_hub.py` (백엔드)

저장소 루트로 `directory`를 잡은 `SimpleHTTPRequestHandler` 서브클래스 1개가 모든 것을 처리한다.

- **정적 서빙** — `/` → 셸(`launcher/index.html`), `/<folder>/...` → 각 프로그램 파일.
  모든 프로그램이 같은 origin에서 서빙되므로, 프로그램마다 서버를 따로 띄우거나 브라우저 팝업을 열 필요가 없다.
  (각 프로그램은 상대경로 `css/`·`js/`를 쓰므로, iframe URL이 폴더를 base로 유지하여 정상 동작한다.)
- **JSON API**
  | 메서드/경로 | 동작 |
  |---|---|
  | `GET /api/programs` | `programs.json`을 읽어 레지스트리 반환 |
  | `GET /api/downloads` | 다운로드 폴더 최근 파일 목록(이름·크기·mtime·확장자) |
  | `POST /api/open {path}` | 파일을 기본 앱으로 열기 — **다운로드 폴더 내부 경로만 허용** |
  | `POST /api/open-folder` | 다운로드 폴더 열기 |
  | `POST /api/run-cli {id}` | `mode:"cli"` 프로그램을 터미널에서 실행 |
- **보안 가드** — `_safe_in_downloads()`가 경로를 resolve하여 다운로드 폴더 밖(및 `..` 탈출)을 차단하고, `run-cli`는 등록된 `cli` 프로그램만 허용한다.
- **레지스트리 로딩** — `load_programs()`가 `programs.json`을 읽고 `id`/`folder` 누락 항목을 걸러내며, `mode`·`group`·`category`·`icon`·`name` 기본값을 채운다.

### `js/main.js` (프론트엔드)

`/api/programs`를 받아 사이드바를 렌더하고, 탭/iframe 생애주기를 관리한다.

- `orderedGroups()` — 레지스트리를 `group → category`로 묶되, **Map의 삽입 순서**를 그대로 사용한다. 즉 정렬 규칙이 코드에 하드코딩돼 있지 않고 `programs.json`의 순서가 곧 화면 순서다.
- `launch(p)` — `mode:"web"`이면 탭+iframe 생성(이미 있으면 활성화), `mode:"cli"`이면 `launchCli()`.
- `activateTab()` / `closeTab()` — 활성 탭만 보이고 나머지는 `display:none`(제거 아님)으로 상태 보존.
- 다운로드 패널, 파일 타입 아이콘 매핑(`fileKind`), 상대시간/용량 포맷 헬퍼.

---

## 새 프로그램 추가하기

**`programs.json`에 객체 1개를 추가하면 끝.** 코드(`.py`·`.js`·`.html`) 수정 불필요.

```jsonc
{
  "id": "my_tool",            // 고유 ID (필수)
  "name": "My Tool",          // 사이드바/탭 표시 이름
  "folder": "my_tool",        // 저장소 내 폴더명 — /<folder>/ 로 서빙 (필수)
  "group": "Web apps",        // 사이드바 최상위 그룹 (자유 텍스트, 처음 등장 순서로 정렬)
  "category": "Editors",      // 그룹 안의 소분류 (자유 텍스트)
  "icon": "ti-tool",          // Tabler 아이콘 이름 (https://tabler.io/icons)
  "mode": "web",              // "web"=iframe 임베드 | "cli"=터미널 실행
  "blurb": "한 줄 설명 (툴팁)"
}
```

- **새 카테고리/그룹**을 쓰면 사이드바에 **자동으로 새 섹션이 생긴다** (구분선 포함). UI 코드를 건드릴 필요가 없다.
- `mode: "cli"`(localhost를 쓰지 않는 프로그램)인 경우 실행할 명령을 함께 적는다:
  ```jsonc
  "mode": "cli",
  "commands": [
    "python my_tool/run.py --init",
    "python my_tool/run.py --all"
  ]
  ```
  → 클릭 시 명령이 입력된 터미널 창이 열리고, 사이드바 하단의 `Standalone / CLI` 섹션에 `CLI` 배지와 함께 표시된다.
- 추가 후 런처를 재시작(또는 브라우저 새로고침)하면 반영된다. (`/api/programs`는 매 요청마다 `programs.json`을 다시 읽는다.)
