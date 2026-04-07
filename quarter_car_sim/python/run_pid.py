"""
Quarter-Car Suspension — PID Controller
========================================
사용법:
  1. 아래 PID 게인 (Kp, Ki, Kd) 수정
  2. 터미널에서 실행: python run_pid.py
  3. results/sim_result.json 생성
  4. 웹 시뮬레이터에서 [결과 불러오기] 버튼으로 로드

제어 목표: 차체 가속도(승차감) 최소화
  u = -Kp * zs  -  Ki * integral(zs)  -  Kd * dzs
"""

import numpy as np
import json
import os
from datetime import datetime


# ╔══════════════════════════════════════════════════════════════╗
# ║  PID 게인 — 여기만 수정하세요                                 ║
# ╚══════════════════════════════════════════════════════════════╝

Kp = 5000       # 비례 게인 (N/m)
Ki = 500        # 적분 게인 (N/m/s)
Kd = 1500       # 미분 게인 (Ns/m)

U_MAX = 2000    # 액추에이터 힘 상한 (N)


# ╔══════════════════════════════════════════════════════════════╗
# ║  차량 파라미터                                                ║
# ╚══════════════════════════════════════════════════════════════╝

PARAMS = {
    "ms": 250,       # Sprung mass (kg)
    "mu": 35,        # Unsprung mass (kg)
    "ks": 15000,     # Spring rate (N/m)
    "cs": 1500,      # Damping coefficient (Ns/m)
    "kt": 150000,    # Tire stiffness (N/m)
}


# ╔══════════════════════════════════════════════════════════════╗
# ║  노면 프로파일                                                ║
# ╚══════════════════════════════════════════════════════════════╝

ROAD_TYPE   = "bump"    # "bump", "step", "sine", "random"
ROAD_HEIGHT = 0.05      # 노면 높이 (m)
ROAD_SPEED  = 16.67     # 차량 속도 (m/s) ≈ 60 km/h

DURATION = 4.0          # 시뮬레이션 시간 (s)
DT       = 0.0005       # 적분 간격 (s)


# ╔══════════════════════════════════════════════════════════════╗
# ║  PID 제어기                                                   ║
# ╚══════════════════════════════════════════════════════════════╝

class PIDController:
    def __init__(self, kp, ki, kd, u_max, dt):
        self.kp = kp
        self.ki = ki
        self.kd = kd
        self.u_max = u_max
        self.dt = dt
        self.integral = 0.0
        self.prev_error = 0.0

    def reset(self):
        self.integral = 0.0
        self.prev_error = 0.0

    def compute(self, zs, dzs):
        """
        에러 = zs (차체 변위, 0이 목표)
        u = -Kp*zs - Ki*integral(zs) - Kd*dzs
        """
        error = zs

        # 적분 (anti-windup: 클램핑)
        self.integral += error * self.dt
        self.integral = np.clip(self.integral, -self.u_max / (self.ki + 1e-9),
                                                self.u_max / (self.ki + 1e-9))

        # PID 출력
        u = -self.kp * error - self.ki * self.integral - self.kd * dzs

        # 포화
        u = np.clip(u, -self.u_max, self.u_max)

        self.prev_error = error
        return float(u)


# ══════════════════════════════════════════════════════════════
#  아래는 시뮬레이션 엔진 — 수정 불필요
# ══════════════════════════════════════════════════════════════

def make_road_fn(rtype, h, v):
    if rtype == "bump":
        dur = 0.3 / v
        t0 = 1.0
        return lambda t: h * np.sin(np.pi * (t - t0) / dur) if 0 <= (t - t0) <= dur else 0.0

    elif rtype == "step":
        ramp, t0 = 0.02, 1.0
        def fn(t):
            dt = t - t0
            if dt < 0: return 0.0
            if dt < ramp: return h * dt / ramp
            return h
        return fn

    elif rtype == "sine":
        freq = v / 3.0
        return lambda t: h * np.sin(2 * np.pi * freq * t)

    elif rtype == "random":
        rng = np.random.RandomState(12345)
        comps = [(v / (0.5 + rng.rand()*5), rng.rand()*2*np.pi,
                  h * (0.3 + 0.7*rng.rand()) / 15 * 3) for _ in range(15)]
        return lambda t: sum(a * np.sin(2*np.pi*f*t + p) for f, p, a in comps)

    return lambda t: 0.0


def derivatives(state, zr, u, p):
    zs, dzs, zu, dzu = state
    spring = p["ks"] * (zs - zu)
    damper = p["cs"] * (dzs - dzu)
    tire   = p["kt"] * (zu - zr)
    ddzs = (-spring - damper + u) / p["ms"]
    ddzu = ( spring + damper - tire - u) / p["mu"]
    return np.array([dzs, ddzs, dzu, ddzu])


def rk4_step(state, zr, zr_mid, zr_next, u, p, dt):
    k1 = derivatives(state, zr, u, p)
    k2 = derivatives(state + 0.5*dt*k1, zr_mid, u, p)
    k3 = derivatives(state + 0.5*dt*k2, zr_mid, u, p)
    k4 = derivatives(state + dt*k3, zr_next, u, p)
    return state + (dt/6) * (k1 + 2*k2 + 2*k3 + k4)


