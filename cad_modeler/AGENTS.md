# CAD Modeler — AI 에이전트 작업 지침

Claude, Codex, Gemini 등 AI 에이전트가 이 툴로 설계할 때 따르는 규칙이다.

(For AI agents: drive the modeler in a visible browser through `window.cad`. Model with named parameters and `'=formula'` values. Run `cad.check()` after every feature and fix every error and warning before moving on. When you stop, save the `.build.js` script, the STEP file and a Markdown work log to `models/`.)

## 원칙
- **브라우저 화면에서 작업한다.** 사람이 같은 화면을 보며 따라오고, 중간에 Undo하거나 파라미터를 바꿀 수 있어야 한다. CLI나 헤드리스로 대신하지 않는다.
- **페이지는 열 때마다 빈 장면이다.** 자동 저장이나 프로젝트 파일 복원은 없다.
- **치수는 파라미터로 만든다.** 도면 치수는 모두 이름 있는 파라미터로 정의하고, 형상 값에는 `'=수식'`을 쓴다. 치수를 바꿔 달라는 요청이 오면 파라미터 하나만 바꾸면 된다.
- **단계마다 형상을 검사한다.** 기능(feature) 하나를 만들 때마다 `cad.check()`를 실행한다. 오류와 경고를 0으로 만든 뒤에 다음 단계로 간다.
- **작업을 멈출 때마다 저장한다.** 빌드 스크립트, STEP, 작업 기록 세 파일을 `models/`에 남긴다. 다음 작업자(사람이든 다른 AI든)는 md를 먼저 읽고 시작한다.

## 실행
```bash
python cad_modeler/launcher.py --port 3017 --no-browser
```
- 실행 후 `http://localhost:3017`을 브라우저로 연다. `CAD Modeler.bat`이나 exe로 열어도 같다(기본 포트 3007, 브라우저 자동으로 열림).
- 저장은 `launcher.py` 서버가 받는다. 정적 서버(`npx http-server` 등)로 열면 `models/`에 직접 저장되지 않고 브라우저 다운로드로 대신된다.
- 조작은 개발자 콘솔이나 에이전트의 브라우저 도구(JS 실행, Playwright, CDP 등)로 `window.cad`를 호출해서 한다. `cad.help()`로 전체 목록을 볼 수 있다.
- 페이지가 처음 열릴 때 CDN에서 Three.js를 받는다. **`window.cad`가 생길 때까지 기다린 뒤** 호출한다.
- 탭이 숨겨져 있으면 렌더링이 멈춰 스크린샷이 이전 화면으로 남는다. 화면으로 확인할 때는 탭을 앞에 띄운다.

## 좌표와 도형 규칙 (단위 mm, Z-up)
| 도형 | params | 기준점 |
|---|---|---|
| box | x, y, z | 중심 |
| cylinder | radius, height, segments | 중심, 축 = Z |
| cone | radius, height, segments | 중심, 꼭짓점이 +Z |
| sphere | radius, segments | 중심 |
| extrude | points [[x,y],…], height, twist°, slices | XY 다각형을 **z=0에서 z=height까지** 돌출. twist≠0이면 Z축 헬리컬 스윕 (twist = height / pitch · 360) |
| revolve | points [[r,z],…], angle°, segments | (r, z) 반단면을 **Z축 둘레로** 회전 (r ≥ 0). 단차·모따기·홈이 있는 축과 허브를 한 번에 |

- `cad.pattern(src, {count, angle})`: src를 Z축 둘레로 count개 복사해 합친다. `angle`이 360이면 등분한다. `count: '=blades'`처럼 파라미터에 연결하면 개수도 파라미터 하나로 바뀐다.

- `opts.rot`는 XYZ 오일러(°)이고 노드 자신의 원점 기준이다. `cad.rotate()`는 세계 축 기준이다.
- `cad.boolean(op, a, b)`: union, subtract(a − b), intersect. 입력 노드는 결과 안으로 들어가 화면에서 숨겨진다.

