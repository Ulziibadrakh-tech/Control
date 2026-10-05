import { ChevronDown, History, Users } from 'lucide-react';
import { useI18n } from '../../i18n/react';
import { useMe, useNow } from '../context';
import { hrefOf, onRouteClick, type Route } from '../route';
import { Avatar } from './bits';

export function Header({ route, onOpenSettings }: { readonly route: Route; readonly onOpenSettings: () => void }) {
  const me = useMe();
  const now = useNow();
  const { t, dateLong } = useI18n();
  const hour = new Date(now).getHours();
  const hello = hour >= 5 && hour < 12 ? 'hello.morning' : hour >= 12 && hour < 18 ? 'hello.afternoon' : 'hello.evening';

  return (
    <header className="top">
      <div className="top__text">
        <p className="top__date">{dateLong(now)}</p>
        <h1 className="top__hello">{t(hello, { name: me?.name ?? '' })}</h1>
      </div>
      <nav className="top__nav" aria-label={t('nav.label')}>
        <a
          className="pill"
          href={hrefOf('history')}
          onClick={onRouteClick('history')}
          aria-current={route === 'history' ? 'page' : undefined}
        >
          <History aria-hidden="true" size={22} strokeWidth={2.4} />
          <span>{t('nav.history')}</span>
        </a>
        <a
          className="pill"
          href={hrefOf('people')}
          onClick={onRouteClick('people')}
          aria-current={route === 'people' ? 'page' : undefined}
        >
          <Users aria-hidden="true" size={22} strokeWidth={2.4} />
          <span>{t('nav.people')}</span>
        </a>
      </nav>
      <button type="button" className="me" onClick={onOpenSettings} aria-label={t('nav.me', { name: me?.name ?? '' })}>
        <Avatar person={me} size="md" />
        <span className="me__name">{me?.name}</span>
        <ChevronDown aria-hidden="true" size={20} strokeWidth={2.5} />
      </button>
    </header>
  );
}
