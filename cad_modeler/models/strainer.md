# 손잡이 달린 돔형 원판 (4-슬롯) 작업 기록

## 상태
- 마지막 작업: 2026. 10. 19. 오후 3:13:27, 작업자: Claude (Opus 5.5)
- 진행: 완료 — 첫 실행에서 형상 검사 통과, 도면 치수 검증표 11/11 ✓
- 파일: models/strainer.build.js (빌드 스크립트), models/strainer.stp (단일 파트, 2745073 bytes, 면 6682개, open=0)
- 형상 검사: ✓ 오류 0 · 경고 0

## 이어서 작업하는 법
- 치수 변경: 빈 페이지에서 `await cad.run('models/strainer.build.js')` (약 4초) → `cad.params({ 이름: 값 })` (약 1.5초, 결과에 검증표 전후 비교 포함)
- 결과만 보기·조립: `await cad.importStep('models/strainer.stp')`

## 요구사항 / 도면 해석
- 출처: 사용자 제공 도면 (Front / Bottom / Isometric, Scale 1:2 — 치수는 실제 값)
- 좌표: 원판 중심 = 원점, 두께 방향 Z (정면도 = +Z 에서 내려다봄), 관은 +X

| 항목 | 값 | 근거 |
|---|---|---|
| 원판 | 바깥 R75, 두께 40 (z −20~20), 둘레는 R20 반원 (중심 r = 55) | 정면도 R75, 측면도 R20, 둘레 반원 중심이 110 치수 끝선 위 |
| 돔 | 윗면 r ≤ 55 에 구면 R100 (높이 16.48, 꼭대기 z 36.48) | 측면도 110 · R100 |
| 슬롯 | 4개, 폭 20, 안쪽 끝 R10 반원 (중심 R20 원 위), 바깥 끝 R45, 관통 | 정면도 4-R10 · R20 · R45, 측면도 숨은선이 바닥까지 |
| 관 | Φ40, X축, 원판 중심에서 135 | 정면도 Φ40 · 135, 측면도 높이 일정 |
| 블렌드 | 정면도 R40 = Φ40 단면을 반지름 60 원호로 휘어 돌린 토러스 조각 (중심 (98.1, ±60)) | R40 이 원판 R75 · 관 선(±20) 에 접함 |

- 모호했던 점
  - 슬롯 바깥 끝: "R45" 와 일점쇄선 원 R45 로 보고 원점 중심 R45 원호로 했다 (평평한 끝이면 바깥 모서리가 r = 46.1 이 됨).
  - 블렌드: 측면도 윗선이 관 끝까지 곧아서 원판 둘레 · 블렌드 · 관이 모두 같은 Φ40 단면을 쓰는 것으로 해석했다.

## 완료한 것
- 단계별 형상 검사: 원판 → +관 → +블렌드 ×2 → 슬롯 패턴 → 관통 컷 모두 오류·경고 0 (첫 실행)
- 화면 Top / Iso / Front 뷰를 도면 정면도 · 등각도 · 측면도와 비교해 일치 확인
- 견고성 (기본값에서 하나씩 또는 조합으로 변경):

