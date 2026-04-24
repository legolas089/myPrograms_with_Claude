"""
Step 6: 최종 포맷팅 및 출력 시트 생성

입력
  - _step1_정제데이터
  - _step2_랩매핑
  - 입력_논문배정       (Step 4에서 사용자가 배정; 세션/슬롯순서/슬롯길이 포함)
  - 입력_좌장Invited    (사용자 편집)
  - 입력_세션좌장       (세션 단위: 날짜×세션×발표장별 세션명·좌장)
  - 설정_시간대         (슬롯 단위: 15분 + 세션 컬럼)

출력 (모두 매번 덮어씀)
  - 구두 발표 명단
  - 포스터 발표 명단
  - 5월7일(목), 5월8일(금) 매트릭스 (+ 병합 정보)
  - 발표 세부 일정

설계
  - 슬롯 = 15분 표시 단위 (설정_시간대의 각 행)
  - 세션 = 좌장 단위, 연속 5슬롯 그룹 (75분)
  - 구두/포스터 모두 날짜+세션+발표장+슬롯순서가 있어야 최종 출력에 반영
  - 구두발표: 슬롯길이(1~5)로 시간표 세로 병합
  - 포스터발표: 슬롯순서(`A01`, `B19` 등)를 코드/정렬 기준으로 사용
  - 45분 발표(슬롯길이=3) 등은 매트릭스에서 세로 병합
  - 휴식 슬롯은 가로 병합
"""

import re

import pandas as pd

from scripts.step2_lab_mapping import normalize_affiliation
from scripts.step4_assignment import (
    abbreviate_affiliation,
    _clean_cell,
    DEFAULT_TIMESLOTS,
    SLOTS_PER_SESSION,
    extract_slot_position,
    is_assignment_complete,
)


# ---------------------------------------------------------------------------
# 상수
# ---------------------------------------------------------------------------

DAY_CODE = {'목': 'Th', '금': 'Fr'}
DAY_ORDER = {'목': 0, '금': 1}

# 세션명에서 suffix(예: '목-오전1' → '오전1')를 단일문자 코드로
SESSION_SUFFIX_CODE = {'오전1': 'A', '오전2': 'B', '오후1': 'C', '오후2': 'D'}

VENUE_NAMES = {
    '1': '그랜드볼륨I',
    '2': '그랜드볼륨II',
    '3': '사파이어I',
    '4': '사파이어II',
    '5': '사파이어III',
    '6': '릴리I',
    '7': '릴리II',
}

DAY_FULL = {'목': '2026년 5월 7일 (목요일)', '금': '2026년 5월 8일 (금요일)'}
DAY_LABEL = {'목': '5월7일(목)', '금': '5월8일(금)'}
POSTER_SESSION_DATE_LABEL = {'목': '5/7(목)', '금': '5/8(금)'}
POSTER_SESSION_COLUMNS = 14


# ---------------------------------------------------------------------------
# 유틸
# ---------------------------------------------------------------------------

def _session_suffix(session_name):
    """'목-오전1' → '오전1'. 구분자가 없으면 원본 반환."""
    if not session_name:
        return ''
    if '-' in session_name:
        return session_name.split('-', 1)[1]
    return session_name


def generate_session_code(date, session, venue, position):
    """KSME 26CA-Th01A01 형태 코드 생성.

    - date: '목'/'금'
    - session: '목-오전1' 등
    - venue: '1'~'7'
    - position: 세션 내 슬롯순서 1~5
    """
    if not (date and session and venue and position):
        return ''
    day = DAY_CODE.get(date, '??')
    venue_str = str(venue).zfill(2)
    suffix = _session_suffix(session)
    slot_letter = SESSION_SUFFIX_CODE.get(suffix, '?')
    try:
        pos_str = str(int(position)).zfill(2)
    except (ValueError, TypeError):
        pos_str = str(position).zfill(2)
    return f"KSME 26CA-{day}{venue_str}{slot_letter}{pos_str}"


def format_matrix_cell(presenter, aff_normalized, is_invited):
    """시간표 매트릭스 셀 포맷: '{[Invited] }{발표자}\\n({소속축약})'"""
    abbr = abbreviate_affiliation(aff_normalized) if aff_normalized else ''
    name = f"[Invited] {presenter}" if is_invited else presenter
    return f"{name}\n({abbr})" if abbr else name


