// 장면 직렬화: 명령 트리(노드 배열)를 JSON 으로 저장/로드
const FORMAT_VERSION = 1;

export function serialize(state) {
  return JSON.stringify({
    version: FORMAT_VERSION,
    nextId: state.nextId,
    nodes: state.nodes.map(n => ({ ...n })),
  }, null, 2);
}

export function deserialize(json) {
  const data = JSON.parse(json);
  if (typeof data !== 'object' || !Array.isArray(data.nodes)) {
    throw new Error('잘못된 형식의 JSON 입니다');
  }
  if (data.version !== FORMAT_VERSION) {
    console.warn(`다른 버전의 파일 (${data.version} vs ${FORMAT_VERSION}) — 호환 시도 중`);
  }
  return {
    nodes: data.nodes,
    nextId: data.nextId ?? (Math.max(0, ...data.nodes.map(n => parseInt(String(n.id).replace(/\D/g,'')) || 0)) + 1),
    selection: [],
  };
}

export function downloadJSON(state, filename) {
  const blob = new Blob([serialize(state)], { type: 'application/json' });
  triggerDownload(blob, filename || 'scene.json');
}

export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
