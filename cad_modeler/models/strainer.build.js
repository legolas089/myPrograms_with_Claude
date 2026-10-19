// 손잡이 달린 돔형 원판 (4-슬롯) — 파라미터 기반 빌드 스크립트
// 실행: 빈 페이지에서 await cad.run('models/strainer.build.js')
// 치수 변경: cad.params({ body_R: 80 }) 처럼 파라미터만 바꾸면 모델·형상 검사·도면 치수 검증표가 함께 갱신된다
//
// 좌표: 원판 중심 = 원점, 두께 방향 = Z (정면도는 +Z 에서 내려다본 모습), 손잡이 관은 +X 방향
// 구조: 원판 회전체(바닥 평면 + 둘레 R20 반원 + 윗면 R100 구면 돔)
//       ∪ 관 Φ40 (X축)
//       ∪ 블렌드 2개 (정면도 R40 = 반지름 20 원 단면을 반지름 60 원호로 휘어 돌린 토러스 조각)
//       − 슬롯 4개 (폭 20, 안쪽 끝 R10 중심이 R20 원 위, 바깥 끝은 R45 원호, 관통)

// 진행 단계마다 형상 검사 — 오류·경고가 있으면 멈춘다
const step = (label, ids) => {
  const c = cad.check(...[].concat(ids));
  if (!c.ok) throw new Error(`[${label}] 형상 검사 실패:\n` + c.issues.map(i => `  ${i.id} ${i.name}: [${i.level}] ${i.message}`).join('\n'));
  console.log(`✓ ${label}`);
  return ids;
};

cad.newScene();

// ── 1. 파라미터 · 규칙 ──
cad.params({
  body_R:    { value: 75,  unit: 'mm', note: '원판 바깥 반지름 R75' },
  rim_R:     { value: 20,  unit: 'mm', note: '둘레 반원 R20 = 원판 두께 40의 절반 = 관 Φ40 의 반지름' },
  dome_R:    { value: 100, unit: 'mm', note: '윗면 구면 돔 R100 (밑면 지름 110 = 2 × (R75 − R20))' },
  slots:     { value: 4,   unit: '개', note: '슬롯 수 (4-R10)' },
  slot_w:    { value: 20,  unit: 'mm', note: '슬롯 폭 20 (끝 R10)' },
  slot_c:    { value: 20,  unit: 'mm', note: '슬롯 안쪽 끝 R10 중심 원 R20' },
  slot_out:  { value: 45,  unit: 'mm', note: '슬롯 바깥 끝 원호 R45' },
  tube_len:  { value: 135, unit: 'mm', note: '원판 중심 ~ 관 끝 135' },
  blend_R:   { value: 40,  unit: 'mm', note: '원판 ~ 관 블렌드 R40 (정면도)' },
  seg:       { value: 96,  unit: '',   note: '원 분할 수 (메쉬용 — 수치 문제 시 자동 조정)', role: 'mesh' },
  blend_ext: { value: 0.5, unit: '°',  note: '블렌드를 원판·관 안으로 더 늘리는 각 (메쉬용 — 접하는 면끼리 겹침 확보)', role: 'mesh' },
});
cad.rule('rim_fits', 'body_R - rim_R > slot_out + 2', '돔 밑면 반지름(R75−R20)은 슬롯 바깥 끝보다 2 mm 이상 커야 함');
cad.rule('dome_ok', 'dome_R > body_R - rim_R', '돔 구 반지름은 돔 밑면 반지름보다 커야 함');
cad.rule('slot_order', 'slot_c - slot_w / 2 > 2 && slot_out > slot_c + 2', '슬롯: 안쪽 끝이 중심에서 2 mm 이상 떨어지고 바깥 끝이 안쪽 끝 중심보다 바깥');
cad.rule('slot_gap', 'slot_c * sin(PI / slots) > slot_w / 2 + 1', '이웃 슬롯 안쪽 끝끼리 1 mm 이상 떨어져야 함');
cad.rule('slot_count', 'slots >= 2 && slots <= 8 && round(slots) === slots', '슬롯 수는 2~8 의 정수');
cad.rule('tube_ok', 'tube_len > sqrt((body_R + blend_R) ** 2 - (rim_R + blend_R) ** 2) + 5', '관 끝은 블렌드가 끝나는 곳보다 5 mm 이상 바깥');
cad.rule('blend_ok', 'blend_R >= 5', '블렌드 R 은 5 mm 이상');
cad.rule('ext_ok', 'blend_ext > 0 && blend_ext <= 2', '블렌드 연장각은 0~2°');

