"""
Step 4: 논문 배정 도우미

설계 철학
  "배치 알고리즘"이 아니라 "포맷팅 도우미" 접근.
  사용자가 `입력_논문배정` 시트에서 직접 날짜/시간/발표장을 지정하고,
  Python은 (a) 미배정 논문 체크, (b) 충돌 검증, (c) 소속 축약만 담당.

배정 판정 기준
  구두/포스터 모두 `날짜 + 세션 + 발표장 + 슬롯순서`가 채워져야 "배정완료".
  하나라도 비어 있으면 "미배정" 또는 "부분배정"으로 남고,
  Step 6 최종 출력(시간표/명단/세부일정)에도 반영되지 않음.

입력
  - _step1_정제데이터  : 발표자/소속/제목 등 원본 정보
  - _step2_랩매핑      : 소속 정규화 결과 (축약 사전의 근거)
  - _step3_플래그      : 다중 발표자 등
  - 입력_논문배정      : 사용자 편집 (최초엔 자동 생성된 템플릿)
  - 설정_시간대        : 사용자 편집 가능한 날짜/시간대 정의

출력
  - _step4_배정현황    : 모든 논문 + 배정 상태 (미배정은 빨강)
  - _step4_충돌경고    : 시간 충돌, 슬롯 과밀 등 검증 결과
  - _step4_소속축약    : 정규화 소속 → 축약형 매핑표 (검증용)

재실행 안전성
  - 입력_논문배정, 설정_시간대 는 최초 1회만 생성 (이후 사용자 편집 보존)
  - _step4_* 시트는 매번 덮어씀
"""

import pandas as pd
import re


# ---------------------------------------------------------------------------
# 소속 축약 규칙
# ---------------------------------------------------------------------------

# 특수 매핑: 한국과학기술원만 영문 약칭으로
SPECIAL_ABBR = {
    '한국과학기술원': 'KAIST',
    '울산과학기술원': 'UNIST',
    '광주과학기술원': 'GIST',
    '포항공과대학교': 'POSTECH',
}

# 공통 규칙: `XX대학교` → `XX대`, `XX여자대학교` → `XX여대`
# 그 외 (연구원/연구소/회사 등)는 원본 유지


def abbreviate_affiliation(normalized):
    """Step 2 정규화 소속명을 시간표 셀에 쓸 축약형으로 변환."""
    if pd.isna(normalized) or not str(normalized).strip():
        return ''
    s = str(normalized).strip()

    # 1) 특수 약칭
    if s in SPECIAL_ABBR:
        return SPECIAL_ABBR[s]

    # 2) `XX여자대학교` → `XX여대`
    m = re.match(r'^(.+?)여자대학교$', s)
    if m:
        return m.group(1) + '여대'

    # 3) `XX대학교` → `XX대`
    m = re.match(r'^(.+?)대학교$', s)
    if m:
        return m.group(1) + '대'

    # 4) 그 외 (연구원/연구소/회사 등) → 원본 유지
    return s


# ---------------------------------------------------------------------------
# 기본 설정값 (시간대 템플릿)
# ---------------------------------------------------------------------------

