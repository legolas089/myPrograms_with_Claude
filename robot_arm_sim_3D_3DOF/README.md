# 3D 3-DOF Robot Arm Simulator

수직다관절 3-DOF 로봇 암 시뮬레이터. 위치 A(Pick) → B(Place) 의 다양한 3차원 경로를 자동으로 탐색·비교합니다. 기존 [robot_arm_sim](../robot_arm_sim/) 의 2D 2-DOF 기능 집합을 베이스 회전(J1)을 더한 3-DOF 로봇으로 확장하고 Three.js 기반 인터랙티브 iso 뷰를 제공합니다.

## 로봇 정의

| 항목 | 값 |
|---|---|
| 자유도 | 3 (모두 회전관절) |
| J1 (θ1) | 베이스 회전 (수직 Z축 둘레) |
| J2 (θ2) | 상완 피치 (수평면 기준 절대각) |
| J3 (θ3) | 전완 피치 (상완 기준 상대각) |
| 좌표 표현 | 원기둥 (r, z, φ), φ=θ1 |
| 작업공간 | 토러스 (`|L1−L2| ≤ r ≤ L1+L2`, `h0±(L1+L2)`) |

폐루프 평행링크는 시각적으로만 그리며, 독립 DOF는 3 으로 고정됩니다.

### 정기구학

```
r  = L1·cos(θ2) + L2·cos(θ2 + θ3)
x  = r · cos(θ1)
y  = r · sin(θ1)
z  = h0 + L1·sin(θ2) + L2·sin(θ2 + θ3)
```

## 주요 기능

- **6가지 경로 전략** (2D 버전과 동일, 3-DOF 일반화)
  - Joint Linear / Cartesian Linear / Via-Point Spline / Elbow Switch / Cubic Polynomial / Circular Arc
- **2개의 IK 해**: Elbow-Up / Elbow-Down (평면 IK 부분)
- **비용 메트릭**: 관절 이동, 카테시안 길이, 최대 관절 속도, 매끄러움
- **관절 가동 제한**: θ1, θ2, θ3 각각 min/max + 위반 검사
- **인터랙티브 3D 뷰** (Three.js):
  - Iso / Top / Front / Side 카메라 프리셋
  - 마우스 orbit / pan / zoom (OrbitControls)
  - 토러스 형태 작업공간 시각화
  - 평행링크 시각 표현
- **A/B 마커 드래그**: XY-평면(z 고정) 으로 raycast 드래그 + 슬라이더 미세 조정
- **3개의 2D 그래프**: θ1·θ2, θ2·θ3 관절공간 + X·Y top-view 카테시안 궤적
- **CSV 내보내기**: t, time, θ1·θ2·θ3 (rad/deg), x·y·z

## 실행 방법

```bash
cd robot_arm_sim_3D_3DOF
npx http-server . -p 3008 -c-1
```

또는 `Robot Arm Simulator 3D.bat` 더블클릭 → `http://localhost:3008`

## 단위

- 내부 계산: SI [m], [rad]
- UI 입출력: [m], [deg]
- 기본값: `h0=0.5, L1=0.7, L2=0.6 [m]`

## 파일 구조

```
robot_arm_sim_3D_3DOF/
├── index.html
├── css/style.css
├── js/
│   ├── main.js          # 상태/UI/애니메이션 루프
│   ├── kinematics.js    # FK3D / IK3D / 작업공간(torus)
│   ├── pathPlanning.js  # 6 전략 + 비용 메트릭 (3-DOF)
│   ├── renderer3d.js    # Three.js 씬 + 로봇 메쉬 + 카메라 + 드래그
│   ├── graphs.js        # 3개의 2D 플롯
│   └── help.js          # 헬프 모달
├── server.py            # PyInstaller 패키징용 정적 서버 (포트 3008)
├── RobotArmSimulator3D.spec
└── Robot Arm Simulator 3D.bat
```

## 기술 스택

- Vanilla JavaScript (ES6 Modules)
- Three.js 0.175 (importmap 으로 CDN 로드, OrbitControls 포함)
- Canvas 2D API (그래프)
- Python `http.server` (패키징용 정적 서버)

## 참고

- Craig, J.J. *Introduction to Robotics: Mechanics and Control*
- Siciliano et al. *Robotics: Modelling, Planning and Control*
- Spong et al. *Robot Modeling and Control*
- Lynch & Park *Modern Robotics*