// 자주 쓰는 식 (수식 문자열에 끼워 넣는다)
const CORE = '(body_R - rim_R)';                                         // 돔 밑면·둘레 반원 중심 반지름 55
const DOME_H = `(dome_R - sqrt(dome_R ** 2 - ${CORE} ** 2))`;            // 돔 높이 16.48
const CX = `sqrt((body_R + blend_R) ** 2 - (rim_R + blend_R) ** 2)`;    // 블렌드 원호 중심 X 98.1
const CY = '(rim_R + blend_R)';                                          // 블렌드 원호 중심 Y 60
const BETA = `(atan2(${CY}, ${CX}) / D)`;                                // 31.45°
const SPAN = `(90 - ${BETA})`;                                           // 블렌드가 도는 각 58.55°

// ── 2. 스케치 ──
// 원판 반단면 (r, z): 바닥 → 둘레 R20 반원 → R100 돔 → 축
cad.sketch('bodySection', `
  const core = body_R - rim_R, domeH = dome_R - Math.sqrt(dome_R ** 2 - core ** 2);
  return geo.profile([0, -rim_R])
    .line([core, -rim_R])
    .arc({ center: [core, 0], to: [core, rim_R], ccw: true })
    .arc({ center: [0, rim_R + domeH - dome_R], to: [0, rim_R + domeH], ccw: true })
    .close().points({ tol: 0.02 });
`);
// 블렌드 단면 (r, z): 반지름 rim_R 원, 중심이 회전축에서 blend_R + rim_R
cad.sketch('blendSection', `
  const n = Math.round(seg), c = blend_R + rim_R;
  return Array.from({ length: n }, (_, k) => [c + rim_R * Math.cos(2 * Math.PI * k / n), rim_R * Math.sin(2 * Math.PI * k / n)]);
`);
// 슬롯 하나 (+X 방향): 바깥 끝 R(slot_out) 원호, 안쪽 끝 R(slot_w/2) 반원
cad.sketch('slot', `
  const h = slot_w / 2, xo = Math.sqrt(slot_out ** 2 - h ** 2);
  return geo.profile([xo, -h])
    .arc({ center: [0, 0], to: [xo, h], ccw: true })
    .line([slot_c, h])
    .arc({ center: [slot_c, 0], to: [slot_c, -h], ccw: true })
    .close().points({ tol: 0.02 });
`);

// ── 3. 원판 ──
// 반 칸(180/seg °) 돌려 슬롯·관 모서리가 회전체 꼭짓점과 정확히 겹치지 않게
let body = step('원판 (바닥 + R20 둘레 + R100 돔)', cad.add('revolve', { points: '=sketch.bodySection()', angle: 360, segments: '=seg' },
  { rot: [0, 0, '=180 / seg'], name: 'Body (R75, R20, dome R100)' }));

// ── 4. 관 Φ40 (+X) — 둘레 반원 중심(r = R55)에서 관 끝까지 ──
const tube = cad.add('cylinder', { radius: '=rim_R', height: `=tube_len - ${CORE}`, segments: '=seg' },
  { pos: [`=(${CORE} + tube_len) / 2`, 0, 0], rot: [0, 90, 0], name: 'Tube Φ40' });
body = step('원판 + 관', cad.boolean('union', body, tube, 'Body + Tube'));

// ── 5. 블렌드 R40 (위·아래) ──
const blendU = cad.add('revolve', { points: '=sketch.blendSection()', angle: `=${SPAN} + 2 * blend_ext`, segments: '=seg' },
  { pos: [`=${CX}`, `=${CY}`, 0], rot: [0, 0, `=180 + ${BETA} - blend_ext`], name: 'Blend R40 (+Y)' });
body = step('블렌드 +Y', cad.boolean('union', body, blendU, 'Body + Tube + Blend1'));
const blendL = cad.add('revolve', { points: '=sketch.blendSection()', angle: `=${SPAN} + 2 * blend_ext`, segments: '=seg' },
  { pos: [`=${CX}`, `=-${CY}`, 0], rot: [0, 0, '=90 - blend_ext'], name: 'Blend R40 (−Y)' });
body = step('블렌드 −Y', cad.boolean('union', body, blendL, 'Body + Tube + Blends'));

// ── 6. 슬롯 4개 (관통) ──
const slot = cad.add('extrude', { points: '=sketch.slot()', height: `=2 * rim_R + ${DOME_H} + 10`, twist: 0, slices: 1 },
  { pos: [0, 0, '=-rim_R - 5'], name: 'Slot (R10 / R45)' });
