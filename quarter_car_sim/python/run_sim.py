"""
Quarter-Car Suspension Simulator — Control Interface
=====================================================
사용법:
  1. 아래 control_law() 함수를 원하는 제어 알고리즘으로 수정
  2. 터미널에서 실행: python run_sim.py
  3. results/ 폴더에 JSON 파일 생성됨
  4. 웹 시뮬레이터에서 [결과 불러오기] 버튼으로 JSON 로드

운동방정식 (액추에이터 포함):
  ms * z̈s = -ks*(zs - zu) - cs*(żs - żu) + u
  mu * z̈u =  ks*(zs - zu) + cs*(żs - żu) - kt*(zu - zr) - u

  u > 0 : 차체를 위로 미는 힘
  u < 0 : 차체를 아래로 미는 힘
"""

import numpy as np
import json
import os
from datetime import datetime


# ╔══════════════════════════════════════════════════════════════╗
# ║  1. 차량 파라미터 — 필요시 수정                              ║
# ╚══════════════════════════════════════════════════════════════╝

PARAMS = {
    "ms": 250,       # Sprung mass (kg)
    "mu": 35,        # Unsprung mass (kg)
    "ks": 15000,     # Spring rate (N/m)
    "cs": 1500,      # Damping coefficient (Ns/m)
    "kt": 150000,    # Tire stiffness (N/m)
}


# ╔══════════════════════════════════════════════════════════════╗
# ║  2. 노면 프로파일 설정 — 필요시 수정                         ║
# ╚══════════════════════════════════════════════════════════════╝

ROAD = {
    "type": "bump",    # "bump", "step", "sine", "random"
    "height": 0.05,    # 노면 높이 (m)
    "speed": 16.67,    # 차량 속도 (m/s) = 60 km/h
}

DURATION = 4.0     # 시뮬레이션 시간 (s)
DT = 0.0005        # 적분 시간 간격 (s)


# ╔══════════════════════════════════════════════════════════════╗
# ║  3. 제어 법칙 — 이 함수만 수정하세요!                        ║
# ║                                                              ║
# ║  아래 예시 중 하나를 주석 해제하거나,                          ║
# ║  직접 작성하세요.                                             ║
# ╚══════════════════════════════════════════════════════════════╝

def control_law(t, zs, dzs, zu, dzu, zr):
    """
    액추에이터 제어 힘 u(t)를 반환합니다.

    Parameters
    ----------
    t   : float — 현재 시간 (s)
    zs  : float — 차체 (sprung mass) 변위 (m)
    dzs : float — 차체 속도 (m/s)
    zu  : float — 휠 (unsprung mass) 변위 (m)
    dzu : float — 휠 속도 (m/s)
    zr  : float — 노면 변위 (m)

    Returns
    -------
    u : float — 액추에이터 힘 (N)
    """

    # ── 예시 1: Skyhook 제어 ──
    c_sky = 2500
    v_rel = dzs - dzu  # 상대 속도
    if dzs * v_rel > 0:
        u = -c_sky * dzs
    else:
        u = 0.0
    return u

    # ── 예시 2: Groundhook 제어 ──
    # c_ground = 3000
    # v_rel = dzs - dzu
    # if dzu * v_rel < 0:
    #     u = c_ground * dzu
    # else:
    #     u = 0.0
    # return u

    # ── 예시 3: PID 제어 ──
    # (PID는 적분항이 필요하므로 global 변수나 클래스 활용)
    # Kp, Kd = 5000, 1500
    # u = -Kp * zs - Kd * dzs
    # return u

    # ── 예시 4: 나중에 PDD-NARX로 교체 ──
    # u = narx_model.predict(...)
    # return u


# ╔══════════════════════════════════════════════════════════════╗
# ║  아래는 시뮬레이션 엔진 — 수정할 필요 없음                    ║
# ╚══════════════════════════════════════════════════════════════╝

# ── 노면 프로파일 생성 ──