## 파라미터 (CATIA의 Parameters / Formulas / Sketch / Check)
```js
cad.params({
  hub_d: { value: 62, unit: 'mm', note: '허브 지름 Φ62' },
  seg:   { value: 96, note: '원통 분할 수', role: 'mesh' },   // 설계 치수가 아닌 메쉬용
});
cad.rule('boss_in_hub', 'boss_d < hub_d', '보스 지름은 허브보다 작아야 함');   // 어기는 변경은 거부된다
cad.sketch('outline', `                                                      // 파라미터 → 2D 점열
  return geo.profile([30, 0]).line([100, 0]).fillet(15)                          // 꼭짓점 필렛 R15 (접점 자동 계산)
    .arc({ center: [0, 0], to: geo.pol(100, 90), ccw: true }).fillet(15)        // 원호 (중심·끝 방향)
    .line([0, 30]).arc({ center: [0, 0], to: [30, 0], ccw: false })
    .close().points({ tol: 0.02 });`);
cad.add('cylinder', { radius: '=hub_d / 2', height: '=hub_l', segments: '=seg' }, { pos: [0, 0, '=hub_l / 2'], name: 'Hub' });
cad.add('extrude', { points: '=sketch.outline()', height: '=blade_h' }, { name: 'Blade outline' });
```
- **값을 바꿀 때**: `cad.params({ hub_d: 70 })`를 호출한다. 화면 왼쪽 아래의 **파라미터 패널**에서 숫자를 바꿔도 같다.
  - 연결된 수식이 모두 다시 계산되고, 이어서 바로 형상 검사가 돌아 `{changed, check, healed}`를 돌려준다.
  - 바꾼 결과는 Undo 한 단계로 되돌릴 수 있다.
- **수식에 쓸 수 있는 것**
  - 파라미터 이름, `Math` 함수(`sqrt`, `sin` 등), `D`(= π/180)
  - `sketch.이름(...)`
  - 스케치 본문에서는 이것 말고도 `geo` 도우미(`pol`, `rot`, `add`, `sub`, `mul`, `dot`, `len`, `unit`, `ang`, `arc`, `arcBetween`, `lineCircle`, `lineLine`)를 쓸 수 있다.
  - **필렛·접선은 손으로 계산하지 않는다.** `geo.profile(start)`로 그린다.
    - 그리기: `.line(to)`, `.lineBy(dx, dy)`, `.polar(len, deg)`, `.arc({center, to | sweep, ccw})`
    - 필렛: `.fillet(R)`은 바로 앞 꼭짓점에 건다. 시작점에 걸려면 `geo.profile(p, {fillet: R})`를 쓴다.
    - 마무리: `.close().points({tol})`로 점열을 만든다.
    - 선-선, 선-원호, 원호-원호 필렛을 모두 지원한다.
- **고정된 값**: 수식이 걸린 값은 오른쪽 패널에서 잠긴다(보라색 기울임). 숫자로 덮어쓰려면 `cad.update(id, {params: {radius: 30}})`처럼 직접 넣는다. 그러면 수식 연결이 끊긴다.
- **규칙**: 파라미터끼리 지켜야 할 관계(작다·크다, 범위)는 처음에 `cad.rule`로 함께 정의한다. 잘못된 값을 넣어도 형상이 깨지기 전에 거부된다.
- **`role: 'mesh'` 파라미터**: 분할 수, 뿌리 겹침 깊이, 패턴 미세 회전처럼 설계 의도와 무관한 값이다.
  - 파라미터를 바꾼 뒤 메쉬 수치 문제(아래 `open`, `nonmanifold` 등)가 생기면, 이 값을 조금씩 바꿔 문제가 없어지는 값을 자동으로 찾는다(`healed`로 보고).
  - 0이 아닌 값은 ±5~20% 범위에서, 0인 값은 ±0.1~0.5 범위에서 시도한다.
  - 새 모델을 만들 때도 이런 '회피용' 파라미터를 한두 개 두면 수정 요청에 강해진다.
