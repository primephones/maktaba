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
export function AiAllowance({ status, stale, compact }: { status: ServerStatus; stale?: boolean; compact?: boolean }) {
  const usable = status.providers.filter((p) => p.configured);
  const limit = usable.reduce((n, p) => n + p.dailyLimit, 0) || 1;
  const used = usable.reduce((n, p) => n + Math.min(p.usedToday, p.dailyLimit), 0);
  const left = Math.max(0, limit - used);
  const features = Object.entries(status.features).filter(([, n]) => n > 0);
  return (
    <div className="allowance">
      <div className="allowance-head">
        <span className="ai-mark" aria-hidden="true">✦</span>
        <b>{left} requests left today</b>
        <span className="muted small">resets {timeUntil(status.resetAt)}</span>
      </div>
      <div className="storage-bar" role="img" aria-label={`${used} of ${limit} requests used today`}>
        {features.map(([f, n]) => <i key={f} style={{ width: `${(n / limit) * 100}%`, background: FEATURE_COLOR[f] ?? 'var(--ink-3)' }} />)}
      </div>
      {!compact && features.length > 0 && (
        <div className="legend">
          {features.map(([f, n]) => (
            <div key={f}><i style={{ background: FEATURE_COLOR[f] }} /><span>{FEATURE_NAME[f] ?? f}</span><span>{n}</span></div>
          ))}
        </div>
      )}
      <p className="muted small">
        About {Math.floor(left * 8)} paragraphs of translation left today.
        {stale && ` Last checked ${new Date(status.fetchedAt).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}; the server can’t be reached right now.`}
      </p>
    </div>
  );
}
