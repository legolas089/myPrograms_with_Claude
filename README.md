# myPrograms_with_Claude

Claude와 함께 만드는 각종 유틸리티 프로그램 모음.

각 프로그램은 별도의 하위 폴더로 관리됩니다. `.bat` 파일을 더블클릭하면 터미널 창 없이 브라우저에서 바로 실행됩니다.

---

## 프로그램 목록

### 1. STEP Viewer (`step-viewer/`)
3D CAD 파일(.step, .stp) 뷰어

- 드래그 & 드롭 또는 버튼으로 STEP 파일 로드
- Three.js + OpenCascade WASM 기반 3D 렌더링
- 왼쪽 어셈블리 트리에서 파트 탐색
- 파트 클릭 시 초록색 하이라이트
- 거리 측정 도구 (점/선/면 조합)
- 마우스 드래그 회전, 스크롤 줌, 우클릭 팬

**실행**: `STEP Viewer.bat` 더블클릭 (http://localhost:3000)

### 2. PDF Editor (`pdf_editor/`)
PDF 합치기, 분리, 페이지 순서 변경 도구

- **합치기**: 여러 PDF를 하나로 결합, 드래그로 파일 순서 변경
- **분리 / 정렬**: 페이지 썸네일 미리보기, 드래그로 페이지 순서 변경, 체크박스로 페이지 선택/제외
  - 선택한 페이지를 현재 순서로 저장 (1개 PDF)
  - 선택한 페이지를 각각 개별 PDF로 분리
  - 페이지 범위 지정 분리 (예: 1-3, 5, 7-10)

**실행**: `PDF Editor.bat` 더블클릭 (http://localhost:3001)

### 3. Quarter-Car Suspension Simulator (`quarter_car_sim/`)
2-DOF 쿼터카 서스펜션 시뮬레이터

- 노면 입력(Speed Bump, Step, Sine, Random)에 대한 차량 응답 실시간 시각화
- 교과서 스타일 2D 스키매틱 애니메이션 (ms-ks/cs-mu-kt-타이어)
- 시간 도메인 변위 그래프 + 주파수 응답 (Bode-style log-log)
- Ride Comfort 지표: Sprung Mass Accel, Rattle Space, Tire Deflection
- Set A vs Set B 비교 모드, 프리셋 (승용차/SUV/레이싱카)
- Python 제어기 연동: `server.py`의 `control_law()` 함수만 수정하여 Passive vs Active 비교
- 독립 실행 스크립트: PID / Skyhook 제어기 → JSON 결과 내보내기

**실행**: `Quarter-Car Sim.bat` 더블클릭 (http://localhost:3002)

### 4. Half-Car Suspension Simulator (`half_car_sim/`)
4-DOF 하프카 서스펜션 시뮬레이터

- 전/후 현가 + 차체 CG 수직변위 + 피치 각도 실시간 시각화
- 축간거리 기반 전/후륜 노면 입력 시간지연
- 하프카 스키매틱 애니메이션 (바디 피치 기울기 반영)
- 4개 그래프: 변위, 피치각(°), 현가 스트로크(mm), 주파수 응답(log-log)
- Ride Comfort 지표: CG/피치 가속도, 전/후 현가변위, 전/후 타이어변형
- Set A vs Set B 비교 모드, 프리셋 (승용차/SUV/스포츠카)
- 12개 파라미터 슬라이더 + 전/후 댐핑비·고유진동수·피치 고유진동수 실시간 표시

**실행**: `Half-Car Sim.bat` 더블클릭 (http://localhost:3003)

### 5. Roll Center Simulator (`roll_center_sim/`)
더블 위시본 서스펜션 프론트뷰 기구학 시뮬레이터

- 4-bar 링키지 기구학으로 Instant Center, Roll Center 실시간 계산
- 프론트뷰 2D 애니메이션 (양측 대칭, IC 구성선, RC 마커, Swing Arm, T₁/T₂ 접지점)
- 범프 트래블에 따른 RC Height, SA Angle, Camber, Track Change 그래프
- Ground Clearance(지상고) 슬라이더: Pivot Y는 차체 기준 상대값
- Kinematic Results 패널: 9개 지표 실시간 표시
- Vehicle Spec 토글: CG Height, Mass, Lateral G 입력 → Load Transfer, Jacking Force
- Set A vs Set B 비교 모드, 프리셋 (Stock Sedan/Lowered/High RC/Parallel)

**실행**: `Roll Center Sim.bat` 더블클릭 (http://localhost:3004)

### 6. 2D Robot Arm Simulator (`robot_arm_sim/`)
2관절 평면 로봇 암 경로 탐색 시뮬레이터

- 위치 A(Pick) → 위치 B(Place) 물체 운반을 위한 다양한 경로 탐색
- 6가지 경로 생성 전략: Joint Linear (MoveJ), Cartesian Linear (MoveL), Via-Point Spline, Elbow Switch, Cubic Polynomial, Circular Arc
- Forward/Inverse Kinematics 실시간 계산 (Elbow-Up / Elbow-Down)
- 관절 각도 제한(θ1/θ2 min/max) 설정 및 위반 검사
- 경로 비용 메트릭: 관절 이동거리, 카테시안 길이, 최대 속도, 매끄러움
- 3개 뷰 동시 시각화: 메인 캔버스(로봇 암 + 경로), 관절공간 플롯(θ1 vs θ2), 카테시안 궤적 플롯
- A/B 위치 캔버스 드래그, 경로 선택/애니메이션 재생

**실행**: `Robot Arm Simulator.bat` 더블클릭 (http://localhost:3005)

### 7. LaTeX Renderer (`latex_renderer/`)
LaTeX 수식 실시간 렌더링 및 이미지 변환 도구

- KaTeX 기반 실시간 수식 렌더링 (입력 즉시 변환)
- 여러 수식 동시 렌더링 (빈 줄로 구분)
- 자동 줄바꿈 (화면 너비에 맞춰 연산자 위치에서 줄바꿈)
- 자동완성: `\` 입력 시 100+ LaTeX 명령어 후보 표시 (↑↓ 선택, Enter 확정)
- 12개 단축 버튼: bmatrix, pmatrix, frac, sum, int, cases, aligned 등
- 자주 쓰는 수식 저장/불러오기 (localStorage)
- Font Size / Line Gap 슬라이더로 캡처용 크기 조절
- Copy PNG 버튼으로 수식을 고해상도 이미지로 클립보드 복사
- **Image → LaTeX OCR**: 논문/교재 수식 캡처 이미지를 LaTeX로 자동 변환 (pix2tex)

**실행**: `LaTeX Renderer.bat` 더블클릭 (http://localhost:3006)
**OCR 사용 시**: Python + `pip install pix2tex flask flask-cors` 필요

### 8. Conference Program Book (`conference-programbook/`)
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

**실행** (브라우저·`.bat` 없음, 터미널 CLI 전용):
```bash
python conference-programbook/generate_program.py --init    # 최초 1회
python conference-programbook/generate_program.py --step all
```
상세 내용은 [`conference-programbook/README.md`](conference-programbook/README.md) 참고.

---

## 사전 요구사항

- [Node.js](https://nodejs.org) 설치 (npx 명령어 사용)
- [Python 3](https://www.python.org) (Quarter-Car 제어기 연동, LaTeX OCR 사용 시 필요)

## 실행 방법

| 방법 | 설명 |
|------|------|
| `.bat` 더블클릭 | 터미널 창 없이 브라우저에서 바로 실행 |
| `.exe` 더블클릭 | 독립 실행 파일 (Node.js 불필요) |
