# models/

CAD Modeler가 서버 경로로 불러올 STEP 파일을 두는 폴더입니다. 이 README를 제외한 파일은 git에 커밋되지 않습니다.

- 브라우저 콘솔에서 `await cad.importStep('models/파일명.step')` 으로 불러옵니다.
- 화면의 **STEP 열기** 버튼이나 끌어다 놓기로 불러온 파일은 이 폴더가 아니라 브라우저(IndexedDB)에 저장됩니다.
