import { useEffect, useId, useState } from "react";
import { Link, useLocation } from "react-router";
import { api } from "../api";
import type { PracticeSettings } from "../types";

const SETTINGS_PATH = "/practice/settings";

/** Recording consent asked once, right before the first recording. Three lines; the rest is on Settings.
 *  The keep-audio box starts from the current setting (initialKeepAudio) and is sent only when the user changes it,
 *  so agreeing again never resets the setting.
 *  transcription=false (the server can't transcribe, or that isn't confirmed yet): neutral lines that hold either way,
 *  so the card never promises a transcript it can't give. */
export default function ConsentPanel({
  retentionDays = 30,
  initialKeepAudio = false,
  notice,
  buttonLabel = "Agree & Start",
  transcription = true,
  onConsented,
}: {
  retentionDays?: number;
  initialKeepAudio?: boolean;
  notice?: string | null;
  buttonLabel?: string;
  transcription?: boolean;
  onConsented: (s: PracticeSettings) => void;
}) {
  const [keepAudio, setKeepAudio] = useState(initialKeepAudio);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Settings already shows the details, so the card doesn't link to the page it is on
  const onSettings = useLocation().pathname === SETTINGS_PATH;
  const newTabNote = useId();

  useEffect(() => {
    if (!touched) setKeepAudio(initialKeepAudio);
  }, [initialKeepAudio, touched]);

  const agree = async () => {
    setBusy(true);
    setErr(null);
    try {
      onConsented(await api.updateSettings(touched ? { consent: true, keep_audio: keepAudio } : { consent: true }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Before You Record</h2>
      {notice && <p className="warn-text">{notice}</p>}
      <ul className="bullets">
        <li>Your voice is recorded while you answer.</li>
        {transcription ? <>
          <li>It's transcribed on our server, not by other services.</li>
          <li>The audio is deleted after transcription unless you keep it.</li>
        </> : <>
          <li>It's saved on our server, not sent to other services.</li>
          <li>The audio is deleted within {retentionDays} days.</li>
        </>}
      </ul>
      <label className="check-label">
        <input
          type="checkbox"
          checked={keepAudio}
          onChange={(e) => {
            setKeepAudio(e.target.checked);
            setTouched(true);
          }}
        />
        Keep original audio for {retentionDays} days
      </label>
      <div className="spacer" />
      <div className="row">
        <button className="primary" disabled={busy} onClick={agree}>{buttonLabel}</button>
        {/* New tab: leaving the interview here would drop a recording that is still waiting to be saved */}
        {!onSettings && <>
          <Link to={SETTINGS_PATH} target="_blank" rel="noopener" aria-describedby={newTabNote}>Details</Link>
          <span id={newTabNote} hidden>Opens in a new tab</span>
        </>}
      </div>
      {err && <p className="err">{err}</p>}
    </section>
  );
}