const slotPat = step('슬롯 패턴', cad.pattern(slot, { count: '=slots', angle: 360 }, { name: 'Slots' }));
const part = step('슬롯 관통', cad.boolean('subtract', body, slotPat, 'Strainer'));

// ── 7. 도면 치수 검증표 ──
// 측정 식은 파라미터가 바뀌어도 같은 대상을 재도록 쓴다: 원판 반지름은 원판 회전체만, 슬롯은 첫 슬롯(+X 방향) 축을 따라
const BODY = "cad.find('Body (R75, R20, dome R100)')";
const XLINE = 'cad.probe([0, 0], { dir: [1, 0, 0] }).segments';              // 중심을 지나는 +X 직선 (z = 0) — 첫 슬롯 축
const CENTER_SEG = `${XLINE}.find(q => q.from[0] <= 0 && q.to[0] >= 0)`;    // 중심을 포함한 재료 구간 → 끝 = 슬롯 안쪽 끝
cad.spec('원판 R75', { expect: '=body_R', measure: `cad.radial(${BODY}).rmax`, tol: 0.05, note: '정면도 R75' });
cad.spec('관 Φ40', { expect: '=2 * rim_R', measure: 'cad.section({ x: tube_len - 5 }).loops[0].circle.d', tol: 0.05, note: '정면도 Φ40 / 측면도 R20' });
cad.spec('관 끝 135', { expect: '=tube_len', measure: 'cad.mass().bbox.max[0]', tol: 0.01, note: '정면도 135' });
cad.spec('바닥 z (두께 40)', { expect: '=-rim_R', measure: 'cad.mass().bbox.min[2]', tol: 0.01, note: '측면도 두께 40' });
cad.spec('돔 꼭대기 높이', { expect: `=rim_R + ${DOME_H}`, measure: 'cad.probe([0, 0]).segments[0].to[2]', tol: 0.02, note: 'R100 돔, 밑면 110' });
cad.spec('돔 구 반지름 R100', { expect: '=dome_R', measure: `(() => { const z0 = cad.probe([0, 0]).segments[0].to[2], r = 0.9 * (body_R - rim_R), a = 180 / slots, z1 = cad.probe({ r, a }).segments[0].to[2], d = z0 - z1;
  return (r * r + d * d) / (2 * d); })()`, tol: 0.5, note: '돔 중심과 슬롯 사이 r = 0.9·R55 점의 높이 차로 계산' });
cad.spec('돔 밑면 지름 110', { expect: `=2 * sqrt(dome_R ** 2 - (dome_R - ${DOME_H} + 0.01) ** 2)`, measure: 'cad.section({ z: rim_R + 0.01 }).loops[0].circle.d', tol: 0.05, note: '측면도 110 (z = 20.01 단면)' });
cad.spec('슬롯 폭 20', { expect: '=slot_w', measure: `(() => { const s = cad.probe([(slot_c + slot_out) / 2, 0], { dir: [0, 1, 0] }).segments;
  const a = s.filter(q => q.to[1] <= 0.01).at(-1), b = s.find(q => q.from[1] >= -0.01); return b.from[1] - a.to[1]; })()`, tol: 0.05, note: '4-R10, 첫 슬롯 가운데에서' });
cad.spec('슬롯 안쪽 끝 (R20 − R10)', { expect: '=slot_c - slot_w / 2', measure: `${CENTER_SEG}.to[0]`, tol: 0.05, note: 'R20 원 위 R10 반원' });
cad.spec('슬롯 바깥 끝 R45', { expect: '=slot_out', measure: `(() => { const s = ${XLINE}, i = s.findIndex(q => q.from[0] <= 0 && q.to[0] >= 0); return s[i + 1].from[0]; })()`, tol: 0.05, note: 'R45' });
// R40 원호(중심 CX, CY)의 가운데 점: 각 m = (180 + β + 270) / 2 → 그 X 에서 Y 방향 직선의 바깥 끝이 원호 위에 있어야 한다
const MID = `((180 + ${BETA} + 270) / 2 * D)`;
cad.spec('블렌드 R40 (중간점 y)', {
  expect: `=${CY} + blend_R * sin(${MID})`,
  measure: `cad.probe([${CX} + blend_R * cos(${MID}), 0], { dir: [0, 1, 0] }).segments.at(-1).to[1]`,
  tol: 0.1, note: '정면도 R40 원호 가운데 점의 Y 좌표' });

cad.select();
cad.view('iso');
return part;