| 변경 | 결과 |
|---|---|
| `body_R:80` | ✓ 형상 검사 · 검증표 11/11 |
| `body_R:70` | ✓ 형상 검사 · 검증표 11/11 |
| `rim_R:18` | ✓ 형상 검사 · 검증표 11/11 |
| `rim_R:22` | ✓ 형상 검사 · 검증표 11/11 |
| `dome_R:90` | ✓ 형상 검사 · 검증표 11/11 |
| `dome_R:130` | ✓ 형상 검사 · 검증표 11/11 |
| `dome_R:200` | ✓ 형상 검사 · 검증표 11/11 |
| `slots:3` | ✓ 형상 검사 · 검증표 11/11 |
| `slots:5` | ✓ 형상 검사 · 검증표 11/11 |
| `slot_w:16` | ✓ 형상 검사 · 검증표 11/11 |
| `slot_c:25` | ✓ 형상 검사 · 검증표 11/11 |
| `slot_out:40` | ✓ 형상 검사 · 검증표 11/11 |
| `tube_len:150` | ✓ 형상 검사 · 검증표 11/11 |
| `blend_R:30` | ✓ 형상 검사 · 검증표 11/11 |
| `blend_R:55` | ✓ 형상 검사 · 검증표 11/11 |
| `body_R:85, rim_R:22, slots:5, slot_out:50` | ✓ 형상 검사 · 검증표 11/11 |
| `tube_len:150, slots:5` | ✓ 형상 검사 · 검증표 11/11 |
| `slot_out:60` | 거부 (규칙 위반) |
| `slots:8` | 거부 (규칙 위반) |
| `slots:6` | 거부 (규칙 위반) |

- 진행 중 고친 것: 처음 검증표 식이 일부 변경에서 깨졌다 (슬롯 3·5개면 +Y 슬롯이 없음, R75 를 다각형 면 가운데에서 잼, 돔 R 추정 오차). 측정 대상을 원판 회전체 · 첫 슬롯 축으로 고정하고 돔은 r = 0.9·R55 에서 재도록 고쳐 해결.

## 남은 것 / 다음 작업자에게
- 관 지름은 둘레 R20 과 같은 파라미터(rim_R)를 쓴다. 관만 굵기를 바꾸라는 요청이 오면 블렌드 단면을 원뿔대로 바꿔야 함.

## 현재 장면
### 장면 (2026. 10. 19. 오후 3:13:27)
- 노드 10개, 최상위 1개
- 전체 bbox: 209.96 × 149.92 × 56.484 mm (min [-74.96,-74.96,-20], max [135,74.96,36.484])

#### 파라미터
| 이름 | 값 | 단위 | 설명 |
|---|---|---|---|
| body_R | 75 | mm | 원판 바깥 반지름 R75 |
| rim_R | 20 | mm | 둘레 반원 R20 = 원판 두께 40의 절반 = 관 Φ40 의 반지름 |
| dome_R | 100 | mm | 윗면 구면 돔 R100 (밑면 지름 110 = 2 × (R75 − R20)) |
| slots | 4 | 개 | 슬롯 수 (4-R10) |
| slot_w | 20 | mm | 슬롯 폭 20 (끝 R10) |
| slot_c | 20 | mm | 슬롯 안쪽 끝 R10 중심 원 R20 |
| slot_out | 45 | mm | 슬롯 바깥 끝 원호 R45 |
| tube_len | 135 | mm | 원판 중심 ~ 관 끝 135 |
| blend_R | 40 | mm | 원판 ~ 관 블렌드 R40 (정면도) |
| seg | 96 |  | 원 분할 수 (메쉬용 — 수치 문제 시 자동 조정) |
| blend_ext | 0.5 | ° | 블렌드를 원판·관 안으로 더 늘리는 각 (메쉬용 — 접하는 면끼리 겹침 확보) |

규칙:
- `body_R - rim_R > slot_out + 2` — 돔 밑면 반지름(R75−R20)은 슬롯 바깥 끝보다 2 mm 이상 커야 함
- `dome_R > body_R - rim_R` — 돔 구 반지름은 돔 밑면 반지름보다 커야 함
- `slot_c - slot_w / 2 > 2 && slot_out > slot_c + 2` — 슬롯: 안쪽 끝이 중심에서 2 mm 이상 떨어지고 바깥 끝이 안쪽 끝 중심보다 바깥
- `slot_c * sin(PI / slots) > slot_w / 2 + 1` — 이웃 슬롯 안쪽 끝끼리 1 mm 이상 떨어져야 함
- `slots >= 2 && slots <= 8 && round(slots) === slots` — 슬롯 수는 2~8 의 정수
- `tube_len > sqrt((body_R + blend_R) ** 2 - (rim_R + blend_R) ** 2) + 5` — 관 끝은 블렌드가 끝나는 곳보다 5 mm 이상 바깥
- `blend_R >= 5` — 블렌드 R 은 5 mm 이상
- `blend_ext > 0 && blend_ext <= 2` — 블렌드 연장각은 0~2°