def format_poster_session_cell(presenter, aff_normalized, slot_label):
    """포스터 세션 표 셀 포맷."""
    abbr = abbreviate_affiliation(aff_normalized) if aff_normalized else ''
    code = _clean_cell(slot_label)
    parts = [presenter]
    if abbr:
        parts.append(f"({abbr})")
    if code:
        parts.append(f"[{code}]")
    return '\n'.join(parts)


def format_author_list_detail(authors_raw, affiliations_raw, presenter):
    """발표 세부 일정의 저자 포맷. 발표자에 *, 각 저자 옆에 축약 소속."""
    if not authors_raw:
        return ''
    authors = [a.strip() for a in str(authors_raw).split(',') if a.strip()]
    affs_raw = [a.strip() for a in str(affiliations_raw).split(',')]

    parts = []
    for i, name in enumerate(authors):
        aff_raw = affs_raw[i] if i < len(affs_raw) else ''
        aff_abbr = abbreviate_affiliation(normalize_affiliation(aff_raw)) if aff_raw else ''
        mark = '*' if name == presenter else ''
        if aff_abbr:
            parts.append(f"{name}{mark}({aff_abbr})")
        else:
            parts.append(f"{name}{mark}")
    return ', '.join(parts)


# ---------------------------------------------------------------------------
# 설정_시간대 파싱 — 슬롯↔세션 매핑
# ---------------------------------------------------------------------------

def _build_slot_index(df_timeslots):
    """설정_시간대를 해석해서 각종 lookup 구조 반환.

    반환:
      slots_by_day: {'목': [ {시간대, 시작, 종료, 세션, is_break}, ... ], '금': [...]}
      sessions_by_day: {'목': ['목-오전1', '목-오전2', '목-오후1'], '금': [...]}
      session_to_slots: {'목-오전1': [시간대이름, ...5개], ...}  (세션에 속한 슬롯 이름을 순서대로)
    """
    slots_by_day = {'목': [], '금': []}
    sessions_by_day = {'목': [], '금': []}
    session_to_slots = {}

    seen_session = set()
    for _, r in df_timeslots.iterrows():
        date = _clean_cell(r.get('날짜'))
        name = _clean_cell(r.get('시간대'))
        start = _clean_cell(r.get('시작'))
        end = _clean_cell(r.get('종료'))
        session = _clean_cell(r.get('세션'))
        if date not in slots_by_day or not name:
            continue
        is_break = not session  # 세션이 비어있으면 휴식
        slots_by_day[date].append({
            '시간대': name,
            '시작': start,
            '종료': end,
            '세션': session,
            'is_break': is_break,
        })
        if session:
            key = (date, session)
            if key not in seen_session:
                sessions_by_day[date].append(session)
                seen_session.add(key)
            session_to_slots.setdefault(session, []).append(name)
    return slots_by_day, sessions_by_day, session_to_slots


# ---------------------------------------------------------------------------
# 입력_세션좌장 템플릿
# ---------------------------------------------------------------------------

def build_session_chair_template(df_timeslots):
    """세션 단위 템플릿 — 날짜×세션×발표장 = 6×7 = 최대 42행."""
    _, sessions_by_day, _ = _build_slot_index(df_timeslots)
    rows = []
    for date in ['목', '금']:
        for session in sessions_by_day.get(date, []):
            for venue_num in ['1', '2', '3', '4', '5', '6', '7']:
                rows.append({
                    '날짜': date,
                    '세션': session,
                    '발표장': venue_num,
                    '발표장명': VENUE_NAMES[venue_num],
                    '세션명': '',       # ← 사용자 기입 (예: '구조설계 및 CAE 1')
                    '좌장': '',         # ← 사용자 기입 (예: '김성훈 (남부대)')
                    '비고': '',
                })
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# 컨텍스트 테이블
# ---------------------------------------------------------------------------