def run_simulation(params, road_fn, duration, dt, controller=None):
    steps = int(duration / dt)
    out_interval = max(1, steps // 2000)

    time_arr, zs_arr, zu_arr, zr_arr = [], [], [], []
    dzs_arr, dzu_arr, ddzs_arr, u_arr = [], [], [], []

    state = np.zeros(4)
    prev_dzs = 0.0

    if controller:
        controller.reset()

    for i in range(steps + 1):
        t = i * dt
        zr = road_fn(t)

        if i % out_interval == 0:
            ddzs = (state[1] - prev_dzs) / dt if i > 0 else 0.0
            time_arr.append(round(t, 6))
            zs_arr.append(float(state[0]))
            zu_arr.append(float(state[2]))
            zr_arr.append(float(zr))
            dzs_arr.append(float(state[1]))
            dzu_arr.append(float(state[3]))
            ddzs_arr.append(float(ddzs))
            u_val = controller.compute(state[0], state[1]) if controller else 0.0
            u_arr.append(u_val)

        prev_dzs = state[1]

        if i < steps:
            u = controller.compute(state[0], state[1]) if controller else 0.0
            zr_mid = road_fn(t + 0.5*dt)
            zr_next = road_fn(t + dt)
            state = rk4_step(state, zr, zr_mid, zr_next, u, params, dt)

    return {
        "time": time_arr, "zs": zs_arr, "zu": zu_arr, "zr": zr_arr,
        "dzs": dzs_arr, "dzu": dzu_arr, "ddzs": ddzs_arr, "u": u_arr,
    }


def compute_comfort(result, params):
    t = np.array(result["time"])
    zs, zu, zr = np.array(result["zs"]), np.array(result["zu"]), np.array(result["zr"])
    ddzs = np.array(result["ddzs"])
    u = np.array(result["u"])
    T = t[-1] - t[0]

    rattle = zs - zu
    tire_def = zu - zr
    return {
        "rmsAcc":     round(float(np.sqrt(np.trapz(ddzs**2, t) / T)), 6),
        "rmsRattle":  round(float(np.sqrt(np.trapz(rattle**2, t) / T)), 6),
        "maxRattle":  round(float(np.max(np.abs(rattle))), 6),
        "rmsTireDef": round(float(np.sqrt(np.trapz(tire_def**2, t) / T)), 6),
        "maxTireDef": round(float(np.max(np.abs(tire_def))), 6),
        "maxForce":   round(float(np.max(np.abs(u))), 2),
        "rmsForce":   round(float(np.sqrt(np.mean(u**2))), 2),
    }


def main():
    print("=" * 50)
    print("  Quarter-Car PID Controller")
    print(f"  Kp={Kp}  Ki={Ki}  Kd={Kd}  Umax={U_MAX}N")
    print("=" * 50)

    road_fn = make_road_fn(ROAD_TYPE, ROAD_HEIGHT, ROAD_SPEED)

    # Passive
    print("\n[1/2] Passive ...")
    passive = run_simulation(PARAMS, road_fn, DURATION, DT, controller=None)
    pc = compute_comfort(passive, PARAMS)
    print(f"  RMS Accel: {pc['rmsAcc']:.4f} m/s2  |  Rattle max: {pc['maxRattle']*1000:.1f} mm  |  Tire max: {pc['maxTireDef']*1000:.1f} mm")

    # Active (PID)
    print("[2/2] PID Active ...")
    pid = PIDController(Kp, Ki, Kd, U_MAX, DT)
    active = run_simulation(PARAMS, road_fn, DURATION, DT, controller=pid)
    ac = compute_comfort(active, PARAMS)
    print(f"  RMS Accel: {ac['rmsAcc']:.4f} m/s2  |  Rattle max: {ac['maxRattle']*1000:.1f} mm  |  Tire max: {ac['maxTireDef']*1000:.1f} mm")
    print(f"  Max Force: {ac['maxForce']:.0f} N  |  RMS Force: {ac['rmsForce']:.0f} N")

    if pc["rmsAcc"] > 0:
        imp = (1 - ac["rmsAcc"] / pc["rmsAcc"]) * 100
        print(f"\n  -> Accel improvement: {imp:+.1f}%")

    # JSON
    output = {
        "metadata": {
            "created": datetime.now().isoformat(),
            "controller": f"PID (Kp={Kp}, Ki={Ki}, Kd={Kd})",
            "duration": DURATION, "dt": DT,
        },
        "params": PARAMS,
        "road": {"type": ROAD_TYPE, "height": ROAD_HEIGHT, "speed": ROAD_SPEED},
        "passive": {**passive, "comfort": pc},
        "active":  {**active,  "comfort": ac},
    }

    out_dir = os.path.join(os.path.dirname(__file__), "..", "results")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "sim_result.json")
    with open(out_path, "w") as f:
        json.dump(output, f)

    size_kb = os.path.getsize(out_path) / 1024
    print(f"\n[OK] results/sim_result.json ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