- **개수 변경**: 날개 수처럼 개수가 바뀌는 것은 `cad.pattern`의 `count`를 파라미터에 연결해 두면 `cad.params({ blades: 5 })` 한 번으로 바뀐다.
- **속도**:
  - 계산 결과는 노드 내용 기준으로 캐시된다. 바뀐 노드와 그 위쪽 노드만 다시 계산한다(`cad.cacheStats()`).
  - Boolean을 길게 직렬로 잇지 말고, 반복 요소는 `pattern`으로 묶어 한 번에 합친다. 그래야 파라미터 변경이 빠르다.
  - 여러 변경은 `await cad.batch(async () => { ... })`로 묶는다. Undo 한 단계가 되고 화면은 끝에 한 번 갱신된다.
  - `cad.run(url)`은 기본적으로 batch로 실행된다.

## 수치 질의 (확인 요청에 숫자로 답한다)
| 함수 | 답 |
|---|---|
| `cad.section({z: 30})` (`{x}`, `{y}`, `{point, normal}`) | 단면 고리마다 넓이·중심·bbox·**원 맞춤 지름**(`loops[i].circle.d`, 최대 편차 `dev`), 구멍 지름 목록(`holes`), 전체 단면적 |
| `cad.probe([x, y])` 또는 `cad.probe({r, a})` | 그 위치를 지나는 Z 방향 직선이 만나는 면 높이(`hits`)와 **재료 구간 두께**(`segments[i].thickness`). `dir`로 방향을 바꿀 수 있다 |
| `cad.radial(ids?)` | Z축 기준 최대·최소 반지름(`rmax`, `dmax`), 높이 범위(`zmin`, `zmax`, `length`) |
| `cad.mass(ids?, {density})` | 부피, 겉넓이, 무게중심, bbox, 질량 |
| `cad.distance(a, b)`, `cad.get(id).bbox` | 최소거리·간섭, 노드 크기 |
| `cad.find('이름')`, `cad.find(/정규식/)` | 노드 id 목록. 모든 질의의 `ids` 인자에 넘겨 특정 부품만 잴 수 있다. 예: `cad.section({z: 20}, cad.find('Hub'))` |

예: "보스 끝면 지름 확인" → `cad.section({ z: 62.999 }).loops[0].circle.d` → `40.002`

## 도면 치수 검증표 (수정 반영 후 자동 재확인)
도면에 적힌 치수를 처음에 검증 항목으로 등록한다.
```js
cad.spec('보스 끝면 Φ', { expect: '=boss_d - 2 * chamfer', measure: 'cad.section({ z: hub_l + boss_l - 0.001 }).loops[0].circle.d', tol: 0.05, note: '모따기 C5 → Φ40' });
cad.specs().table   // | 항목 | 기대 | 실측 | 차이 | 허용 | 판정 |
```
- **`expect`**: 도면 값(숫자) 또는 `'=수식'`이다. 수식을 쓰면 파라미터를 바꿀 때 기대값도 따라 바뀐다.
- **`measure`**: 위 수치 질의를 쓰는 식(문자열)이다.
- **자동 갱신**
  - `cad.params(...)`의 결과에는 `specs.table`(변경 전 → 후 열 포함)과 `specs.changed`(값이 바뀐 항목)가 들어 있다.
  - 수정 요청을 반영한 뒤에는 이 표를 사용자에게 그대로 보여 준다.
- **검사와 저장**
    - **`measure`는 파라미터가 바뀌어도 같은 대상을 재야 한다.** 다른 부품이 섞일 수 있는 단면은 `cad.find`로 대상을 좁힌다. 높이·각도도 고정 숫자 대신 파라미터 식으로 쓴다(예: `z: hub_l / 2`).
    - **측정 위치는 대상 부품의 bbox 기준으로 쓴다.** 사람이 화면에서 부품을 옮겨(분해도 등) 놓아도 같은 곳을 재야 한다. 조립 높이를 고정해 두면 단면이 빈 곳을 잘라 `대상 없음`이 된다.
      ```js
      const S = "cad.find('Spacer')";
      // ✗ 조립 높이 고정: cad.section({ z: base_t + spacer_t / 2 }, S) — 스페이서를 옮기면 빈 곳을 자른다
      // ✓ 부품 위치 기준: cad.section({ z: cad.bbox(...S).center[2] }, S)
      cad.spec('스페이서 가운데 구멍 Φ', { expect: '=bore_d', tol: 0.05,
        measure: `cad.section({ z: cad.bbox(...${S}).center[2] }, ${S}).loops.find(l => l.hole && l.circle?.d > 10).circle.d` });
      ```
      `cad.probe`도 같다. x·y는 `cad.bbox(...ids).center` 기준으로 잡고, 높이는 결과에서 `cad.bbox(...ids).min[2]`를 빼 부품 바닥 기준으로 비교한다.