def _make_context(df_clean, df_lab, df_assign, df_invited, df_timeslots):
    """각 논문에 필요한 모든 정보를 합친 worktable 생성."""
    lab_lookup = df_lab.set_index('논문번호').to_dict('index')
    assign_lookup = df_assign.set_index('논문번호').to_dict('index')
    invited_lookup = (
        df_invited.set_index('논문번호').to_dict('index')
        if df_invited is not None and len(df_invited) else {}
    )

    # 세션 등장 순서 (날짜별)
    _, sessions_by_day, _ = _build_slot_index(df_timeslots)
    session_order = {}
    for date, sessions in sessions_by_day.items():
        for idx, s in enumerate(sessions):
            session_order[(date, s)] = idx

    rows = []
    for _, r in df_clean.iterrows():
        pid = r['논문번호']
        lab_info = lab_lookup.get(pid, {})
        assign_info = assign_lookup.get(pid, {})
        inv_info = invited_lookup.get(pid, {})

        date = _clean_cell(assign_info.get('날짜'))
        session = _clean_cell(assign_info.get('세션'))
        venue = _clean_cell(assign_info.get('발표장'))
        pos = _clean_cell(assign_info.get('슬롯순서'))
        span = _clean_cell(assign_info.get('슬롯길이'))
        is_oral = r.get('발표형식') == '구두발표'
        is_invited = _clean_cell(inv_info.get('Invited')).upper() == 'Y'

        pos_int = extract_slot_position(pos)
        try:
            span_int = int(span) if span else 1
        except ValueError:
            span_int = 1
        if span_int is None or span_int < 1:
            span_int = 1

        session_code = ''
        if is_oral and all([date, session, venue, pos]):
            session_code = generate_session_code(date, session, venue, pos)

        day_ord = DAY_ORDER.get(date, 99)
        sess_ord = session_order.get((date, session), 999)
        try:
            venue_ord = int(venue) if venue else 99
        except ValueError:
            venue_ord = 99
        pos_ord = pos_int if pos_int is not None else 999

        is_assigned = is_assignment_complete(date, session, venue, pos)

        rows.append({
            '논문번호': pid,
            '발표자': r.get('발표자'),
            '소속': r.get('소속'),
            '직위': r.get('직위'),
            '발표형식': r.get('발표형식'),
            '발표분야': r.get('발표분야'),
            '제목': r.get('제목'),
            '저자_원본': r.get('저자정보-성명'),
            '저자_소속_원본': r.get('저자정보-소속기관'),
            '랩대표_소속_원본': lab_info.get('랩대표_소속_원본'),
            '랩대표_소속_정규화': lab_info.get('랩대표_소속_정규화'),
            '날짜': date,
            '세션': session,
            '발표장': venue,
            '슬롯순서': pos,
            '슬롯길이': span_int,
            '세션코드': session_code,
            'is_oral': is_oral,
            'is_invited': is_invited,
            'is_assigned': is_assigned,
            '_날짜순': day_ord,
            '_세션순': sess_ord,
            '_발표장순': venue_ord,
            '_슬롯순': pos_ord,
        })
    return pd.DataFrame(rows)


def _validate_poster_field_contiguity(ctx):
    """각 (날짜, 세션) 내에서 포스터 분야 블록이 연속되는지 검증.
    슬롯순서 기준 정렬 후 한 번 종료된 분야가 다시 나타나면 위반으로 기록.
    """
    errors = []
    poster = ctx[(~ctx['is_oral']) & (ctx['is_assigned'])]
    for (day, sess), grp in poster.groupby(['날짜', '세션'], sort=False):
        seen_completed = set()
        prev_field = None
        for _, r in grp.sort_values(['_슬롯순', '논문번호']).iterrows():
            f = r['발표분야']
            if f != prev_field:
                if f in seen_completed:
                    errors.append({
                        '날짜': day, '세션': sess,
                        '논문번호': r['논문번호'], '발표자': r['발표자'],
                        '슬롯순서': r['슬롯순서'], '발표분야': f,
                        '이전분야': prev_field,
                    })
                if prev_field is not None:
                    seen_completed.add(prev_field)
                prev_field = f
    return errors


def _validate_poster_slot_numbers(ctx):
    """각 (날짜, 세션) 내 포스터 슬롯 숫자가 고유한지 검증.
    같은 세션에서 'A16'과 'C16'처럼 숫자가 겹치면 코드가 중복되므로 차단.
    """
    errors = []
    poster = ctx[(~ctx['is_oral']) & (ctx['is_assigned'])]
    for (day, sess), grp in poster.groupby(['날짜', '세션'], sort=False):
        seen = {}  # num -> (pid, slot, 발표자)
        for _, r in grp.sort_values(['_슬롯순', '논문번호']).iterrows():
            num = r.get('_슬롯순')
            if pd.isna(num):
                continue
            num = int(num)
            if num in seen:
                prev = seen[num]
                errors.append({
                    '날짜': day, '세션': sess, '번호': num,
                    'prev_slot': prev[1], 'prev_pid': prev[0], 'prev_발표자': prev[2],
                    'cur_slot': r['슬롯순서'], 'cur_pid': r['논문번호'], 'cur_발표자': r['발표자'],
                })
            else:
                seen[num] = (r['논문번호'], r['슬롯순서'], r['발표자'])
    return errors


