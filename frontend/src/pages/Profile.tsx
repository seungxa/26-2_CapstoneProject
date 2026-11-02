
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Entry = {
  id: number
  title: string
  organization: string
  date: string
  description: string
}

type SectionKey = 'certificates' | 'languages' | 'activities' | 'awards'

type BasicInfo = {
  name: string
  email: string
  phone: string
  address: string
}

type EducationInfo = {
  school: string
  major: string
  secondMajor: string
  gpa: string
  period: string
}

type Sections = Record<SectionKey, Entry[]>

const sectionTitles: Record<SectionKey, string> = {
  certificates: '자격증',
  languages: '어학',
  activities: '경력 및 대외활동',
  awards: '수상 내역',
}

const sectionLabels: Record<SectionKey, string[]> = {
  certificates: ['자격증명', '발급기관', '등급', '취득일', '비고'],
  languages: ['시험명', '등급', '응시일', '비고'],
  activities: ['활동명 / 회사명', '기관명', '활동 기간', '역할 및 주요 내용'],
  awards: ['수상명', '주최기관', '수상일', '수상 내용'],
}

const createEntry = (): Entry => ({
  id: Date.now() + Math.random(),
  title: '',
  organization: '',
  date: '',
  description: '',
})

const initialBasic: BasicInfo = {
  name: '',
  email: '',
  phone: '',
  address: '',
}

const initialEducation: EducationInfo = {
  school: '',
  major: '',
  secondMajor: '',
  gpa: '',
  period: '',
}

const createInitialSections = (): Sections => ({
  certificates: [createEntry()],
  languages: [createEntry()],
  activities: [createEntry()],
  awards: [createEntry()],
})

