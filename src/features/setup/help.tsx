import { navigate } from '../../app/router';
import { Icon } from '../../ui/Icon';
import { helpFor } from './helpText';

export { helpFor } from './helpText';

/** An error, with what it means and what to do. */
export function HelpFor({ error, compact }: { error: string; compact?: boolean }) {
  const h = helpFor(error);
  return (
    <div className="help-box" role="alert">
      <div className="help-head">
        <Icon name="warn" />
        <span className="grow">
          <b>{h.title}</b>
          {error && !compact && <span className="muted small">{error}</span>}
        </span>
      </div>
      <ol>
        {h.steps.map((s) => <li key={s}>{s}</li>)}
      </ol>
      {h.action && <button className="btn" onClick={() => navigate(h.action!.to)}>{h.action.label}</button>}
    </div>
  );
}