def _validate_poster_slot_prefix(ctx):
    """슬롯 접두어(A/B/C/D)가 세션 레터와 일치하는지 검증."""
    errors = []
    poster = ctx[(~ctx['is_oral']) & (ctx['is_assigned'])]
    for _, r in poster.iterrows():
        slot = str(r.get('슬롯순서', '')).strip()
        if not slot:
            continue
        m = re.match(r'^([A-Za-z])', slot)
        if not m:
            continue
        slot_letter = m.group(1).upper()
        suffix = _session_suffix(r.get('세션', ''))
        expected = SESSION_SUFFIX_CODE.get(suffix, '?')
        if slot_letter != expected:
            errors.append({
                '날짜': r['날짜'], '세션': r['세션'],
                '논문번호': r['논문번호'], '발표자': r['발표자'],
                '슬롯순서': slot, 'expected': expected,
            })
    return errors


# ---------------------------------------------------------------------------
# 1. 구두 발표 명단
# ---------------------------------------------------------------------------

def _build_chair_lookup(df_session_chair):
    """(날짜, 세션, 발표장) → {세션명, 좌장} dict 반환."""
    sc_lookup = {}
    if df_session_chair is None:
        return sc_lookup
    for _, r in df_session_chair.iterrows():
        d = _clean_cell(r.get('날짜'))
        s = _clean_cell(r.get('세션'))
        v = _clean_cell(r.get('발표장'))
        if d and s and v:
            sc_lookup[(d, s, v)] = {
                '세션명': _clean_cell(r.get('세션명')),
                '좌장': _clean_cell(r.get('좌장')),
            }
    return sc_lookup


def _chair_of(sc_lookup, date, session, venue):
    info = sc_lookup.get((date, session, str(venue)), {})
    return info.get('좌장') or ''


def build_oral_list(ctx, df_session_chair=None):
    """구두 발표 명단 (배정 완료만, 발표 순서대로). 좌장 컬럼 포함."""
    df = ctx[(ctx['is_oral']) & (ctx['is_assigned'])].copy()
    df = df.sort_values(
        ['_날짜순', '_세션순', '_발표장순', '_슬롯순', '논문번호']
    ).reset_index(drop=True)
    sc = _build_chair_lookup(df_session_chair)
    chairs = [_chair_of(sc, d, s, v) for d, s, v in zip(df['날짜'], df['세션'], df['발표장'])]
    return pd.DataFrame({
        '번호': range(1, len(df) + 1),
        '논문번호': df['논문번호'],
        '세션코드': df['세션코드'],
        '발표자': df['발표자'],
        '소속': df['소속'],
        '직위': df['직위'],
        '발표분야': df['발표분야'],
        '제목': df['제목'],
        'Invited': df['is_invited'].map({True: 'Y', False: ''}),
        '좌장': chairs,
    })


# ---------------------------------------------------------------------------
# 2. 포스터 발표 명단
# ---------------------------------------------------------------------------

POSTER_VENUE_CODE = '08'  # 포스터 세션 가상 발표장 코드 (구두 1~7과 구분)


def generate_poster_code(date, session, position):
    """포스터 세션코드: KSME 26CA-{Day}{08}{SessionLetter}{Position}

    예) 목-오전1의 1번 포스터 → KSME 26CA-Th08A01
    """
    if not (date and session and position):
        return ''
    day = DAY_CODE.get(date, '??')
    suffix = _session_suffix(session)
    slot_letter = SESSION_SUFFIX_CODE.get(suffix, '?')
    try:
        pos_str = str(int(position)).zfill(2)
    except (ValueError, TypeError):
        pos_str = str(position).zfill(2)
    return f"KSME 26CA-{day}{POSTER_VENUE_CODE}{slot_letter}{pos_str}"


def _poster_codes_by_pid(df):
    """사용자가 입력_논문배정.슬롯순서에 적은 숫자를 코드 위치로 그대로 사용.
    예: 슬롯 'A14' → 코드 ..A14. 'C16'이라도 세션이 오전1이면 ..A16 (letter는 세션 기준).
    숫자 중복·누락은 _validate_poster_slot_uniqueness에서 별도 검증.
    """
    mapping = {}
    for (day, sess), grp in df.groupby(['날짜', '세션'], sort=False):
        for _, r in grp.iterrows():
            num = r.get('_슬롯순')
            if pd.isna(num):
                continue
            mapping[r['논문번호']] = generate_poster_code(day, sess, int(num))
    return mapping


def _assign_poster_codes(df):
    mapping = _poster_codes_by_pid(df)
    return [mapping.get(pid, '') for pid in df['논문번호']]


