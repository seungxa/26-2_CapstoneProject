import { useMemo } from "react";
import { langOf } from "../labels";
import { CRITERIA, MIN_RATE_SEC, splitPoints, stateName, type AnswerMetrics, type CriterionState, type ImprovementPoint, type Insights } from "../review/insights";
import type { PracticeSession } from "../types";

// Charts and rule-based points under the Summary card's Details (R1). Computed from the session detail only
// (no LLM call); the math is in review/insights.ts

const STATE_MARK: Record<CriterionState, { mark: string; cls: string }> = {
  충분: { mark: "✓", cls: "good" },
  보완: { mark: "!", cls: "warn" },
  판단유보: { mark: "–", cls: "neutral" },
  "점검 전": { mark: "·", cls: "none" },
};

interface Bar {
  key: string;
  label: string;
  value: number;
  text: string;
  tip: string;
}

/** 가로 막대(단일 계열). 기준선은 점선, 값은 막대 끝에 쓰고 표 보기를 함께 둔다 */
function BarChart({ title, note, bars, max, refLine, empty, unit }: {
  title: string;
  note?: string;
  bars: Bar[];
  max: number;
  refLine?: { value: number; label: string } | null;
  empty: string;
  unit: string;
}) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <figure className="viz" aria-label={title}>
      <figcaption>
        <span className="viz-title">{title}</span>
        {refLine && bars.length > 0 && <span className="viz-key small muted"><i className="viz-ref-key" aria-hidden="true" />{refLine.label}</span>}
      </figcaption>
      {bars.length === 0 ? (
        <p className="muted small viz-empty">{empty}</p>
      ) : (
        <>
          <div className="bars" role="img" aria-label={`${title}: ${bars.map((b) => `${b.label} ${b.text}`).join(", ")}`}>
            {bars.map((b) => (
              <div className="bar-row" key={b.key} title={b.tip}>
                <span className="bar-label">{b.label}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: pct(b.value) }} />
                  {refLine && <span className="bar-ref" style={{ left: pct(refLine.value) }} />}
                </span>
                <span className="bar-value">{b.text}</span>
              </div>
            ))}
          </div>
          <details className="viz-table">
            <summary className="small">Show as Table</summary>
            <table>
              <thead><tr><th>Answer</th><th>{unit}</th></tr></thead>
              <tbody>{bars.map((b) => <tr key={b.key}><td>{b.label}</td><td>{b.text}</td></tr>)}</tbody>
            </table>
          </details>
        </>
      )}
      {note && bars.length > 0 && <p className="muted small viz-note">{note}</p>}
    </figure>
  );
}