DEFAULT_TIMESLOTS = [
    # 목요일 오전1 세션 (9:00~10:15, 5슬롯)
    {'날짜': '목', '시간대': '오전1',  '시작': '9:00',  '종료': '9:15',  '세션': '목-오전1'},
    {'날짜': '목', '시간대': '오전2',  '시작': '9:15',  '종료': '9:30',  '세션': '목-오전1'},
    {'날짜': '목', '시간대': '오전3',  '시작': '9:30',  '종료': '9:45',  '세션': '목-오전1'},
    {'날짜': '목', '시간대': '오전4',  '시작': '9:45',  '종료': '10:00', '세션': '목-오전1'},
    {'날짜': '목', '시간대': '오전5',  '시작': '10:00', '종료': '10:15', '세션': '목-오전1'},
    # 휴식
    {'날짜': '목', '시간대': '휴식1',  '시작': '10:15', '종료': '10:30', '세션': ''},
    {'날짜': '목', '시간대': '휴식2',  '시작': '10:30', '종료': '10:45', '세션': ''},
    # 목요일 오전2 세션 (10:45~12:00, 5슬롯)
    {'날짜': '목', '시간대': '오전8',  '시작': '10:45', '종료': '11:00', '세션': '목-오전2'},
    {'날짜': '목', '시간대': '오전9',  '시작': '11:00', '종료': '11:15', '세션': '목-오전2'},
    {'날짜': '목', '시간대': '오전10', '시작': '11:15', '종료': '11:30', '세션': '목-오전2'},
    {'날짜': '목', '시간대': '오전11', '시작': '11:30', '종료': '11:45', '세션': '목-오전2'},
    {'날짜': '목', '시간대': '오전12', '시작': '11:45', '종료': '12:00', '세션': '목-오전2'},
    # 목요일 오후1 세션 (13:30~14:45, 5슬롯)
    {'날짜': '목', '시간대': '오후1',  '시작': '13:30', '종료': '13:45', '세션': '목-오후1'},
    {'날짜': '목', '시간대': '오후2',  '시작': '13:45', '종료': '14:00', '세션': '목-오후1'},
    {'날짜': '목', '시간대': '오후3',  '시작': '14:00', '종료': '14:15', '세션': '목-오후1'},
    {'날짜': '목', '시간대': '오후4',  '시작': '14:15', '종료': '14:30', '세션': '목-오후1'},
    {'날짜': '목', '시간대': '오후5',  '시작': '14:30', '종료': '14:45', '세션': '목-오후1'},
    # 금요일 오전1 세션
    {'날짜': '금', '시간대': '오전1',  '시작': '9:00',  '종료': '9:15',  '세션': '금-오전1'},
    {'날짜': '금', '시간대': '오전2',  '시작': '9:15',  '종료': '9:30',  '세션': '금-오전1'},
    {'날짜': '금', '시간대': '오전3',  '시작': '9:30',  '종료': '9:45',  '세션': '금-오전1'},
    {'날짜': '금', '시간대': '오전4',  '시작': '9:45',  '종료': '10:00', '세션': '금-오전1'},
    {'날짜': '금', '시간대': '오전5',  '시작': '10:00', '종료': '10:15', '세션': '금-오전1'},
    # 휴식
    {'날짜': '금', '시간대': '휴식1',  '시작': '10:15', '종료': '10:30', '세션': ''},
    {'날짜': '금', '시간대': '휴식2',  '시작': '10:30', '종료': '10:45', '세션': ''},
    # 금요일 오전2 세션
    {'날짜': '금', '시간대': '오전8',  '시작': '10:45', '종료': '11:00', '세션': '금-오전2'},
    {'날짜': '금', '시간대': '오전9',  '시작': '11:00', '종료': '11:15', '세션': '금-오전2'},
    {'날짜': '금', '시간대': '오전10', '시작': '11:15', '종료': '11:30', '세션': '금-오전2'},
    {'날짜': '금', '시간대': '오전11', '시작': '11:30', '종료': '11:45', '세션': '금-오전2'},
    {'날짜': '금', '시간대': '오전12', '시작': '11:45', '종료': '12:00', '세션': '금-오전2'},
    # 금요일 오후1 세션
    {'날짜': '금', '시간대': '오후1',  '시작': '13:30', '종료': '13:45', '세션': '금-오후1'},
    {'날짜': '금', '시간대': '오후2',  '시작': '13:45', '종료': '14:00', '세션': '금-오후1'},
    {'날짜': '금', '시간대': '오후3',  '시작': '14:00', '종료': '14:15', '세션': '금-오후1'},
    {'날짜': '금', '시간대': '오후4',  '시작': '14:15', '종료': '14:30', '세션': '금-오후1'},
    {'날짜': '금', '시간대': '오후5',  '시작': '14:30', '종료': '14:45', '세션': '금-오후1'},
]