def build_poster_list(ctx, df_session_chair=None):
    """포스터 발표 명단 (배정된 것만, 발표 순서대로). 좌장·포스터코드 포함."""
    df = ctx[(~ctx['is_oral']) & (ctx['is_assigned'])].copy()
    df = df.sort_values(
        ['_날짜순', '_세션순', '_발표장순', '_슬롯순', '논문번호']
    ).reset_index(drop=True)
    sc = _build_chair_lookup(df_session_chair)
    chairs = [_chair_of(sc, d, s, v) for d, s, v in zip(df['날짜'], df['세션'], df['발표장'])]
    codes = _assign_poster_codes(df)
    return pd.DataFrame({
        '번호': range(1, len(df) + 1),
        '포스터코드': codes,
        '논문번호': df['논문번호'],
        '세션': df['세션'],
        '발표자': df['발표자'],
        '소속': df['소속'],
        '직위': df['직위'],
        '발표분야': df['발표분야'],
        '제목': df['제목'],
        '좌장': chairs,
    })


# ---------------------------------------------------------------------------
# 3. 시간표 매트릭스 (병합 정보 포함)
# ---------------------------------------------------------------------------

def build_matrix(ctx, df_timeslots, df_session_chair, day):
    """특정 날짜의 매트릭스 DataFrame + 병합 지시 리스트 반환.

    반환: (matrix_df, merges)
      merges: [(r1, c1, r2, c2), ...]  (openpyxl에 전달할 1-based 셀 좌표)
    """
    slots_by_day, sessions_by_day, session_to_slots = _build_slot_index(df_timeslots)
    day_slots = slots_by_day.get(day, [])

    # 세션/좌장 lookup (세션 단위)
    sc_lookup = {}
    if df_session_chair is not None:
        for _, r in df_session_chair.iterrows():
            d = _clean_cell(r.get('날짜'))
            s = _clean_cell(r.get('세션'))
            v = _clean_cell(r.get('발표장'))
            if d and s and v:
                sc_lookup[(d, s, v)] = {
                    '세션명': _clean_cell(r.get('세션명')),
                    '좌장': _clean_cell(r.get('좌장')),
                }

    # 구두발표를 (날짜, 세션, 발표장, 시작슬롯순서) 기준으로 lookup
    # 발표자 셀 + 차지하는 슬롯수 정보 필요
    presentation_cells = {}  # (session, venue, pos): {'text':..., 'span':...}
    day_ctx = ctx[(ctx['날짜'] == day) & (ctx['is_oral']) & (ctx['is_assigned'])]
    for _, p in day_ctx.iterrows():
        try:
            pos_int = int(p['슬롯순서'])
        except (ValueError, TypeError):
            continue
        key = (p['세션'], p['발표장'], pos_int)
        text = format_matrix_cell(
            p['발표자'],
            p['랩대표_소속_정규화'] or p['소속'],
            p['is_invited'],
        )
        existing = presentation_cells.get(key)
        if existing is None:
            presentation_cells[key] = {'text': text, 'span': int(p['슬롯길이'] or 1)}
        else:
            # 중복 배정 — 줄바꿈으로 합침 (검증 단계 경고도 발생함)
            existing['text'] += '\n' + text

    venues = ['1', '2', '3', '4', '5', '6', '7']

    # 헤더 (3행)
    header_rows = [
        [f"{DAY_LABEL[day]} 대한기계학회 CAE 및 응용역학부문 2026년 춘계학술대회 발표일정"]
        + [''] * 7,
        ['발표장 / 시간'] + [f'제{i}발표장' for i in range(1, 8)],
        [''] + [VENUE_NAMES[v] for v in venues],
    ]
    body_rows = []
    merges = []  # 1-based

    # 헤더 행(첫 줄) 가로 병합 — 전체 8열
    merges.append((1, 1, 1, 8))

    # body 생성
    # session_seen: 해당 세션의 세션명/좌장 헤더를 한 번만 그리기 위해
    session_seen = set()
    # 세로 병합 스킵 마커: (row_idx, col_idx) 에 공백을 넣고 나중에 병합
    vertical_skip = set()
    # 세션 구분용: 이전 슬롯의 '구분키' (세션명 or '__break__')
    prev_group = None

    for slot in day_slots:
        ts_name = slot['시간대']
        start, end = slot['시작'], slot['종료']
        session = slot['세션']
        is_break = slot['is_break']
        curr_group = '__break__' if is_break else session

        # 세션(또는 휴식 블록)이 바뀌면 공백 행 한 줄 삽입
        if prev_group is not None and curr_group != prev_group:
            body_rows.append([''] * 8)

        # 새 세션 시작 시점이면 세션명/좌장 행 삽입
        if session and session not in session_seen:
            session_seen.add(session)
            sess_row = ['세션명']
            chair_row = ['좌장']
            for v in venues:
                info = sc_lookup.get((day, session, v), {})
                sess_row.append(info.get('세션명') or 'TBD')
                chair_row.append(info.get('좌장') or 'TBD')
            body_rows.append(sess_row)
            body_rows.append(chair_row)

        prev_group = curr_group

        # 슬롯 행
        time_label = f"{start}~{end}"
        if is_break:
            # 휴식 → 가로 병합 (발표장 7칸을 하나로)
            row_idx_1based = len(header_rows) + len(body_rows) + 1
            body_rows.append([time_label, '휴식'] + [''] * 6)
            merges.append((row_idx_1based, 2, row_idx_1based, 8))
            continue

        # 구두 슬롯: 세션 내 해당 slot의 position을 계산
        session_slots_list = session_to_slots.get(session, [])
        try:
            pos_in_session = session_slots_list.index(ts_name) + 1  # 1-based
        except ValueError:
            pos_in_session = None

        row = [time_label]
        current_row_idx = len(header_rows) + len(body_rows) + 1  # 1-based

        for col_idx_0, v in enumerate(venues):
            col_idx_1based = col_idx_0 + 2  # A=1, 발표장1=2
            if (current_row_idx, col_idx_1based) in vertical_skip:
                row.append('')
                continue

            cell = presentation_cells.get((session, v, pos_in_session))
            if cell is None:
                row.append('')
            else:
                row.append(cell['text'])
                span = cell['span']
                if span > 1:
                    # 세로 병합: 아래 span-1개 행을 스킵 등록 + merges 추가
                    end_row = current_row_idx + span - 1
                    merges.append((current_row_idx, col_idx_1based, end_row, col_idx_1based))
                    for extra in range(1, span):
                        vertical_skip.add((current_row_idx + extra, col_idx_1based))
        body_rows.append(row)

    all_rows = header_rows + body_rows
    matrix_df = pd.DataFrame(all_rows)
    return matrix_df, merges


