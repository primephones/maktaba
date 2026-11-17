import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** A line of Arabic set large, with its meaning and author beneath. */
export interface Epigraph {
  line: string;
  gloss: string;
  by: string;
}

/** al-Mutanabbī's line on books, known to every reader of Arabic. */
export const BEST_COMPANION: Epigraph = {
  line: 'وخيرُ جليسٍ في الزمانِ كتابُ',
  gloss: 'The best companion, in any age, is a book.',
  by: 'al-Mutanabbī',
};

interface Props {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /** Shown in place of the icon, on the screens a new reader sees first. */
  epigraph?: Epigraph;
}

/** An empty screen says what belongs here and offers the way to fill it. */
export function EmptyState({ icon = 'book', title, children, action, epigraph }: Props) {
  return (
    <div className="empty fade-in">
      {epigraph ? (
        <figure className="epigraph">
          <span className="line" lang="ar">{epigraph.line}</span>
          <figcaption>
            <span className="gloss">{epigraph.gloss}</span>
            <span className="by">{epigraph.by}</span>
          </figcaption>
        </figure>
      ) : (
        <div className="mark">
          <Icon name={icon} size={34} />
        </div>
      )}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
