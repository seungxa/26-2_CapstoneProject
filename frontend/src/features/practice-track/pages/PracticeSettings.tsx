import { useEffect, useState } from "react";
import { api } from "../api";
import { clearAllVoice } from "../delivery/voice";
import { clearAllVideo } from "../video/metrics";
import ConsentPanel from "../components/ConsentPanel";
import type { DeleteResult, PracticeSettings as Settings } from "../types";

const recordings = (n: number) => `${n} recording${n === 1 ? "" : "s"}`;

/** Result of deleting audio. If storage failed for some files, say how many and that the server retries on its own.
 *  If storage couldn't be listed, the count is unknown, so say so without a number. */
function deleteMessage({ deleted, failed, unchecked }: DeleteResult, none: string) {
  const done = deleted > 0 ? `Deleted ${recordings(deleted)}.` : failed > 0 || unchecked ? "" : none;
  const left = failed > 0 ? `${deleted > 0 ? `${failed} more` : recordings(failed)} couldn't be deleted yet and will be retried automatically.` : "";
  const unknown = unchecked ? "Some recordings may remain. They will be checked and deleted automatically." : "";
  return { text: [done, left, unknown].filter(Boolean).join(" "), warn: failed > 0 || unchecked };
}

const agreedOn = (iso: string) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

/** Recording consent, keeping original audio, and deleting it */
export default function PracticeSettings() {
  const [st, setSt] = useState<Settings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; warn: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // Promise transcription only once /health confirms it (same rule as the interview consent card)
  const [transcribes, setTranscribes] = useState(false);

  useEffect(() => {
    api.settings().then(setSt).catch((e) => setErr(e.message));
    let alive = true;
    api.health().then((h) => { if (alive) setTranscribes(h.stt.available === true); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleKeep = (keep_audio: boolean) => run(async () => setSt(await api.updateSettings({ keep_audio })));

  const deleteAll = () => {
    if (!confirm("Delete all recordings? Transcripts and history stay, but answers without a transcript will be empty. This can't be undone.")) return;
    run(async () => {
      const result = await api.deleteAllRecordings();
      clearAllVoice(); clearAllVideo();
      setMsg(deleteMessage(result, "No recordings to delete."));
    });
  };

  const withdraw = () => {
    if (!confirm("Withdraw consent? All recordings will be deleted, and you can't record until you agree again. Transcripts and history stay, but answers without a transcript will be empty.")) return;
    run(async () => {
      const r = await api.updateSettings({ consent: false });
      setSt(r);
      clearAllVoice(); clearAllVideo();
      const m = deleteMessage(r, "There were no recordings to delete.");
      setMsg({ ...m, text: `Consent withdrawn. ${m.text}` });
    });
  };

  if (err && !st) return <p className="err">{err}</p>;
  if (!st) return <p className="muted">Loading…</p>;
  const days = st.retention_days;

  return (
    <>
      <h1>Settings</h1>
      {msg && <p className={msg.warn ? "warn-text" : "ok-text"}>{msg.text}</p>}
      {err && <p className="err">{err}</p>}

      {/* Before consent the keep-audio choice is in the consent card, so it appears in one place only */}
      {!st.consented_at && (
        <ConsentPanel
          retentionDays={days}
          initialKeepAudio={st.keep_audio}
          transcription={transcribes}
          buttonLabel="Agree"
          onConsented={(s) => {
            setSt(s);
            setMsg({ text: "Consent saved. You can record answers now.", warn: false });
          }}
        />
      )}

      <section className="card">
        <h2>Recordings</h2>
        {st.consented_at && (
          <label className="check-label">
            <input type="checkbox" checked={st.keep_audio} disabled={busy} onChange={(e) => toggleKeep(e.target.checked)} />
            Keep original audio for {days} days
          </label>
        )}
        <div className="spacer" />
        <div className="row">
          <button className="danger" disabled={busy} onClick={deleteAll}>Delete All Recordings</button>
          {st.consented_at && <button className="danger" disabled={busy} onClick={withdraw}>Withdraw Consent</button>}
        </div>
        {st.consented_at && <p className="small muted">You agreed to recording on {agreedOn(st.consented_at)}.</p>}
      </section>

      <section className="card">
        <h2>Privacy</h2>
        <p>{transcribes ? "Your voice is transcribed on our server and isn't sent to other services." : "Your voice is saved on our server and isn't sent to other services."}</p>
        <p>Camera video never leaves your device.</p>
        <details className="fold">
          <summary>Details</summary>
          <ul className="bullets small">
            <li>{transcribes ? `Audio is deleted right after transcription. Kept audio, and audio that couldn't be transcribed, is deleted after ${days} days.` : `Audio is deleted after ${days} days.`}</li>
            <li>Changing the keep setting applies to new recordings. Saved audio keeps its deletion date.</li>
            <li>Transcripts, ratings, and notes stay in your history until you delete that practice.</li>
            <li>Speech and pause timing and camera results are worked out in your browser, never sent, and cleared when you reload.</li>
            <li>Record only your own voice, and use this for practice, not during a real interview.</li>
          </ul>
        </details>
      </section>
    </>
  );
}
