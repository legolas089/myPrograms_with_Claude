"""
Step 1: 데이터 정제

입력: 시트2 (원본 submission 데이터)
출력:
  - _step1_정제데이터 : 정제된 데이터 (다음 Step들의 입력)
  - _step1_예외항목   : 제외·교정된 항목 + 복구 힌트

처리 순서
  1. 제목 줄바꿈 병합    : 빈 행의 제목 조각을 이전 논문 제목에 이어붙임
  2. 빈 행 제거          : 논문번호가 없는 행 삭제
  3. 제목 마크다운 제거  : **, __ 같은 볼드 마커 삭제
  4. 중복 제출 제거      : (발표자 + 제목) 동일 중 등록일이 늦은 것만 유지
  5. 미등록/미납 제외    : 예외항목에 복구 힌트와 함께 기록
  6. 발표형식 메모 처리  : 메모에 '포스터...수정' 있으면 '포스터발표'로 변경
  7. 발표분야 오타 교정  : '[특별세선]' → '[특별세션]' 등
"""

import pandas as pd
import re


# 발표분야 오타 교정 사전 (부분 문자열 치환)
TYPO_MAP = {
    '[특별세선]': '[특별세션]',
}


# ---------------------------------------------------------------------------
# 유틸
# ---------------------------------------------------------------------------

def _is_blank(value):
    """NaN 또는 공백 문자열이면 True."""
    if pd.isna(value):
        return True
    return not str(value).strip()


def fix_field_typo(value):
    """발표분야 등의 단순 오타 교정."""
    if pd.isna(value):
        return value
    s = str(value)
    for wrong, right in TYPO_MAP.items():
        s = s.replace(wrong, right)
    return s