# ---------------------------------------------------------------------------
# 4. 발표 세부 일정
# ---------------------------------------------------------------------------

def build_oral_detail(ctx, df_timeslots, df_session_chair):
    """발표장별 → 날짜별 → 세션별 상세 출력.

    구분 규칙: 세션 사이에 1줄, 날짜 사이에 2줄 공백.
    """
    _, sessions_by_day, session_to_slots = _build_slot_index(df_timeslots)

    # 세션별 시작~종료 시간
    session_times = {}
    for _, t in df_timeslots.iterrows():
        session = _clean_cell(t.get('세션'))
        if not session:
            continue
        start = _clean_cell(t.get('시작'))
        end = _clean_cell(t.get('종료'))
        if session not in session_times:
            session_times[session] = [start, end]
        else:
            session_times[session][1] = end

    sc_lookup = _build_chair_lookup(df_session_chair)

    # 2열 구조: [세션코드, 내용]
    rows = [['발 표 세 부 일 정', '']]

    for venue_num in ['1', '2', '3', '4', '5', '6', '7']:
        rows.append(['', f"제{venue_num}발표장 ({VENUE_NAMES[venue_num]})"])

        first_day_written = False
        for day in ['목', '금']:
            day_data = ctx[
                (ctx['발표장'] == venue_num)
                & (ctx['날짜'] == day)
                & (ctx['is_oral'])
                & (ctx['is_assigned'])
            ]
            if len(day_data) == 0:
                continue

            if first_day_written:
                rows.append(['', ''])
                rows.append(['', ''])
            first_day_written = True

            rows.append(['', DAY_FULL[day]])

            first_session_written = False
            for session in sessions_by_day.get(day, []):
                sess_data = day_data[day_data['세션'] == session]
                if len(sess_data) == 0:
                    continue
                sess_data = sess_data.sort_values('_슬롯순')

                if first_session_written:
                    rows.append(['', ''])
                first_session_written = True

                start, end = session_times.get(session, ('', ''))
                info = sc_lookup.get((day, session, venue_num), {})
                sess_name = info.get('세션명') or 'TBD'
                chair = info.get('좌장') or 'TBD'
                header = f"{start} ~ {end}  {sess_name}          좌 장 : {chair}"
                rows.append(['', header])

                for _, p in sess_data.iterrows():
                    author_line = format_author_list_detail(
                        p['저자_원본'], p['저자_소속_원본'], p['발표자']
                    )
                    title_prefix = 'Invited Paper*  ' if p['is_invited'] else ''
                    title_line = f"{title_prefix}{p['제목']} / {author_line}"
                    rows.append([p['세션코드'], title_line])

    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# 5. 포스터 발표 세부 일정