def make_road_fn(cfg):
    rtype = cfg["type"]
    h = cfg["height"]
    v = cfg["speed"]

    if rtype == "bump":
        bump_len = 0.3
        bump_dur = bump_len / v
        t0 = 1.0
        def fn(t):
            dt = t - t0
            if dt < 0 or dt > bump_dur:
                return 0.0
            return h * np.sin(np.pi * dt / bump_dur)
        return fn

    elif rtype == "step":
        ramp = 0.02
        t0 = 1.0
        def fn(t):
            dt = t - t0
            if dt < 0:
                return 0.0
            if dt < ramp:
                return h * dt / ramp
            return h
        return fn

    elif rtype == "sine":
        wl = 3.0
        freq = v / wl
        def fn(t):
            return h * np.sin(2 * np.pi * freq * t)
        return fn

    elif rtype == "random":
        rng = np.random.RandomState(12345)
        comps = []
        for _ in range(15):
            wl = 0.5 + rng.rand() * 5
            freq = v / wl
            phase = rng.rand() * 2 * np.pi
            amp = h * (0.3 + 0.7 * rng.rand()) / 15 * 3
            comps.append((freq, phase, amp))
        def fn(t):
            return sum(a * np.sin(2*np.pi*f*t + p) for f, p, a in comps)
        return fn

    else:
        return lambda t: 0.0


# ── RK4 적분 ──

def derivatives(state, zr, u, p):
    zs, dzs, zu, dzu = state
    ms, mu, ks, cs, kt = p["ms"], p["mu"], p["ks"], p["cs"], p["kt"]

    spring = ks * (zs - zu)
    damper = cs * (dzs - dzu)
    tire = kt * (zu - zr)

    ddzs = (-spring - damper + u) / ms
    ddzu = (spring + damper - tire - u) / mu

    return np.array([dzs, ddzs, dzu, ddzu])


def rk4_step(state, zr, zr_mid, zr_next, u, p, dt):
    k1 = derivatives(state, zr, u, p)
    k2 = derivatives(state + 0.5*dt*k1, zr_mid, u, p)
    k3 = derivatives(state + 0.5*dt*k2, zr_mid, u, p)
    k4 = derivatives(state + dt*k3, zr_next, u, p)
    return state + (dt/6) * (k1 + 2*k2 + 2*k3 + k4)


# ── 시뮬레이션 실행 ──

