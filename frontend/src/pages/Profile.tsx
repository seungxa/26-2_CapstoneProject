
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  blankRecord,
  collegeAffiliations,
  emptyArchive,
  fieldGroups,
  groupInfo,
  highSchoolAffiliations,
  normalizeArchive,
  opicGrades,
  type Archive,
  type Field,
  type GroupKey,
  type RecordData,
} from '../lib/archiveFields'

type Entry = {
  id: number
  values: RecordData
}

type EntryGroups = Record<GroupKey, Entry[]>

let nextEntryId = 0

function makeEntry(values: RecordData): Entry {
  return {
    id: ++nextEntryId,
    values: { ...values },
  }
}

function toEntries(archive: Archive): EntryGroups {
  return {
    education: archive.education.map(makeEntry),
    experience: archive.experience.map(makeEntry),
    military: archive.military.map(makeEntry),
    language: archive.language.map(makeEntry),
    license: archive.license.map(makeEntry),
    activity: archive.activity.map(makeEntry),
    award: archive.award.map(makeEntry),
  }
}

function hasContent(values: RecordData) {
  return Object.values(values).some(
    value => value.trim().length > 0
  )
}

function ProfileField({
  field,
  value,
  onChange,
  optionsOverride,
}: {
  field: Field
  value: string
  onChange: (value: string) => void
  optionsOverride?: string[]
}) {
  const choices = optionsOverride ?? field.options

  return (
    <label className="archive-field">
      <span>{field.label}</span>

      {choices ? (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
        >
          <option value="">선택하세요</option>
          {value && !choices.includes(value) && (
            <option value={value}>{value}</option>
          )}
          {choices.map(choice => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea
          value={value}
          maxLength={20000}
          placeholder={field.placeholder ?? field.label}
          onChange={e => onChange(e.target.value)}
          rows={4}
        />
      ) : (
        <input
          type={field.type ?? 'text'}
          value={value}
          maxLength={20000}
          placeholder={field.placeholder ?? field.label}
          step={field.type === 'number' ? 'any' : undefined}
          onChange={e => onChange(e.target.value)}
        />
      )}
    </label>
  )
}

export default function Profile() {
  const [profile, setProfile] = useState<RecordData>(
    () => blankRecord('profile')
  )

  const [entries, setEntries] = useState<EntryGroups>(
    () => toEntries(emptyArchive())
  )

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    let active = true

    async function loadProfile() {
      try {
        const { data: auth, error: authError } =
          await supabase.auth.getUser()

        if (authError) throw authError
        if (!auth.user) {
          throw new Error('로그인이 필요합니다.')
        }

        const { data, error: dbError } = await supabase
          .from('profiles')
          .select('archive')
          .eq('user_id', auth.user.id)
          .maybeSingle()

        if (dbError) throw dbError
        if (!active) return

        const archive = normalizeArchive(data?.archive)

        if (!archive.profile.email) {
          archive.profile.email = auth.user.email ?? ''
        }

        setProfile(archive.profile)
        setEntries(toEntries(archive))
        setDirty(false)
      } catch (err) {
        if (active) {
          setLoadError(
            err instanceof Error
              ? err.message
              : '프로필을 불러오지 못했습니다.'
          )
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadProfile()

    return () => {
      active = false
    }
  }, [])

  function updateProfile(key: string, value: string) {
    setProfile(previous => ({
      ...previous,
      [key]: value,
    }))
    setDirty(true)
  }

  function updateEntry(
    group: GroupKey,
    id: number,
    key: string,
    value: string
  ) {
    setEntries(previous => ({
      ...previous,
      [group]: previous[group].map(entry => {
        if (entry.id !== id) return entry

        const values = { ...entry.values, [key]: value }

        // 학교 구분을 바꾸면 기존 계열 선택을 초기화합니다.
        if (group === 'education' && key === 'tier') {
          values.affiliation = ''
        }

        // 시험을 바꾸면 기존 OPIc 등급을 초기화합니다.
        if (group === 'language' && key === 'exam') {
          values.grade = ''
        }

        return { ...entry, values }
      }),
    }))
    setDirty(true)
  }

  function addEntry(group: GroupKey) {
    if (entries[group].length >= 100) {
      setError('각 항목은 최대 100건까지 추가할 수 있습니다.')
      return
    }

    setEntries(previous => ({
      ...previous,
      [group]: [
        ...previous[group],
        makeEntry(blankRecord(group)),
      ],
    }))
    setDirty(true)
    setError('')
  }

  function removeEntry(group: GroupKey, id: number) {
    setEntries(previous => ({
      ...previous,
      [group]: previous[group].filter(
        entry => entry.id !== id
      ),
    }))
    setDirty(true)
  }

  function buildArchive(): Archive {
    const getItems = (group: GroupKey) =>
      entries[group]
        .map(entry => ({ ...entry.values }))
        .filter(hasContent)

    return {
      schemaVersion: '1',
      profile: { ...profile },
      education: getItems('education'),
      experience: getItems('experience'),
      military: getItems('military'),
      language: getItems('language'),
      license: getItems('license'),
      activity: getItems('activity'),
      award: getItems('award'),
    }
  }

  function validateArchive(archive: Archive): string | null {
    const tiers = new Set<string>()

    for (const school of archive.education) {
      if (!school.tier) {
        return '학력 정보를 작성했다면 학교 구분을 선택해 주세요.'
      }

      if (tiers.has(school.tier)) {
        return (
          `학교 구분 "${school.tier}"이 중복되었습니다. ` +
          '확장 프로그램에서 해당 학력의 자동입력이 누락될 수 있습니다.'
        )
      }

      tiers.add(school.tier)
    }

    const allRecords: RecordData[] = [archive.profile]

    for (const group of groupInfo) {
      if (archive[group.key].length > 100) {
        return `${group.title}은 최대 100건까지 입력할 수 있습니다.`
      }

      allRecords.push(...archive[group.key])
    }

    for (const record of allRecords) {
      for (const value of Object.values(record)) {
        if (typeof value !== 'string') {
          return '모든 입력값은 문자열이어야 합니다.'
        }

        if (value.length > 20000) {
          return '입력값 하나는 최대 20,000자까지 허용됩니다.'
        }
      }
    }

    const email = archive.profile.email.trim()

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return '이메일 형식을 확인해 주세요.'
    }

    const postcode = archive.profile.postcode.trim()

    if (postcode && !/^\d{5}$/.test(postcode)) {
      return '우편번호는 숫자 5자리로 입력해 주세요.'
    }

    const json = JSON.stringify(archive, null, 2)
    const bytes = new TextEncoder().encode(json).length

    if (bytes > 2 * 1024 * 1024) {
      return 'JSON 파일은 2MB 이하만 내보낼 수 있습니다.'
    }

    return null
  }

  async function handleSave() {
    setError('')

    const archive = buildArchive()
    const validationError = validateArchive(archive)

    if (validationError) {
      setError(validationError)
      return
    }

    setSaving(true)

    try {
      const { data: auth, error: authError } =
        await supabase.auth.getUser()

      if (authError) throw authError
      if (!auth.user) {
        throw new Error('로그인이 필요합니다.')
      }

      const { error: saveError } = await supabase
        .from('profiles')
        .upsert(
          {
            user_id: auth.user.id,
            archive,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        )

      if (saveError) throw saveError

      setDirty(false)
      setShowSaveModal(true)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : '프로필 저장에 실패했습니다.'
      )
    } finally {
      setSaving(false)
    }
  }

  function handleExport() {
    setError('')

    const archive = buildArchive()
    const validationError = validateArchive(archive)

    if (validationError) {
      setError(validationError)
      return
    }

    if (
      dirty &&
      !window.confirm(
        '아직 Supabase에 저장하지 않은 변경 사항이 있습니다. ' +
        '현재 입력한 내용으로 JSON을 다운로드하시겠습니까?'
      )
    ) {
      return
    }

    const json = JSON.stringify(archive, null, 2)
    const blob = new Blob([json], {
      type: 'application/json;charset=utf-8',
    })

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = 'jobseeker-archive.json'
    document.body.appendChild(link)
    link.click()
    link.remove()

    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (loading) {
    return (
      <main className="profile-page">
        <h1>My Profile</h1>
        <p>프로필을 불러오는 중입니다...</p>
      </main>
    )
  }

  if (loadError) {
    return (
      <main className="profile-page">
        <h1>My Profile</h1>
        <p role="alert">{loadError}</p>
        <button onClick={() => window.location.reload()}>
          다시 시도
        </button>
      </main>
    )
  }

  return (
    <main className="profile-page">
      <h1>My Profile</h1>

      <p className="archive-description">
        채용 지원에 필요한 정보를 입력해 주세요.
        해당하지 않는 항목은 비워 두셔도 됩니다.
      </p>

      {error && (
        <p className="archive-error" role="alert">
          {error}
        </p>
      )}

      {/* 기본정보 */}
      <section className="profile-section">
        <h2>기본정보</h2>

        <div className="profile-grid">
          {fieldGroups.profile.map(field => (
            <ProfileField
              key={field.key}
              field={field}
              value={profile[field.key] ?? ''}
              onChange={value =>
                updateProfile(field.key, value)
              }
            />
          ))}
        </div>
      </section>

      {/* 이력별 입력 영역 */}
      {groupInfo.map(group => (
        <section
          key={group.key}
          className="profile-section"
        >
          <h2>{group.title}</h2>

          {entries[group.key].length === 0 && (
            <p className="archive-empty">
              등록된 {group.title} 정보가 없습니다.
              아래 버튼으로 추가할 수 있습니다.
            </p>
          )}

          {entries[group.key].map((entry, index) => (
            <div
              className="archive-entry"
              key={entry.id}
            >
              <div className="archive-entry-header">
                <h3>
                  {group.itemName} {index + 1}
                </h3>

                <button
                  type="button"
                  className="delete-button"
                  onClick={() =>
                    removeEntry(group.key, entry.id)
                  }
                >
                  삭제
                </button>
              </div>

              <div className="profile-grid">
                {fieldGroups[group.key].map(field => {
                  let choices: string[] | undefined

                  if (
                    group.key === 'education' &&
                    field.key === 'affiliation'
                  ) {
                    const tier = entry.values.tier

                    if (tier === '고등학교') {
                      choices = highSchoolAffiliations
                    } else if (tier) {
                      choices = collegeAffiliations
                    }
                  }

                  if (
                    group.key === 'language' &&
                    field.key === 'grade' &&
                    entry.values.exam === 'OPIc'
                  ) {
                    choices = opicGrades
                  }

                  return (
                    <ProfileField
                      key={field.key}
                      field={field}
                      value={entry.values[field.key] ?? ''}
                      optionsOverride={choices}
                      onChange={value =>
                        updateEntry(
                          group.key,
                          entry.id,
                          field.key,
                          value
                        )
                      }
                    />
                  )
                })}
              </div>
            </div>
          ))}

          <button
            type="button"
            className="add-button"
            disabled={entries[group.key].length >= 100}
            onClick={() => addEntry(group.key)}
          >
            + {group.itemName} 추가
          </button>
        </section>
      ))}

      {/* 저장 및 내보내기 */}
      <div className="archive-actions">
        <button
          type="button"
          className="archive-save-button"
          disabled={saving}
          onClick={() => void handleSave()}
        >
          {saving ? '저장 중...' : '프로필 저장하기'}
        </button>

        <button
          type="button"
          className="archive-export-button"
          onClick={handleExport}
        >
          JSON 내보내기
        </button>
      </div>

      <p className="archive-privacy">
        JSON 파일에는 이름, 연락처, 주소 등 개인정보가
        포함됩니다. 확장 프로그램으로 가져온 후에는
        다운로드한 파일을 안전하게 삭제해 주세요.
      </p>

      {/* 저장 완료 팝업 */}
      {showSaveModal && (
        <div
          className="archive-modal-overlay"
          onClick={() => setShowSaveModal(false)}
        >
          <div
            className="archive-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-modal-title"
            onClick={e => e.stopPropagation()}
          >
            <div className="archive-modal-icon">✓</div>
            <h2 id="archive-modal-title">저장 완료!</h2>
            <p>프로필이 성공적으로 저장되었습니다.</p>

            <button
              type="button"
              onClick={() => setShowSaveModal(false)}
            >
              확인
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
