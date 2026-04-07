"""
Quarter-Car Control Server
===========================
웹 시뮬레이터와 연동되는 제어기 서버.
시뮬레이터가 생성한 노면 데이터를 받아, 제어기를 적용한 결과를 반환합니다.

사용법:
  1. 아래 control_law() 수정
  2. python server.py 실행 (포트 8000)
  3. 웹 시뮬레이터에서 [Python 제어기] 체크 후 [시작]

서버가 받는 것: 차량 파라미터 + 노면 시계열 zr(t)
서버가 하는 것: Passive(u=0) + Active(u=control_law) 시뮬레이션
서버가 보내는 것: 두 시뮬레이션 결과 JSON
"""

import numpy as np
import json
from http.server import HTTPServer, BaseHTTPRequestHandler


# ╔══════════════════════════════════════════════════════════════╗
# ║  제어 법칙 — 여기만 수정하세요!                               ║
# ╚══════════════════════════════════════════════════════════════╝

CONTROLLER_NAME = "PID (Kp=5000, Ki=500, Kd=1500)"

# PID 게인
Kp = 5000
Ki = 500
Kd = 1500
U_MAX = 2000  # 액추에이터 힘 상한 (N)

# PID 적분항 상태
_integral = 0.0

def control_reset():
    """시뮬레이션 시작 시 호출됨"""
    global _integral
    _integral = 0.0

def control_law(t, zs, dzs, zu, dzu, zr, dt):
    """
    매 시뮬레이션 스텝마다 호출됩니다.

    Parameters
    ----------
    t   : float — 현재 시간 (s)
    zs  : float — 차체 변위 (m)
    dzs : float — 차체 속도 (m/s)
    zu  : float — 휠 변위 (m)
    dzu : float — 휠 속도 (m/s)
    zr  : float — 노면 변위 (m)
    dt  : float — 시간 간격 (s)

    Returns
    -------
    u : float — 액추에이터 힘 (N)
    """
    global _integral

    error = zs
    _integral += error * dt
    # Anti-windup
    _integral = np.clip(_integral, -U_MAX / (Ki + 1e-9), U_MAX / (Ki + 1e-9))

    u = -Kp * error - Ki * _integral - Kd * dzs
    u = np.clip(u, -U_MAX, U_MAX)
    return float(u)


# ══════════════════════════════════════════════════════════════
#  시뮬레이션 엔진 (수정 불필요)
# ══════════════════════════════════════════════════════════════

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


def interpolate_road(road_time, road_zr, t):
    """노면 시계열을 보간"""
    if t <= road_time[0]:
        return road_zr[0]
    if t >= road_time[-1]:
        return road_zr[-1]
    idx = np.searchsorted(road_time, t) - 1
    idx = max(0, min(idx, len(road_time) - 2))
    frac = (t - road_time[idx]) / (road_time[idx+1] - road_time[idx])
    return road_zr[idx] + frac * (road_zr[idx+1] - road_zr[idx])


def run_simulation(params, road_time, road_zr, duration, dt, use_control=False):
    road_t = np.array(road_time)
    road_z = np.array(road_zr)

    def road_fn(t):
        return float(interpolate_road(road_t, road_z, t))

    steps = int(duration / dt)
    out_interval = max(1, steps // 2000)

    time_arr, zs_arr, zu_arr, zr_arr = [], [], [], []
    ddzs_arr, u_arr = [], []

    state = np.zeros(4)
    prev_dzs = 0.0

    if use_control:
        control_reset()

    for i in range(steps + 1):
        t = i * dt
        zr = road_fn(t)

        if i % out_interval == 0:
            ddzs = (state[1] - prev_dzs) / dt if i > 0 else 0.0
            time_arr.append(round(t, 6))
            zs_arr.append(float(state[0]))
            zu_arr.append(float(state[2]))
            zr_arr.append(float(zr))
            ddzs_arr.append(float(ddzs))
            if use_control:
                u_arr.append(control_law(t, state[0], state[1], state[2], state[3], zr, dt))
            else:
                u_arr.append(0.0)

        prev_dzs = state[1]

        if i < steps:
            u = control_law(t, state[0], state[1], state[2], state[3], zr, dt) if use_control else 0.0
            zr_mid = road_fn(t + 0.5*dt)
            zr_next = road_fn(t + dt)
            state = rk4_step(state, zr, zr_mid, zr_next, u, params, dt)

    return {
        "time": time_arr, "zs": zs_arr, "zu": zu_arr, "zr": zr_arr,
        "ddzs": ddzs_arr, "u": u_arr,
    }


def compute_comfort(result):
    t = np.array(result["time"])
    zs, zu, zr = np.array(result["zs"]), np.array(result["zu"]), np.array(result["zr"])
    ddzs, u = np.array(result["ddzs"]), np.array(result["u"])
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


# ══════════════════════════════════════════════════════════════
#  HTTP 서버
# ══════════════════════════════════════════════════════════════

class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path != "/simulate":
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))

        params = body["params"]
        road_time = body["road_time"]
        road_zr = body["road_zr"]
        duration = body.get("duration", 4.0)
        dt = body.get("dt", 0.0005)

        print(f"[REQ] params={params}, duration={duration}, road points={len(road_time)}")

        # Passive
        passive = run_simulation(params, road_time, road_zr, duration, dt, use_control=False)
        pc = compute_comfort(passive)

        # Active
        active = run_simulation(params, road_time, road_zr, duration, dt, use_control=True)
        ac = compute_comfort(active)

        imp = (1 - ac["rmsAcc"] / pc["rmsAcc"]) * 100 if pc["rmsAcc"] > 0 else 0
        print(f"  Passive RMS: {pc['rmsAcc']:.4f}  Active RMS: {ac['rmsAcc']:.4f}  ({imp:+.1f}%)")

        result = {
            "controller": CONTROLLER_NAME,
            "passive": {**passive, "comfort": pc},
            "active":  {**active,  "comfort": ac},
        }

        data = json.dumps(result).encode()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, format, *args):
        # 간결한 로그
        pass


PORT = 8000

if __name__ == "__main__":
    print("=" * 50)
    print(f"  Quarter-Car Control Server")
    print(f"  Controller: {CONTROLLER_NAME}")
    print(f"  http://localhost:{PORT}/simulate")
    print("=" * 50)
    print("  Waiting for requests...\n")
    HTTPServer(("", PORT), Handler).serve_forever()