function Profile() {
  const [basic, setBasic] = useState<BasicInfo>(initialBasic)
  const [education, setEducation] =
    useState<EducationInfo>(initialEducation)

  const [sections, setSections] =
    useState<Sections>(createInitialSections)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [showSaveModal, setShowSaveModal] = useState(false)
  // Load saved profile when the page opens
  useEffect(() => {
    let active = true

    const loadProfile = async () => {
      try {
        const { data: userData, error: userError } =
          await supabase.auth.getUser()

        if (userError) throw userError

        const user = userData.user

        if (!user) {
          throw new Error('로그인이 필요합니다.')
        }

        const { data, error } = await supabase
          .from('profiles')
          .select('basic, education, sections')
          .eq('user_id', user.id)
          .maybeSingle()

        if (error) throw error
        if (!active) return

        if (data) {
          setBasic({
            ...initialBasic,
            ...(data.basic as Partial<BasicInfo>),
          })

          setEducation({
            ...initialEducation,
            ...(data.education as Partial<EducationInfo>),
          })

          const savedSections =
            data.sections as Partial<Sections> | null

          const defaults = createInitialSections()

          setSections({
            certificates:
              savedSections?.certificates ?? defaults.certificates,
            languages:
              savedSections?.languages ?? defaults.languages,
            activities:
              savedSections?.activities ?? defaults.activities,
            awards:
              savedSections?.awards ?? defaults.awards,
          })
        } else {
          // Use the account email for a new profile
          setBasic(prev => ({
            ...prev,
            email: user.email ?? '',
          }))
        }
      } catch (error) {
        if (active) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : '프로필을 불러오지 못했습니다.'
          )
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    loadProfile()

    return () => {
      active = false
    }
  }, [])

  function addEntry(section: SectionKey) {
    setSections(prev => ({
      ...prev,
      [section]: [...prev[section], createEntry()],
    }))
  }

  function removeEntry(section: SectionKey, id: number) {
    setSections(prev => ({
      ...prev,
      [section]: prev[section].filter(entry => entry.id !== id),
    }))
  }

  function updateEntry(
    section: SectionKey,
    id: number,
    field: keyof Entry,
    value: string
  ) {
    setSections(prev => ({
      ...prev,
      [section]: prev[section].map(entry =>
        entry.id === id ? { ...entry, [field]: value } : entry
      ),
    }))
  }

  // Save the current profile to Supabase
  const handleSave = async () => {
    setSaving(true)
    setMessage('')
    setErrorMessage('')

    try {
      const { data: userData, error: userError } =
        await supabase.auth.getUser()

      if (userError) throw userError

      const user = userData.user

      if (!user) {
        throw new Error('로그인이 필요합니다.')
      }

      const { error } = await supabase
        .from('profiles')
        .upsert(
          {
            user_id: user.id,
            basic,
            education,
            sections,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        )

      if (error) throw error

      setShowSaveModal(true)
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : '프로필 저장에 실패했습니다.'
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="profile-page">
        <h1>My Profile</h1>
        <p>프로필 정보를 불러오는 중입니다...</p>
      </div>
    )
  }

  return (
    <div className="profile-page">
      <h1>My Profile</h1>
      <p className="profile-description">
        채용 지원에 필요한 정보를 등록해 주세요.
        모든 항목을 작성할 필요는 없습니다.
      </p>

      {errorMessage && (
        <p role="alert" style={{ color: '#dc2626' }}>
          {errorMessage}
        </p>
      )}

      {message && (
        <p role="status" style={{ color: '#15803d' }}>
          {message}
        </p>
      )}

      <section className="profile-section">
        <h2>👤 기본정보</h2>
        <div className="profile-grid">
          <label>
            이름
            <input
              value={basic.name}
              onChange={e =>
                setBasic({ ...basic, name: e.target.value })
              }
              placeholder="이름"
            />
          </label>

          <label>
            이메일
            <input
              type="email"
              value={basic.email}
              onChange={e =>
                setBasic({ ...basic, email: e.target.value })
              }
              placeholder="example@email.com"
            />
          </label>

          <label>
            전화번호
            <input
              value={basic.phone}
              onChange={e =>
                setBasic({ ...basic, phone: e.target.value })
              }
              placeholder="010-0000-0000"
            />
          </label>

          <label>
            주소
            <input
              value={basic.address}
              onChange={e =>
                setBasic({ ...basic, address: e.target.value })
              }
              placeholder="주소"
            />
          </label>
        </div>
      </section>

      <section className="profile-section">
        <h2>🎓 학력</h2>
        <div className="profile-grid">
          {([
            ['school', '학교명'],
            ['major', '전공'],
            ['secondMajor', '복수전공'],
            ['gpa', '학점'],
            ['period', '재학 기간'],
          ] as const).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                value={education[key]}
                onChange={e =>
                  setEducation({
                    ...education,
                    [key]: e.target.value,
                  })
                }
                placeholder={label}
              />
            </label>
          ))}
        </div>
      </section>

      {(Object.keys(sectionTitles) as SectionKey[]).map(section => (
        <section className="profile-section" key={section}>
          <h2>{sectionTitles[section]}</h2>

          {sections[section].map((entry, index) => (
            <div className="profile-entry" key={entry.id}>
              <div className="entry-header">
                <strong>
                  {sectionTitles[section]} {index + 1}
                </strong>

                <button
                  type="button"
                  className="delete-button"
                  onClick={() => removeEntry(section, entry.id)}
                >
                  삭제
                </button>
              </div>

              <div className="profile-grid">
                {(
                  ['title', 'organization', 'date', 'description'] as const
                ).map((field, i) => (
                  <label key={field}>
                    {sectionLabels[section][i]}

                    {field === 'description' ? (
                      <textarea
                        value={entry[field]}
                        onChange={e =>
                          updateEntry(
                            section,
                            entry.id,
                            field,
                            e.target.value
                          )
                        }
                        placeholder={sectionLabels[section][i]}
                      />
                    ) : (
                      <input
                        value={entry[field]}
                        onChange={e =>
                          updateEntry(
                            section,
                            entry.id,
                            field,
                            e.target.value
                          )
                        }
                        placeholder={sectionLabels[section][i]}
                      />
                    )}
                  </label>
                ))}
              </div>
            </div>
          ))}

          <button
            type="button"
            className="add-button"
            onClick={() => addEntry(section)}
          >
            + {sectionTitles[section]} 추가
          </button>
        </section>
      ))}

      <button
        type="button"
        className="save-button"
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? '저장 중...' : '프로필 저장하기'}
      </button>

        {/* 저장 완료 팝업 */}
      {showSaveModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowSaveModal(false)}
        >
          <div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-modal-title"
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-icon">✓</div>

            <h2 id="save-modal-title">저장 완료!</h2>

            <p>프로필이 성공적으로 저장되었습니다.</p>

            <button
              type="button"
              className="modal-confirm-button"
              onClick={() => setShowSaveModal(false)}
            >
              확인
            </button>
          </div>
        </div>
      )}

    </div>
  )
}

export default Profile
