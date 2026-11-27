import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import './Apply.css'

// scripts/build-extension-zip.mjs 가 만든 public/downloads/extension.json
type ExtensionInfo = {
  name: string
  version: string
  file: string
  folder: string
  bytes: number
  sha256: string
  minimumChromeVersion: string | null
}

const FALLBACK: ExtensionInfo = {
  name: 'JobSeeker Apply',
  version: '0.7.0',
  file: '/downloads/jobseeker-apply.zip',
  folder: 'jobseeker-apply-0.7.0',
  bytes: 0,
  sha256: '',
  minimumChromeVersion: '116',
}

function formatSize(bytes: number) {
  if (!bytes) return ''
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)}KB`
    : `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

function Apply() {
  const [info, setInfo] = useState<ExtensionInfo>(FALLBACK)

  useEffect(() => {
    let active = true
    fetch('/downloads/extension.json', { cache: 'no-cache' })
      .then(res => (res.ok ? res.json() : null))
      .then((data: ExtensionInfo | null) => {
        if (active && data?.file) setInfo(data)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  const size = formatSize(info.bytes)

  return (
    <div className="apply-page">
      <section className="apply-hero">
        <div>
          <h2>Apply</h2>
          <p>
            크롬 확장 프로그램 <strong>{info.name}</strong>이 저장해 둔 내 프로필로
            채용 사이트 지원서를 자동으로 채워 줍니다. 다음·저장·제출 버튼은 누르지
            않으니, 결과를 확인한 뒤 직접 제출하세요.
          </p>
        </div>

        <div className="apply-download">
          <a className="apply-download-button" href={info.file} download>
            확장 프로그램 다운로드
          </a>
          <span className="apply-meta">
            v{info.version}
            {size && ` · ${size}`} · zip
            {info.minimumChromeVersion && ` · Chrome ${info.minimumChromeVersion} 이상`}
          </span>
        </div>
      </section>

      <section className="apply-section">
        <h3>1. 설치하기</h3>
        <p className="apply-note">
          크롬 웹스토어가 아닌 파일로 배포하기 때문에 <strong>개발자 모드</strong>로
          설치합니다. 처음 한 번만 하면 됩니다.
        </p>
        <ol className="apply-steps">
          <li>
            위 버튼으로 <code>jobseeker-apply.zip</code>을 받고 <strong>압축을 풉니다</strong>.
            <span className="apply-hint">
              크롬은 zip 파일을 바로 설치하지 못합니다. 압축을 풀면{' '}
              <code>{info.folder}</code> 폴더가 생깁니다. 이 폴더는 지우지 말고 둘 곳에
              옮겨 두세요(예: 문서 폴더). 폴더를 지우면 확장도 동작하지 않습니다.
            </span>
          </li>
          <li>
            크롬 주소창에 <code>chrome://extensions</code>를 입력해 확장 프로그램
            페이지를 엽니다.
          </li>
          <li>
            오른쪽 위 <strong>개발자 모드</strong> 스위치를 켭니다.
          </li>
          <li>
            왼쪽 위 <strong>압축해제된 확장 프로그램을 로드합니다</strong>를 누르고{' '}
            <code>{info.folder}</code> 폴더를 선택합니다.
            <span className="apply-hint">
              <code>manifest.json</code>이 들어 있는 폴더를 골라야 합니다. 한 단계 위나 아래
              폴더를 고르면 "매니페스트 파일이 없습니다" 오류가 납니다.
            </span>
          </li>
          <li>
            목록에 <strong>JobSeeker Apply {info.version}</strong>이 보이면 설치 완료입니다.
            주소창 옆 퍼즐 아이콘에서 핀을 눌러 툴바에 고정해 두면 편합니다.
          </li>
        </ol>
      </section>

      <section className="apply-section">
        <h3>2. 내 프로필 불러오기</h3>
        <ol className="apply-steps">
          <li>
            <Link to="/profile">Profile</Link> 페이지에서 정보를 입력하고{' '}
            <strong>JSON 내보내기</strong>로 <code>jobseeker-archive.json</code>을 받습니다.
          </li>
          <li>
            툴바의 JobSeeker 아이콘을 눌러 사이드 패널을 엽니다.
          </li>
          <li>
            <strong>My archive</strong> 탭 → <strong>Data</strong> →{' '}
            <strong>Import JSON</strong>에서 받은 파일을 고르고{' '}
            <strong>Save archive</strong>를 누릅니다.
            <span className="apply-hint">
              프로필은 이 브라우저(chrome.storage)에만 저장되고 서버로 보내지 않습니다.
            </span>
          </li>
        </ol>
      </section>

      <section className="apply-section">
        <h3>3. 지원서 채우기</h3>
        <ol className="apply-steps">
          <li>채용 사이트의 지원서 페이지를 열고 새로고침합니다.</li>
          <li>
            사이드 패널의 <strong>Apply</strong> 탭에서 <strong>Fill this step</strong>을
            누릅니다.
          </li>
          <li>
            확실한 항목은 바로 채워지고, 애매한 항목은 검토 목록에 제안값으로 남습니다.
            확인 후 <strong>Apply suggestion</strong>으로 넣거나 직접 고칩니다.
          </li>
          <li>
            <strong>Results</strong>에서 채운 항목을 확인한 뒤, 다음 단계로 넘어가면
            다시 <strong>Fill this step</strong>을 누릅니다.
          </li>
        </ol>
        <p className="apply-note">
          기본 지원 사이트: 인크루트, 사람인, 잡코리아. 다른 사이트에서는{' '}
          <strong>Allow this site</strong>를 눌러 권한을 허용한 뒤 다시 실행하세요.
        </p>
      </section>

      <section className="apply-section">
        <h3>4. AI 판단 (선택)</h3>
        <p>
          규칙으로 정하지 못한 항목만 AI에 물어보는 기능입니다. 꺼 두어도 규칙만으로
          동작합니다. 사이드 패널 Apply 탭의 <strong>AI (optional)</strong>을 펼쳐
          서비스와 API 키를 넣고 <strong>Save</strong> → <strong>Test connection</strong>
          을 누르세요.
        </p>
        <ul className="apply-list">
          <li>Claude · OpenAI · Gemini(OpenAI 호환) · Ollama(로컬, 키 없음)를 쓸 수 있습니다.</li>
          <li>API 키는 이 브라우저에만 저장되며 웹 페이지 스크립트는 읽을 수 없습니다.</li>
          <li>
            AI에는 규칙으로 못 정한 항목의 이름·안내문·선택지와 프로필 값이 전송됩니다.
          </li>
        </ul>
      </section>

      <section className="apply-section">
        <h3>업데이트 · 문제 해결</h3>
        <dl className="apply-faq">
          <dt>새 버전으로 바꾸려면?</dt>
          <dd>
            먼저 사이드 패널에서 <strong>Export JSON</strong>으로 프로필을 백업합니다.
            새 zip을 받아 압축을 풀고, <code>chrome://extensions</code>에서 기존
            JobSeeker를 삭제한 뒤 새 폴더를 다시 로드하고 JSON을 가져옵니다. 같은 폴더에
            덮어썼다면 카드의 새로고침(↻) 버튼만 눌러도 됩니다.
          </dd>
          <dt>버튼을 눌러도 아무 일이 없어요</dt>
          <dd>
            확장을 설치하기 전에 열어 둔 탭은 새로고침해야 합니다. 그래도 안 되면{' '}
            <strong>Connect page</strong>를 누르세요.
          </dd>
          <dt>"Disable developer mode extensions" 경고가 떠요</dt>
          <dd>
            개발자 모드로 설치한 확장에 크롬이 띄우는 안내입니다. 닫기를 누르면 계속
            쓸 수 있습니다.
          </dd>
          <dt>일부 항목이 채워지지 않아요</dt>
          <dd>
            닫힌 Shadow DOM, canvas 입력, 권한 없는 다른 도메인 iframe은 처리하지
            않습니다. 처음 쓰는 사이트는 결과 목록을 꼭 확인하고 제출하세요.
          </dd>
        </dl>
        {info.sha256 && (
          <p className="apply-checksum">
            SHA-256: <code>{info.sha256}</code>
          </p>
        )}
      </section>
    </div>
  )
}

export default Apply
