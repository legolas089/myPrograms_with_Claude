"""
Step 3: 제약조건 플래깅

입력:
  - _step1_정제데이터 (좌장 신청여부 등 원본 컬럼 참조용)
  - _step2_랩매핑     (lab_id 병합용)

출력:
  - _step3_플래그        : 각 논문별 배치 제약 플래그 (덮어쓰기)
  - 입력_좌장Invited     : 사용자 편집용 템플릿 (최초 1회만 생성, 이후 보존)

플래그 종류
  - is_multi_presenter   : 같은 발표자가 2건 이상 발표 (시간 분산 필요)
  - multi_presenter_count: 해당 발표자의 총 발표 수
  - multi_peer_papers    : 동일 발표자의 다른 논문번호들 (충돌 방지용)
  - is_special_session   : '[특별세션/세선]' 으로 시작하는 분야
  - is_chair_requested   : 원본 '좌장 신청여부' = Y
"""

import pandas as pd


def build_flags(df_clean, df_lab):
    """정제 데이터 + 랩매핑으로부터 배치 제약 플래그 생성."""
    # 논문번호 → lab_id 조회 사전
    lab_lookup = df_lab.set_index('논문번호')['lab_id'].to_dict()

    # 발표자별 사전 통계
    presenter_counts = df_clean['발표자'].value_counts().to_dict()
    presenter_papers = (
        df_clean.groupby('발표자')['논문번호'].apply(list).to_dict()
    )

    rows = []
    for _, row in df_clean.iterrows():
        paper_id = row.get('논문번호')
        presenter = row.get('발표자')
        field = row.get('발표분야') or ''

        multi_count = presenter_counts.get(presenter, 0)
        peers = [
            p for p in presenter_papers.get(presenter, [])
            if p != paper_id
        ]

        is_special = str(field).startswith('[특별세')
        is_chair_req = (
            str(row.get('좌장 신청여부', '')).strip().upper() == 'Y'
        )

        rows.append({
            '논문번호': paper_id,
            '발표자': presenter,
            '발표형식': row.get('발표형식'),
            '발표분야': field,
            'lab_id': lab_lookup.get(paper_id, ''),
            'is_multi_presenter': multi_count >= 2,
            'multi_presenter_count': multi_count,
            'multi_peer_papers': ', '.join(peers) if peers else '',
            'is_special_session': is_special,
            'is_chair_requested': is_chair_req,
        })
    return pd.DataFrame(rows)


def build_chair_invited_template(flag_df):
    """사용자가 직접 작성할 좌장/Invited 입력 템플릿.

    - 논문번호/발표자/발표형식/발표분야: 참고용 (덮어쓰기 방지)
    - Invited: 사용자가 'Y' 또는 '' 로 마킹
    - 좌장여부: 사용자가 'Y' 또는 '' 로 마킹 (원본 좌장신청여부와 별개로, 실제 배정 여부)
    - 참고사항: 자유 메모
    """
    template = flag_df[['논문번호', '발표자', '발표형식', '발표분야']].copy()
    template['Invited'] = ''
    template['좌장여부'] = ''
    template['참고사항'] = ''
    return template
