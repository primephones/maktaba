import { switchTab, navigate, TABS, type Route } from '../app/router';
import { Icon, type IconName } from './Icon';

const LABEL: Record<(typeof TABS)[number], string> = { home: 'Home', library: 'Library', references: 'References' };
const ICON: Record<(typeof TABS)[number], IconName> = { home: 'home', library: 'library', references: 'references' };

/** The floating glass bar: three tabs, Search, and the one Add book button in the app. */
export function BottomBar({ route, hidden, onAdd }: { route: Route; hidden: boolean; onAdd: () => void }) {
  const active = TABS.indexOf(route.name as (typeof TABS)[number]);
  return (
    <nav className="bar" data-hidden={hidden} aria-label="Main" inert={hidden}>
      <div className="bar-tabs">
        {active >= 0 && <span className="bar-ind" style={{ transform: `translateX(${active * 100}%)` }} />}
        {TABS.map((tab) => (
          <button key={tab} className="bar-tab" aria-current={route.name === tab ? 'page' : undefined} onClick={() => switchTab(tab)}>
            <Icon name={ICON[tab]} size={22} />
            <span>{LABEL[tab]}</span>
          </button>
        ))}
      </div>
      <span className="bar-sep" aria-hidden="true" />
      <button className="bar-act" aria-label="Search your books" onClick={() => navigate('/search')}>
        <Icon name="search" />
      </button>
      <button className="bar-act bar-act--add" aria-label="Add book" onClick={onAdd}>
        <Icon name="plus" />
      </button>
    </nav>
  );
}
