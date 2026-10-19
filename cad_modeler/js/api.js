// 스크립트 API — 브라우저 콘솔(또는 Claude)에서 window.cad 로 모델링을 조작한다.
// 모든 변경은 History 를 거치므로 화면의 Undo/Redo 로 되돌릴 수 있다.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { Brush, Evaluator, INTERSECTION } from 'three-bvh-csg';
import { defaultParams, evaluateNode, PRIMITIVE_FIELDS, isBooleanNode, nodeInputs, evalCacheStats } from './kernel.js';
import { cmdAddNode, cmdDeleteNode, cmdBoolean, cmdReplaceState, cmdSetTransforms, cmdParams } from './history.js';
import { attachFormulas, applyFormulas, checkRules, isFormula, validateParamName, paramsMarkdown } from './params.js';
import { serialize, triggerDownload } from './persistence.js';
import { getMeshForNode } from './visualize.js';
import { composeDelta } from './gizmo.js';
import { buildStepText, exportNodes } from './exporters.js';
import { collectIssues } from './health.js';
import { probe as probeGeoms, section as sectionGeoms, massProps, radial as radialGeoms } from './query.js';

// 설계 의도와 무관한 메쉬 수치 문제 (role:'mesh' 파라미터를 바꿔 피할 수 있는 것)
const MESH_CODES = new Set(['open', 'flipped', 'nonmanifold', 'bool-volume', 'inverted']);

const HELP = `window.cad — Simple CAD Modeler 스크립트 API (단위 mm, Z-up, 회전은 XYZ 오일러 °)
  cad.list()                         노드 요약 [{id,type,name,params,transform,bbox,...}]
  cad.find(name | /정규식/)           이름으로 노드 id 찾기 → [id]
  cad.get(id)                        노드 하나 요약
  cad.add(type, params?, opts?)      type: box|cylinder|sphere|cone|extrude|revolve, opts: {pos,rot,scale,name} → id
                                     extrude: {points:[[x,y],...], height, twist°, slices} — z 0→height 로 돌출,
                                       twist≠0 이면 Z축 헬리컬 스윕 (twist = height/pitch·360)
                                     revolve: {points:[[r,z],...], angle°, segments} — (r,z) 반단면을 Z축 둘레로 회전
  cad.boolean(op, a, b, name?)       op: union|subtract|intersect → id  (a 에서 b 를 뺌)
  cad.pattern(src, {count, angle}, {name}) Z축 원형 패턴 (count: '=blades' 처럼 파라미터 연결 가능) → id
  await cad.batch(fn)                fn 안의 변경을 Undo 한 단계로, 화면 갱신은 끝에 한 번
  cad.cacheStats()                   평가 캐시 {hits, misses, entries, mb}
  cad.update(id, {params,pos,rot,scale,name,visible})
  cad.move(ids, [dx,dy,dz])          노드들을 상대 이동 (한 번의 Undo)
  cad.moveTo(ids, [x,y,z], anchor?)  bbox 중심(anchor='bottom' 이면 바닥 중심)을 해당 좌표로
  cad.rotate(ids, [rx,ry,rz], pivot?) 세계 축 기준 회전 (기본 pivot = bbox 중심). Y-up 모델 → Z-up: [90,0,0]
  cad.remove(...ids)                 삭제 (Boolean 입력으로 쓰이는 노드는 건너뜀 → 반환값)
  cad.select(...ids)                 화면 선택 (빈 인자 = 선택 해제)
  await cad.importStep(url)          서버 경로의 STEP 을 참조 모델로 가져오기 → [ids]
  cad.bbox(...ids)                   세계 좌표 bbox {min,max,size,center}
  cad.distance(a, b)                 두 노드 최소거리 {distance, intersects, pointA, pointB}
  cad.view(name?, ids?)              iso|top|bottom|front|back|left|right (+ids 로 해당 노드만 프레이밍)
  cad.lastMeasure()                  측정 패널의 마지막 결과
  cad.undo() / cad.redo() / cad.newScene() / cad.toJSON()
  — 파라미터 (치수 변경은 파라미터 하나만 바꾸면 모델 전체가 따라오게) —
  cad.params({이름: 값 | {value,unit,note,role}}, {force?, heal?}) 정의·변경 → 수식 전부 재계산 → 바로 형상 검사
                                       → {changed, formulaErrors, check, healed}. 규칙 위반이면 거부.
                                       메쉬 수치 문제가 생기면 role:'mesh' 파라미터(분할 수 등)를 조금 바꿔 자동으로 피함 (heal:false 로 끔)
  cad.params() / cad.param(name, value?) 값 읽기 / 한 개 변경
  cad.add(type, {radius: '=hub_d/2'}, {pos: [0, 0, '=hub_l/2']})   '=수식' 은 파라미터에 연결된 값
  cad.sketch(name, code)             파라미터로 점열을 만드는 함수 본문 (노드에서 points: '=sketch.name()')
  cad.rule(name, expr, message)      파라미터 조건 (예: 'boss_d < hub_d') — 어기는 변경은 거부
  — 수치 질의 (확인 요청에 숫자로 답하기) —
  cad.probe([x,y] | {r, a}, {dir?, ids?}) Z 방향 직선이 만나는 면 높이와 재료 구간 두께 → {hits, segments:[{from,to,thickness}]}
  cad.section({z}|{x}|{y}|{point,normal}, ids?) 단면 고리별 넓이·중심·bbox·원 맞춤 지름, 구멍 지름 → {area, loops, holes}
  cad.mass(ids?, {density?})          부피·겉넓이·무게중심·bbox
  cad.radial(ids?)                   Z축 기준 최대·최소 반지름(지름), 높이 범위
  — 도면 치수 검증표 (수정 반영 후 자동 재확인) —
  cad.spec(name, {expect, measure, tol?, note?})  expect: 숫자 | '=수식', measure: "cad.section({z:20}).loops[0].circle.d" 같은 식
  cad.specs()                        → {ok, rows, table}. cad.params() 결과에도 전후 비교표(specs.table) 포함, cad.check() 에 불일치 포함
  — 형상 검사 (설계 단계마다 실행해 오류·경고를 0 으로 만든 뒤 다음 단계로) —
  cad.check(...ids)                  열린/찢어진 면, 면 방향, 비다양체, Boolean 실패·효과 없음·분리 검사
                                       (ids 없으면 최상위 전체와 그 하위) → {ok, errors, warnings, issues:[{id,name,level,code,message}]}
  — 저장 / 이어서 작업 (페이지는 항상 빈 장면으로 열린다. 작업 순서는 AGENTS.md) —
  await cad.saveStep(path, ids?, {force?}) STEP 을 서버 models/ 에 저장 (ids 없으면 보이는 최상위 전체).
                                     형상 검사에 오류·경고가 있으면 저장하지 않고 예외 (force:true 로 무시).
                                     단일 파트 → .stp, 어셈블리 → .step 자동 → {path,bytes,open,...}
  await cad.saveText(path, text)     작업 기록(.md)·빌드 스크립트(.build.js) 등 텍스트를 models/ 에 저장
  await cad.run(url)                 빌드 스크립트 실행 (예: 'models/propeller.build.js') → 스크립트의 return 값
  cad.report()                       현재 장면 트리·파라미터를 마크다운으로 (작업 기록에 붙여 넣기용)`;

