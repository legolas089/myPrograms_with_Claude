# Quarter-Car Suspension Simulator

2-DOF 쿼터카 서스펜션 시뮬레이터. 노면 입력에 대한 차량 응답을 실시간으로 시각화하고, Python 제어기를 연동하여 Passive vs Active 비교가 가능합니다.

## 구조

```
quarter_car_sim/
├── index.html              # 메인 페이지
├── css/style.css           # 다크 테마 스타일
├── js/
│   ├── main.js             # UI, 이벤트, Python 서버 연동
│   ├── simulation.js       # RK4 솔버, 주파수 응답, Comfort 지표
│   ├── road.js             # 노면 프로파일 (bump/step/sine/random)
│   ├── animation.js        # 2D 쿼터카 다이어그램 애니메이션
│   └── graphs.js           # 변위/주파수응답/u(t) 그래프
│
├── python/
│   ├── server.py           # 제어기 서버 (웹 시뮬레이터 연동)
│   ├── run_sim.py          # 독립 실행 (Skyhook 예시)
│   ├── run_pid.py          # PID 제어기 독립 실행
│   ├── requirements.txt    # numpy
│   └── Run Server.bat      # 서버 실행 배치
│
├── results/                # Python이 생성한 JSON 결과 파일
├── Quarter-Car Sim.bat     # 웹 서버 실행 (port 3002)
└── README.md
```

## 운동방정식

```
ms * z̈s = -ks(zs - zu) - cs(żs - żu) + u
mu * z̈u =  ks(zs - zu) + cs(żs - żu) - kt(zu - zr) - u
```

- `ms`, `mu` : Sprung / Unsprung mass
- `ks`, `cs` : Spring rate / Damping coefficient
- `kt` : Tire stiffness
- `zr` : 노면 입력, `u` : 액추에이터 힘

## 사용법

### 기본 (Passive 시뮬레이션)

1. `Quarter-Car Sim.bat` 실행 (http://localhost:3002)
2. 파라미터 조정 → 노면 선택 → [시작]
3. Set A / Set B 비교 모드 가능

### Python 제어기 연동

1. `python/server.py` 상단의 `control_law()` 함수 수정
2. `python/Run Server.bat` 실행 (port 8000)
3. 웹에서 [Python 제어기] 체크 → [시작]
4. 시뮬레이터가 노면 데이터를 Python에 전송 → Passive vs Active 비교

### 독립 실행 (JSON 내보내기)

```bash
cd python
python run_pid.py     # PID 제어기
python run_sim.py     # Skyhook 제어기
```

→ `results/sim_result.json` 생성 → 웹에서 [결과 불러오기]로 로드

## 기능

| 기능 | 설명 |
|------|------|
| 파라미터 슬라이더 | ms, mu, ks, cs, kt + 감쇠비/고유진동수 표시 |
| 노면 프로파일 | Speed Bump, Step, Sine Wave, Random |
| 비교 모드 | Set A vs Set B 동시 애니메이션 |
| 교과서 다이어그램 | ms-ks/cs-mu-kt-타이어 스키매틱 |
| 시간 도메인 그래프 | zs, zu, zr 변위 |
| 주파수 응답 | Sprung Accel, Rattle Space, Tire Deflection |
| u(t) 그래프 | 제어 입력 시계열 (Python 연동 시) |
| Ride Comfort | RMS 가속도, Rattle Space, Tire Deflection + 수식 툴팁 |
| Python 서버 | control_law() 함수만 수정하여 제어기 교체 |
| 프리셋 | 승용차 / SUV / 레이싱카 |

## Python 제어기 작성법

`python/server.py`의 `control_law()` 함수를 수정합니다:

```python
def control_law(t, zs, dzs, zu, dzu, zr, dt):
    """
    t   : 현재 시간 (s)
    zs  : 차체 변위 (m)
    dzs : 차체 속도 (m/s)
    zu  : 휠 변위 (m)
    dzu : 휠 속도 (m/s)
    zr  : 노면 변위 (m)
    dt  : 시간 간격 (s)

    return: u (액추에이터 힘, N)
    """
    u = -Kp * zs - Kd * dzs   # 예: PD 제어
    return u
```

웹 시뮬레이터의 모든 노면에서 동작합니다.