def run_simulation(params, road_fn, duration, dt, use_control=False):
    steps = int(duration / dt)
    output_interval = max(1, steps // 2000)

    time_arr = []
    zs_arr, zu_arr, zr_arr = [], [], []
    dzs_arr, dzu_arr, ddzs_arr = [], [], []
    u_arr = []

    state = np.array([0.0, 0.0, 0.0, 0.0])
    prev_dzs = 0.0

    for i in range(steps + 1):
        t = i * dt
        zr = road_fn(t)

        if i % output_interval == 0:
            ddzs = (state[1] - prev_dzs) / dt if i > 0 else 0.0
            time_arr.append(round(t, 6))
            zs_arr.append(float(state[0]))
            zu_arr.append(float(state[2]))
            zr_arr.append(float(zr))
            dzs_arr.append(float(state[1]))
            dzu_arr.append(float(state[3]))
            ddzs_arr.append(float(ddzs))

            if use_control:
                u_arr.append(float(
                    control_law(t, state[0], state[1], state[2], state[3], zr)
                ))
            else:
                u_arr.append(0.0)

        prev_dzs = state[1]

        if i < steps:
            zs, dzs, zu, dzu = state
            u = control_law(t, zs, dzs, zu, dzu, zr) if use_control else 0.0

            zr_mid = road_fn(t + 0.5*dt)
            zr_next = road_fn(t + dt)
            state = rk4_step(state, zr, zr_mid, zr_next, u, params, dt)

    return {
        "time": time_arr,
        "zs": zs_arr, "zu": zu_arr, "zr": zr_arr,
        "dzs": dzs_arr, "dzu": dzu_arr, "ddzs": ddzs_arr,
        "u": u_arr,
    }


# ── Comfort 지표 계산 ──

def compute_comfort(result, params):
    time = np.array(result["time"])
    zs = np.array(result["zs"])
    zu = np.array(result["zu"])
    zr = np.array(result["zr"])
    ddzs = np.array(result["ddzs"])

    T = time[-1] - time[0]
    dt = T / (len(time) - 1)

    rms_acc = float(np.sqrt(np.trapz(ddzs**2, time) / T))
    rattle = zs - zu
    rms_rattle = float(np.sqrt(np.trapz(rattle**2, time) / T))
    max_rattle = float(np.max(np.abs(rattle)))
    tire_def = zu - zr
    rms_tire = float(np.sqrt(np.trapz(tire_def**2, time) / T))
    max_tire = float(np.max(np.abs(tire_def)))
    max_u = float(np.max(np.abs(result["u"]))) if result["u"] else 0.0
    rms_u = float(np.sqrt(np.mean(np.array(result["u"])**2))) if result["u"] else 0.0

    return {
        "rmsAcc": round(rms_acc, 6),
        "rmsRattle": round(rms_rattle, 6),
        "maxRattle": round(max_rattle, 6),
        "rmsTireDef": round(rms_tire, 6),
        "maxTireDef": round(max_tire, 6),
        "maxForce": round(max_u, 2),
        "rmsForce": round(rms_u, 2),
    }


# ── 메인 ──

def main():
    print("=" * 50)
    print("  Quarter-Car Suspension Simulator")
    print("=" * 50)

    road_fn = make_road_fn(ROAD)

    # Passive (u = 0)
    print("\n[1/2] Passive 시뮬레이션 실행 중...")
    passive = run_simulation(PARAMS, road_fn, DURATION, DT, use_control=False)
    passive_comfort = compute_comfort(passive, PARAMS)
    print(f"  RMS Accel: {passive_comfort['rmsAcc']:.4f} m/s²")
    print(f"  Rattle:    {passive_comfort['maxRattle']*1000:.1f} mm (max)")
    print(f"  Tire Def:  {passive_comfort['maxTireDef']*1000:.1f} mm (max)")

    # Active (u = control_law)
    print("\n[2/2] Active 시뮬레이션 실행 중...")
    active = run_simulation(PARAMS, road_fn, DURATION, DT, use_control=True)
    active_comfort = compute_comfort(active, PARAMS)
    print(f"  RMS Accel: {active_comfort['rmsAcc']:.4f} m/s²")
    print(f"  Rattle:    {active_comfort['maxRattle']*1000:.1f} mm (max)")
    print(f"  Tire Def:  {active_comfort['maxTireDef']*1000:.1f} mm (max)")
    print(f"  Max Force: {active_comfort['maxForce']:.0f} N")

    # 개선율
    if passive_comfort["rmsAcc"] > 0:
        imp = (1 - active_comfort["rmsAcc"] / passive_comfort["rmsAcc"]) * 100
        print(f"\n  -> Accel improvement: {imp:+.1f}%")

    # JSON 저장
    output = {
        "metadata": {
            "created": datetime.now().isoformat(),
            "controller": "control_law (see run_sim.py)",
            "duration": DURATION,
            "dt": DT,
        },
        "params": PARAMS,
        "road": ROAD,
        "passive": {
            "time": passive["time"],
            "zs": passive["zs"],
            "zu": passive["zu"],
            "zr": passive["zr"],
            "ddzs": passive["ddzs"],
            "u": passive["u"],
            "comfort": passive_comfort,
        },
        "active": {
            "time": active["time"],
            "zs": active["zs"],
            "zu": active["zu"],
            "zr": active["zr"],
            "ddzs": active["ddzs"],
            "u": active["u"],
            "comfort": active_comfort,
        },
    }

    out_dir = os.path.join(os.path.dirname(__file__), "..", "results")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "sim_result.json")
    with open(out_path, "w") as f:
        json.dump(output, f)

    size_kb = os.path.getsize(out_path) / 1024
    print(f"\n[OK] 결과 저장: results/sim_result.json ({size_kb:.0f} KB)")
    print("  -> 웹 시뮬레이터에서 [결과 불러오기] 버튼으로 로드하세요")


if __name__ == "__main__":
    main()
