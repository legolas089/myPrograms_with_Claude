# 2D Robot Arm Simulator

2관절(2-DOF) 평면 로봇 암 시뮬레이터. 위치 A(Pick)에서 위치 B(Place)로 물체를 옮기기 위한 다양한 관절 각도 경로를 탐색하고 비교합니다.

최종 목표는 다물체동역학(MBD) 툴로 로봇 암 응력을 해석하는 것이며, 그 전 단계로 기하학적으로 다양한 경로를 탐색하는 것이 목적입니다.

## 주요 기능

### 로봇 암 기구학
- **Forward Kinematics**: 관절 각도 (θ1, θ2) → 말단장치 위치 (x, y)
- **Inverse Kinematics**: 목표 위치 (x, y) → 관절 각도, 기하학적 접근법 (Law of Cosines)
- **2개의 IK 해**: Elbow-Up / Elbow-Down 구성
- **작업공간 시각화**: 환형(annular) 영역으로 도달 가능 범위 표시

### 6가지 경로 생성 전략

각 전략은 로봇공학 교과서 및 산업 로봇 모션 명령에 기반합니다.

| # | 전략 | 산업 명령어 | 교과서 근거 | 특성 |
|---|------|-----------|-----------|------|
| 1 | **Joint Linear** | MoveJ / PTP | Craig Ch.7, Siciliano Ch.4 | 관절공간 직선 보간. IK 불필요, 특이점 면역 |
| 2 | **Cartesian Linear** | MoveL / LIN | Craig Ch.7, Lynch Ch.9 | 카테시안 직선 경로. 매 스텝 IK 적용 |
| 3 | **Via-Point Spline** | Zone/APO/CNT | Craig Ch.7, Spong Ch.7 | 랜덤 경유점을 거치는 Bezier 곡선 경로 |
| 4 | **Elbow Switch** | confdata/STATUS | Craig Ch.4, Siciliano Ch.2 | Elbow-Up ↔ Down 시그모이드 블렌드 전환 |
| 5 | **Cubic Polynomial** | 내부 보간 엔진 | Craig Ch.7, Spong Ch.7 | 경계 속도 조건에 따른 3차 다항식 궤적 |
| 6 | **Circular Arc** | MoveC / CIRC 변형 | Craig Ch.7, Siciliano Ch.4 | 관절공간 원호 경로, FK 비선형성 탐색 |

### 경로 비용 메트릭
경로를 4가지 기준으로 평가하여 순위를 매깁니다:
- **관절 이동 거리** (총 회전량, rad) — 가중치 1.0
- **카테시안 경로 길이** (말단 이동 거리, px) — 가중치 0.005
- **최대 관절 속도** (피크 토크 관련) — 가중치 5.0
- **매끄러움** (2차 차분 = 가속도 변화) — 가중치 3.0

### 관절 각도 제한 (Joint Limits)
- θ1, θ2 각각의 min/max 값을 슬라이더로 설정
- 활성화 시 관절공간 그래프에 허용 영역(빨간 점선 사각형) 표시
- 메인 캔버스에 제한된 작업공간 경계(주황 점선) 표시
- 경로별 위반 검사: 제한 준수 경로 우선 정렬, 위반 경로는 ✗ 표시

### 인터랙션
- **드래그**: 캔버스에서 위치 A(빨간점) / B(초록점) 직접 드래그
- **슬라이더**: 암 길이(L1, L2), 위치 좌표, 관절 제한, 경로 수, 속도 조절
- **경로 선택**: 경로 목록 클릭 → 해당 경로 하이라이트 + 상세 정보
- **애니메이션**: Play 버튼으로 선택 경로를 따라 암 이동 + 박스 운반

### 시각화 (3개 뷰)
- **메인 캔버스**: 로봇 암, 작업공간, 모든 경로 궤적(색상별), A/B 마커, 박스
- **관절공간 그래프**: θ1 vs θ2 좌표에 모든 경로 표시 + 관절 제한 영역
- **카테시안 궤적 그래프**: X vs Y 좌표에 말단장치 경로 표시

## 실행 방법

```bash
cd robot_arm_sim
npx http-server . -p 3005 -c-1
```

또는 `Robot Arm Simulator.bat` 더블클릭

브라우저에서 http://localhost:3005 접속

## 사용 방법

1. **암 파라미터 설정**: L1, L2 슬라이더로 링크 길이 조절
2. **(선택) 관절 제한 설정**: "Enable Joint Limits" 체크 후 θ1/θ2 min/max 설정
3. **위치 설정**: 슬라이더 또는 캔버스 드래그로 A(Pick), B(Place) 위치 지정
4. **경로 탐색**: "Explore Paths" 클릭 → 다양한 경로 생성 및 비용 순위
5. **경로 비교**: 경로 목록에서 클릭하여 개별 경로 분석
6. **애니메이션**: "Play" 버튼으로 선택 경로 애니메이션 재생

## 파일 구조

```
robot_arm_sim/
├── index.html              # 페이지 구조 (좌측 패널 + 메인 캔버스 + 그래프)
├── css/style.css           # 다크 테마 CSS
├── js/
│   ├── main.js             # 상태 관리, UI 이벤트, 애니메이션 루프
│   ├── kinematics.js       # FK, IK (elbow-up/down), 작업공간 경계
│   ├── pathPlanning.js     # 6가지 경로 생성 전략, 비용 메트릭, 관절 제한 검사
│   ├── renderer.js         # 메인 캔버스 렌더링 (암, 경로, 마커, 작업공간)
│   └── graphs.js           # 관절공간 플롯 + 카테시안 궤적 플롯
├── Robot Arm Simulator.bat # Windows 실행 스크립트
└── README.md
```

## 기술 스택

- Vanilla JavaScript (ES6 Modules)
- Canvas 2D API
- `npx http-server` (정적 파일 서버)

## 참고 문헌

- Craig, J.J. *Introduction to Robotics: Mechanics and Control* (4th ed.) — Ch.4 (IK), Ch.7 (Trajectory)
- Siciliano, B. et al. *Robotics: Modelling, Planning and Control* — Ch.2 (IK), Ch.4 (Trajectory)
- Spong, M.W. et al. *Robot Modeling and Control* — Ch.3 (IK), Ch.7 (Trajectory)
- Lynch, K.M. & Park, F.C. *Modern Robotics* — Ch.6 (IK), Ch.9 (Trajectory)
- ABB RAPID (`MoveJ`, `MoveL`, `MoveC`), KUKA KRL (`PTP`, `LIN`, `CIRC`), FANUC TP, UR Script

## 사전 요구사항

- [Node.js](https://nodejs.org) (npx http-server 사용)
