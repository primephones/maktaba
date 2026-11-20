import type { ServerStatus } from '../../ai/client';

const FEATURE_NAME: Record<string, string> = { translate: 'Translate', ocr: 'Text recognition', ask: 'Ask', explain: 'Explain', irab: 'Iʿrāb' };
const FEATURE_COLOR: Record<string, string> = { translate: 'var(--rubric)', ocr: 'var(--slate)', ask: 'var(--gold)', explain: 'var(--gold-soft)', irab: 'var(--ink-3)' };

export function timeUntil(t: number): string {
  const ms = t - Date.now();
  if (ms <= 0) return 'now';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  if (h >= 1) return `in ${h} h ${m} min`;
  return `in ${Math.max(1, m)} min`;
}

/** Today's use of every AI service in one bar, split by feature, with what is left. */
/** A daily allowance this large means the service has none. */
export const UNLIMITED = 100_000;

export function AiAllowance({ status, stale, compact }: { status: ServerStatus; stale?: boolean; compact?: boolean }) {
  // Free services set their limits per model and change them often (some models allow 20
  // requests a day, the light ones far more), so no "left today" figure is made up: what is
  // shown is what was used, and which models are out for now and why.
  const usable = status.providers.filter((p) => p.configured);
  const used = usable.reduce((n, p) => n + p.usedToday, 0);
  const features = Object.entries(status.features).filter(([, n]) => n > 0);
  const total = features.reduce((n, [, x]) => n + x, 0) || 1;
  const out = usable.flatMap((p) => (p.resting ?? []).filter((r) => r.until > Date.now()).map((r) => ({ ...r, service: p.name })));
  const forDay = out.filter((r) => /used up|no longer offered/i.test(r.reason));
  const busy = out.filter((r) => !/used up|no longer offered/i.test(r.reason));
  return (
    <div className="allowance">
      <div className="allowance-head">
        <span className="ai-mark" aria-hidden="true">✦</span>
        <b>{used ? `${used} request${used === 1 ? '' : 's'} today` : 'Nothing asked of your AI today'}</b>
        <span className="muted small">day resets {timeUntil(status.resetAt)}</span>
      </div>
      {features.length > 0 && (
        <div className="storage-bar" role="img" aria-label={`${used} requests today`}>
          {features.map(([f, n]) => <i key={f} style={{ width: `${(n / total) * 100}%`, background: FEATURE_COLOR[f] ?? 'var(--ink-3)' }} />)}
        </div>
      )}
      {!compact && features.length > 0 && (
        <div className="legend">
          {features.map(([f, n]) => (
            <div key={f}><i style={{ background: FEATURE_COLOR[f] }} /><span>{FEATURE_NAME[f] ?? f}</span><span>{n}</span></div>
          ))}
        </div>
      )}
      {!compact && forDay.length > 0 && (
        <p className="muted small">Out for today: {forDay.map((r) => `${r.model.replace(/^.*\//, '')} (${r.reason})`).join('; ')}. The other models carry on.</p>
      )}
      {!compact && busy.length > 0 && (
        <p className="muted small">Resting for a moment: {busy.map((r) => r.model.replace(/^.*\//, '')).join(', ')} (busy). Asked again {timeUntil(Math.min(...busy.map((r) => r.until)))}.</p>
      )}
      <p className="muted small">
        {compact
          ? 'Free allowances are per model; when one runs out the next is used.'
          : 'Google’s free allowance is set for each model and changes often: the strongest allow about 20 requests a day, the lighter ones far more. When one runs out, Maktaba moves to the next by itself. A page of a scanned book, or about eight paragraphs, is one request.'}
        {stale && ` Last checked ${new Date(status.fetchedAt).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}; the server can’t be reached right now.`}
      </p>
    </div>
  );
}
