# 4엽 프로펠러 작업 기록

## 상태
- 마지막 작업: 2026. 10. 19. 오후 3:00:07, 작업자: Claude (Opus 5.5)
- 진행: 완료 — 파라미터 기반, 원형 패턴(날개 수 파라미터), 도면 치수 검증표 7항목 ✓
- 파일: models/propeller.build.js (빌드 스크립트), models/propeller.stp (단일 파트)
- 형상 검사: ✓ 오류 0 · 경고 0 · 검증표 7/7

## 이어서 작업하는 법
- 치수 변경: 빈 페이지에서 `await cad.run('models/propeller.build.js')` (약 3.5초) → `cad.params({ 이름: 값 })` (약 2초, 결과에 검증표 전후 비교 포함)
- 날개 수: `cad.params({ blades: 5 })`
- 결과만 보기·조립: `await cad.importStep('models/propeller.stp')`

## 요구사항 / 도면 해석
- 출처: 사용자 제공 도면 (Front/Left/Section A-A/Isometric, "날개 형상은 Helix를 활용, Pitch 152mm")
- Z = 프로펠러 축, 허브 뒷면 z=0, 보스 쪽(+Z)이 정면도 시점 (화면 Top 뷰 = 도면 정면도)
- 모호했던 점: 63 = 43 + 20 으로 보고 날개 윗면을 허브 앞면(z 43)에 맞춤. 두께 2 는 축방향 두께로 적용.
- 앞 모서리(정면 투영)는 뿌리 r=hub_d/2 @ root_ang(45°) 와 끝 r=blade_r @ tip_ang(60°) 를 잇는 직선 (수직 아래 기준).

## 완료한 것
- 구조: 허브+보스 회전체 1개 ∪ (헬리컬 시트 ∩ 정면 외형 → 날개 1장 → 원형 패턴 blades 개)
- 견고성: 기본값에서 20가지 변경(날개 수 3/5/6, 허브·보스·피치·끝 반지름·필렛·두께·각도·길이, 조합 2건) 모두 형상 검사·검증표 통과, 규칙 위반 2건은 거부됨. 1건(blade_h 30)은 메쉬 회피 파라미터 blade_rot 0→0.1° 로 자동 해결

## 남은 것 / 다음 작업자에게
- 날개 두께를 법선 방향 2 mm 로 해석해야 한다면 bladeBand 스케치에서 반지름별 두께 보정 필요

## 현재 장면
### 장면 (2026. 10. 19. 오후 3:00:07)
- 노드 6개, 최상위 1개
- 전체 bbox: 223.965 × 223.965 × 63 mm (min [-111.982,-111.982,0], max [111.982,111.982,63])

#### 파라미터
| 이름 | 값 | 단위 | 설명 |
|---|---|---|---|
| hub_d | 62 | mm | 허브 지름 Φ62 |
| hub_l | 43 | mm | 허브 길이 (63 − 20) |
| boss_d | 50 | mm | 보스 지름 Φ50 |
| boss_l | 20 | mm | 보스 길이 |
| chamfer | 5 | mm | 보스 끝 모따기 C5 (45°) |
| blades | 4 | 개 | 날개 수 |
| blade_r | 112 | mm | 날개 끝 반지름 R112 |
| fillet_r | 15 | mm | 날개 끝 모서리 R15 |
| blade_t | 2 | mm | 날개 두께 (축방향) |
| blade_h | 40 | mm | 날개 축방향 범위 (허브 앞면 기준) |
| pitch | 152 | mm | 헬릭스 피치 |
| root_ang | 45 | ° | 앞 모서리 뿌리 각 (수직 아래 기준) |
| tip_ang | 60 | ° | 앞 모서리 끝 각 (수직 아래 기준) |
| seg | 96 |  | 원통 분할 수 (메쉬용 — 수치 문제 시 자동 조정) |
| root_in | 2 | mm | 날개 뿌리가 허브 안으로 들어가는 깊이 (메쉬용 — 수치 문제 시 자동 조정) |
| blade_rot | 0 | ° | 날개 패턴 미세 회전 (메쉬용 — 수치 문제 시 자동 조정, ±0.5° 이내) |

규칙:
- `boss_d < hub_d` — 보스 지름은 허브 지름보다 작아야 함
- `chamfer > 0 && chamfer < boss_d / 2 && chamfer < boss_l` — 모따기는 보스 반지름·길이보다 작아야 함
- `blades >= 2 && blades <= 8 && Math.round(blades) === blades` — 날개 수는 2~8 의 정수
- `blade_h > blade_t && blade_h <= hub_l - 1` — 날개 축방향 범위는 두께보다 크고 허브 길이 − 1 이하
- `fillet_r > 0 && fillet_r < (blade_r - hub_d / 2) / 3` — 끝 필렛은 날개 길이의 1/3 보다 작아야 함
- `blade_r > hub_d / 2 + 10` — 날개 끝 반지름은 허브보다 10 mm 이상 커야 함
- `root_in >= 1 && root_in <= 6 && hub_d / 2 - root_in - 4 > boss_d / 4` — 날개 뿌리 깊이는 1~6 mm, 허브 안에 들어가야 함
- `Math.abs(blade_rot) <= 0.5` — 날개 미세 회전은 ±0.5° 이내 (설계 각도에 영향 없게)
- `pitch > blade_h` — 피치는 날개 축방향 범위보다 커야 함 (한 바퀴 이상 감기지 않게)

#### 도면 치수 검증
| 항목 | 기대 | 실측 | 차이 | 허용 | 판정 |
|---|---|---|---|---|---|
| 허브 Φ | 62 | 61.9834 | -0.0166 | ±0.05 | ✓ |
| 보스 Φ | 50 | 49.9938 | -0.0062 | ±0.05 | ✓ |
| 보스 끝면 Φ | 40 | 40.002 | 0.002 | ±0.05 | ✓ |
| 전체 길이 | 63 | 63 | 0 | ±0.01 | ✓ |
| 날개 끝 R | 112 | 112 | 0 | ±0.05 | ✓ |
| 날개 두께 | 2 | 2.0039 | 0.0039 | ±0.05 | ✓ |
| 피치 | 152 | 151.974 | -0.026 | ±0.5 | ✓ |

#### 노드 트리 (ƒ = 수식으로 연결된 값)
- `n6` **Propeller** — union(n1, n5)
  - `n1` **Hub + Boss (C5)** — revolve(points=[7점], angle=360, segments=96) rot=[0,0,1.875] ƒ{params.points=sketch.hubSection(), params.segments=seg, rot.2=180 / seg}
  - `n5` **Blades** — pattern(n4, count=4, angle=360) ƒ{params.count=blades, rot.2=blade_rot}
    - `n4` **Blade** — intersect(n2, n3)
      - `n2` **Blade helix sheet** — extrude(points=[4점], height=46, twist=-108.947, slices=1) pos=[0,0,-1] ƒ{params.points=sketch.bladeBand(), params.height=blade_h + 6, params.twist=-(blade_h + 6) / pitch * 360, pos.2=hub_l - blade_h - 4}
      - `n3` **Blade outline (R, fillet)** — extrude(points=[95점], height=44, twist=0, slices=1) pos=[0,0,0.5] ƒ{params.points=sketch.bladeOutline(), params.height=blade_h + 4, pos.2=hub_l - blade_h - 2.5}
