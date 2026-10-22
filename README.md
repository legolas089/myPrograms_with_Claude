# myPrograms_with_Claude

Claude와 함께 만드는 각종 유틸리티 프로그램 모음.

각 프로그램은 별도의 하위 폴더로 관리됩니다. `.bat` 파일을 더블클릭하면 터미널 창 없이 브라우저에서 바로 실행됩니다.

- 서버는 창 없이(`pythonw`, exe 는 `console=False`) 백그라운드에서 돈다. **종료**는 작업 관리자에서 `pythonw.exe`(또는 해당 `.exe`)를 끝낸다.
- 기본 포트가 사용 중이면 다음 빈 포트(+1)로 자동 이동한다. 백엔드 포트(LaTeX OCR 5000 · Article Printer 5001 · Quarter-Car 제어기 8000)는 고정.
- 필요한 것은 아래 [사전 요구사항](#사전-요구사항) 참고.

---

## 통합 런처 (`launcher/`)

모든 프로그램을 한 화면에서 실행·관리하는 통합 UI.

- **왼쪽 패널**: 프로그램을 카테고리별로 나열 (Vehicle Dynamics / Robotics / 3D·CAD / Editors), 그리고 localhost를 쓰지 않는 CLI 프로그램은 하단 `Standalone / CLI` 섹션으로 분리
- **가운데 패널**: 클릭한 프로그램이 Chrome 스타일 탭으로 열림 — 여러 개를 동시에 실행하고 탭을 전환해도 각 프로그램의 상태가 유지됨
- **오른쪽 Downloads 패널**: 상단 Downloads 버튼으로 토글, 다운로드 폴더의 최근 파일을 클릭하면 기본 앱으로 열기 / `Open folder`로 폴더 열기
- 통합 런처 서버 하나(포트 3100)가 저장소 전체를 단일 origin으로 서빙하여 각 웹 프로그램을 iframe으로 임베드 — 프로그램마다 서버를 따로 띄우지 않음
  - 단, 백엔드가 필요한 프로그램 중 **Article Printer 백엔드만** 열 때 자동으로 띄운다 (런처를 닫아도 계속 실행됨). LaTeX OCR(5000)·Quarter-Car Python 제어기(8000)는 런처에서 열면 자동 실행되지 않으므로 각 `.bat` 으로 실행
- CLI 전용인 Conference Program Book은 클릭 시 저장소 루트에서 명령어를 바로 실행하는 터미널 창을 연다
- 프로그램 추가: `launcher/programs.json` 에 항목 하나 추가 (코드 수정 불필요)

**실행**: `Launcher.bat` 더블클릭 (http://localhost:3100) · 상세: [`launcher/README.md`](launcher/README.md)

---

## 프로그램 목록

### 1. STEP Viewer (`step_viewer/`)
3D CAD 파일(.step, .stp) 뷰어

- 드래그 & 드롭 또는 버튼으로 STEP 파일 로드
- Three.js + OpenCascade WASM 기반 3D 렌더링
- 왼쪽 어셈블리 트리에서 파트 탐색
- 파트 클릭 시 초록색 하이라이트
- 거리 측정 도구 (점/선/면 조합) — 단축키 `M` 측정 모드, `Esc` 취소
- 마우스 드래그 회전, 스크롤 줌, 우클릭 팬

**실행**: `STEP Viewer.bat` 또는 `dist/STEPViewer.exe` 더블클릭 (http://localhost:3000)
- `dist/STEPViewer.exe` 는 2026-04 빌드라 2026-10 의 면·모서리 수정이 빠져 있다 — 최신 동작은 `.bat` 으로 실행

### 2. PDF Editor (`pdf_editor/`)
PDF 합치기, 분리, 페이지 순서 변경 도구

- **합치기**: 여러 PDF를 하나로 결합, 드래그로 파일 순서 변경
- **분리 / 정렬**: 페이지 썸네일 미리보기, 드래그로 페이지 순서 변경, 체크박스로 페이지 선택/제외
  - 선택한 페이지를 현재 순서로 저장 (1개 PDF)
  - 선택한 페이지를 각각 개별 PDF로 분리
  - 페이지 범위 지정 분리 (예: 1-3, 5, 7-10)
  - 선택 반전 버튼
- **합치기 / 정렬**: 여러 PDF의 페이지를 한 화면에서 드래그로 섞어 정렬·선택한 뒤 1개 PDF(`merged_sorted.pdf`)로 저장

**실행**: `PDF Editor.bat` 또는 `dist/PDFEditor.exe` 더블클릭 (http://localhost:3001)

### 3. Quarter-Car Suspension Simulator (`quarter_car_sim/`)
2-DOF 쿼터카 서스펜션 시뮬레이터

- 노면 입력(Speed Bump, Step, Sine, Random)에 대한 차량 응답 실시간 시각화
- 교과서 스타일 2D 스키매틱 애니메이션 (ms-ks/cs-mu-kt-타이어)
- 시간 도메인 변위 그래프 + 주파수 응답 (Bode-style log-log)
- Ride Comfort 지표: Sprung Mass Accel, Rattle Space, Tire Deflection
- Set A vs Set B 비교 모드, 프리셋 (승용차/SUV/레이싱카)
- Python 제어기 연동: `python/server.py`의 `control_law()` 함수만 수정하여 Passive vs Active 비교 (웹 UI 의 "Python 제어기" 체크)
  - `.bat`/`.exe` 실행 시 `python/server.py`(포트 8000)가 자동 시작 — PATH 의 Python 과 `numpy` 필요. 수동 실행은 `python/Run Server.bat`
- 독립 실행 스크립트: `python/run_sim.py`(Skyhook) · `python/run_pid.py`(PID) → `results/sim_result.json` → 웹 UI [결과 불러오기]로 비교

**실행**: `Quarter-Car Sim.bat` 또는 `dist/QuarterCarSim.exe` 더블클릭 (http://localhost:3002) · 상세: [`quarter_car_sim/README.md`](quarter_car_sim/README.md)

### 4. Half-Car Suspension Simulator (`half_car_sim/`)
4-DOF 하프카 서스펜션 시뮬레이터

- 전/후 현가 + 차체 CG 수직변위 + 피치 각도 실시간 시각화
- 축간거리 기반 전/후륜 노면 입력 시간지연
- 하프카 스키매틱 애니메이션 (바디 피치 기울기 반영)
- 4개 그래프: 변위, 피치각(°), 현가 스트로크(mm), 주파수 응답(log-log)
- Ride Comfort 지표: CG/피치 가속도, 전/후 현가변위, 전/후 타이어변형
- Set A vs Set B 비교 모드, 프리셋 (승용차/SUV/스포츠카)
- 12개 파라미터 슬라이더 + 전/후 댐핑비·고유진동수·피치 고유진동수 실시간 표시

**실행**: `Half-Car Sim.bat` 또는 `dist/HalfCarSim.exe` 더블클릭 (http://localhost:3003) · 상세: [`half_car_sim/README.md`](half_car_sim/README.md)

### 5. Roll Center Simulator (`roll_center_sim/`)
더블 위시본 서스펜션 프론트뷰 기구학 시뮬레이터

- 4-bar 링키지 기구학으로 Instant Center, Roll Center 실시간 계산
- 프론트뷰 2D 애니메이션 (양측 대칭, IC 구성선, RC 마커, Swing Arm, T₁/T₂ 접지점)
- 범프 트래블에 따른 RC Height, SA Angle, Camber, Track Change 그래프
- Ground Clearance(지상고) 슬라이더: Pivot Y는 차체 기준 상대값
- Kinematic Results 패널: 9개 지표 실시간 표시
- Vehicle Spec 토글: CG Height, Mass, Lateral G 입력 → Load Transfer, Jacking Force
- Set A vs Set B 비교 모드, 프리셋 (Stock Sedan/Lowered/High RC/Parallel)

**실행**: `Roll Center Sim.bat` 또는 `dist/RollCenterSim.exe` 더블클릭 (http://localhost:3004) · 상세: [`roll_center_sim/README.md`](roll_center_sim/README.md)

### 6. 2D Robot Arm Simulator (`robot_arm_sim/`)
2관절 평면 로봇 암 경로 탐색 시뮬레이터

- 위치 A(Pick) → 위치 B(Place) 물체 운반을 위한 다양한 경로 탐색
- 6가지 경로 생성 전략: Joint Linear (MoveJ), Cartesian Linear (MoveL), Via-Point Spline, Elbow Switch, Cubic Polynomial, Circular Arc
- Forward/Inverse Kinematics 실시간 계산 (Elbow-Up / Elbow-Down)
- 관절 각도 제한(θ1/θ2 min/max) 설정 및 위반 검사
- 경로 비용 메트릭: 관절 이동거리, 카테시안 길이, 최대 속도, 매끄러움
- 3개 뷰 동시 시각화: 메인 캔버스(로봇 암 + 경로), 관절공간 플롯(θ1 vs θ2), 카테시안 궤적 플롯
- A/B 위치 캔버스 드래그, 경로 선택/애니메이션 재생, 경로 개수 슬라이더 · 전략별 체크박스, `?` 도움말
- CSV 내보내기 (선택 경로): t, time_s, θ1·θ2 (rad/deg), x·y

**실행**: `Robot Arm Simulator.bat` 또는 `dist/RobotArmSimulator.exe` 더블클릭 (http://localhost:3005) · 상세: [`robot_arm_sim/README.md`](robot_arm_sim/README.md), exe 안내 [`README_exe.md`](robot_arm_sim/README_exe.md)

### 7. 3D 3-DOF Robot Arm Simulator (`robot_arm_sim_3D_3DOF/`)
수직다관절 3-DOF 로봇 암 경로 탐색 시뮬레이터 (2D 버전의 3차원 확장)

- 자유도 3: J1(베이스 회전, Z축) + J2(상완 피치) + J3(전완 피치)
- 정기구학: `r = L1·cos(θ2) + L2·cos(θ2+θ3)`, `x=r·cosθ1`, `y=r·sinθ1`, `z=h0+L1·sinθ2+L2·sin(θ2+θ3)`
- 토러스 형태 작업공간 시각화 (`|L1−L2| ≤ r ≤ L1+L2`)
- 6가지 경로 전략 (2D 버전과 동일, 3-DOF 일반화): MoveJ, MoveL, Via-Point Spline, Elbow Switch, Cubic Polynomial, Circular Arc
- IK 2해 (Elbow-Up / Elbow-Down), 관절 가동 제한(θ1/θ2/θ3 min/max) 위반 검사
- Three.js 인터랙티브 3D 뷰: Iso/Top/Front/Side 프리셋, OrbitControls (orbit/pan/zoom), A/B 마커 XY-평면 raycast 드래그
- 3개 2D 그래프: θ1·θ2 / θ2·θ3 관절공간 + X·Y top-view 카테시안 궤적
- 경로마다 소요 시간(관절 20°/s 기준) 표시, Workspace · Grid 표시 토글, 슬라이더 옆 수치 입력, `?` 도움말
- CSV 내보내기: t, time_s, θ1·θ2·θ3 (rad/deg), 관절 J1~J3 와 끝단 P 의 x·y·z

**실행**: `Robot Arm Simulator 3D.bat` 더블클릭 (http://localhost:3008) — exe 는 저장소에 없음 (`RobotArmSimulator3D.spec` 으로 빌드) · 상세: [`robot_arm_sim_3D_3DOF/README.md`](robot_arm_sim_3D_3DOF/README.md)

### 8. LaTeX Renderer (`latex_renderer/`)
LaTeX 수식 실시간 렌더링 및 이미지 변환 도구

- KaTeX 기반 실시간 수식 렌더링 (입력 즉시 변환)
- 여러 수식 동시 렌더링 (빈 줄로 구분)
- 자동 줄바꿈 (화면 너비에 맞춰 연산자 위치에서 줄바꿈)
- 자동완성: `\` 입력 시 100+ LaTeX 명령어 후보 표시 (↑↓ 선택, Enter 확정)
- 12개 단축 버튼: bmatrix, pmatrix, frac, sum, int, cases, aligned 등
- 자주 쓰는 수식 저장/불러오기 (localStorage)
- Font Size / Line Gap 슬라이더로 캡처용 크기 조절
- Copy PNG 버튼으로 수식을 고해상도 이미지로 클립보드 복사
- **Image → LaTeX OCR**: 논문/교재 수식 캡처 이미지를 LaTeX로 자동 변환 (pix2tex) — Ctrl+V 붙여넣기, 끌어다 놓기, 찾아보기 버튼

**실행**: `LaTeX Renderer.bat` 또는 `dist/LaTeXRenderer.exe` 더블클릭 (http://localhost:3006)
**OCR 사용 시**: Python + `pip install pix2tex flask flask-cors pillow` 필요 — OCR 서버(`server.py`, 포트 5000)는 실행 시 자동 시작되고, 첫 실행 때 모델(약 300MB)을 내려받는다

### 9. Simple CAD Modeler (`cad_modeler/`)
브라우저 3D 모델링 워크벤치 — 도면을 보고 파라미터 기반으로 부품을 만들고, 단계마다 형상 검사와 도면 치수 검증을 하며 STEP/STL 로 저장. 사람이 화면에서 직접 쓰거나, AI 에이전트(Claude·Codex·Gemini 등)가 스크립트 API 로 같은 화면에서 모델링한다.

- **도형**: Box, Cylinder, Sphere, Cone, **Extrude**(2D 다각형 돌출, twist 로 헬리컬 스윕), **Revolve**(반단면 회전체 — 단차·모따기·돔), **원형 패턴**(개수도 파라미터)
- **Boolean**: Union / Subtract / Intersect — three-bvh-csg 기반, 노드 내용 기준 평가 캐시로 바뀐 노드만 다시 계산
- **파라미터 설계 (CATIA 식)**: 이름 있는 파라미터 + `'=hub_d / 2'` 같은 수식 값 + 스케치(선·원호·필렛 자동 접점) + 규칙(어기는 값은 거부)
  - 화면 왼쪽 아래 **파라미터 패널**에서 값을 바꾸면 모델 전체가 다시 계산되고 바로 검사된다 (Undo 한 단계)
- **단계별 형상 검사**: 열린·찢어진 면, 면 방향, 비다양체 모서리, Boolean 실패·효과 없음·분리를 노드마다 검사 → Outliner ⚠ 표시, 상태 줄, `cad.check()`
- **도면 치수 검증표**: 도면 치수를 검증 항목으로 등록 → 수정할 때마다 기대값·실측·전후 비교 표가 자동 갱신 (패널·상태 줄 `치수 n/n ✓`)
- **수치 질의**: 단면(넓이·원 맞춤 지름·구멍), 광선(면 높이·재료 두께), Z축 반지름 범위, 부피·무게중심
- **STEP 참조 모델**: `STEP 열기` 버튼·끌어다 놓기로 불러와 파트별 노드로 분리 (occt-import-js WASM, Web Worker), X-ray 반투명
- **편집**: 축 이동/회전 기즈모(W/E, 스냅), Transform 패널(수식이 걸린 값은 잠김), Undo/Redo (Ctrl+Z/Y)
- **측정 (M)**: 점/선/면 최단거리, 원형 모서리·원통면 지름과 축, 선택 2개 최소거리·간섭(겹친 체적)
- **보기**: Iso/Top/Front/Right/Fit (0/7/1/3/F)
- **저장과 이어서 작업**: 페이지는 열 때마다 **빈 장면**이다. 작업을 멈출 때 `cad_modeler/models/` 에 세 파일을 남긴다
  - `<이름>.build.js` — 파라미터·스케치·규칙·형상·검증표를 만드는 빌드 스크립트 (`await cad.run('models/<이름>.build.js')` 로 다시 생성)
  - `<이름>.stp` (단일 파트) / `.step` (어셈블리) — 결과 형상, 검사 문제가 있으면 저장 거부
  - `<이름>.md` — 작업 기록: 도면 해석, 파라미터 표, 검증 결과, 남은 일
  - 세 파일 모두 git 에 올리지 않는다 (저장소에는 프로그램만). 예외로 예제 `models/propeller.build.js` (헬릭스 4엽 프로펠러), `models/strainer.build.js` (손잡이 달린 돔형 원판)와 그 작업 기록만 들어 있다
- **JSON 저장/불러오기** (Ctrl+S/O): 노드 트리·파라미터·검증표 포함, **STL 내보내기**
- **스크립트 API (`window.cad`)**: 모든 기능을 코드로 — `cad.help()` 로 목록. AI 에이전트 작업 규칙은 [`cad_modeler/AGENTS.md`](cad_modeler/AGENTS.md)

**실행**: `CAD Modeler.bat` 더블클릭 (http://localhost:3007, 포트가 쓰이고 있으면 다음 빈 포트)
- 명령줄: `python cad_modeler/launcher.py --port 3007 [--no-browser]` — `models/` 저장(PUT)은 이 서버가 받는다 (정적 서버로 열면 브라우저 다운로드로 대신됨)
- exe 로 묶으려면 `pyinstaller cad_modeler/CADModeler.spec` (exe 옆의 `models/` 폴더를 쓴다)

### 10. Article Printer (`article_printer/`)
뉴스·위키·블로그 링크를 붙여넣으면 광고·메뉴를 뺀 본문만 추출해 한 개의 PDF로 묶어 인쇄하는 도구

- 링크를 한 줄에 하나씩, 한 번에 최대 10개까지 입력 → 병렬로 가져와 문서 목록에 표시
- 본문 추출: 사이트별 어댑터 → `trafilatura` → `readability-lxml` 순으로 시도
  - 위키백과·네이버 블로그는 본문 컨테이너를 직접 읽어 제목·그림·표를 보존 (네이버 블로그는 바깥 프레임이 아닌 실제 본문 페이지 PostView를 자동으로 찾음)
  - 조선일보처럼 본문을 JS로 그리는 Arc XP 사이트는 페이지에 내장된 기사 JSON에서 추출
  - 네이버 뉴스·나무위키는 정리 규칙을 적용한 뒤 자동 추출
  - 저작권 문구·기자 이메일 같은 꼬리 문단은 자동으로 체크 해제
- 문서 목록: ▲▼로 순서 변경, ✕ 삭제, 실패한 문서는 ↻ 다시 시도 / ✎ 직접 입력으로 대체
- 문단 단위 편집: 체크박스로 포함/제외, Shift+클릭 범위 선택, "여기 위/아래 모두 제외"로 원하는 구역만 남기기, 전체 선택 / 전체 해제 / 이미지 모두 제외
- 자동 추출이 안 되는 페이지(로그인·JS 전용·봇 차단)는 **직접 입력**으로 본문 텍스트나 페이지 소스 HTML을 붙여넣기
- 인쇄 옵션: 이미지 포함, 출처·날짜·기자 표시, 문서마다 새 페이지, 첫 장 목차, 글자 크기·줄 간격, 파일 이름
- **PDF 저장**: 로컬 Chrome/Edge 헤드리스로 렌더링해 `Downloads` 폴더에 한 개의 PDF로 저장 (텍스트 선택 가능)
- **전체 미리보기 / 브라우저 인쇄**: 완성 문서를 화면 안 미리보기 창에 띄우고, 브라우저 인쇄 대화상자로 프린터 출력 또는 PDF 저장 (Chrome/Edge가 없을 때의 대안)
- 통합 런처에서 열면 백엔드(`server.py`, 포트 5001)를 자동으로 띄움

**실행**: `Article Printer.bat` 더블클릭 (http://localhost:5001 — 고정 포트, 이미 실행 중이면 브라우저만 연다)

**의존성**: `pip install flask flask-cors requests trafilatura readability-lxml`

### 11. Conference Program Book (`conference_programbook/`)
학회 제출 엑셀을 프로그램북 작업 파일로 자동 변환·검증하는 Python CLI 파이프라인

- `input_raw.xlsx` (학회 submission 원본) → `program_book_working.xlsx` (다중 시트 통합 작업본)
- "포맷팅 도우미" 설계: 완전 자동 배치가 아닌 사용자 배정값 검증 + 출력 시트 자동 생성
- 6단계 파이프라인 (Step 5는 Step 4에 통합, 번호는 작업 이력 흔적)
  - Step 1: 데이터 정제 (제목 병합, 중복 제거, 미등록/미납 분리, 발표분야 오타 교정)
  - Step 2: 랩/소속 식별 (직위 기반 랩대표 판정, 4대 과기원 영문 약칭, `lab_id` 생성)
  - Step 3: 제약조건 플래그 (다중 발표자, 특별 세션, 좌장 요청) + `입력_좌장Invited` 템플릿
  - Step 4: 배정 검증 (배정값 오류·슬롯 중복·발표자 시간 충돌) + `설정_시간대`/`입력_논문배정` 템플릿
  - Step 6: 최종 출력 (세션 코드 `KSME 26CA-...`, 구두/포스터 명단, 시간표 매트릭스, 세부일정, 포스터 세션 배치)
- 시트 분류: 사용자 편집 시트(재실행 시 보존) / `_` 접두 중간 시트(덮어씀) / 최종 출력 시트(한글 복붙용)
- 필요 패키지: `pandas`, `openpyxl`

**실행** (브라우저·`.bat` 없음, 터미널 CLI 전용) — 작업 파일 경로가 현재 폴더 기준이므로 **폴더 안에서** 실행:
```bash
cd conference_programbook
python generate_program.py --init      # 최초 1회 (input_raw.xlsx → program_book_working.xlsx, 이미 있으면 건너뜀)
python generate_program.py --step all  # 또는 --step 1|2|3|4|6 개별 실행
```
- 저장소에는 예시 `input_raw.xlsx` · `program_book_working.xlsx` 가 들어 있다
상세 내용은 [`conference_programbook/README.md`](conference_programbook/README.md) 참고.

---

## 사전 요구사항

| 필요한 것 | 어디에 | 비고 |
|---|---|---|
| **Windows** | `.bat` 실행 | `.bat` 은 `pythonw` 로 서버를 띄운다. 다른 OS 에서는 `python <폴더>/launcher.py` (또는 `server.py`) 를 직접 실행 |
| **[Python 3](https://www.python.org)** (`python` · `pythonw` 가 PATH 에 있어야 함) | 통합 런처와 모든 웹 프로그램 | 서버는 표준 라이브러리만 사용 |
| **Chrome / Edge 등 최신 브라우저** | 모든 웹 프로그램 | WebGL · WebAssembly · ES 모듈 사용 |
| **인터넷 연결** | STEP Viewer, PDF Editor, LaTeX Renderer, CAD Modeler, 3D Robot Arm, 통합 런처(아이콘) | 아래 표의 브라우저 라이브러리를 CDN(unpkg · esm.sh · jsdelivr)에서 받는다 |

프로그램별로 쓰는 라이브러리:

| 프로그램 | Python 패키지 (`pip install`) | 브라우저 라이브러리 (CDN, 설치 불필요 · 인터넷 필요) |
|---|---|---|
| 통합 런처 | — (표준 라이브러리) | Tabler Icons 3.11.0 |
| STEP Viewer | — | three.js 0.175.0, occt-import-js 0.0.23 (OpenCascade WASM) |
| PDF Editor | — | pdf-lib 1.17.1, pdf.js (pdfjs-dist) 3.11.174 |
| Quarter-Car Sim | 제어기 연동 시 `numpy` | — |
| Half-Car Sim · Roll Center Sim · 2D Robot Arm | — | — (외부 라이브러리 없음, 오프라인 동작) |
| 3D Robot Arm | — | three.js 0.175.0 |
| LaTeX Renderer | OCR 사용 시 `pix2tex flask flask-cors pillow` (pix2tex 가 PyTorch 를 함께 설치 — 용량 큼) | KaTeX 0.16.11, html2canvas 1.4.1 |
| CAD Modeler | — | three.js 0.175.0, three-mesh-bvh 0.7.8, three-bvh-csg 0.0.16, occt-import-js 0.0.23 |
| Article Printer | `flask flask-cors requests trafilatura readability-lxml` (lxml 포함) | — (PDF 저장은 로컬 Chrome/Edge 헤드리스, 인쇄 글꼴 Pretendard 는 설치돼 있으면 사용) |
| Conference Program Book | `pandas openpyxl` | — |

- exe 를 직접 빌드하려면 `pip install pyinstaller` 후 각 폴더의 `.spec` 으로 `pyinstaller <이름>.spec`.

- Node.js 는 필요 없다 (`.claude/launch.json` 의 일부 개발용 미리보기 설정만 `npx http-server` 를 쓴다).
- 포트: 통합 런처 3100, 각 프로그램 3000~3008 (쓰이고 있으면 다음 빈 포트), LaTeX OCR 서버 5000 · Article Printer 5001 · Quarter-Car 제어기 8000 (고정).
- 저장소에 없는 것: `cad_modeler/models/` 의 설계 결과물(빌드 스크립트·작업 기록·STEP)은 커밋하지 않는다. 예제(propeller, strainer)만 빌드 스크립트와 작업 기록으로 들어 있고, 모델은 빌드 스크립트로 다시 만든다.

## 실행 방법

| 방법 | 설명 |
|------|------|
| `.bat` 더블클릭 | 터미널 창 없이 브라우저에서 바로 실행 (Python 필요) |
| `dist/*.exe` 더블클릭 | 독립 실행 파일 (Python 불필요, 단 Quarter-Car 제어기·LaTeX OCR 기능은 PATH 의 Python 을 찾아 쓴다) — 저장소에 들어 있는 것: STEP Viewer, PDF Editor, Quarter-Car, Half-Car, Roll Center, 2D Robot Arm, LaTeX Renderer |
