import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'

import './Apply.css'

// Written by scripts/build-extension-zip.mjs → public/downloads/extension.json
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
  folder: 'jobseeker-apply',
  bytes: 0,
  sha256: '',
  minimumChromeVersion: '116',
}

const EXTENSIONS_URL = 'chrome://extensions'

function formatSize(bytes: number) {
  if (!bytes) return ''
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <button
      type="button"
      className="apply-copy"
      onClick={async () => setCopied(await copyText(text))}
      aria-label={`${label}: ${text}`}
    >
      {copied ? 'Copied ✓' : label}
    </button>
  )
}

/* Screenshots live in public/guide/. A missing file is simply not shown,
   so a step can list its image before the capture is added. */
function GuideImage({ src, alt, narrow, caption }: { src: string; alt: string; narrow?: boolean; caption?: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <figure className={`apply-shot${narrow ? ' apply-shot-narrow' : ''}`}>
      <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="apply-step">
      <span className="apply-step-num" aria-hidden="true">{n}</span>
      <div className="apply-step-body">
        <h4>{title}</h4>
        {children}
      </div>
    </li>
  )
}

/* ---------- AI options ---------- */

type AiOption = {
  id: string
  name: string
  fit: string // the situation chip
  provider: string // what to pick in the extension's Provider menu
  url?: string
  model?: string
  modelNote?: string
  key: string
  dataLeaves: string
  cost: string
  bestFor: string
  notes: ReactNode[]
}

