# models/

CAD Modeler 작업 파일을 두는 폴더입니다. 이 폴더의 설계 결과물(빌드 스크립트 `*.build.js`, 작업 기록 `*.md`, STEP `.stp`·`.step`)은 git에 올리지 않습니다. 저장소에는 이 README와 예제(`propeller`, `strainer`의 `.build.js`·`.md`)만 있습니다.

- 작업을 멈출 때 `cad.saveStep('models/<프로젝트>')`(단일 파트는 `.stp`, 어셈블리는 `.step`이 자동으로 붙음)와 `cad.saveText('models/<프로젝트>.md', 기록)`으로 결과 형상과 작업 기록을 여기에 저장합니다(`launcher.py`로 실행했을 때).
- 이어서 작업할 때는 빈 페이지에서 `<프로젝트>.md`를 먼저 읽고 `await cad.importStep('models/<프로젝트>.stp')`으로 불러옵니다.
- 화면의 **STEP 열기** 버튼이나 끌어다 놓기로도 같은 파일을 불러올 수 있습니다.
- 자세한 순서와 작업 기록 템플릿은 [../AGENTS.md](../AGENTS.md)에 있습니다.
