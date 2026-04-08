# 2D Robot Arm Simulator

2관절 평면 로봇 암 시뮬레이터. 위치 A에서 위치 B로 물체를 옮기기 위한 다양한 경로를 탐색하고 비교합니다.

## 주요 기능

- **2-DOF 평면 로봇 암**: Forward/Inverse Kinematics 실시간 계산
- **드래그 가능한 위치 A/B**: 캔버스에서 직접 드래그하여 목표 위치 설정
- **6가지 경로 생성 전략**:
  1. Joint Linear (관절공간 선형보간) — MoveJ/PTP
  2. Cartesian Linear (카테시안 선형보간) — MoveL/LIN
  3. Via-Point Spline (경유점 스플라인 경로)
  4. Elbow Switch (팔꿈치 구성 전환)
  5. Cubic Polynomial (3차 다항식 궤적)
  6. Circular Arc (관절공간 원호 경로)
- **경로 비용 메트릭**: 관절 이동거리, 카테시안 경로 길이, 매끄러움 기반 비용 계산 및 순위
- **시각화**: 메인 캔버스(로봇 암 + 경로), 관절공간 플롯(θ1 vs θ2), 카테시안 궤적 플롯
- **애니메이션**: 선택 경로를 따라 암 이동 + 박스 운반 애니메이션

## 실행 방법

```bash
cd robot_arm_sim
npx http-server . -p 3005 -c-1
```

또는 `Robot Arm Simulator.bat` 실행

브라우저에서 http://localhost:3005 접속

## 파일 구조

```
robot_arm_sim/
├── index.html          # 페이지 구조
├── css/style.css       # 다크 테마 CSS
├── js/
│   ├── main.js         # 상태 관리, UI, 애니메이션 루프
│   ├── kinematics.js   # FK, IK, 작업공간 경계
│   ├── pathPlanning.js # 6가지 경로 생성 전략
│   ├── renderer.js     # 메인 캔버스 렌더링
│   └── graphs.js       # 관절공간 + 카테시안 그래프
└── README.md
```

## 사전 요구사항

- Node.js (npx http-server 사용)
