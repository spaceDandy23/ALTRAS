import { Link } from 'react-router-dom';
import { Panel } from '@/components/ui/Panel';
import { useAuthStore } from '@/stores/auth.store';

const menuItems = [
  {
    to: '/lessons',
    symbol: '→',
    kicker: 'Start here',
    title: 'Lessons',
    description: 'Play guided activities and build your translation skills.',
    accent: 'yellow',
  },
  {
    to: '/profile',
    symbol: '★',
    kicker: 'Your space',
    title: 'Profile',
    description: 'View and update your local student identity.',
    accent: 'blue',
  },
  {
    to: '/settings',
    symbol: '⚙',
    kicker: 'Make it yours',
    title: 'Settings',
    description: 'Adjust volume choices and animation preferences.',
    accent: 'red',
  },
] as const;

export function MainMenuPage() {
  const user = useAuthStore((state) => state.user);
  return (
    <div className="menu-page page-enter">
      <section className="menu-hero">
        <div>
          <p className="eyebrow">Ready when you are</p>
          <h1>
            Hello, <span>{user?.displayName}</span>!
          </h1>
          <p className="menu-hero__lead">Choose your next move and let the words become math.</p>
        </div>
        <Panel className="example-board" accent="yellow">
          <span className="example-board__label">Translate this idea</span>
          <p>“six less than twice a number”</p>
          <span className="example-board__arrow" aria-hidden="true">
            →
          </span>
          <strong>2x − 6</strong>
        </Panel>
      </section>
      <nav className="menu-grid" aria-label="Main menu">
        {menuItems.map((item, index) => (
          <Link to={item.to} className={`menu-card menu-card--${item.accent}`} key={item.to}>
            <span className="menu-card__number">0{index + 1}</span>
            <span className="menu-card__symbol" aria-hidden="true">
              {item.symbol}
            </span>
            <span className="eyebrow">{item.kicker}</span>
            <strong>{item.title}</strong>
            <span className="menu-card__description">{item.description}</span>
            <span className="menu-card__action">
              Open <span aria-hidden="true">→</span>
            </span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
