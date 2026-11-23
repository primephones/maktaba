/**
 * The eight-pointed star (khātam): two squares, one turned a quarter. Used sparingly, as a
 * divider at the end of a chapter.
 */
export function Khatam({ size = 18 }: { size?: number }) {
  return (
    <svg className="khatam" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="5" y="5" width="14" height="14" />
      <rect x="5" y="5" width="14" height="14" transform="rotate(45 12 12)" />
      <circle cx="12" cy="12" r="2.2" />
    </svg>
  );
}

/** Line drawings for empty screens: a book stand (raḥl) with an open book, and a lamp. */
export function EmptyDrawing({ kind }: { kind: 'rehal' | 'lamp' | 'star' }) {
  if (kind === 'lamp') {
    return (
      <svg className="empty-drawing" viewBox="0 0 120 96" aria-hidden="true" focusable="false">
        <path d="M60 10v8" />
        <path d="M54 18h12l4 8H50z" />
        <path d="M44 26h32c0 22-6 34-16 38-10-4-16-16-16-38z" />
        <path d="M52 34c2 10 4 18 8 22" className="soft" />
        <path d="M50 70h20M46 78h28" />
        <path d="M60 64v6" />
        <path d="M30 40c-4 6-4 14 0 20M90 40c4 6 4 14 0 20" className="soft" />
      </svg>
    );
  }
  if (kind === 'star') {
    return (
      <svg className="empty-drawing" viewBox="0 0 120 96" aria-hidden="true" focusable="false">
        <rect x="38" y="26" width="44" height="44" />
        <rect x="38" y="26" width="44" height="44" transform="rotate(45 60 48)" />
        <circle cx="60" cy="48" r="9" className="soft" />
      </svg>
    );
  }
  return (
    <svg className="empty-drawing" viewBox="0 0 120 96" aria-hidden="true" focusable="false">
      {/* The open book */}
      <path d="M60 30c-10-6-24-8-36-6v30c12-2 26 0 36 6 10-6 24-8 36-6V24c-12-2-26 0-36 6z" />
      <path d="M60 30v30" />
      <path d="M32 33c7-1 14 0 20 2M32 40c7-1 14 0 20 2M68 35c6-2 13-3 20-2M68 42c6-2 13-3 20-2" className="soft" />
      {/* The folding stand beneath it, crossed */}
      <path d="M26 58l60 30M94 58L34 88" />
      <path d="M22 88h18M80 88h18" className="soft" />
    </svg>
  );
}