- `cad.check()`(인자 없음)와 `cad.saveStep`은 검증표 불일치를 오류(`spec`)로 다룬다.
  - 화면 왼쪽 아래 파라미터 패널 밑에 검증표가 표시된다. 상태 줄에는 `치수 7/7 ✓`처럼 나온다.

## 단계별 형상 검사 (설계 중 반드시)
기능 하나를 만들 때마다(Boolean 하나, 파라미터 변경 한 번마다) 검사한다.
```js
const c = cad.check(id);    // 인자를 빼면 장면 전체
if (!c.ok) console.table(c.issues);   // 해결한 뒤 다음 단계로
```
빌드 스크립트에서는 `step(label, id)` 도우미(예: `models/propeller.build.js`)를 쓴다. 문제가 있으면 그 자리에서 멈춘다.

화면에서도 같은 결과를 볼 수 있다.
- 장면이 바뀔 때마다 백그라운드 검사가 돈다.
- 문제가 있는 노드는 Outliner에 ⚠로 표시된다(빨강 = 오류, 주황 = 경고). 마우스를 올리면 내용이 나온다.
- 상태 줄에 `⚠ 오류 N · 경고 M` 또는 `✓ 형상 정상`이 표시된다.

| 코드 | 수준 | 뜻 | 해결 |
|---|---|---|---|
| `open` | 오류 | 찢어지거나 열린 면 (닫힌 솔리드가 아님) | 입력이 닫혀 있는지 확인한다. 같은 평면끼리 맞닿는 Boolean을 피한다. `role:'mesh'` 값(분할 수)을 바꿔 본다 |
| `flipped`, `inverted` | 오류 | 면 방향이 어긋나거나 안팎이 뒤집힘 | extrude 점 순서·높이 부호를 확인한다 |
| `empty` | 오류 | Boolean 결과가 비어 있음 | 두 입력이 실제로 겹치는지 위치를 확인한다 |
| `bool-volume` | 오류 | Boolean 결과 부피가 이론 범위를 벗어남 (연산 실패 의심) | 입력을 0.1~0.5 mm 옮기거나 분할 수를 바꾼다 |
| `eval-failed` | 오류 | 형상 계산 예외 | 메시지를 보고 파라미터와 점열을 확인한다 |
| `rule`, `formula` | 오류 | 파라미터 규칙 위반, 수식 계산 실패 | 파라미터 값이나 수식을 고친다 |
| `spec` | 오류 | 도면 치수 검증표 불일치 | 모델·수식을 고친다. 도면 해석이 바뀐 것이면 사용자 확인 후 spec을 고친다 |
| `nonmanifold` | 경고 | 모서리 하나를 면 3개 이상이 공유 (모서리·면으로만 맞닿음) | 0.5~1 mm 겹치게 한다. 우연히 꼭짓점이 겹친 경우는 원통을 반 칸(180/seg °) 돌린다 |
| `bool-disjoint` | 경고 | Union 입력이 이어지지 않아 떨어진 솔리드가 생김 | 0.5~1 mm 겹치게 한다 |
| `bool-noeffect` | 경고 | Cut이 아무것도 깎지 않음 | 빼는 형상의 위치를 확인한다 |
| `bool-split` | 경고 | Cut으로 형상이 여러 조각으로 나뉨 | 의도한 것인지 확인한다 |

- `cad.saveStep`은 검사에 오류나 경고가 남아 있으면 저장하지 않는다.
- 불가피하게 남겨야 하면 `{force: true}`로 저장하고, 작업 기록에 사유를 쓴다.

