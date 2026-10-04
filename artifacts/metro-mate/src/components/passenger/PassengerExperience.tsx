import { useEffect, useRef, useState } from 'react';
import { Link, Route, Switch, Redirect, useLocation } from 'wouter';
import { MapPin, Navigation, Ticket, UserRound } from 'lucide-react';
import type { User } from '../../services/demo';
import { usePassengerAccount } from '../../hooks/use-passenger-account';
import { useRideTracking } from '../../hooks/use-ride-tracking';
import { PricesPage } from '../PricesPage';
import { MapLegal } from '../MapLegal';
import { GoPage } from './GoPage';
import { BoardingPage } from './BoardingPage';
import { useBoardingSelection } from './boarding';
import { BillsPage } from './BillsPage';
import { ProfilePage } from './ProfilePage';
import { TicketPage, TicketHistoryPage } from './TicketPages';
import { Avatar } from './Avatar';
import './passenger.css';
import { PassengerVehicleCheckInPage } from '../transport';
import { useTransportMode } from '../../services/transport-mode';

type Props = { user: User; geo: { lat: number; lng: number; accuracy: number; timestamp: number } | null; geoStatus: string; geoError: string | null; requestPosition: () => void; signOut: () => void };
const nav = [
  { label: 'Bilet', path: '/user/ticket', icon: Ticket },
  { label: 'Go', path: '/user/map', icon: MapPin },
  { label: 'Profile', path: '/user/profile', icon: UserRound },
];

export function PassengerExperience({ user, geo, geoStatus, geoError, requestPosition, signOut }: Props) {
  const mode = useTransportMode();
  const c = usePassengerAccount(user);
  useRideTracking(c, geo, geoStatus);
  const [location, setLocation] = useLocation();
  const [selection, setSelection] = useBoardingSelection(user.id);
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); }, [location]);
  const onGo = location === '/user/map';
  // Lazy-mount Go once, then keep it mounted (hidden) so destination and live route survive navigation.
  const [goVisited, setGoVisited] = useState(onGo);
  useEffect(() => { if (onGo) setGoVisited(true); }, [onGo]);
  const active = (p: string) => location === p ||
    (p === '/user/ticket' && ['/user/tickets/history', '/user/check-in', '/user/boarding'].includes(location)) ||
    (p === '/user/profile' && ['/user/bills', '/prices', '/privacy', '/terms'].includes(location));
  const profile = c.account?.profile ?? { firstName: user.firstName, lastName: user.lastName, photo: null };
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  let body;
  if (!c.account) body = <div className="surface pad empty-state">{c.error ? <><h2>Wallet unavailable</h2><div className="pz-alert" role="alert">{c.error}</div><button className="btn" onClick={c.reload}>Retry</button></> : <h2>Loading wallet…</h2>}
    {location === '/user/profile' && <button type="button" className="btn btn-secondary" onClick={signOut} data-testid="button-sign-out">Sign out</button>}
  </div>;
  else body = <>
    {c.error && <div className="pz-alert" role="alert">{c.error}</div>}
    <Switch>
      <Route path="/user/map">{null}</Route>
      <Route path="/user/bills"><BillsPage controller={c} /></Route>
      <Route path="/user/profile"><ProfilePage controller={c} onSignOut={signOut} /></Route>
      <Route path="/prices"><PricesPage defaultDiscountId={c.account.profile.discountId} embedded /></Route>
      <Route path="/user/boarding"><BoardingPage controller={c} selection={selection} onClear={() => setSelection(null)} /></Route>
      <Route path="/user/ticket"><TicketPage controller={c} /></Route>
      <Route path="/user/check-in"><PassengerVehicleCheckInPage /></Route>
      <Route path="/user/tickets/history"><TicketHistoryPage controller={c} /></Route>
      <Route path="/user/journeys"><Redirect to="/user/tickets/history" /></Route>
      <Route path="/privacy"><MapLegal kind="privacy" /></Route>
      <Route path="/terms"><MapLegal kind="terms" /></Route>
      <Route><Redirect to="/user/map" /></Route>
    </Switch>
  </>;
  return <div className="app-shell pz-passenger-shell">
    <header className="topbar" data-testid="passenger-header">
      <Link href="/user/map" className="brand" aria-label="FairRide home" data-testid="link-brand"><span className="brand-mark"><Navigation size={19} /></span><span className="pz-wordmark">FairRide</span></Link>
      <div className="top-actions"><Avatar profile={profile} /><span className="pz-name" title={name} data-testid="header-passenger-name">{name}</span></div>
    </header>
    <main ref={mainRef} className="content pz-main" aria-label={nav.find(item => active(item.path))?.label ?? 'FairRide information'}>
      {c.account && goVisited && <div hidden={!onGo} data-testid="go-keepalive"><GoPage visible={onGo} controller={c} geo={geo} geoStatus={geoStatus} geoError={geoError} requestPosition={requestPosition} onBoard={s => { setSelection(s); setLocation('/user/boarding'); }} /></div>}
      {body}
    </main>
    <footer className="pz-footer" data-testid="passenger-footer">
      <nav className="pz-bottom-nav" aria-label="Main navigation">{nav.map(({ label, path, icon: Icon }) =>
        <Link key={path} href={path} aria-current={active(path) ? 'page' : undefined}
          className={`nav-link ${active(path) ? 'active' : ''}`} data-testid={`link-nav-${label.toLowerCase()}`}>
          <Icon size={22} /><span>{label}</span>
        </Link>)}</nav>
    </footer>
      </div>;
}