// models/ 아래로 PUT (launcher.py 가 받는다). 정적 서버라 PUT 을 못 받으면 브라우저 다운로드로 대신한다
async function putFile(path, body, type) {
  const rel = String(path).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel.startsWith('models/') || rel.split('/').includes('..')) throw new Error(`models/ 아래 경로만 저장할 수 있습니다: ${path}`);
  const blob = new Blob([body], { type });
  let r;
  try { r = await fetch(rel, { method: 'PUT', body: blob, headers: { 'Content-Type': type } }); } catch (err) { r = null; }
  if (r && r.ok) return { ...(await r.json()), downloaded: false };
  if (!r || r.status === 405 || r.status === 501) {
    triggerDownload(blob, rel.split('/').pop());
    console.warn(`서버가 저장을 받지 않아 브라우저 다운로드로 저장했습니다 (launcher.py 로 실행하면 ${rel} 에 바로 저장됨)`);
    return { path: rel, bytes: blob.size, downloaded: true };
  }
  throw new Error(`${rel} 저장 실패: HTTP ${r.status} ${await r.text().catch(() => '')}`.trim());
}

// 거리/간섭 계산용 BVH. 화면용 BVH 는 삼각형 순서를 보존하는 indirect 모드인데,
// three-mesh-bvh 의 geometry 간 거리 계산은 indirect 에서 결과가 틀리므로 별도의 일반 BVH 를 만들어 캐시한다.
const distCache = new WeakMap();
function distanceGeometry(geom) {
  let g = distCache.get(geom);
  if (!g) {
    g = new THREE.BufferGeometry();
    g.setAttribute('position', geom.attributes.position);
    if (geom.index) g.setIndex(geom.index.clone());
    g.boundsTree = new MeshBVH(g);
    distCache.set(geom, g);
  }
  return g;
}

// 두 삼각형 사이 거리 (교차하지 않는다는 가정): 꼭짓점–면 6쌍, 변–변 9쌍 중 최소.
// three-mesh-bvh 의 distanceToTriangle 은 같은 평면 위의 떨어진 두 삼각형(동축 구멍 벽 등)을 0 으로 내므로 직접 계산한다.
const _ta = new THREE.Triangle(), _tb = new THREE.Triangle(), _q = new THREE.Vector3();
const _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3();
function segSegClosest(p1, q1, p2, q2, outA, outB) {
  const d1 = _s1.subVectors(q1, p1), d2 = _s2.subVectors(q2, p2);
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.x * rx + d2.y * ry + d2.z * rz;
  let s = 0, t = 0;
  if (a > 1e-14 || e > 1e-14) {
    if (a <= 1e-14) t = Math.min(1, Math.max(0, f / e));
    else {
      const c = d1.x * rx + d1.y * ry + d1.z * rz;
      if (e <= 1e-14) s = Math.min(1, Math.max(0, -c / a));
      else {
        const b = d1.dot(d2), den = a * e - b * b;
        s = den > 1e-14 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
        else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
      }
    }
  }
  outA.copy(p1).addScaledVector(d1, s);
  outB.copy(p2).addScaledVector(d2, t);
  return outA.distanceTo(outB);
}
function triTriDistance(A, B, outA, outB) {
  _ta.set(A.a, A.b, A.c); _tb.set(B.a, B.b, B.c);
  let best = Infinity;
  const ca = new THREE.Vector3(), cb = new THREE.Vector3();
  for (const v of [B.a, B.b, B.c]) {
    _ta.closestPointToPoint(v, _q);
    const d = _q.distanceTo(v);
    if (d < best) { best = d; outA.copy(_q); outB.copy(v); }
  }
  for (const v of [A.a, A.b, A.c]) {
    _tb.closestPointToPoint(v, _q);
    const d = _q.distanceTo(v);
    if (d < best) { best = d; outA.copy(v); outB.copy(_q); }
  }
  const ea = [[A.a, A.b], [A.b, A.c], [A.c, A.a]], eb = [[B.a, B.b], [B.b, B.c], [B.c, B.a]];
  for (const [p1, q1] of ea) for (const [p2, q2] of eb) {
    const d = segSegClosest(p1, q1, p2, q2, ca, cb);
    if (d < best) { best = d; outA.copy(ca); outB.copy(cb); }
  }
  return best;
}