VALID_DATES = {'목', '금'}
VALID_VENUES = {'1', '2', '3', '4', '5', '6', '7'}  # 발표장 번호 문자열로
SLOTS_PER_SESSION = 5  # 세션당 5슬롯 (15분 × 5 = 75분)
MAX_SLOT_POSITION = SLOTS_PER_SESSION  # 세션 내 슬롯순서 최댓값
MAX_SLOT_SPAN = SLOTS_PER_SESSION  # 한 발표가 차지할 수 있는 최대 슬롯수 (75분)
STATUS_ASSIGNED = '배정완료'
STATUS_PARTIAL = '부분배정'
STATUS_UNASSIGNED = '미배정'
REQUIRED_ASSIGNMENT_FIELDS = ('날짜', '세션', '발표장', '슬롯순서')


# ---------------------------------------------------------------------------
# 템플릿 생성
# ---------------------------------------------------------------------------

def build_assignment_template(df_clean, df_lab):
    """모든 논문번호가 자동 입력된 `입력_논문배정` 템플릿 생성.

    사용자는 우측 배정 컬럼만 채우면 됨.

    컬럼 의미:
      - 날짜:       목 / 금
      - 세션:       `설정_시간대` 시트의 세션명 (예: `목-오전1`, `목-오전2`, `목-오후1`)
      - 발표장:     1 ~ 7
      - 슬롯순서:   세션 내 시작 위치 1 ~ 5 (구두발표용)
      - 슬롯길이:   연속으로 차지하는 슬롯 수 (1=15분, 2=30분, 3=45분, …, 5=75분)
                  비워두면 기본 1
      - 비고:       자유 메모
    구두/포스터 모두 날짜/세션/발표장/슬롯순서가 채워져야 최종 출력에 반영된다.
    포스터 슬롯순서는 `A01`, `B19`처럼 세션 레터가 붙은 형식도 허용한다.
    """
    # Step 2의 랩대표와 병합 (같은 랩끼리 묶어서 정렬하기 쉽게)
    lab_lookup = df_lab.set_index('논문번호').to_dict('index')

    rows = []
    for _, r in df_clean.iterrows():
        pid = r['논문번호']
        lab_info = lab_lookup.get(pid, {})
        rows.append({
            '논문번호': pid,
            '발표자': r.get('발표자'),
            '발표형식': r.get('발표형식'),
            '발표분야': r.get('발표분야'),
            '랩대표': lab_info.get('랩대표', ''),
            '날짜': '',           # ← 사용자 기입: 목 / 금
            '세션': '',           # ← 사용자 기입: 목-오전1 / 목-오전2 / 목-오후1 / ...
            '발표장': '',         # ← 사용자 기입: 1 ~ 7
            '슬롯순서': '',       # ← 사용자 기입 (구두): 1 ~ 5
            '슬롯길이': '',       # ← 사용자 기입 (구두, 선택): 1~5 (기본 1=15분)
            '비고': '',           # 자유 메모
        })
    df = pd.DataFrame(rows)

    # 정렬 기준: 발표형식(구두 먼저) → 발표분야 → 랩대표 (같은 랩끼리 인접 보기 좋게)
    df['_fmt_order'] = df['발표형식'].map({'구두발표': 0, '포스터발표': 1}).fillna(2)
    df = df.sort_values(['_fmt_order', '발표분야', '랩대표', '논문번호']).drop(columns='_fmt_order')
    return df.reset_index(drop=True)


# ---------------------------------------------------------------------------
# 배정 현황 분석
# ---------------------------------------------------------------------------

def _clean_cell(value):
    """NaN / 'nan' / 공백 문자열을 모두 빈 문자열로 정규화."""
    if pd.isna(value):
        return ''
    s = str(value).strip()
    if s.lower() == 'nan':
        return ''
    return s


def _parse_int_or_default(s, default):
    s = _clean_cell(s)
    if not s:
        return default
    try:
        return int(s)
    except ValueError:
        return None  # 파싱 실패


def extract_slot_position(value):
    """슬롯순서에서 숫자부를 추출해 int로 반환. 없으면 None."""
    cleaned = _clean_cell(value)
    if not cleaned:
        return None
    try:
        return int(cleaned)
    except ValueError:
        m = re.search(r'\d+', cleaned)
        return int(m.group()) if m else None


