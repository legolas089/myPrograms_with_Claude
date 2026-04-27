"""
Step 2: 랩/그룹 식별

입력: _step1_정제데이터
출력:
  - _step2_랩매핑      : 각 논문에 랩대표(지도교수 등), 정규화 소속, lab_id 부여
  - _step2_소속정규화  : 원본 소속 → 정규화 소속 대응표 (검증용)
  - _step2_랩요약      : 랩별 발표 건수·분야 요약 (정렬용)

판별 규칙
  - 랩대표(지도교수 등):
      * 단독 저자                      → 본인
      * 발표자 직위가 교수급            → 발표자 본인
      * 그 외 (학생/연구원/빈값)        → 저자 목록의 마지막 사람
  - 소속 정규화:
      * 슬래시/쉼표로 여러 기관이 병기된 경우 첫 번째 기관만 사용
        (예: '고등기술연구원 / KAIST' → '고등기술연구원')
      * 영문 약칭(KAIST/GIST/UNIST/POSTECH)을 한글 공식명으로 통일
      * 괄호 안 내용 제거
      * 학과·학부 suffix 자동 제거
  - lab_id = "{랩대표}__{정규화소속}"
"""

import pandas as pd
import re


# ---------------------------------------------------------------------------
# 정규화 사전 (코드 내 최소한만)
# ---------------------------------------------------------------------------

# 영문 약칭 / 별칭 → 대표 한글명
ALIAS_MAP = {
    'KAIST': '한국과학기술원',
    'GIST': '광주과학기술원',
    'UNIST': '울산과학기술원',
    '유니스트': '울산과학기술원',
    'POSTECH': '포항공과대학교',
    '포스텍': '포항공과대학교',
}

# 기관명 경계로 쓸 suffix (긴 것부터 체크)
ORG_SUFFIXES = [
    '대학교', '과학기술원', '공과대학', '대학원',
    '연구원', '연구소', '기술원', '대학',
]

# 발표자 본인을 랩대표로 간주할 직위 키워드
SENIOR_KEYWORDS = [
    '교수', '책임연구원', '수석연구원', '실장', '연구교수',
    '대표', 'CEO', '상무', '이사', '매니저',
]

# 여러 기관이 함께 기재될 때 쓰이는 구분자
MULTI_ORG_SEPARATORS = ['/', ',']


# ---------------------------------------------------------------------------
# 정규화 함수
# ---------------------------------------------------------------------------

def normalize_affiliation(raw):
    """소속 문자열을 대표 기관명으로 정규화."""
    if pd.isna(raw):
        return None
    s = str(raw).strip()
    if not s:
        return None

    # 0) 여러 기관이 함께 기재된 경우 첫 기관만 사용
    # 예: "고등기술연구원 / KAIST" → "고등기술연구원"
    for sep in MULTI_ORG_SEPARATORS:
        if sep in s:
            s = s.split(sep)[0].strip()
            break

    # 1) 영문 약칭이 포함되어 있으면 바로 대표명으로 치환
    for alias, canonical in ALIAS_MAP.items():
        if alias in s:
            return canonical

    # 2) 괄호 안 내용 제거: "한국과학기술원 (KAIST)" → "한국과학기술원"
    s = re.sub(r'\s*\([^)]*\)\s*', ' ', s).strip()

    # 3) 기관명 suffix 위치에서 자르기
    for suffix in ORG_SUFFIXES:
        idx = s.find(suffix)
        if idx >= 0:
            return s[: idx + len(suffix)].strip()

    # 4) 매칭 안 되면 (회사/기타) 원본 유지
    return s


def _split_and_strip(value):
    """쉼표로 분리하고 공백 제거된 리스트 반환."""
    if pd.isna(value):
        return []
    return [x.strip() for x in str(value).split(',')]


def _safe_str(value):
    """NaN/None 안전한 문자열 변환 + strip."""
    if pd.isna(value):
        return ''
    return str(value).strip()


def identify_lab_representative(row):
    """
    랩대표(지도교수 등) 판별.
    Returns: (랩대표명, 랩대표 소속 원본)
    """
    authors = [a for a in _split_and_strip(row.get('저자정보-성명')) if a]
    affiliations = _split_and_strip(row.get('저자정보-소속기관'))

    presenter = _safe_str(row.get('발표자'))
    presenter_aff = _safe_str(row.get('소속'))
    position = _safe_str(row.get('직위'))

    # 단독 저자
    if len(authors) <= 1:
        name = authors[0] if authors else presenter
        aff = affiliations[0] if affiliations and affiliations[0] else presenter_aff
        return name, aff

    # 발표자가 시니어 직위면 본인이 랩대표
    if any(k in position for k in SENIOR_KEYWORDS):
        return presenter, presenter_aff

    # 그 외: 저자 목록의 마지막 사람
    last_author = authors[-1]
    if len(affiliations) >= len(authors) and affiliations[len(authors) - 1]:
        last_aff = affiliations[len(authors) - 1]
    else:
        last_aff = presenter_aff
    return last_author, last_aff


# ---------------------------------------------------------------------------
# 메인
# ---------------------------------------------------------------------------

def map_labs(df_clean):
    """각 논문에 랩대표·정규화 소속·lab_id를 부여하고 요약 표들을 생성."""
    # 1) 논문별 랩 매핑
    rows = []
    for _, row in df_clean.iterrows():
        rep_name, rep_aff_raw = identify_lab_representative(row)
        rep_aff_norm = normalize_affiliation(rep_aff_raw)
        lab_id = (
            f"{rep_name}__{rep_aff_norm}"
            if rep_name and rep_aff_norm
            else ''
        )
        rows.append({
            '논문번호': row.get('논문번호'),
            '발표자': row.get('발표자'),
            '직위': row.get('직위'),
            '발표형식': row.get('발표형식'),
            '발표분야': row.get('발표분야'),
            '랩대표': rep_name,
            '랩대표_소속_원본': rep_aff_raw,
            '랩대표_소속_정규화': rep_aff_norm,
            'lab_id': lab_id,
        })
    lab_df = pd.DataFrame(rows)

    # 2) 소속 정규화 대응표 (발표자/공저자 소속 전부 모아서 unique)
    all_affs = []
    for _, row in df_clean.iterrows():
        all_affs.append(_safe_str(row.get('소속')))
        all_affs.extend(a for a in _split_and_strip(row.get('저자정보-소속기관')))
    unique_affs = sorted({a for a in all_affs if a})
    norm_map_df = pd.DataFrame([
        {'원본': a, '정규화': normalize_affiliation(a)}
        for a in unique_affs
    ])

    # 3) 랩별 요약 (발표 건수 내림차순)
    summary = (
        lab_df.groupby('lab_id', dropna=False)
              .agg(
                  랩대표=('랩대표', 'first'),
                  소속=('랩대표_소속_정규화', 'first'),
                  발표건수=('논문번호', 'count'),
                  발표분야=('발표분야',
                           lambda s: ', '.join(sorted(set(x for x in s.dropna() if x)))),
              )
              .reset_index()
              .sort_values(['발표건수', 'lab_id'], ascending=[False, True])
              .reset_index(drop=True)
    )

    stats = {
        'n_papers': len(lab_df),
        'n_labs': lab_df['lab_id'].nunique(),
        'n_unique_aff_raw': len(norm_map_df),
        'n_unique_aff_norm': norm_map_df['정규화'].nunique(),
    }
    return lab_df, norm_map_df, summary, stats
