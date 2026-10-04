import { Link } from 'wouter';
import { Activity, ArrowRight, Navigation, ShieldCheck, UserRound } from 'lucide-react';
import type { Role } from '../services/demo';
import './demo-login.css';

const roles: { role: Role; title: string; description: string; icon: typeof UserRound }[] = [
  { role: 'USER', title: 'Pasażer', description: 'Wybierz trasę i transport, zrób check-in i rozlicz przejazd przy check-out.', icon: UserRound },
  { role: 'CONDUCTOR', title: 'Konduktor', description: 'Blokada odprawy w pojeździe i podgląd anonimowych przejazdów.', icon: ShieldCheck },
  { role: 'ADMIN', title: 'Administrator', description: 'Przegląd sieci, linii i floty.', icon: Activity },
];

export function DemoLoginPage({ onChoose, busy = false }: { onChoose: (role: Role) => void | Promise<void>; busy?: boolean }) {
  return (
    <div className="dl">
      <header className="dl-bar">
        <Link href="/home" className="brand" data-testid="link-login-home">
          <span className="brand-mark"><Navigation size={19} /></span>FairRide
        </Link>
        <div className="top-actions">
          <Link href="/sign-in" className="nav-link" data-testid="link-verified-sign-in">Login</Link>
          <Link href="/home" className="nav-link" data-testid="link-login-about">About</Link>
        </div>
      </header>
      <main className="dl-main fade-in">
        <h1>Wybierz widok</h1>
        {roles.map(({ role, title, description, icon: Icon }) => (
          <button type="button" key={role} className="dl-card" disabled={busy} onClick={() => onChoose(role)} data-testid={`button-login-${role.toLowerCase()}`}>
            <span className="dl-ico"><Icon size={21} /></span>
            <span className="dl-txt"><strong>{title}</strong><span>{description}</span></span>
            <ArrowRight size={18} />
          </button>
        ))}
        <div className="notice">Wersja pokazowa: doładowania i rozliczenia przejazdów są symulowane, nie pobieramy pieniędzy. Potwierdzenia przejazdów nie są biletami przewoźników. Role wybierane tutaj nie nadają uprawnień do rzeczywistej floty.{busy ? ' Otwieranie sesji…' : ''}</div>
      </main>
    </div>
  );
}

export default DemoLoginPage;
