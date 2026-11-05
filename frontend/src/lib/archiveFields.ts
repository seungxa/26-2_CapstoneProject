
export type GroupKey =
  | 'education'
  | 'experience'
  | 'military'
  | 'language'
  | 'license'
  | 'activity'
  | 'award'

export type RecordData = Record<string, string>

export type Archive = {
  schemaVersion: '1'
  profile: RecordData
} & Record<GroupKey, RecordData[]>

export type Field = {
  key: string
  label: string
  type?: 'text' | 'email' | 'date' | 'month' | 'number' | 'textarea'
  options?: string[]
  placeholder?: string
}

const options = (items: string) => items.split('|')

export const groupInfo: {
  key: GroupKey
  title: string
  itemName: string
}[] = [
  { key: 'education', title: '학력', itemName: '학교' },
  { key: 'experience', title: '경력', itemName: '경력' },
  { key: 'military', title: '병역사항', itemName: '병역사항' },
  { key: 'language', title: '어학', itemName: '어학' },
  { key: 'license', title: '자격증', itemName: '자격증' },
  { key: 'activity', title: '대외활동', itemName: '활동' },
  { key: 'award', title: '수상 내역', itemName: '수상' },
]

export const fieldGroups: Record<'profile' | GroupKey, Field[]> = {
  profile: [
    { key: 'name', label: '한글 이름' },
    { key: 'nameHanja', label: '한자 이름' },
    { key: 'nameEnglish', label: '영문 이름' },
    { key: 'birth', label: '생년월일', type: 'date' },
    { key: 'gender', label: '성별', options: options('남성|여성') },
    {
      key: 'veteran',
      label: '취업지원대상자(보훈)',
      options: options('비대상|대상'),
    },
    { key: 'veteranNumber', label: '보훈번호' },
    {
      key: 'disability',
      label: '장애 여부',
      options: options('비대상|대상'),
    },
    { key: 'email', label: '이메일', type: 'email' },
    { key: 'phone', label: '휴대전화', placeholder: '010-1234-5678' },
    { key: 'emergencyPhone', label: '비상연락처' },
    { key: 'postcode', label: '우편번호', placeholder: '숫자 5자리' },
    { key: 'address', label: '기본주소' },
    { key: 'addressDetail', label: '상세주소' },
  ],

  education: [
    {
      key: 'tier',
      label: '학교 구분',
      options: options(
        '고등학교|전문대학|대학교|편입대학교|대학원|대학원(석사)|대학원(박사)'
      ),
    },
    { key: 'school', label: '학교명' },
    {
      key: 'location',
      label: '소재지',
      options: options(
        '서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|해외'
      ),
    },
    { key: 'affiliation', label: '계열' },
    { key: 'major', label: '전공' },
    { key: 'doubleMajor', label: '복수전공' },
    { key: 'minor', label: '부전공' },
    { key: 'start', label: '입학년월', type: 'month' },
    { key: 'end', label: '졸업(예정)년월', type: 'month' },
    {
      key: 'status',
      label: '졸업 구분',
      options: options('졸업|졸업예정|재학|휴학|중퇴|수료'),
    },
    {
      key: 'degree',
      label: '학위',
      options: options('전문학사|학사|석사|박사'),
    },
    { key: 'gpa', label: '학점', type: 'number' },
    {
      key: 'scale',
      label: '학점 만점',
      options: options('4.5|4.3|4.0|100'),
    },
  ],

  experience: [
    { key: 'company', label: '회사명' },
    { key: 'department', label: '부서' },
    { key: 'role', label: '직무' },
    { key: 'position', label: '직급' },
    {
      key: 'employmentType',
      label: '근무형태',
      options: options('정규직|계약직|인턴|파견직|수습|아르바이트|기타'),
    },
    { key: 'start', label: '입사년월', type: 'month' },
    { key: 'end', label: '퇴사년월', type: 'month' },
    {
      key: 'status',
      label: '재직 구분',
      options: options('재직|퇴사'),
    },
    {
      key: 'leaving',
      label: '사직사유',
      options: options('계약만료|이직|학업|개인사정|권고사직|기타'),
    },
    { key: 'description', label: '담당업무', type: 'textarea' },
  ],

  military: [
    {
      key: 'serviceStatus',
      label: '군필 여부',
      options: options('군필|미필|면제|복무중|해당없음'),
    },
    {
      key: 'branch',
      label: '군별',
      options: options(
        '육군|해군|공군|해병대|의무경찰|의무소방|사회복무요원|기타'
      ),
    },
    {
      key: 'specialty',
      label: '병과',
      options: options(
        '보병|행정|통신|수송|의무|공병|포병|기갑|헌병|정보|기타'
      ),
    },
    {
      key: 'rankName',
      label: '계급',
      options: options(
        '이병|일병|상병|병장|하사|중사|상사|소위|중위|대위|기타'
      ),
    },
    { key: 'start', label: '복무 시작일', type: 'date' },
    { key: 'end', label: '복무 종료일', type: 'date' },
    {
      key: 'discharge',
      label: '전역사유',
      options: options('만기전역|의가사전역|의병전역|소집해제|기타'),
    },
    { key: 'exemption', label: '면제사유' },
  ],

  language: [
    {
      key: 'languageName',
      label: '언어',
      options: options('영어|일본어|중국어|독일어|프랑스어|스페인어|기타'),
    },
    {
      key: 'exam',
      label: '시험명',
      options: options(
        'TOEIC|TOEIC-Speaking|TOEFL(IBT)|New TEPS|OPIc|JLPT|JPT|HSK|기타'
      ),
    },
    { key: 'score', label: '점수', type: 'number' },
    { key: 'grade', label: '등급', placeholder: '예: IH, AL, N1' },
    { key: 'number', label: '등록번호' },
    { key: 'date', label: '취득일', type: 'date' },
    {
      key: 'speaking',
      label: '회화 수준',
      options: options('상|중|하'),
    },
    {
      key: 'reading',
      label: '독해 수준',
      options: options('상|중|하'),
    },
    {
      key: 'writing',
      label: '작문 수준',
      options: options('상|중|하'),
    },
  ],

  license: [
    { key: 'credential', label: '자격증명' },
    { key: 'grade', label: '등급' },
    { key: 'number', label: '등록(자격)번호' },
    { key: 'issuer', label: '발행처' },
    { key: 'date', label: '취득일', type: 'date' },
  ],

  activity: [
    { key: 'title', label: '활동명' },
    { key: 'organization', label: '주관기관' },
    {
      key: 'category',
      label: '활동 구분',
      options: options(
        '동아리|대외활동|봉사활동|프로젝트|교육|해외경험|기타'
      ),
    },
    { key: 'start', label: '시작년월', type: 'month' },
    { key: 'end', label: '종료년월', type: 'month' },
    { key: 'description', label: '활동내용', type: 'textarea' },
  ],

  award: [
    { key: 'title', label: '수상명' },
    { key: 'organization', label: '수여기관' },
    { key: 'date', label: '수상일', type: 'date' },
    { key: 'rank', label: '수상등급' },
  ],
}

