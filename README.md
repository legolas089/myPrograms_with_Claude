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

---

## 사전 요구사항

- [Node.js](https://nodejs.org) 설치 (npx 명령어 사용)
- [Python 3](https://www.python.org) (Quarter-Car 제어기 연동 시 필요, `pip install numpy`)
