// 4엽 프로펠러 — 파라미터 기반 빌드 스크립트
// 실행: 빈 페이지에서 await cad.run('models/propeller.build.js')
// 치수 변경: cad.params({ hub_d: 70 }) / 날개 수: cad.params({ blades: 5 }) — 모델·형상 검사·치수 검증표가 함께 갱신된다

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
  hub_d:    { value: 62,  unit: 'mm', note: '허브 지름 Φ62' },
  hub_l:    { value: 43,  unit: 'mm', note: '허브 길이 (63 − 20)' },
  boss_d:   { value: 50,  unit: 'mm', note: '보스 지름 Φ50' },
  boss_l:   { value: 20,  unit: 'mm', note: '보스 길이' },
  chamfer:  { value: 5,   unit: 'mm', note: '보스 끝 모따기 C5 (45°)' },
  blades:   { value: 4,   unit: '개', note: '날개 수' },
  blade_r:  { value: 112, unit: 'mm', note: '날개 끝 반지름 R112' },
  fillet_r: { value: 15,  unit: 'mm', note: '날개 끝 모서리 R15' },
  blade_t:  { value: 2,   unit: 'mm', note: '날개 두께 (축방향)' },
  blade_h:  { value: 40,  unit: 'mm', note: '날개 축방향 범위 (허브 앞면 기준)' },
  pitch:    { value: 152, unit: 'mm', note: '헬릭스 피치' },
  root_ang: { value: 45,  unit: '°',  note: '앞 모서리 뿌리 각 (수직 아래 기준)' },
  tip_ang:  { value: 60,  unit: '°',  note: '앞 모서리 끝 각 (수직 아래 기준)' },
  seg:      { value: 96,  unit: '',   note: '원통 분할 수 (메쉬용 — 수치 문제 시 자동 조정)', role: 'mesh' },
  root_in:  { value: 2,   unit: 'mm', note: '날개 뿌리가 허브 안으로 들어가는 깊이 (메쉬용 — 수치 문제 시 자동 조정)', role: 'mesh' },
  blade_rot:{ value: 0,   unit: '°',  note: '날개 패턴 미세 회전 (메쉬용 — 수치 문제 시 자동 조정, ±0.5° 이내)', role: 'mesh' },
});
cad.rule('boss_in_hub', 'boss_d < hub_d', '보스 지름은 허브 지름보다 작아야 함');
cad.rule('chamfer_fit', 'chamfer > 0 && chamfer < boss_d / 2 && chamfer < boss_l', '모따기는 보스 반지름·길이보다 작아야 함');
cad.rule('blade_count', 'blades >= 2 && blades <= 8 && Math.round(blades) === blades', '날개 수는 2~8 의 정수');
cad.rule('blade_in_hub', 'blade_h > blade_t && blade_h <= hub_l - 1', '날개 축방향 범위는 두께보다 크고 허브 길이 − 1 이하');
cad.rule('fillet_fit', 'fillet_r > 0 && fillet_r < (blade_r - hub_d / 2) / 3', '끝 필렛은 날개 길이의 1/3 보다 작아야 함');
cad.rule('tip_out', 'blade_r > hub_d / 2 + 10', '날개 끝 반지름은 허브보다 10 mm 이상 커야 함');
cad.rule('root_ok', 'root_in >= 1 && root_in <= 6 && hub_d / 2 - root_in - 4 > boss_d / 4', '날개 뿌리 깊이는 1~6 mm, 허브 안에 들어가야 함');
cad.rule('blade_rot_ok', 'Math.abs(blade_rot) <= 0.5', '날개 미세 회전은 ±0.5° 이내 (설계 각도에 영향 없게)');
cad.rule('pitch_ok', 'pitch > blade_h', '피치는 날개 축방향 범위보다 커야 함 (한 바퀴 이상 감기지 않게)');