export const highSchoolAffiliations = options(
  '인문계|자연계|예체능계|외국어계|실업계(특성화)|기타'
)

export const collegeAffiliations = options(
  '인문|사회|상경|자연|공학|의약|간호|사범|법과|예체능|농림|가정|기타'
)

export const opicGrades = options(
  'AL|IH|IM3|IM2|IM1|IL|NH|NM|NL'
)

export function blankRecord(group: 'profile' | GroupKey): RecordData {
  return Object.fromEntries(
    fieldGroups[group].map(field => [field.key, ''])
  )
}

export function emptyArchive(): Archive {
  return {
    schemaVersion: '1',
    profile: blankRecord('profile'),
    education: [],
    experience: [],
    military: [],
    language: [],
    license: [],
    activity: [],
    award: [],
  }
}

export function normalizeArchive(input: unknown): Archive {
  const archive = emptyArchive()

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return archive
  }

  const source = input as Record<string, unknown>

  function normalizeRecord(
    group: 'profile' | GroupKey,
    value: unknown
  ): RecordData {
    const record =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {}

    return Object.fromEntries(
      fieldGroups[group].map(field => [
        field.key,
        typeof record[field.key] === 'string'
          ? record[field.key]
          : '',
      ])
    )
  }

  archive.profile = normalizeRecord('profile', source.profile)

  for (const { key } of groupInfo) {
    const items = Array.isArray(source[key]) ? source[key] : []

    archive[key] = items
      .slice(0, 100)
      .map(item => normalizeRecord(key, item))
  }

  return archive
}
