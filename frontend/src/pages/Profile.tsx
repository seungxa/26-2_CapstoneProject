import { useState } from 'react'

type Entry = {
  id: number
  title: string
  organization: string
  date: string
  description: string
}

type SectionKey = 'certificates' | 'languages' | 'activities' | 'awards'

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

function Profile() {
  const [basic, setBasic] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
  })

  const [education, setEducation] = useState({
    school: '',
    major: '',
    secondMajor: '',
    gpa: '',
    period: '',
  })

  const [sections, setSections] = useState<Record<SectionKey, Entry[]>>({
    certificates: [createEntry()],
    languages: [createEntry()],
    activities: [createEntry()],
    awards: [createEntry()],
  })

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

  return (
    <div className="profile-page">
      <h1>My Profile</h1>
      <p className="profile-description">
        채용 지원에 필요한 정보를 등록해 주세요.
        모든 항목을 작성할 필요는 없습니다.
      </p>

      <section className="profile-section">
        <h2>👤 기본정보</h2>
        <div className="profile-grid">
          <label>
            이름
            <input
              value={basic.name}
              onChange={e => setBasic({ ...basic, name: e.target.value })}
              placeholder="이름"
            />
          </label>
          <label>
            이메일
            <input
              type="email"
              value={basic.email}
              onChange={e => setBasic({ ...basic, email: e.target.value })}
              placeholder="example@email.com"
            />
          </label>
          <label>
            전화번호
            <input
              value={basic.phone}
              onChange={e => setBasic({ ...basic, phone: e.target.value })}
              placeholder="010-0000-0000"
            />
          </label>
          <label>
            주소
            <input
              value={basic.address}
              onChange={e => setBasic({ ...basic, address: e.target.value })}
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
                  setEducation({ ...education, [key]: e.target.value })
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
                <strong>{sectionTitles[section]} {index + 1}</strong>
                <button
                  type="button"
                  className="delete-button"
                  onClick={() => removeEntry(section, entry.id)}
                >
                  삭제
                </button>
              </div>

              <div className="profile-grid">
                {(['title', 'organization', 'date', 'description'] as const)
                  .map((field, i) => (
                    <label key={field}>
                      {sectionLabels[section][i]}
                      {field === 'description' ? (
                        <textarea
                          value={entry[field]}
                          onChange={e =>
                            updateEntry(section, entry.id, field, e.target.value)
                          }
                          placeholder={sectionLabels[section][i]}
                        />
                      ) : (
                        <input
                          value={entry[field]}
                          onChange={e =>
                            updateEntry(section, entry.id, field, e.target.value)
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
        onClick={() => alert('다음 단계에서 저장 기능을 연결할 예정입니다.')}
      >
        프로필 저장하기
      </button>
    </div>
  )
}

export default Profile