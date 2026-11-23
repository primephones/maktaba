/** The name مكتبة drawn stroke by stroke in ink, then filled; Maktaba beneath it. */
export function InkName({ small }: { small?: boolean }) {
  return (
    <svg className="ink-name" data-small={small || undefined} viewBox="0 0 320 170" role="img" aria-label="Maktaba, مكتبة">
      <text className="ink-ar" x="160" y="98" textAnchor="middle" lang="ar">مكتبة</text>
      <line className="ink-rule" x1="112" y1="122" x2="208" y2="122" />
      <text className="ink-en" x="160" y="156" textAnchor="middle">Maktaba</text>
    </svg>
  );
}

/** Soft shapes holding the places of books while the shelf loads. */
export function ShelfSkeleton({ count = 6, row }: { count?: number; row?: boolean }) {
  return (
    <div className={row ? 'shelf skeleton' : 'grid skeleton'} aria-busy="true" aria-label="Loading your books">
      {Array.from({ length: count }, (_, i) => (
        <div className="tile" key={i} aria-hidden="true">
          <div className="ph ph-cover" />
          <div className="ph ph-line" />
          <div className="ph ph-line ph-line--short" />
        </div>
      ))}
    </div>
  );
}