// ── 2. 스케치 (파라미터 → 2D 점열) ──
// 허브 + 보스 반단면 (r, z): 보스 끝 모따기 chamfer × 45°
cad.sketch('hubSection', `
  const top = hub_l + boss_l;
  return [[0, 0], [hub_d / 2, 0], [hub_d / 2, hub_l], [boss_d / 2, hub_l], [boss_d / 2, top - chamfer], [boss_d / 2 - chamfer, top], [0, top]];
`);
// 앞 모서리 L: 뿌리 (hub_d/2, root_ang) ↔ 끝 (blade_r, tip_ang). 정면도 각 α → 세계각 270 − α
const LINE = `
  const P0 = geo.pol(hub_d / 2, 270 - root_ang), P1 = geo.pol(blade_r, 270 - tip_ang);
  const u = geo.unit(geo.sub(P1, P0));
  const dmin = Math.abs(P0[0] * u[1] - P0[1] * u[0]);                          // 원점에서 L 까지 거리
  const at = r => geo.lineCircle(P0, u, [0, 0], Math.max(r, dmin + 0.5))[1];   // L 위에서 반지름 r 인 점 (바깥쪽)
  const span = blade_h / pitch * 360;                                            // 날개가 감기는 각
`;
// 헬리컬 시트 단면: L 과 L 을 두께만큼(δ) 돌린 선 사이 띠. 시트는 z = hub_l − blade_h − 4 에서 시작해 위로 비튼다
cad.sketch('bladeBand', LINE + `
  const z0 = hub_l - blade_h - 4, rho = (hub_l - z0) / pitch * 360, delta = blade_t / pitch * 360;
  const A = at(hub_d / 2 - root_in - 4), B = at(blade_r + 10);   // 시트 안쪽 끝은 컷터 뿌리보다 4 mm 안쪽
  return [geo.rot(A, rho), geo.rot(B, rho), geo.rot(B, rho - delta), geo.rot(A, rho - delta)];
`);
// 정면 외형: 뿌리 → L → (R fillet) → R blade_r 원호 → (R fillet) → L 을 span 만큼 돌린 선 → 허브 안 원호
cad.sketch('bladeOutline', LINE + `
  const rr = hub_d / 2 - root_in, root1 = at(rr), root2 = geo.rot(root1, span);
  return geo.profile(root1)
    .line(P1).fillet(fillet_r)
    .arc({ center: [0, 0], to: geo.rot(P1, span), ccw: true }).fillet(fillet_r)
    .line(root2)
    .arc({ center: [0, 0], to: root1, ccw: false })
    .close().points({ tol: 0.02 });
`);

// ── 3. 허브 + 보스 (회전체 하나) ──
// 반 칸(180/seg °) 돌려 날개 모서리가 원통 꼭짓점과 정확히 겹치지 않게 한다 (겹치면 비다양체 모서리)
const hub = step('허브 + 보스', cad.add('revolve', { points: '=sketch.hubSection()', angle: 360, segments: '=seg' },
  { rot: [0, 0, '=180 / seg'], name: 'Hub + Boss (C5)' }));

// ── 4. 날개 1장 (헬리컬 시트 ∩ 정면 외형) → 원형 패턴 ──
const sheet = cad.add('extrude', { points: '=sketch.bladeBand()', height: '=blade_h + 6', twist: '=-(blade_h + 6) / pitch * 360', slices: 1 },
  { pos: [0, 0, '=hub_l - blade_h - 4'], name: 'Blade helix sheet' });
const cut = cad.add('extrude', { points: '=sketch.bladeOutline()', height: '=blade_h + 4', twist: 0, slices: 1 },
  { pos: [0, 0, '=hub_l - blade_h - 2.5'], name: 'Blade outline (R, fillet)' });
const blade = step('날개 1장', cad.boolean('intersect', sheet, cut, 'Blade'));
const blades = step('날개 패턴', cad.pattern(blade, { count: '=blades', angle: 360 }, { name: 'Blades' }));
cad.update(blades, { rot: [0, 0, '=blade_rot'] });
const prop = step('허브 + 날개', cad.boolean('union', hub, blades, 'Propeller'));

// ── 5. 도면 치수 검증표 (치수를 바꾸면 기대값도 파라미터를 따라간다) ──
// 날개 가운데 위치 (반지름 중간, 앞 모서리에서 감기는 각의 절반)
const MID = 'r: (hub_d / 2 + blade_r) / 2, a: 270 - (root_ang + tip_ang) / 2 + blade_h / pitch * 180';
// 허브·보스 지름은 허브 회전체만 잘라서 잰다 (날개 단면이 섞이지 않게)
const HUB = "cad.find('Hub + Boss (C5)')";
cad.spec('허브 Φ', { expect: '=hub_d', measure: `cad.section({ z: hub_l / 2 }, ${HUB}).loops[0].circle.d`, tol: 0.05, note: '단면 A-A Φ62' });
cad.spec('보스 Φ', { expect: '=boss_d', measure: `cad.section({ z: hub_l + 2 }, ${HUB}).loops[0].circle.d`, tol: 0.05, note: '단면 A-A Φ50' });
cad.spec('보스 끝면 Φ', { expect: '=boss_d - 2 * chamfer', measure: `cad.section({ z: hub_l + boss_l - 0.001 }, ${HUB}).loops[0].circle.d`, tol: 0.05, note: '모따기 C5 → Φ40' });
cad.spec('전체 길이', { expect: '=hub_l + boss_l', measure: 'cad.radial().length', tol: 0.01, note: '측면도 63' });
cad.spec('날개 끝 R', { expect: '=blade_r', measure: 'cad.radial().rmax', tol: 0.05, note: '정면도 R112' });
cad.spec('날개 두께', { expect: '=blade_t', measure: `cad.probe({ ${MID} }).segments[0].thickness`, tol: 0.05, note: '날개 가운데, 축방향' });
cad.spec('피치', { expect: '=pitch', measure: `(() => { const q = { ${MID} }, top = a => cad.probe({ r: q.r, a }).segments[0].to[2];
  return (top(q.a - 5) - top(q.a + 5)) * 36; })()`, tol: 0.5, note: '같은 반지름에서 10° 당 윗면 높이 차 × 36' });

cad.select();
cad.view('iso');
return prop;
