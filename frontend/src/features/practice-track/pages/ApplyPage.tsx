import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { normalizeArchive } from "../../../lib/archiveFields";
import { pingExtension, sendArchive, sendSession } from "../integration/extensionBridge";
import "../styles.css";

type Info = { version: string; size: number; web_origins?: string[] };
/** Sites every build accepts (development); a release build adds the team web address */
const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
type Status = { state: "checking" } | { state: "missing" } | { state: "installed"; version?: string };

const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;

/** Apply: install the JobSeeker extension, connect it to this account, and how to use it */
export default function ApplyPage() {
  const [info, setInfo] = useState<Info | null>(null);
  const [status, setStatus] = useState<Status>({ state: "checking" });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/downloads/extension.json").then((r) => (r.ok ? r.json() : null)).then(setInfo).catch(() => setInfo(null));
  }, []);

  const check = useCallback(async () => {
    setStatus({ state: "checking" });
    const found = await pingExtension();
    setStatus(found.installed ? { state: "installed", version: found.version } : { state: "missing" });
    if (found.installed) {
      const { data } = await supabase.auth.getSession();
      if (data.session) await sendSession(data.session.access_token);
    }
  }, []);
  useEffect(() => { void check(); }, [check]);

  const sendProfile = async () => {
    setSending(true);
    setErr(null);
    setSent(null);
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error("Sign in again to send your profile.");
      const { data, error } = await supabase.from("profiles").select("archive").eq("user_id", auth.user.id).maybeSingle();
      if (error) throw new Error("Your profile could not be read. Try again in a moment.");
      const archive = normalizeArchive(data?.archive);
      if (!archive.profile.email) archive.profile.email = auth.user.email ?? "";
      const result = await sendArchive(archive);
      if (!result.ok) throw new Error(result.error);
      setSent("Profile sent");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const installed = status.state === "installed";
  return (
    <div className="practice-track apply-page" lang="en">
      <h1>Apply</h1>

      <section className="card" aria-labelledby="apply-install">
        <h2 id="apply-install">Install the extension</h2>
        <a className="button primary" href="/downloads/jobseeker-extension.zip" download="">
          Download{info ? ` (v${info.version}, ${kb(info.size)})` : ""}
        </a>
        {info && ![...DEV_ORIGINS, ...(info.web_origins ?? [])].includes(window.location.origin) && (
          <p className="small warn-text" data-testid="download-origin-warning">
            This download can't connect to this site yet: the team needs to rebuild it for {window.location.origin}.
          </p>
        )}
        <ol aria-label="Install steps">
          <li>Unzip the file.</li>
          <li>Open <code>chrome://extensions</code> in Chrome.</li>
          <li>Turn on <strong>Developer mode</strong> (top right).</li>
          <li>Click <strong>Load unpacked</strong> and choose the unzipped folder.</li>
          <li>Pin JobSeeker from the puzzle icon in the toolbar.</li>
        </ol>
      </section>

      <section className="card" aria-labelledby="apply-connect">
        <h2 id="apply-connect">Connect</h2>
        <div className="row">
          <span className={`chip ${installed ? "good" : ""}`} data-testid="extension-status">
            {status.state === "checking" ? "Checking…" : installed ? `Installed${status.version ? ` v${status.version}` : ""}` : "Not installed"}
          </span>
          <button onClick={() => void check()}>Check again</button>
        </div>
        <p className="small muted">Your sign-in is passed to the extension automatically. Send your profile so it can fill applications.</p>
        <button className="primary" disabled={!installed || sending} onClick={() => void sendProfile()}>Send my profile</button>
        {sent && <p className="small" role="status">{sent}</p>}
        {err && <p className="err" role="alert">{err}</p>}
      </section>

      <section className="card" aria-labelledby="apply-use">
        <h2 id="apply-use">Use it</h2>
        <ul>
          <li>On a job posting, click the JobSeeker icon and choose <strong>Save posting</strong>.</li>
          <li>On an application form, choose <strong>Fill this application</strong> and check the side panel before filling.</li>
          <li>Saved postings and deadlines appear under Track.</li>
        </ul>
      </section>
    </div>
  );
}