// 두 메쉬 표면 사이 최단거리. 삼각형 수가 적은 쪽의 각 삼각형에 대해
// 다른 쪽 BVH 를 현재 최솟값보다 가까운 노드만 탐색하며 삼각형–삼각형 거리를 잰다.
// (three-mesh-bvh 0.7.8 의 closestPointToGeometry 도 같은 이유로 결과가 틀려 쓰지 않는다)
function triCount(g) { return g.index ? g.index.count / 3 : g.attributes.position.count / 3; }
function boxGap(a, b) {
  const dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
  const dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y);
  const dz = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
  return Math.hypot(dx, dy, dz);
}
function meshDistance(gA, gB) {
  const swap = triCount(gA) < triCount(gB);
  const [big, small] = swap ? [gB, gA] : [gA, gB];
  const pos = small.attributes.position, idx = small.index;
  const tri = new THREE.Triangle();
  const triBox = new THREE.Box3();
  const p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
  let best = Infinity;
  const bestS = new THREE.Vector3(), bestB = new THREE.Vector3();
  const n = triCount(small);
  for (let t = 0; t < n && best > 0; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    tri.a.fromBufferAttribute(pos, i0); tri.b.fromBufferAttribute(pos, i1); tri.c.fromBufferAttribute(pos, i2);
    triBox.setFromPoints([tri.a, tri.b, tri.c]);
    big.boundsTree.shapecast({
      intersectsBounds: box => boxGap(box, triBox) < best,
      boundsTraverseOrder: box => boxGap(box, triBox),
      intersectsTriangle: other => {
        const d = triTriDistance(other, tri, p1, p2);
        if (d < best) { best = d; bestB.copy(p1); bestS.copy(p2); }
        return d === 0;
      },
    });
  }
  return swap
    ? { distance: best, pointA: bestS, pointB: bestB }
    : { distance: best, pointA: bestB, pointB: bestS };
}

// 두 닫힌 메쉬의 교집합 체적 (mm³). 계산 실패(열린 메쉬 등) 시 null
const csgEval = new Evaluator();
csgEval.attributes = ['position'];
csgEval.useGroups = false;
function intersectionVolume(gA, gB) {
  try {
    const bare = g => {
      const x = new THREE.BufferGeometry();
      x.setAttribute('position', g.attributes.position);
      if (g.index) x.setIndex(g.index.clone());
      return x;
    };
    const a = new Brush(bare(gA)), b = new Brush(bare(gB));
    a.updateMatrixWorld(); b.updateMatrixWorld();
    const res = csgEval.evaluate(a, b, INTERSECTION);
    const pos = res.geometry.attributes.position, idx = res.geometry.index;
    const n = idx ? idx.count / 3 : pos.count / 3;
    const p = new THREE.Vector3(), q = new THREE.Vector3(), w = new THREE.Vector3();
    let vol = 0;
    for (let t = 0; t < n; t++) {
      p.fromBufferAttribute(pos, idx ? idx.getX(3 * t) : 3 * t);
      q.fromBufferAttribute(pos, idx ? idx.getX(3 * t + 1) : 3 * t + 1);
      w.fromBufferAttribute(pos, idx ? idx.getX(3 * t + 2) : 3 * t + 2);
      vol += p.dot(q.cross(w)) / 6;
    }
    res.geometry.dispose(); a.geometry.dispose(); b.geometry.dispose();
    return Math.abs(vol);
  } catch (err) {
    console.warn('교집합 체적 계산 실패:', err);
    return null;
  }
}

