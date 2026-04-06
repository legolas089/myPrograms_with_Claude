# myPrograms_with_Claude

Claude와 함께 만드는 각종 유틸리티 프로그램 모음.

각 프로그램은 별도의 하위 폴더로 관리됩니다. 실행하려면 **Node.js**가 필요합니다.

---

## 프로그램 목록

### 1. STEP Viewer (`step-viewer/`)
3D CAD 파일(.step, .stp) 뷰어

- 드래그 & 드롭 또는 버튼으로 STEP 파일 로드
- Three.js + OpenCascade WASM 기반 3D 렌더링
- 왼쪽 어셈블리 트리에서 파트 탐색
- 파트 클릭 시 초록색 하이라이트
- 거리 측정 도구 (점/선/면 조합)
- 마우스 드래그 회전, 스크롤 줌, 우클릭 팬

**실행**: `STEP Viewer.bat` 더블클릭 (http://localhost:3000)

### 2. PDF Editor (`pdf_editor/`)
PDF 합치기, 분리, 페이지 순서 변경 도구

- **합치기**: 여러 PDF를 하나로 결합, 드래그로 파일 순서 변경
- **분리 / 정렬**: 페이지 썸네일 미리보기, 드래그로 페이지 순서 변경, 체크박스로 페이지 선택/제외
  - 선택한 페이지를 현재 순서로 저장 (1개 PDF)
  - 선택한 페이지를 각각 개별 PDF로 분리
  - 페이지 범위 지정 분리 (예: 1-3, 5, 7-10)

**실행**: `PDF Editor.bat` 더블클릭 (http://localhost:3001)

---

## 사전 요구사항

- [Node.js](https://nodejs.org) 설치 (npx 명령어 사용)
