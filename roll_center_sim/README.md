# Roll Center Simulator

더블 위시본 서스펜션 프론트뷰 기구학 시뮬레이터. 범프 트래블에 따른 Roll Center, Instant Center, Swing Arm, Camber 등의 변화를 실시간으로 시각화합니다.

## 구조

```
roll_center_sim/
├── index.html              # 메인 페이지
├── css/style.css           # 다크 테마 스타일
├── js/
│   ├── main.js             # UI, 이벤트, 프리셋, 범프 스윕 애니메이션
│   ├── geometry.js         # 4-bar 링키지 기구학, IC/RC/SA/Camber/KPI 계산
│   ├── animation.js        # 2D 프론트뷰 서스펜션 캔버스 렌더링
│   └── graphs.js           # RC Height, SA Angle, Camber, Track Change 그래프
│
├── Roll Center Sim.bat     # 웹 서버 실행 (port 3004)
└── README.md
```

## 기구학 모델

### 좌표계
- x: 횡방향 (0 = 차량 중심선, 양수 = 아웃보드/오른쪽)
- y: 수직 (0 = 지면, 양수 = 위)

### 주요 점
- **P1**: Lower arm inner pivot (차체 마운트)
- **P2**: Upper arm inner pivot (차체 마운트)
- **P3**: Lower ball joint (너클 하단)
- **P4**: Upper ball joint (너클 상단)
- **IC**: Instant Center (P1-P3 연장선과 P2-P4 연장선의 교점)
- **RC**: Roll Center (좌/우 타이어 접지점에서 각 IC로의 직선 교점)

### 4-Bar 링키지 풀이
범프 시 lower arm 각도 변화 → P3 위치 계산 → 원-원 교차(circle-circle intersection)로 P4 결정 → IC, RC, Swing Arm 등 계산

### 계산 항목
| 항목 | 설명 |
|------|------|
| RC Height | Roll Center 높이 (지면 기준) |
| IC Position | Instant Center 좌표 (x, y) |
| Swing Arm Length | IC에서 타이어 접지점까지 거리 |
| Swing Arm Angle | IC-접지점 직선의 수평 각도 |
| Camber | 너클(P3-P4) 직선의 수직 대비 각도 |
| Camber Gain | 정적 위치 대비 캠버 변화량 |
| KPI | Kingpin Inclination (너클 기울기) |
| Scrub Radius | KPI 직선 지면 교점과 타이어 접지 중심 거리 |
| Track Change | 정적 위치 대비 접지점 횡방향 이동량 |

### Vehicle Spec (선택 입력)
체크박스 활성화 시 추가 입력/결과 표시:

| 항목 | 설명 |
|------|------|
| Geometric Transfer | RC 높이 기반 기하학적 하중 이동 |
| Elastic Transfer | 스프링/댐퍼에 의한 탄성 하중 이동 |
| Geo Ratio | RC Height / CG Height (기하학적 하중 이동 비율) |
| Jacking Force | Swing Arm 각도에 의한 수직 방향 반력 |

## 사용법

1. `Roll Center Sim.bat` 실행 (http://localhost:3004)
2. 파라미터 슬라이더 조정 → 실시간 업데이트
3. [Sweep] 버튼으로 전체 범프 범위 애니메이션
4. Set A / Set B 비교 모드 가능
5. Vehicle Spec 체크 시 Load Transfer 결과 추가 표시

## 기능

| 기능 | 설명 |
|------|------|
| 파라미터 슬라이더 | Half Track, Ground Clearance(지상고), Lower/Upper Arm (pivot X/Y, length, angle), Bump Range |
| 프리셋 | Stock Sedan / Lowered / High RC / Parallel Arms / 사용자 정의 |
| 프론트뷰 애니메이션 | 양측 대칭 서스펜션, IC 구성선(점선), RC 마커, Swing Arm 선, T₁/T₂ 접지점 |
| 그래프 (2×2) | RC Height, SA Angle, Camber, Track Change vs Bump |
| 범프 스윕 | 자동 범프 범위 순회 애니메이션 + 수동 슬라이더 |
| 비교 모드 | Set A vs Set B 동시 표시 |
| Vehicle Spec | CG Height, Mass, Lateral G → Load Transfer, Jacking Force (토글) |
| Kinematic Results | 현재 범프 위치에서의 9개 기구학 지표 실시간 표시 |