# ---------------------------------------------------------------------------

def build_poster_detail(ctx, df_timeslots, df_session_chair):
    """포스터 세부 일정 — 세션별로 묶고, 각 세션 내에서 발표분야별로 묶어서 나열.

    구분: 세션 사이에 2줄, 발표분야 사이에 1줄.
    """
    _, sessions_by_day, _ = _build_slot_index(df_timeslots)

    session_times = {}
    for _, t in df_timeslots.iterrows():
        session = _clean_cell(t.get('세션'))
        if not session:
            continue
        start = _clean_cell(t.get('시작'))
        end = _clean_cell(t.get('종료'))
        if session not in session_times:
            session_times[session] = [start, end]
        else:
            session_times[session][1] = end

    sc_lookup = _build_chair_lookup(df_session_chair)

    # 2열 구조: [세션코드, 내용]
    rows = [['포 스 터 발 표 세 부 일 정', '']]

    poster_ctx = ctx[(~ctx['is_oral']) & (ctx['is_assigned'])].copy()

    first_session_written = False
    for day in ['목', '금']:
        for session in sessions_by_day.get(day, []):
            sess_data = poster_ctx[
                (poster_ctx['날짜'] == day) & (poster_ctx['세션'] == session)
            ]
            if len(sess_data) == 0:
                continue

            if first_session_written:
                rows.append(['', ''])
                rows.append(['', ''])
            first_session_written = True

            venues = sess_data['발표장'].dropna().unique()
            venue_for_chair = str(venues[0]) if len(venues) else '7'
            info = sc_lookup.get((day, session, venue_for_chair), {})
            sess_name = info.get('세션명') or '포스터 전시'
            chair = info.get('좌장') or 'TBD'
            start, end = session_times.get(session, ('', ''))

            header = (
                f"[{DAY_LABEL[day]} {session}] {start} ~ {end}  "
                f"{sess_name}          좌 장 : {chair}"
            )
            rows.append(['', header])

            sess_sorted = sess_data.sort_values(
                ['_슬롯순', '논문번호']
            ).reset_index(drop=True)
            code_by_pid = _poster_codes_by_pid(sess_data)

            # 사용자 슬롯순서 그대로 순회 — 발표분야가 바뀔 때마다 헤더 삽입
            field_blocks = []
            cur_field = None
            cur_block = []
            for _, p in sess_sorted.iterrows():
                f = p['발표분야']
                if f != cur_field:
                    if cur_block:
                        field_blocks.append((cur_field, cur_block))
                    cur_field = f
                    cur_block = []
                cur_block.append(p)
            if cur_block:
                field_blocks.append((cur_field, cur_block))

            first_block_written = False
            for field, block in field_blocks:
                if first_block_written:
                    rows.append(['', ''])
                first_block_written = True

                rows.append(['', f"◆ {field} ({len(block)}편)"])
                for p in block:
                    author_line = format_author_list_detail(
                        p['저자_원본'], p['저자_소속_원본'], p['발표자']
                    )
                    pcode = code_by_pid.get(p['논문번호'], '')
                    rows.append([pcode, f"{p['제목']} / {author_line}"])

    return pd.DataFrame(rows)