def strip_bold_markers(title):
    """제목에서 마크다운 볼드 마커(**, __) 제거 + 공백 정리."""
    if pd.isna(title):
        return title
    s = str(title)
    s = re.sub(r'\*\*', '', s)
    s = re.sub(r'__', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def normalize_presentation_type(raw):
    """
    발표형식 문자열에서 괄호 안 메모 분리 + 형식 변경 지시 해석.
    Returns: (정규화된 발표형식, 메모 or None)
    """
    if pd.isna(raw):
        return None, None
    s = str(raw).strip()
    m = re.match(r'^([^(]+)\((.+)\)\s*$', s)
    if not m:
        return s, None

    base = m.group(1).strip()
    note = m.group(2).strip()

    if '포스터' in note and ('수정' in note or '변경' in note):
        return '포스터발표', note
    if '구두' in note and ('수정' in note or '변경' in note):
        return '구두발표', note
    return base, note


# ---------------------------------------------------------------------------
# 주요 단계
# ---------------------------------------------------------------------------

def merge_split_titles(df):
    """빈 행에 남아있는 제목 조각을 직전 유효 논문의 제목에 병합.

    Returns: (병합된 df, 병합 건수 리스트[{논문번호, 조각}])
    """
    df = df.reset_index(drop=True).copy()
    merged_log = []
    last_idx = None

    for i in range(len(df)):
        has_paper = not _is_blank(df.loc[i, '논문번호'])
        if has_paper:
            last_idx = i
            continue

        # 빈 행: 제목 조각이 있으면 이전 논문에 병합
        title_frag = df.loc[i, '제목']
        if not _is_blank(title_frag) and last_idx is not None:
            prev_title = df.loc[last_idx, '제목']
            prev_str = '' if _is_blank(prev_title) else str(prev_title).strip()
            frag_str = str(title_frag).strip()
            df.loc[last_idx, '제목'] = (prev_str + ' ' + frag_str).strip()
            merged_log.append({
                '논문번호': df.loc[last_idx, '논문번호'],
                '병합된_조각': frag_str,
            })
    return df, merged_log


def deduplicate(df):
    """동일 (발표자, 제목) 중 등록일이 늦은 것(= 최신) 유지.

    동점 시 논문번호가 큰 쪽을 선호 (일반적으로 늦게 발급됨).
    Returns: (중복 제거된 df, 제거된 항목 리스트)
    """
    if '등록일' not in df.columns or '제목' not in df.columns:
        return df, []

    df_work = df.copy()
    df_work['_dup_key'] = (
        df_work['발표자'].fillna('').astype(str).str.strip() + '|||'
        + df_work['제목'].fillna('').astype(str).str.strip()
    )

    # 유효한 키만 대상 (발표자도 제목도 비어있지 않은 것)
    has_key = (
        df_work['발표자'].fillna('').astype(str).str.strip().ne('')
        & df_work['제목'].fillna('').astype(str).str.strip().ne('')
    )

    # 최신 우선 정렬 후 중복 마킹 (첫 건만 유지)
    df_sorted = df_work[has_key].sort_values(
        ['등록일', '논문번호'], ascending=[False, False], na_position='last'
    )
    keep_mask = ~df_sorted['_dup_key'].duplicated(keep='first')

    keep_indices = set(df_sorted[keep_mask].index)
    drop_indices = set(df_sorted[~keep_mask].index)

    removed = []
    for idx in drop_indices:
        r = df_work.loc[idx]
        # 어떤 논문이 살아남았는지 같이 기록
        kept_idx = df_sorted[
            (df_sorted['_dup_key'] == r['_dup_key']) & keep_mask
        ].index
        kept_paper = (
            df_work.loc[kept_idx[0], '논문번호'] if len(kept_idx) else ''
        )
        kept_fmt = (
            df_work.loc[kept_idx[0], '발표형식'] if len(kept_idx) and '발표형식' in df_work.columns else ''
        )
        removed.append({
            '논문번호': r['논문번호'],
            '발표자': r['발표자'],
            '제목': str(r['제목'])[:60],
            '등록일': r['등록일'],
            '유지된_논문번호': kept_paper,
            '원본발표형식': r.get('발표형식', '') if '발표형식' in df_work.columns else '',
            '원본발표분야': r.get('발표분야', '') if '발표분야' in df_work.columns else '',
            '유지된_발표형식': kept_fmt,
        })

    # 유효키 없는 행은 그대로 두고, 유효키 있는 중복만 제거
    result = df_work[has_key & df_work.index.isin(keep_indices)]
    # 원래 유효키가 없던 행도 다시 붙이기 (사실상 거의 없음)
    result = pd.concat([result, df_work[~has_key]], ignore_index=False)
    result = result.drop(columns=['_dup_key']).sort_index()
    return result, removed


# ---------------------------------------------------------------------------
# 메인
# ---------------------------------------------------------------------------

def clean(df_raw):
    """원본 데이터 → (정제 데이터, 예외항목, 통계)."""
    df = df_raw.copy()
    exceptions = []

    def add_exception(row, kind, detail, recovery=''):
        exceptions.append({
            '논문번호': row.get('논문번호', ''),
            '발표자': row.get('발표자', ''),
            '예외유형': kind,
            '상세': detail,
            '복구방법': recovery,
            '원본발표형식': row.get('발표형식', ''),
            '원본발표분야': row.get('발표분야', ''),
        })

    # --- 1. 제목 줄바꿈 병합 (빈 행 제거 전에) ---
    df, merge_log = merge_split_titles(df)
    n_title_merged = len(merge_log)

    # --- 2. 빈 행 제거 ---
    is_empty = df['논문번호'].apply(_is_blank)
    n_empty = int(is_empty.sum())
    df = df[~is_empty].copy()

    # --- 3. 제목 마크다운 제거 ---
    df['제목'] = df['제목'].apply(strip_bold_markers)

    # --- 4. 중복 제출 제거 ---
    df, dup_removed = deduplicate(df)
    for item in dup_removed:
        kept_fmt = item.get('유지된_발표형식', '')
        removed_fmt = item.get('원본발표형식', '')
        detail = f"제목 동일, {item['유지된_논문번호']} 유지 (더 늦은 등록일)"
        if kept_fmt and removed_fmt and kept_fmt != removed_fmt:
            detail += f" — 제거된 행 발표형식={removed_fmt}, 유지된 행 발표형식={kept_fmt}"
        exceptions.append({
            '논문번호': item['논문번호'],
            '발표자': item['발표자'],
            '예외유형': '중복제출_제거',
            '상세': detail,
            '복구방법': '시트2에서 해당 행을 삭제하여 최종본 유지',
            '원본발표형식': removed_fmt,
            '원본발표분야': item.get('원본발표분야', ''),
        })

    # --- 5. 미등록/미납 제외 ---
    not_registered = (
        (df['사전등록여부'] != '등록완료')
        | (df['사전등록 결제여부'] != '결제완료')
    )
    for _, row in df[not_registered].iterrows():
        add_exception(
            row,
            '미등록/미납',
            f"등록:{row.get('사전등록여부')}, 결제:{row.get('사전등록 결제여부')}",
            recovery='시트2에서 해당 행의 사전등록여부=등록완료, 사전등록 결제여부=결제완료로 수정 후 재실행',
        )
    df = df[~not_registered].copy()

    # --- 6. 발표형식 정규화 ---
    norm = df['발표형식'].apply(normalize_presentation_type)
    df['발표형식_정규'] = norm.apply(lambda x: x[0])
    df['발표형식_메모'] = norm.apply(lambda x: x[1])

    has_note = df['발표형식_메모'].notna()
    for _, row in df[has_note].iterrows():
        add_exception(row, '발표형식_메모', row['발표형식_메모'])

    # --- 7. 발표분야 오타 교정 ---
    df['발표분야_원본'] = df['발표분야']
    df['발표분야'] = df['발표분야'].apply(fix_field_typo)
    changed = df['발표분야_원본'].fillna('') != df['발표분야'].fillna('')
    for _, row in df[changed].iterrows():
        add_exception(
            row,
            '발표분야_오타교정',
            f"'{row['발표분야_원본']}' → '{row['발표분야']}'",
        )

    # --- 정리 ---
    df['발표형식'] = df['발표형식_정규']
    df = df.drop(columns=['발표형식_정규', '발표형식_메모', '발표분야_원본'])

    exc_df = pd.DataFrame(exceptions)
    if not exc_df.empty:
        col_order = ['논문번호', '발표자', '예외유형', '상세', '복구방법',
                     '원본발표형식', '원본발표분야']
        exc_df = exc_df[[c for c in col_order if c in exc_df.columns]]

    stats = {
        'titles_merged': n_title_merged,
        'empty_rows_removed': n_empty,
        'duplicates_removed': len(dup_removed),
        'unregistered_removed': int(not_registered.sum()),
        'rows_after_cleaning': len(df),
        'exceptions_logged': len(exc_df),
    }
    return df, exc_df, stats