## 작업 흐름
1. **시작**: 페이지를 연다(빈 장면).
   - 이어서 작업하는 경우: 먼저 `models/<프로젝트>.md`를 읽는다.
   - 치수를 바꾸거나 형상을 고쳐야 하면: `await cad.run('models/<프로젝트>.build.js')`로 파라미터가 살아 있는 모델을 다시 만든다.
   - 결과만 보거나 그 위에 다른 부품을 붙일 때: `await cad.importStep('models/<프로젝트>.stp')`(어셈블리면 `.step`)로 불러온다. STEP으로 불러온 형상은 편집할 수 없는 참조 모델이다.
2. **파라미터 정의**
   - 도면 치수를 `cad.params`로 모두 정의한다. 단위와 출처(`note`)를 함께 적는다.
   - 치수 사이의 관계는 `cad.rule`로 정의한다.
   - 확인할 도면 치수는 `cad.spec`으로 등록한다. 모델링이 끝나면 모두 ✓여야 한다.
3. **기능 단위 모델링**: 기능 하나마다 아래 순서로 진행한다.
   - `'=수식'`으로 도형을 추가한다. 노드에는 사람이 알아볼 이름을 붙인다.
   - Boolean으로 합친다.
   - `cad.check(id)`로 검사하고 문제를 0으로 만든다.
   - `cad.view(...)`로 화면을 보여 준다.
4. **검증**
   - 도면 치수와 맞는지 확인한다(`cad.get(id).bbox`, `cad.distance`, 측정 패널).
   - 도면의 각 뷰와 화면 뷰를 비교한다.
5. **견고성 확인**
   - 주요 파라미터를 ±10~20% 바꿔 `cad.params(...)`를 호출하고, `check.ok`인지 본다.
   - 확인이 끝나면 원래 값으로 되돌린다.
   - 문제가 나오면 수식과 겹침 여유를 고쳐 어떤 값에서도 깨지지 않게 만든다.
6. **중지할 때(작업이 끝났을 때도)**: 세 파일을 저장한다.
   ```js
   await cad.saveText('models/<프로젝트>.build.js', buildScript);  // 파라미터·스케치·규칙·형상을 만드는 전체 스크립트 (cad.run 으로 실행됨)
   await cad.saveStep('models/<프로젝트>');                        // 1개면 .stp, 여러 개면 .step (검사 문제가 있으면 거부)
   await cad.saveText('models/<프로젝트>.md', workLog);             // 아래 템플릿
   ```
   - `cad.report()`는 파라미터 표, 규칙, 노드 트리(수식 포함)를 마크다운으로 돌려준다.

## 작업 기록 템플릿 (`models/<프로젝트>.md`)
~~~markdown
# <프로젝트 이름> 작업 기록

## 상태
- 마지막 작업: <날짜 시간>, <작업자: 사람/Claude/Codex/...>
- 진행: <완료 | 진행 중 — 어디까지>
- 파일: models/<프로젝트>.build.js, models/<프로젝트>.stp (<bytes>)
- 형상 검사: <✓ 오류 0 · 경고 0 | 남은 문제와 사유>

## 요구사항 / 도면 해석
- 출처: <도면 파일이나 요청 요약>
- 핵심 치수와 해석: <표나 목록. 모호했던 치수를 어떻게 해석했는지 근거와 함께>

## 파라미터
<cad.report() 의 파라미터 표 — 치수 변경 요청은 여기 이름으로 cad.params({...})>

## 완료한 것
- <단계별 결과와 검증 값 (bbox, 측정치), 견고성 확인한 파라미터 범위>

## 남은 것 / 다음 작업자에게
- <할 일, 알려진 문제, 확인이 필요한 질문>

## 현재 장면
<cad.report() 출력>
~~~

## API 요약
`cad.help()`가 최신 목록이다.
- **생성·편집**: `add`, `boolean`, `update`, `move`, `moveTo`, `rotate`, `remove`, `select`, `undo`, `redo`, `newScene`
- **생성 추가분**: `pattern`, `batch`, `cacheStats`
- **파라미터**: `params`, `param`, `sketch`, `rule`
- **검사·조회**: `check`, `section`, `probe`, `radial`, `mass`, `spec`, `specs`, `list`, `get`, `bbox`, `distance`, `lastMeasure`, `view`
- **파일**: `run`, `importStep`, `saveStep`, `saveText`, `report`, `toJSON`