export function createApi(deps) {
  const { state, history, redraw, importStepFromUrl, measure, setView, toast } = deps;

  const node = id => {
    const n = state.nodes.find(x => x.id === id);
    if (!n) throw new Error(`노드 없음: ${id}`);
    return n;
  };
  const nodeMap = () => new Map(state.nodes.map(n => [n.id, n]));

  // 화면에 그려진 메쉬가 있으면 그 지오메트리, 없으면(숨김/boolean 자식) 새로 평가
  function worldGeometry(id) {
    const mesh = getMeshForNode(id);
    if (mesh && mesh.position.lengthSq() === 0) return { geom: mesh.geometry, temp: false };
    const g = evaluateNode(node(id), nodeMap());
    if (!g) throw new Error(`형상을 계산할 수 없음: ${id} (STEP 파일이 로드되지 않았을 수 있음)`);
    return { geom: g, temp: true };
  }

  function boxOf(ids) {
    const box = new THREE.Box3();
    for (const id of ids) {
      const { geom, temp } = worldGeometry(id);
      geom.computeBoundingBox();
      box.union(geom.boundingBox);
      if (temp) geom.dispose();
    }
    return box;
  }

  const r3 = v => Math.round(v * 1000) / 1000;
  const boxJSON = b => b.isEmpty() ? null : {
    min: b.min.toArray().map(r3), max: b.max.toArray().map(r3),
    size: b.getSize(new THREE.Vector3()).toArray().map(r3),
    center: b.getCenter(new THREE.Vector3()).toArray().map(r3),
  };

  function summary(n) {
    const out = { id: n.id, type: n.type, name: n.name, visible: n.visible !== false, transform: n.transform };
    if (n.params) out.params = n.params;
    if (isBooleanNode(n)) Object.assign(out, { op: n.op, a: n.a, b: n.b });
    if (n.type === 'pattern') Object.assign(out, { src: n.src });
    if (n.expr) out.expr = n.expr;
    if (n.type === 'step') Object.assign(out, { source: n.source, path: n.path });
    try { out.bbox = boxJSON(boxOf([n.id])); } catch { out.bbox = null; }
    return out;
  }

  function newId() { return `n${state.nextId++}`; }

  // 측정 대상: ids 를 주면 그 노드들, 없으면 화면에 보이는 최상위 형상 전체
  function measureGeoms(ids) {
    const nodes = ids ? [].concat(ids).map(node) : exportNodes({ ...state, selection: [] }, { includeStep: true });
    if (!nodes.length) throw new Error('측정할 형상이 없습니다');
    const map = nodeMap();
    return nodes.map(n => {
      const g = evaluateNode(n, map);
      if (!g) throw new Error(`형상을 계산할 수 없음: ${n.id}`);
      return g;
    });
  }
  function withGeoms(ids, fn) {
    const gs = measureGeoms(ids);
    try { return fn(gs); } finally { gs.forEach(g => g.dispose()); }
  }

  // 도면 치수 검증표: 각 항목의 measure(수식 문자열, cad·파라미터 사용)를 계산해 expect 와 비교
  function evalSpecs() {
    const p = Object.fromEntries(Object.entries(state.params || {}).map(([k, v]) => [k, v.value]));
    const names = Object.keys(p);
    return (state.specs || []).map(sp => {
      const row = { name: sp.name, note: sp.note || '', tol: sp.tol ?? 0.05 };
      try {
        // 파라미터 수식과 같은 수학 함수 (sqrt, sin, atan2, PI, D = π/180 …)
        const ev = code => new Function('cad', 'p', ...names,
          `const {PI, abs, min, max, sqrt, sin, cos, tan, atan2, round, ceil, floor, hypot} = Math; const D = PI / 180; return (${code});`)(api, p, ...names.map(n => p[n]));
        row.expect = typeof sp.expect === 'string' ? ev(sp.expect.replace(/^\s*=/, '')) : sp.expect;
        row.actual = ev(sp.measure);
        if (typeof row.actual !== 'number' || !Number.isFinite(row.actual)) throw new Error(`측정값이 숫자가 아님 (${row.actual})`);
        row.delta = Math.round((row.actual - row.expect) * 1e4) / 1e4;
        row.expect = Math.round(row.expect * 1e4) / 1e4;
        row.actual = Math.round(row.actual * 1e4) / 1e4;
        row.ok = Math.abs(row.actual - row.expect) <= row.tol;
      } catch (err) {
        row.ok = false; row.error = err.message;
      }
      return row;
    });
  }
  function specsTable(rows, before = null) {
    const prev = before ? new Map(before.map(r => [r.name, r])) : null;
    const lines = [`| 항목 | 기대 | 실측 | 차이 | 허용 | 판정 |${prev ? ' 변경 전 |' : ''}`, `|---|---|---|---|---|---|${prev ? '---|' : ''}`];
    for (const r of rows) {
      const b = prev?.get(r.name);
      lines.push(`| ${r.name} | ${r.expect ?? ''} | ${r.error ? '오류: ' + r.error : r.actual} | ${r.delta ?? ''} | ±${r.tol} | ${r.ok ? '✓' : '✗'} |`
        + (prev ? ` ${b ? (b.actual !== r.actual ? `${b.actual} → ${r.actual}` : '—') : '(새 항목)'} |` : ''));
    }
    return lines.join('\n');
  }
  function specIssues(rows) {
    return rows.filter(r => !r.ok).map(r => ({ id: '-', name: `검증 ${r.name}`, level: 'error', code: 'spec',
      message: r.error ? `검증 계산 실패: ${r.error}` : `도면 치수 불일치: 기대 ${r.expect}, 실측 ${r.actual} (차이 ${r.delta}, 허용 ±${r.tol})` }));
  }

  const api = {
    help() { console.log(HELP); return HELP; },
    list() { return state.nodes.map(summary); },
    get(id) { return summary(node(id)); },

    add(type, params = {}, opts = {}) {
      if (!PRIMITIVE_FIELDS[type]) throw new Error(`알 수 없는 type: ${type}`);
      const n = {
        id: null, type,
        params: { ...defaultParams(type), ...params },
        transform: { pos: [...(opts.pos || [0, 0, 0])], rot: [...(opts.rot || [0, 0, 0])], scale: [...(opts.scale || [1, 1, 1])] },
        name: opts.name || `${type}_${state.nodes.length + 1}`,
        visible: true,
      };
      // '=수식' 값은 파라미터에 묶는다 (예: radius: '=hub_d/2'). 계산에 실패하면 id 를 쓰지 않고 예외
      attachFormulas(state, n, { params, pos: opts.pos, rot: opts.rot, scale: opts.scale });
      n.id = newId();
      history.apply(cmdAddNode(n));
      return n.id;
    },

    boolean(op, a, b, name) {
      node(a); node(b);
      for (const id of [a, b]) if (state.nodes.some(n => nodeInputs(n).includes(id))) throw new Error(`${id} 는 이미 다른 노드의 입력입니다`);
      const id = newId();
      history.apply(cmdBoolean(op, a, b, id, o => name || `${o}_${state.nodes.length + 1}`));
      return id;
    },

    // 이름(문자열은 정확히 일치, RegExp 는 패턴)으로 노드 id 찾기 → [id]
    find(name) {
      const hit = n => name instanceof RegExp ? name.test(n.name || '') : n.name === name;
      return state.nodes.filter(hit).map(n => n.id);
    },

    // 원형 패턴: src 를 Z축 둘레로 count 개 (angle 360 = 등분). count·angle 에 '=수식' 가능 (예: count: '=blades')
    pattern(src, params = {}, opts = {}) {
      node(src);
      if (state.nodes.some(n => nodeInputs(n).includes(src))) throw new Error(`${src} 는 이미 다른 노드의 입력입니다`);
      const n = {
        id: null, type: 'pattern', src,
        params: { count: 2, angle: 360, ...params },
        transform: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
        name: opts.name || `pattern_${state.nodes.length + 1}`,
        visible: true,
      };
      attachFormulas(state, n, { params });
      n.id = newId();
      history.apply(cmdAddNode(n));
      return n.id;
    },

    // fn 안의 변경을 Undo 한 단계로 묶고 화면은 끝에 한 번만 갱신한다 (async 함수도 가능) → fn 의 반환값
    batch(fn, label = 'Batch') { return history.group(label, fn); },

    // 평가 캐시 상태 {hits, misses, entries, mb}
    cacheStats() { return evalCacheStats(); },

    update(id, patch) {
      const n = node(id);
      const prev = JSON.parse(JSON.stringify(n));
      const next = JSON.parse(JSON.stringify(n));
      if (patch.params) next.params = { ...next.params, ...patch.params };
      if (patch.pos) next.transform.pos = [...patch.pos];
      if (patch.rot) next.transform.rot = [...patch.rot];
      if (patch.scale) next.transform.scale = [...patch.scale];
      // 숫자로 직접 넣은 자리는 수식 연결을 끊고, '=수식' 은 새로 연결한다
      if (next.expr) {
        const drop = path => { if (next.expr[path] !== undefined) { console.warn(`${id} ${path} 의 수식(${next.expr[path]})을 해제하고 숫자로 고정합니다`); delete next.expr[path]; } };
        for (const [k, v] of Object.entries(patch.params || {})) if (!isFormula(v)) drop(`params.${k}`);
        for (const head of ['pos', 'rot', 'scale']) (patch[head] || []).forEach((v, i) => { if (!isFormula(v)) drop(`${head}.${i}`); });
        if (!Object.keys(next.expr).length) delete next.expr;
      }
      attachFormulas(state, next, { params: patch.params, pos: patch.pos, rot: patch.rot, scale: patch.scale });
      if (patch.name !== undefined) next.name = patch.name;
      if (patch.visible !== undefined) next.visible = patch.visible;
      history.apply({
        label: 'API update',
        do: s => { const i = s.nodes.findIndex(x => x.id === id); if (i >= 0) s.nodes[i] = JSON.parse(JSON.stringify(next)); },
        undo: s => { const i = s.nodes.findIndex(x => x.id === id); if (i >= 0) s.nodes[i] = JSON.parse(JSON.stringify(prev)); },
      });
      return summary(state.nodes.find(x => x.id === id));
    },

    // ── 파라미터 (CATIA Parameters/Formulas) ──
    // cad.params()                         → { 이름: 값 }
    // cad.params({ hub_d: 62, pitch: { value: 152, unit: 'mm', note: '헬릭스 피치' } }, { force })
    //   정의하거나 값을 바꾸고 모든 수식을 다시 계산한다 (Undo 한 단계). 규칙을 어기면 바꾸지 않고 예외 (force 로 무시)
    params(defs, opts = {}) {
      if (defs === undefined) return Object.fromEntries(Object.entries(state.params || {}).map(([k, v]) => [k, v.value]));
      const entries = Object.entries(defs).map(([k, v]) => {
        validateParamName(k);
        const d = typeof v === 'object' && v !== null ? v : { value: v };
        if (d.value !== undefined && !Number.isFinite(d.value)) throw new Error(`${k}: 값은 숫자여야 합니다 (${d.value})`);
        return [k, d];
      });
      const mutate = s => {
        s.params = s.params || {};
        for (const [k, d] of entries) s.params[k] = { ...(s.params[k] || {}), ...d };
      };
      // 규칙은 바꾸기 전에 복사본으로 미리 검사한다
      const trial = { ...state, params: structuredClone(state.params || {}) };
      mutate(trial);
      const broken = checkRules(trial);
      if (broken.length && !opts.force) {
        throw new Error(`파라미터 규칙 위반 — 바꾸지 않았습니다:\n${broken.map(r => `  ${r.expr}: ${r.message}`).join('\n')}`);
      }
      const specsBefore = opts.check !== false && (state.specs || []).length ? evalSpecs() : null;
      const before = state.nodes.map(n => JSON.stringify([n.params, n.transform]));
      history.apply(cmdParams(`Params ${entries.map(e => e[0]).join(', ')}`, mutate, applyFormulas));
      const changed = state.nodes.filter((n, i) => JSON.stringify([n.params, n.transform]) !== before[i]).map(n => n.id);
      const formulaErrors = state.formulaErrors || [];
      if (formulaErrors.length) console.warn('수식 계산 실패:', formulaErrors);
      if (opts.check === false) return { changed, formulaErrors, rules: broken };
      // 바뀐 모델을 바로 검사하고, 메쉬 수치 문제(CSG 잔여물)면 설계 치수가 아닌 role:'mesh' 파라미터(분할 수 등)를
      // 조금씩 바꿔 가며 문제가 없어지는 값을 찾는다 — 설계 의도는 그대로 두고 수치 우연만 피한다
      let check = api.check();
      let healed = null;
      const numeric = c => c.issues.filter(i => MESH_CODES.has(i.code));
      if (numeric(check).length && opts.heal !== false) {
        const meshParams = Object.entries(state.params || {}).filter(([, v]) => v.role === 'mesh');
        outer: for (const [k, v] of meshParams) {
          // 0 인 값은 조금 더하고 빼 보고, 아니면 비율로 바꿔 본다 (정수 파라미터는 정수로)
          const cands = v.value === 0 ? [0.1, -0.1, 0.25, -0.25, 0.5] : [1.05, 0.95, 1.1, 0.9, 1.2].map(f => v.value * f);
          for (const c of cands) {
            const nv = Number.isInteger(v.value) && v.value !== 0 ? Math.round(c) : +c.toFixed(4);
            if (nv === v.value) continue;
            const trialState = { ...state, params: { ...state.params, [k]: { ...v, value: nv } } };
            if (checkRules(trialState).length) continue;
            history.apply(cmdParams(`Heal ${k}=${nv}`, s => { s.params = { ...s.params, [k]: { ...s.params[k], value: nv } }; }, applyFormulas));
            const c2 = api.check();
            if (!numeric(c2).length) { healed = { param: k, from: v.value, to: nv }; check = c2; break outer; }
            history.undo();
          }
        }
        if (healed) console.warn(`메쉬 수치 문제를 피하려고 ${healed.param} 를 ${healed.from} → ${healed.to} 로 바꿨습니다`);
      }
      const out = { changed, formulaErrors, rules: broken, healed, check: { ok: check.ok, errors: check.errors, warnings: check.warnings, issues: check.issues } };
      if (specsBefore) {
        const rows = evalSpecs();
        out.specs = { ok: rows.every(r => r.ok), rows, table: specsTable(rows, specsBefore),
          changed: rows.filter(r => specsBefore.find(b => b.name === r.name)?.actual !== r.actual).map(r => r.name) };
      }
      return out;
    },
    param(name, value, meta = {}) {
      if (value === undefined) return state.params?.[name]?.value;
      return api.params({ [name]: { ...meta, value } });
    },
    // 파라미터로 2D 점열을 만드는 코드. 본문에서 파라미터 이름·geo 도우미·args 를 쓸 수 있고 점열을 return.
    // 노드에서는 points: '=sketch.이름()' 으로 연결한다
    sketch(name, code) {
      validateParamName(name);
      if (code === undefined) return state.sketches?.[name];
      history.apply(cmdParams(`Sketch ${name}`, s => { s.sketches = { ...(s.sketches || {}), [name]: String(code) }; }, applyFormulas));
      return { formulaErrors: state.formulaErrors || [] };
    },
    // 파라미터가 지켜야 할 조건 (예: cad.rule('boss_fits', 'boss_d < hub_d', '보스 지름은 허브보다 작아야 함')). expr 없이 부르면 삭제
    rule(name, expr, message) {
      history.apply(cmdParams(`Rule ${name}`, s => {
        s.rules = (s.rules || []).filter(r => r.name !== name).concat(expr ? [{ name, expr, message }] : []);
      }, applyFormulas));
      return checkRules(state);
    },

    move(ids, d) {
      ids = [].concat(ids);
      const updates = ids.map(id => {
        const t = node(id).transform;
        return { id, transform: { ...t, pos: t.pos.map((v, i) => v + (d[i] || 0)) } };
      });
      history.apply(cmdSetTransforms(updates, 'API move'));
    },

    // ids 전체 bbox 의 기준점(anchor)이 target 에 오도록 이동. anchor: 'center' | 'bottom'(바닥면 중심)
    moveTo(ids, target = [0, 0, 0], anchor = 'center') {
      ids = [].concat(ids);
      const b = boxOf(ids);
      const ref = b.getCenter(new THREE.Vector3());
      if (anchor === 'bottom') ref.z = b.min.z;
      api.move(ids, [target[0] - ref.x, target[1] - ref.y, target[2] - ref.z]);
    },

    // ids 전체를 pivot(기본: bbox 중심) 기준으로 세계 X→Y→Z 순서로 회전 (deg). 예: Y-up 모델 → Z-up 은 [90,0,0]
    rotate(ids, deg, pivot = null) {
      ids = [].concat(ids);
      const c = pivot ? new THREE.Vector3(...pivot) : boxOf(ids).getCenter(new THREE.Vector3());
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...deg.map(THREE.MathUtils.degToRad), 'ZYX'));
      const D = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z)
        .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
        .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
      history.apply(cmdSetTransforms(ids.map(id => ({ id, transform: composeDelta(D, node(id).transform) })), 'API rotate'));
    },

    // Boolean 의 입력(a/b)으로 쓰이는 노드는 지우지 않는다 — 지우면 Boolean 결과가 조용히 사라진다.
    // 같은 호출에 Boolean 도 들어 있으면 Boolean 을 먼저 지운 뒤 입력을 지운다. 반환: 지우지 못한 id
    remove(...ids) {
      let rest = ids.flat().filter(id => state.nodes.some(n => n.id === id));
      const usedAsInput = id => state.nodes.some(n => nodeInputs(n).includes(id));
      for (let progress = true; progress && rest.length;) {
        progress = false;
        for (const id of [...rest]) {
          if (usedAsInput(id)) continue;
          history.apply(cmdDeleteNode(id));
          rest = rest.filter(x => x !== id);
          progress = true;
        }
      }
      return rest;
    },

    select(...ids) {
      state.selection = ids.flat().filter(id => state.nodes.some(n => n.id === id));
      redraw();
    },

    async importStep(url) { return importStepFromUrl(url); },

    bbox(...ids) {
      ids = ids.flat();
      if (!ids.length) ids = state.nodes.filter(n => n.visible !== false).map(n => n.id);
      return boxJSON(boxOf(ids));
    },

    // BVH 기반 두 노드 간 최소거리 + 간섭 여부 (메쉬 근사이므로 곡면은 분할 오차 포함)
    distance(a, b) {
      const A = worldGeometry(a), B = worldGeometry(b);
      try {
        const gA = distanceGeometry(A.geom), gB = distanceGeometry(B.geom);
        const r = meshDistance(gA, gB);
        let hit = gA.boundsTree.intersectsGeometry(gB, new THREE.Matrix4());
        // 표면이 닿기만 해도(면 접촉) 교차로 잡히므로, 겹친 체적을 CSG 로 구해 실제 간섭인지 가린다
        let overlapVolume = null;
        if (hit) {
          overlapVolume = intersectionVolume(gA, gB);
          if (overlapVolume !== null && overlapVolume < 1e-3) hit = false;
        }
        return {
          distance: r3(hit ? 0 : r.distance),
          intersects: hit,
          touching: !hit && r.distance < 1e-3,
          overlapVolume: overlapVolume === null ? null : r3(overlapVolume),
          pointA: r.pointA.toArray().map(r3), pointB: r.pointB.toArray().map(r3),
        };
      } finally {
        if (A.temp) A.geom.dispose();
        if (B.temp) B.geom.dispose();
      }
    },

    // 형상 1개면 단일 파트 .stp, 여러 개면 어셈블리 .step (화면의 STEP 버튼과 같은 규칙).
    // path 의 확장자는 생략해도 되고, 규칙과 다르면 맞는 확장자로 바꿔 저장한다. 다시 열 때는 빈 장면에서 cad.importStep(path)
    async saveStep(path, ids, opts = {}) {
      // ids 가 없으면 화면 선택과 상관없이 보이는 최상위 형상 전체
      const nodes = ids ? [].concat(ids).map(node) : exportNodes({ ...state, selection: [] }, { includeStep: true });
      if (!nodes.length) throw new Error('저장할 도형이 없습니다');
      const issues = [...(ids ? [] : specIssues(evalSpecs())), ...collectIssues(nodes, nodeMap())];
      if (issues.length && !opts.force) {
        throw new Error(`형상 검사 문제 ${issues.length}건 — 해결한 뒤 저장하세요 (cad.check() 로 확인, 불가피하면 {force:true} 와 작업 기록에 사유):\n`
          + issues.map(i => `  ${i.id} ${i.name}: [${i.level}] ${i.message}`).join('\n'));
      }
      const ext = nodes.length > 1 ? '.step' : '.stp';
      const base = String(path).replace(/\.(step|stp)$/i, '');
      if (/\.(step|stp)$/i.test(String(path)) && !String(path).toLowerCase().endsWith(ext)) {
        console.warn(`${nodes.length > 1 ? '어셈블리' : '단일 파트'}는 ${ext} 로 저장합니다: ${base}${ext}`);
      }
      path = base + ext;
      const fileName = path.split('/').pop();
      const r = buildStepText(state, { nodes, assembly: nodes.length > 1, fileName });
      if (r.open) console.warn(`STEP 메쉬가 완전히 닫혀 있지 않습니다 (열린 파트 ${r.open}개) — 다시 불러와 형상을 확인하세요`);
      const saved = await putFile(path, r.text, 'application/step');
      toast(`${saved.path} 저장${saved.downloaded ? ' (다운로드)' : ''}`, 'success');
      return { ...saved, components: r.components, triangles: r.triangles, faces: r.faces, open: r.open, issues };
    },

    // ── 수치 질의 ──
    // cad.probe([x, y]) / cad.probe({r, a}) — Z 방향 직선이 만나는 면과 재료 구간(두께). opts: {dir:[..], z, ids}
    probe(at, opts = {}) {
      let xy = at;
      if (!Array.isArray(at)) { const a = (at.a ?? at.angle) * Math.PI / 180; xy = [at.r * Math.cos(a), at.r * Math.sin(a)]; }
      const origin = [xy[0], xy[1], xy[2] ?? opts.z ?? 0];
      return withGeoms(opts.ids, gs => probeGeoms(gs, origin, opts.dir || [0, 0, 1]));
    },
    // cad.section({z: 30}) | {x} | {y} | {point, normal} — 단면 고리마다 넓이·중심·bbox·원 맞춤(지름), 구멍 지름 목록
    section(plane, ids) { return withGeoms(ids, gs => sectionGeoms(gs, plane)); },
    // cad.mass(ids?, {density}) — 부피·겉넓이·무게중심·bbox (density 를 주면 질량)
    mass(ids, opts = {}) { return withGeoms(ids, gs => massProps(gs, opts.density)); },
    // cad.radial(ids?) — Z축에서 가장 먼/가까운 반지름, 높이 범위 {rmax, dmax, rmin, zmin, zmax, length}
    radial(ids) { return withGeoms(ids, gs => radialGeoms(gs)); },

    // ── 도면 치수 검증표 ──
    // cad.spec('Φ62 허브', { expect: 62, measure: "cad.section({z: 20}).loops[0].circle.d", tol: 0.05, note: '단면 A-A' })
    //   expect: 도면 값(숫자) 또는 '=수식'(파라미터를 따라감), measure: cad·파라미터를 쓰는 식 (문자열 — 저장됨)
    // cad.spec(name, null) 삭제. 정의는 Undo 가능하고 JSON 에 저장된다
    spec(name, def) {
      if (def !== null && (!def || def.measure === undefined || def.expect === undefined)) throw new Error('spec: {expect, measure} 가 필요합니다');
      history.apply(cmdParams(`Spec ${name}`, st => {
        st.specs = (st.specs || []).filter(x => x.name !== name).concat(def ? [{ name, tol: 0.05, ...def, measure: String(def.measure) }] : []);
      }, applyFormulas));
      return def ? evalSpecs().find(r => r.name === name) : null;
    },
    // 검증표 전체 → {ok, rows, table(마크다운)}
    specs() {
      const rows = evalSpecs();
      return { ok: rows.every(r => r.ok), rows, table: specsTable(rows) };
    },

    check(...ids) {
      ids = ids.flat();
      const map = nodeMap();
      let nodes;
      if (ids.length) nodes = ids.map(node);
      else {
        const consumed = new Set();
        for (const n of state.nodes) for (const id of nodeInputs(n)) consumed.add(id);
        nodes = state.nodes.filter(n => !consumed.has(n.id));
      }
      const issues = [
        ...(ids.length ? [] : specIssues(evalSpecs())),
        ...checkRules(state).map(r => ({ id: '-', name: `규칙 ${r.name}`, level: 'error', code: 'rule', message: `파라미터 규칙 위반: ${r.expr} — ${r.message}` })),
        ...(state.formulaErrors || []).map(e => ({ id: e.id, name: e.name, level: 'error', code: 'formula', message: `수식 계산 실패: ${e.path} = ${e.expr} (${e.message})` })),
        ...collectIssues(nodes, map),
      ];
      const errors = issues.filter(i => i.level === 'error').length;
      return { ok: issues.length === 0, errors, warnings: issues.length - errors, issues };
    },

    // 빌드 스크립트 실행 (models/<프로젝트>.build.js). 스크립트 안에서 cad 를 쓰고 마지막에 return 한 값을 돌려준다
    // opts.batch(기본 true): 스크립트 전체를 Undo 한 단계로, 화면은 끝에 한 번 갱신
    async run(url, opts = {}) {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      const AsyncFunction = (async () => {}).constructor;
      const fn = new AsyncFunction('cad', await r.text());
      return opts.batch === false ? fn(api) : history.group(`Run ${url}`, () => fn(api));
    },

    async saveText(path, text) {
      const saved = await putFile(path, String(text), 'text/plain; charset=utf-8');
      toast(`${saved.path} 저장${saved.downloaded ? ' (다운로드)' : ''}`, 'success');
      return saved;
    },

    // 최상위 노드부터 Boolean 트리를 들여쓰기로 펼친 마크다운
    report() {
      const byId = nodeMap();
      const consumed = new Set();
      for (const n of state.nodes) for (const id of nodeInputs(n)) consumed.add(id);
      const num = v => (Math.round(v * 1000) / 1000);
      const fmtParams = p => Object.entries(p || {}).map(([k, v]) =>
        Array.isArray(v) ? `${k}=[${v.length}점]` : `${k}=${typeof v === 'number' ? num(v) : v}`).join(', ');
      const fmtT = t => {
        if (!t) return '';
        const parts = [];
        if (t.pos.some(v => v)) parts.push(`pos=[${t.pos.map(num)}]`);
        if (t.rot.some(v => v)) parts.push(`rot=[${t.rot.map(num)}]`);
        if (t.scale.some(v => v !== 1)) parts.push(`scale=[${t.scale.map(num)}]`);
        return parts.join(' ');
      };
      const lines = [];
      const walk = (n, depth) => {
        const pad = '  '.repeat(depth);
        const head = `${pad}- \`${n.id}\` **${n.name || n.type}**`;
        if (isBooleanNode(n) || n.type === 'pattern') {
          const f = n.expr ? ` ƒ{${Object.entries(n.expr).map(([k, e]) => `${k}=${e}`).join(', ')}}` : '';
          lines.push(n.type === 'pattern'
            ? `${head} — pattern(${n.src}, ${fmtParams(n.params)})${f}`
            : `${head} — ${n.op}(${n.a}, ${n.b})${fmtT(n.transform) ? ' ' + fmtT(n.transform) : ''}`);
          for (const c of nodeInputs(n)) { const cn = byId.get(c); if (cn) walk(cn, depth + 1); }
        } else if (n.type === 'step') {
          lines.push(`${head} — STEP ${n.source}${n.url ? ` (${n.url})` : ''} ${fmtT(n.transform)}`.trimEnd());
        } else {
          const f = n.expr ? ` ƒ{${Object.entries(n.expr).map(([k, e]) => `${k}=${e.length > 40 ? e.slice(0, 40) + '…' : e}`).join(', ')}}` : '';
          lines.push(`${head} — ${n.type}(${fmtParams(n.params)}) ${fmtT(n.transform)}${f}`.trimEnd());
        }
      };
      const tops = state.nodes.filter(n => !consumed.has(n.id));
      for (const n of tops) walk(n, 0);
      let box = null;
      try { box = boxJSON(boxOf(tops.filter(n => n.visible !== false).map(n => n.id))); } catch { /* 형상 없음 */ }
      return [
        `### 장면 (${new Date().toLocaleString()})`,
        `- 노드 ${state.nodes.length}개, 최상위 ${tops.length}개`,
        box ? `- 전체 bbox: ${box.size.join(' × ')} mm (min [${box.min}], max [${box.max}])` : '- 전체 bbox: 없음',
        '',
        '#### 파라미터',
        paramsMarkdown(state),
        '',
        ...((state.specs || []).length ? ['#### 도면 치수 검증', specsTable(evalSpecs()), ''] : []),
        '#### 노드 트리 (ƒ = 수식으로 연결된 값)',
        ...lines,
      ].join('\n');
    },

    view(name = 'iso', ids) { setView(name, ids ? [].concat(ids) : null); },
    lastMeasure() { return measure.last || null; },

    undo() { return history.undo(); },
    redo() { return history.redo(); },
    newScene() { history.apply(cmdReplaceState({ nodes: [], nextId: 1, selection: [], params: {}, sketches: {}, rules: [], specs: [] })); setView('iso'); },
    toJSON() { return serialize(state); },
    toast,
  };
  return api;
}