const AI_OPTIONS: AiOption[] = [
  {
    id: 'off',
    name: 'Rules only (AI off)',
    fit: 'I just want it to work, no setup',
    provider: 'Leave "Use AI" unchecked',
    key: 'Not needed',
    dataLeaves: 'No',
    cost: 'Free',
    bestFor: 'Most forms on the supported job sites. This is the default.',
    notes: [
      'Fields the rules cannot decide stay in the review list as suggestions for you to fill in.',
    ],
  },
  {
    id: 'claude',
    name: 'Claude',
    fit: 'Best guesses on tricky, unusual forms',
    provider: 'Claude (Anthropic API)',
    url: 'https://api.anthropic.com/v1',
    model: 'claude-haiku-5-5',
    key: 'Anthropic API key',
    dataLeaves: 'Yes, to Anthropic',
    cost: 'Paid per use',
    bestFor: 'Forms with unfamiliar field names or format rules the rules miss.',
    notes: [
      'The URL and model are filled in for you when you pick this provider.',
      <>
        Other models:{' '}
        <a href="https://docs.claude.com/en/docs/about-claude/models/overview" target="_blank" rel="noreferrer">
          Claude model list
        </a>
      </>,
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    fit: 'I already have an OpenAI API account',
    provider: 'OpenAI-compatible',
    url: 'https://api.openai.com/v1',
    modelNote: 'A model name from your OpenAI account',
    key: 'OpenAI API key',
    dataLeaves: 'Yes, to OpenAI',
    cost: 'Paid per use',
    bestFor: 'People who already use the OpenAI API.',
    notes: [
      <>
        A small, fast model is enough. See the{' '}
        <a href="https://platform.openai.com/docs/models" target="_blank" rel="noreferrer">
          OpenAI model list
        </a>
        .
      </>,
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini',
    fit: 'I want to use my Google account',
    provider: 'OpenAI-compatible',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelNote: 'A Gemini "Flash" model name',
    key: 'Gemini API key (Google AI Studio)',
    dataLeaves: 'Yes, to Google',
    cost: 'Check Google AI Studio for current limits',
    bestFor: 'People who already have a Google AI Studio key.',
    notes: [
      <>
        Get a key in{' '}
        <a href="https://aistudio.google.com" target="_blank" rel="noreferrer">
          Google AI Studio
        </a>{' '}
        and pick a model from the{' '}
        <a href="https://ai.google.dev/gemini-api/docs/models" target="_blank" rel="noreferrer">
          Gemini model list
        </a>
        .
      </>,
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    fit: 'Keep my data on my own computer',
    provider: 'OpenAI-compatible',
    url: 'http://127.0.0.1:11434/v1',
    model: 'qwen3:4b',
    key: 'Leave empty',
    dataLeaves: 'No, runs on your PC',
    cost: 'Free',
    bestFor: 'Privacy first. Needs Ollama installed and is slower on most laptops.',
    notes: [
      <>
        Install{' '}
        <a href="https://ollama.com" target="_blank" rel="noreferrer">
          Ollama
        </a>{' '}
        and download the model first (for example <code>ollama pull qwen3:4b</code>).
      </>,
      <>
        If <strong>Test connection</strong> shows 403, restart Ollama with{' '}
        <code>OLLAMA_ORIGINS=chrome-extension://*</code>.
      </>,
    ],
  },
]

function AiGuide() {
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState('off')
  const selected = AI_OPTIONS.find(option => option.id === selectedId) ?? AI_OPTIONS[0]

  return (
    <section className="apply-card apply-ai">
      <div className="apply-ai-head">
        <div>
          <h3>AI assist <span className="apply-tag">Optional</span></h3>
          <p>
            AI is only asked about fields the rules can't decide. Without it the
            extension still works with rules only.
          </p>
        </div>
        <button
          type="button"
          className={`apply-switch${open ? ' on' : ''}`}
          role="switch"
          aria-checked={open}
          aria-controls="apply-ai-panel"
          onClick={() => setOpen(value => !value)}
        >
          <span className="apply-switch-track" aria-hidden="true">
            <span className="apply-switch-thumb" />
          </span>
          {open ? 'Hide AI setup' : 'Show AI setup'}
        </button>
      </div>

      {open && (
        <div id="apply-ai-panel" className="apply-ai-panel">
          <h4>Which one fits you?</h4>
          <div className="apply-chips" role="radiogroup" aria-label="Choose your situation">
            {AI_OPTIONS.map(option => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={option.id === selectedId}
                className={`apply-chip${option.id === selectedId ? ' active' : ''}`}
                onClick={() => setSelectedId(option.id)}
              >
                {option.fit}
              </button>
            ))}
          </div>

          <div className="apply-ai-detail" aria-live="polite">
            <div className="apply-ai-detail-head">
              <strong>{selected.name}</strong>
              <span>{selected.bestFor}</span>
            </div>

            {selected.id === 'off' ? (
              <p className="apply-muted">
                Nothing to set up. In the side panel's <strong>Apply</strong> tab, keep{' '}
                <strong>AI (optional)</strong> closed and <strong>Use AI</strong> unchecked.
              </p>
            ) : (
              <>
                <p className="apply-muted">
                  In the side panel's <strong>Apply</strong> tab, open{' '}
                  <strong>AI (optional)</strong>, check <strong>Use AI</strong>, and enter:
                </p>
                <dl className="apply-settings">
                  <dt>Provider</dt>
                  <dd>{selected.provider}</dd>
                  <dt>API URL</dt>
                  <dd>
                    <code>{selected.url}</code>
                    {selected.url && <CopyButton text={selected.url} />}
                  </dd>
                  <dt>Model</dt>
                  <dd>
                    {selected.model ? (
                      <>
                        <code>{selected.model}</code>
                        <CopyButton text={selected.model} />
                      </>
                    ) : (
                      selected.modelNote
                    )}
                  </dd>
                  <dt>API key</dt>
                  <dd>{selected.key}</dd>
                </dl>
                <p className="apply-muted">
                  Then press <strong>Save</strong> (Chrome asks to allow the API address) and{' '}
                  <strong>Test connection</strong>.
                </p>
              </>
            )}

            <ul className="apply-list">
              {selected.notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </div>

          <div className="apply-table-wrap">
            <table className="apply-table">
              <caption>Compare the options</caption>
              <thead>
                <tr>
                  <th scope="col">Option</th>
                  <th scope="col">Provider in the extension</th>
                  <th scope="col">API key</th>
                  <th scope="col">Data leaves your PC</th>
                  <th scope="col">Cost</th>
                </tr>
              </thead>
              <tbody>
                {AI_OPTIONS.map(option => (
                  <tr
                    key={option.id}
                    className={option.id === selectedId ? 'active' : ''}
                    onClick={() => setSelectedId(option.id)}
                  >
                    <th scope="row">
                      <button type="button" onClick={() => setSelectedId(option.id)}>
                        {option.name}
                      </button>
                    </th>
                    <td>{option.id === 'off' ? '—' : option.provider}</td>
                    <td>{option.key}</td>
                    <td>{option.dataLeaves}</td>
                    <td>{option.cost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <GuideImage
            src="/guide/panel-ai.png"
            alt="AI (optional) settings in the side panel"
            caption="Where to enter these settings in the side panel (shown with the Claude defaults)."
            narrow
          />

          <p className="apply-muted apply-small">
            What is sent: the name, hint text and choices of the fields the rules couldn't
            decide, plus your archive values (saved answers are not sent). API keys are stored
            only in this browser and web pages can't read them.
          </p>
        </div>
      )}
    </section>
  )
}

/* ---------- Page ---------- */

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
      <section className="apply-card apply-hero">
        <div>
          <h2>Apply</h2>
          <p>
            Fill job application forms from your JobSeeker profile with one click. You
            review the result and submit it yourself.
          </p>
        </div>
        <div className="apply-download">
          <a className="apply-download-button" href={info.file} download>
            Download extension
          </a>
          <span className="apply-meta">
            v{info.version}
            {size && ` · ${size}`} · .zip
            {info.minimumChromeVersion && ` · Chrome ${info.minimumChromeVersion}+`}
          </span>
        </div>
      </section>

      <h3 className="apply-guide-title">User Guide</h3>

      <section className="apply-card">
        <p className="apply-group">Install (one time)</p>
        <ol className="apply-steps">
          <Step n={1} title="Download and unzip">
            <p>
              Click <strong>Download extension</strong> above. Right-click{' '}
              <code>jobseeker-apply.zip</code> and choose <strong>Extract All</strong>{' '}
              (<strong>압축 풀기</strong>). You get a <code>{info.folder}</code> folder with{' '}
              <code>manifest.json</code> inside.
            </p>
            <p className="apply-muted">
              Chrome can't install the .zip directly. Keep the folder somewhere permanent
              (for example, Documents). If you delete it, the extension stops working.
            </p>
            <GuideImage src="/guide/step-1-unzip.png" alt="The unzipped jobseeker-apply folder" />
          </Step>

          <Step n={2} title="Open the Extensions page">
            <div className="apply-url">
              <code>{EXTENSIONS_URL}</code>
              <CopyButton text={EXTENSIONS_URL} label="Copy address" />
            </div>
            <p className="apply-muted">
              Paste it into Chrome's address bar and press Enter. For security, Chrome
              doesn't let websites open this page with a link, so it has to be pasted.
              You can also use the menu: <strong>⋮ → Extensions → Manage Extensions</strong>{' '}
              (<strong>확장 프로그램 → 확장 프로그램 관리</strong>).
            </p>
          </Step>

          <Step n={3} title="Turn on Developer mode">
            <p>
              Switch on <strong>Developer mode</strong> (<strong>개발자 모드</strong>) in the
              top-right corner.
            </p>
            <GuideImage src="/guide/step-3-developer-mode.png" alt="Developer mode switch on the Extensions page" />
          </Step>

          <Step n={4} title="Load the folder">
            <p>
              Click <strong>Load unpacked</strong> (<strong>압축해제된 확장 프로그램 로드</strong>),
              select the <code>{info.folder}</code> folder and click{' '}
              <strong>Select Folder</strong> (<strong>폴더 선택</strong>).
            </p>
            <p className="apply-muted">
              Pick the folder that contains <code>manifest.json</code>. If you get a "Manifest
              file is missing" error, you picked the folder above it — open the folder one level
              deeper and try again.
            </p>
            <GuideImage src="/guide/step-4-load-unpacked.png" alt="Load unpacked button and folder picker" />
          </Step>

          <Step n={5} title="Pin it to the toolbar">
            <p>
              <strong>JobSeeker Apply {info.version}</strong> now appears in the list. Click
              the puzzle icon next to the address bar and click the pin next to{' '}
              <strong>JobSeeker Apply</strong>.
            </p>
            <GuideImage src="/guide/step-5-pin.png" alt="Pinning JobSeeker Apply from the puzzle menu" />
          </Step>
        </ol>
      </section>

      <section className="apply-card">
        <p className="apply-group">Use</p>
        <ol className="apply-steps" start={6}>
          <Step n={6} title="Bring in your profile">
            <p>
              On the <Link to="/profile">Profile</Link> page, fill in your details and click{' '}
              <strong>JSON 내보내기</strong> (export) to get{' '}
              <code>jobseeker-archive.json</code>.
            </p>
            <p>
              Click the JobSeeker icon to open the side panel. In <strong>My archive</strong>,
              open <strong>Data → Import JSON</strong>, choose the file, then click{' '}
              <strong>Save archive</strong>.
            </p>
            <p className="apply-muted">
              Your profile is saved only in this browser. It is not sent to our server.
            </p>
            <GuideImage src="/guide/panel-import.png" alt="Import JSON in the side panel" narrow />
          </Step>

          <Step n={7} title="Fill an application">
            <p>
              Open an application form on a job site and refresh the page. In the side
              panel's <strong>Apply</strong> tab, click <strong>Fill this step</strong>.
            </p>
            <ul className="apply-list">
              <li>Sure matches are filled in right away.</li>
              <li>
                Unsure ones stay in the review list. Check them and click{' '}
                <strong>Apply suggestion</strong>, or type them yourself.
              </li>
              <li>
                After moving to the next page of the form, click <strong>Fill this step</strong>{' '}
                again.
              </li>
            </ul>
            <p className="apply-note">
              Works out of the box on Incruit, Saramin and JobKorea. On other sites, click{' '}
              <strong>Allow this site</strong> first. The extension never clicks Next, Save
              or Submit.
            </p>
            <GuideImage src="/guide/panel-fill.png" alt="Apply tab in the side panel" narrow />
          </Step>
        </ol>
      </section>

      <AiGuide />

      <section className="apply-card">
        <h3>Troubleshooting</h3>
        <details className="apply-faq">
          <summary>How do I update to a new version?</summary>
          <p>
            Back up your profile with <strong>Export JSON</strong> in the side panel. Download
            and unzip the new version, remove the old JobSeeker on{' '}
            <code>{EXTENSIONS_URL}</code>, load the new folder and import the JSON again. If
            you unzipped over the same folder, just click the reload (↻) button on its card.
          </p>
        </details>
        <details className="apply-faq">
          <summary>Nothing happens when I click a button</summary>
          <p>
            Tabs opened before installing need a refresh. If it still doesn't work, click{' '}
            <strong>Connect page</strong>.
          </p>
        </details>
        <details className="apply-faq">
          <summary>Chrome shows "Disable developer mode extensions"</summary>
          <p>
            Chrome shows this for every extension loaded in developer mode. Close it and keep
            using the extension.
          </p>
        </details>
        <details className="apply-faq">
          <summary>Some fields are not filled</summary>
          <p>
            Closed Shadow DOM, canvas inputs and other-domain frames without permission are
            not supported. On a site you haven't used before, always check the Results list
            before submitting.
          </p>
        </details>
        {info.sha256 && (
          <p className="apply-checksum">
            SHA-256 of the download: <code>{info.sha256}</code>
          </p>
        )}
      </section>
    </div>
  )
}

export default Apply
