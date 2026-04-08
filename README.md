# myPrograms_with_Claude

Claude와 함께 만드는 각종 유틸리티 프로그램 모음.

각 프로그램은 별도의 하위 폴더로 관리됩니다. 실행하려면 **Node.js**가 필요합니다.

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

---

## 사전 요구사항

- [Node.js](https://nodejs.org) 설치 (npx 명령어 사용)
- [Python 3](https://www.python.org) (Quarter-Car 제어기 연동 시 필요, `pip install numpy`)