#### 도면 치수 검증
| 항목 | 기대 | 실측 | 차이 | 허용 | 판정 |
|---|---|---|---|---|---|
| 원판 R75 | 75 | 75 | 0 | ±0.05 | ✓ |
| 관 Φ40 | 40 | 39.9965 | -0.0035 | ±0.05 | ✓ |
| 관 끝 135 | 135 | 135 | 0 | ±0.01 | ✓ |
| 바닥 z (두께 40) | -20 | -20 | 0 | ±0.01 | ✓ |
| 돔 꼭대기 높이 | 36.4835 | 36.4835 | 0 | ±0.02 | ✓ |
| 돔 구 반지름 R100 | 100 | 99.77 | -0.23 | ±0.5 | ✓ |
| 돔 밑면 지름 110 | 109.9696 | 109.9678 | -0.0018 | ±0.05 | ✓ |
| 슬롯 폭 20 | 20 | 20 | 0 | ±0.05 | ✓ |
| 슬롯 안쪽 끝 (R20 − R10) | 10 | 10.0197 | 0.0197 | ±0.05 | ✓ |
| 슬롯 바깥 끝 R45 | 45 | 45 | 0 | ±0.05 | ✓ |
| 블렌드 R40 (중간점 y) | 25.1089 | 25.1089 | 0 | ±0.1 | ✓ |

#### 노드 트리 (ƒ = 수식으로 연결된 값)
- `n10` **Strainer** — subtract(n7, n9)
  - `n7` **Body + Tube + Blends** — union(n5, n6)
    - `n5` **Body + Tube + Blend1** — union(n3, n4)
      - `n3` **Body + Tube** — union(n1, n2)
        - `n1` **Body (R75, R20, dome R100)** — revolve(points=[53점], angle=360, segments=96) rot=[0,0,1.875] ƒ{params.points=sketch.bodySection(), params.segments=seg, rot.2=180 / seg}
        - `n2` **Tube Φ40** — cylinder(radius=20, height=80, segments=96) pos=[95,0,0] rot=[0,90,0] ƒ{params.radius=rim_R, params.height=tube_len - (body_R - rim_R), params.segments=seg, pos.0=((body_R - rim_R) + tube_len) / 2}
      - `n4` **Blend R40 (+Y)** — revolve(points=[96점], angle=59.551, segments=96) pos=[98.107,60,0] rot=[0,0,210.949] ƒ{params.points=sketch.blendSection(), params.angle=(90 - (atan2((rim_R + blend_R), sqrt((bo…, params.segments=seg, pos.0=sqrt((body_R + blend_R) ** 2 - (rim_R + …, pos.1=(rim_R + blend_R), rot.2=180 + (atan2((rim_R + blend_R), sqrt((bo…}
    - `n6` **Blend R40 (−Y)** — revolve(points=[96점], angle=59.551, segments=96) pos=[98.107,-60,0] rot=[0,0,89.5] ƒ{params.points=sketch.blendSection(), params.angle=(90 - (atan2((rim_R + blend_R), sqrt((bo…, params.segments=seg, pos.0=sqrt((body_R + blend_R) ** 2 - (rim_R + …, pos.1=-(rim_R + blend_R), rot.2=90 - blend_ext}
  - `n9` **Slots** — pattern(n8, count=4, angle=360) ƒ{params.count=slots}
    - `n8` **Slot (R10 / R45)** — extrude(points=[35점], height=66.484, twist=0, slices=1) pos=[0,0,-25] ƒ{params.points=sketch.slot(), params.height=2 * rim_R + (dome_R - sqrt(dome_R ** 2 -…, pos.2=-rim_R - 5}