function StatusGrid({ answers, reasons }: { answers: AnswerMetrics[]; reasons: Map<string, Record<string, string>> }) {
  return (
    <figure className="viz" aria-label="Checks by answer">
      <figcaption><span className="viz-title">Checks by Answer</span></figcaption>
      <div className="table-scroll">
      <table className="status-grid" aria-label="Checks for each answer">
        <thead>
          <tr><th>Answer</th>{CRITERIA.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {answers.map((m) => (
            <tr key={m.id}>
              <th scope="row"><a href={`#answer-${m.id}`} title={m.question}>Q{m.order}</a></th>
              {CRITERIA.map((c) => {
                const st = m.statuses[c.key];
                return (
                  <td key={c.key} title={reasons.get(m.id)?.[c.key] || undefined}>
                    <span className="st"><i className={`st-mark ${STATE_MARK[st].cls}`} aria-hidden="true">{STATE_MARK[st].mark}</i>{stateName(st)}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  );
}

function PointItem({ p }: { p: ImprovementPoint }) {
  return (
    <li>
      <div className="row">
        <strong className="grow">{p.title}</strong>
        {p.source === "coaching" && <span className="chip">From checks</span>}
        <span className="small point-answers">
          {p.answers.map((a, i) => <span key={a.id}>{i > 0 && " · "}<a href={`#answer-${a.id}`}>Q{a.order}</a></span>)}
        </span>
      </div>
      <div className="small muted" lang={langOf(p.evidence)}>{p.evidence}</div>
      {p.answers.filter((a) => a.quote).map((a) => (
        <blockquote className="quote small" key={a.id}>Q{a.order} <span lang="ko">“{a.quote}”</span></blockquote>
      ))}
      <div className="small"><b>Try:</b> <span lang={langOf(p.action)}>{p.action}</span></div>
    </li>
  );
}

/** Renders nothing until something was answered: the Summary line says "No answers yet." */
export default function ReviewInsights({ s, ins }: { s: PracticeSession; ins: Insights }) {
  const reasons = useMemo(
    () => new Map(s.answers.map((a) => [a.id, Object.fromEntries((a.coaching_report?.input_status === "legacy_unverified" ? [] : a.coaching_report?.criteria ?? []).map((c) => [c.key, c.reason]))])),
    [s],
  );
  const answered = ins.answers.filter((m) => m.recorded || m.hasTranscript);
  if (answered.length === 0) return null;

  const recorded = ins.answers.filter((m) => m.durationSec != null);
  const limit = ins.answers.find((m) => m.limitSec != null)?.limitSec ?? null;
  const timeBars: Bar[] = recorded.map((m) => ({
    key: m.id, label: `Q${m.order}`, value: m.durationSec as number, text: `${Math.round(m.durationSec as number)}s`,
    tip: `Q${m.order} · ${Math.round(m.durationSec as number)}s${m.usage != null ? ` (${Math.round(m.usage * 100)}% of the limit)` : ""}`,
  }));
  const timeMax = Math.max(limit ?? 0, ...recorded.map((m) => m.durationSec as number), 1);

  const rated = ins.answers.filter((m) => m.spm != null);
  const speedBars: Bar[] = rated.map((m) => ({
    key: m.id, label: `Q${m.order}`, value: m.spm as number, text: `${m.spm}`,
    tip: `Q${m.order} · ${m.spm} syllables/min${ins.avgSpm != null ? ` (average ${Math.round(ins.avgSpm)})` : ""}`,
  }));
  const speedMax = Math.max(...rated.map((m) => m.spm as number), ins.avgSpm ?? 0, 1);
  const speedEmpty = recorded.length === 0
    ? "No recorded answers, so there's no speaking pace."
    : `Speaking pace needs a recording of at least ${MIN_RATE_SEC}s with its original transcript.`;

  const ratingBars: Bar[] = ins.answers.filter((m) => m.rating != null).map((m) => ({
    key: m.id, label: `Q${m.order}`, value: m.rating as number, text: `${m.rating}/5`, tip: `Q${m.order} · self-rating ${m.rating}/5`,
  }));

  const { shown, more } = splitPoints(ins.points);

  return (
    <div className="insights">
      <div className="insights-grid">
        <StatusGrid answers={ins.answers} reasons={reasons} />
        <BarChart
          title="Answer Time" unit="Recording length" bars={timeBars} max={timeMax}
          refLine={limit != null ? { value: limit, label: `Limit ${limit}s` } : null}
          empty="No recorded answers, so there's no answer time to show."
        />
        <BarChart
          title="Speaking Pace (syllables/min)" unit="Syllables per minute" bars={speedBars} max={speedMax}
          refLine={ins.avgSpm != null ? { value: ins.avgSpm, label: `Session average ${Math.round(ins.avgSpm)}` } : null}
          empty={speedEmpty}
          note="Measured over the whole recording, pauses included, so it reads slower than you spoke. Compare answers within this session."
        />
        <BarChart title="Self Rating" unit="Rating (out of 5)" bars={ratingBars} max={5} empty="No self-ratings yet." />
      </div>

      <h3 className="insights-sub">What to Work On</h3>
      {ins.points.length === 0 ? (
        <p className="muted small" data-testid="insight-points">Nothing came up from the rules. Each answer shows its own checks.</p>
      ) : (
        <div data-testid="insight-points">
          <ol className="plain insight-points">{shown.map((p) => <PointItem key={p.key} p={p} />)}</ol>
          {more.length > 0 && (
            <details>
              <summary className="small">Show {more.length} More</summary>
              <ol className="plain insight-points">{more.map((p) => <PointItem key={p.key} p={p} />)}</ol>
            </details>
          )}
        </div>
      )}
      {ins.untranscribed > 0 && (
        <p className="muted small">{ins.untranscribed === 1 ? "1 recorded answer has" : `${ins.untranscribed} recorded answers have`} no transcript, so {ins.untranscribed === 1 ? "it wasn't" : "they weren't"} checked. Type a transcript or retry transcription to check {ins.untranscribed === 1 ? "it" : "them"}.</p>
      )}
    </div>
  );
}