def is_assignment_complete(date, session, venue, pos):
    """최종 출력 반영 여부 판단에 쓰는 공통 기준."""
    return all([
        _clean_cell(date),
        _clean_cell(session),
        _clean_cell(venue),
        _clean_cell(pos),
    ])


def get_missing_assignment_fields(date, session, venue, pos):
    values = {
        '날짜': _clean_cell(date),
        '세션': _clean_cell(session),
        '발표장': _clean_cell(venue),
        '슬롯순서': _clean_cell(pos),
    }
    return [name for name, value in values.items() if not value]


def analyze_assignments(df_clean, df_lab, df_assign, df_timeslots):
    """사용자가 편집한 `입력_논문배정`을 분석하여 현황/충돌 리포트 생성."""
    assign_lookup = df_assign.set_index('논문번호').to_dict('index')
    lab_lookup = df_lab.set_index('논문번호').to_dict('index') if '논문번호' in df_lab.columns else {}

    # 유효 세션 set: `설정_시간대` 시트의 '세션' 컬럼에 등장하는 값들
    valid_sessions = {
        _clean_cell(r.get('세션'))
        for _, r in df_timeslots.iterrows()
    }
    valid_sessions.discard('')

    status_rows = []
    warnings = []

    for _, r in df_clean.iterrows():
        pid = r['논문번호']
        a = assign_lookup.get(pid, {})

        date = _clean_cell(a.get('날짜'))
        session = _clean_cell(a.get('세션'))
        venue = _clean_cell(a.get('발표장'))
        pos = _clean_cell(a.get('슬롯순서'))
        span = _clean_cell(a.get('슬롯길이'))

        is_oral = r.get('발표형식') == '구두발표'
        complete = is_assignment_complete(date, session, venue, pos)
        any_filled = any([date, session, venue, pos, span])
        missing_required = get_missing_assignment_fields(date, session, venue, pos)

        issues = []
        if date and date not in VALID_DATES:
            issues.append(f"날짜 값 이상: '{date}'")
        if session and session not in valid_sessions:
            issues.append(f"세션 '{session}'이 설정_시간대에 없음")
        if venue and venue not in VALID_VENUES:
            issues.append(f"발표장 값 이상: '{venue}' (1~7 허용)")

        pos_int = extract_slot_position(pos)
        span_int = _parse_int_or_default(span, default=1)
        if pos and pos_int is None:
            issues.append(f"슬롯순서는 숫자여야 함: '{pos}'")
        elif is_oral and pos_int is not None and not (1 <= pos_int <= MAX_SLOT_POSITION):
            issues.append(f"슬롯순서 범위 초과 (1~{MAX_SLOT_POSITION}): {pos_int}")
        if span and span_int is None:
            issues.append(f"슬롯길이는 숫자여야 함: '{span}'")
        elif is_oral and span_int is not None and not (1 <= span_int <= MAX_SLOT_SPAN):
            issues.append(f"슬롯길이 범위 초과 (1~{MAX_SLOT_SPAN}): {span_int}")
        # 슬롯순서 + 슬롯길이가 세션 경계(5)를 넘으면 오류 (구두만)
        if is_oral and pos_int is not None and span_int is not None:
            if pos_int + span_int - 1 > MAX_SLOT_POSITION:
                issues.append(
                    f"슬롯{pos_int}에서 길이{span_int}은 세션 경계(5) 초과"
                )

        if complete:
            status_label = STATUS_ASSIGNED
        elif any_filled:
            status_label = STATUS_PARTIAL
            issues.insert(0, f"필수 배정값 누락: {', '.join(missing_required)}")
        else:
            status_label = STATUS_UNASSIGNED

        parts = [
            x for x in [
                date,
                session,
                f"{venue}발표장" if venue else '',
                f"슬롯{pos}" + (f"(+{span_int - 1})" if is_oral and span_int and span_int > 1 else '')
                if pos else '',
            ] if x
        ]
        location = ' / '.join(parts) if parts else ''

        status_rows.append({
            '논문번호': pid,
            '발표자': r.get('발표자'),
            '발표형식': r.get('발표형식'),
            '발표분야': r.get('발표분야'),
            '배정여부': status_label,
            '위치': location,
            '이슈': ' | '.join(issues),
        })

        for msg in issues:
            warnings.append({
                '논문번호': pid,
                '발표자': r.get('발표자'),
                '유형': '배정값_오류',
                '상세': msg,
            })

    status_df = pd.DataFrame(status_rows)

    # --- 충돌 검증 1: 구두발표 슬롯 점유 충돌 (세션×발표장 단위) ---
    # (세션, 발표장) 별로 어떤 position(1~5)이 누구에게 점유됐는지 맵
    occupancy = {}  # key: (date, session, venue), value: {pos: [pid, ...]}
    for _, r in df_clean.iterrows():
        if r.get('발표형식') != '구두발표':
            continue
        a = assign_lookup.get(r['논문번호'], {})
        date = _clean_cell(a.get('날짜'))
        session = _clean_cell(a.get('세션'))
        venue = _clean_cell(a.get('발표장'))
        pos_int = _parse_int_or_default(_clean_cell(a.get('슬롯순서')), default=None)
        span_int = _parse_int_or_default(_clean_cell(a.get('슬롯길이')), default=1) or 1
        if not (date and session and venue) or pos_int is None:
            continue
        key = (date, session, venue)
        slot_map = occupancy.setdefault(key, {})
        # 이 발표가 차지하는 position들
        for p in range(pos_int, pos_int + span_int):
            if p > MAX_SLOT_POSITION:
                break
            slot_map.setdefault(p, []).append(r['논문번호'])

    for (date, session, venue), slot_map in occupancy.items():
        for p, pids in slot_map.items():
            if len(pids) > 1:
                warnings.append({
                    '논문번호': ', '.join(pids),
                    '발표자': '',
                    '유형': '슬롯_중복점유',
                    '상세': (
                        f"{date}/{session}/{venue}발표장 슬롯{p}에 {len(pids)}건 배정: "
                        f"{', '.join(pids)}"
                    ),
                })

    # --- 충돌 검증 2: 같은 발표자의 세션 중복 ---
    # (발표자, 랩대표, 날짜, 세션) 기준. 랩대표가 다르면 동명이인으로 간주해 제외.
    # 포스터발표는 동일 세션에 여러 명이 정상이므로 검증 대상에서 제외.
    presenter_session_groups = {}
    for _, r in df_clean.iterrows():
        if r.get('발표형식') != '구두발표':
            continue
        a = assign_lookup.get(r['논문번호'], {})
        date = _clean_cell(a.get('날짜'))
        session = _clean_cell(a.get('세션'))
        if not (date and session):
            continue
        lab = _clean_cell(lab_lookup.get(r['논문번호'], {}).get('랩대표'))
        key = (r.get('발표자'), lab, date, session)
        presenter_session_groups.setdefault(key, []).append(r['논문번호'])
    for (presenter, lab, date, session), pids in presenter_session_groups.items():
        if len(pids) > 1:
            warnings.append({
                '논문번호': ', '.join(pids),
                '발표자': presenter,
                '유형': '발표자_시간충돌',
                '상세': f"{date}/{session}에 {len(pids)}건 배정됨 (랩대표={lab or '?'})",
            })

    warn_df = pd.DataFrame(warnings) if warnings else pd.DataFrame(
        columns=['논문번호', '발표자', '유형', '상세']
    )

    # --- 소속 축약표 ---
    unique_affs = sorted(set(df_lab['랩대표_소속_정규화'].dropna()))
    abbr_df = pd.DataFrame([
        {'정규화소속': aff, '축약형': abbreviate_affiliation(aff)}
        for aff in unique_affs if aff
    ])

    stats = {
        'total': len(status_df),
        'assigned': int((status_df['배정여부'] == STATUS_ASSIGNED).sum()),
        'partial': int((status_df['배정여부'] == STATUS_PARTIAL).sum()),
        'unassigned': int((status_df['배정여부'] == STATUS_UNASSIGNED).sum()),
        'warnings': len(warn_df),
    }
    return status_df, warn_df, abbr_df, stats