def build_poster_session_sheet(ctx, df_timeslots):
    """포스터 세션을 예시 표 형태로 배치한 시트 + 병합 정보 생성."""
    _, sessions_by_day, _ = _build_slot_index(df_timeslots)

    session_times = {}
    for _, t in df_timeslots.iterrows():
        session = _clean_cell(t.get('세션'))
        if not session:
            continue
        start = _clean_cell(t.get('시작'))
        end = _clean_cell(t.get('종료'))
        if session not in session_times:
            session_times[session] = [start, end]
        else:
            session_times[session][1] = end

    poster_ctx = ctx[(~ctx['is_oral']) & (ctx['is_assigned'])].copy()
    if poster_ctx.empty:
        rows = [['포스터 세션 배치 데이터 없음'] + [''] * (POSTER_SESSION_COLUMNS - 1)]
        merges = [(1, 1, 1, POSTER_SESSION_COLUMNS)]
        return pd.DataFrame(rows), merges

    poster_ctx = poster_ctx.sort_values(
        ['_날짜순', '_세션순', '_슬롯순', '논문번호']
    ).reset_index(drop=True)

    rows = []
    merges = []
    current_row = 1

    for day in ['목', '금']:
        for session in sessions_by_day.get(day, []):
            sess_data = poster_ctx[
                (poster_ctx['날짜'] == day) & (poster_ctx['세션'] == session)
            ].copy()
            if sess_data.empty:
                continue

            sess_data = sess_data.sort_values(['_슬롯순', '논문번호']).reset_index(drop=True)
            suffix = _session_suffix(session)
            session_letter = SESSION_SUFFIX_CODE.get(suffix, '?')
            start, end = session_times.get(session, ('', ''))
            title = (
                f"포스터 세션 {session_letter} "
                f"({POSTER_SESSION_DATE_LABEL[day]} {start}~{end}, {len(sess_data)}명)"
            )
            rows.append([title] + [''] * (POSTER_SESSION_COLUMNS - 1))
            merges.append((current_row, 1, current_row, POSTER_SESSION_COLUMNS))
            current_row += 1

            for start_idx in range(0, len(sess_data), POSTER_SESSION_COLUMNS):
                chunk = sess_data.iloc[start_idx:start_idx + POSTER_SESSION_COLUMNS].reset_index(drop=True)

                header_row = [''] * POSTER_SESSION_COLUMNS
                seg_start = 0
                while seg_start < len(chunk):
                    field = chunk.loc[seg_start, '발표분야']
                    seg_end = seg_start
                    while seg_end + 1 < len(chunk) and chunk.loc[seg_end + 1, '발표분야'] == field:
                        seg_end += 1
                    header_row[seg_start] = field
                    if seg_end > seg_start:
                        merges.append(
                            (current_row, seg_start + 1, current_row, seg_end + 1)
                        )
                    seg_start = seg_end + 1
                rows.append(header_row)
                current_row += 1

                poster_row = [''] * POSTER_SESSION_COLUMNS
                for col_idx, (_, p) in enumerate(chunk.iterrows()):
                    poster_row[col_idx] = format_poster_session_cell(
                        p['발표자'],
                        p['랩대표_소속_정규화'] or p['소속'],
                        p['슬롯순서'],
                    )
                rows.append(poster_row)
                current_row += 1

                if start_idx + POSTER_SESSION_COLUMNS < len(sess_data):
                    rows.append([''] * POSTER_SESSION_COLUMNS)
                    current_row += 1

            rows.append([''] * POSTER_SESSION_COLUMNS)
            rows.append([''] * POSTER_SESSION_COLUMNS)
            current_row += 2

    return pd.DataFrame(rows), merges


# ---------------------------------------------------------------------------
# 진입점
# ---------------------------------------------------------------------------

def build_all(df_clean, df_lab, df_assign, df_timeslots, df_invited, df_session_chair):
    """모든 Step 6 출력 생성.

    반환: (outputs, merges, stats)
      outputs: {sheet_name: DataFrame}
      merges:  {sheet_name: [(r1,c1,r2,c2), ...]}   (openpyxl 1-based)
    """
    ctx = _make_context(df_clean, df_lab, df_assign, df_invited, df_timeslots)

    mat_thu, merges_thu = build_matrix(ctx, df_timeslots, df_session_chair, '목')
    mat_fri, merges_fri = build_matrix(ctx, df_timeslots, df_session_chair, '금')

    poster_session_sheet, poster_session_merges = build_poster_session_sheet(ctx, df_timeslots)

    outputs = {
        '구두 발표 명단': build_oral_list(ctx, df_session_chair),
        '포스터 발표 명단': build_poster_list(ctx, df_session_chair),
        '5월7일(목)': mat_thu,
        '5월8일(금)': mat_fri,
        '발표 세부 일정': build_oral_detail(ctx, df_timeslots, df_session_chair),
        '포스터 발표 세부 일정': build_poster_detail(ctx, df_timeslots, df_session_chair),
        '포스터 세션 배치': poster_session_sheet,
    }
    merges = {
        '5월7일(목)': merges_thu,
        '5월8일(금)': merges_fri,
        '포스터 세션 배치': poster_session_merges,
    }
    stats = {
        'n_oral_listed': len(outputs['구두 발표 명단']),
        'n_poster_listed': len(outputs['포스터 발표 명단']),
    }
    return outputs, merges, stats
