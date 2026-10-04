import { Link } from 'wouter';
import { ArrowRight, Bus, Footprints, History, MapPin, Navigation, Receipt, Ticket, Wallet } from 'lucide-react';
import './home.css';

const flow = [
  { icon: Navigation, title: 'Twoja lokalizacja GPS', text: 'Start trasy z prawdziwej pozycji urządzenia, po Twojej zgodzie.' },
  { icon: MapPin, title: 'Cel podróży', text: 'Wpisz adres lub nazwę miejsca.' },
  { icon: Bus, title: 'Połączenia', text: 'Rzeczywiste alternatywy transportu publicznego i odcinki pieszo.' },
  { icon: Receipt, title: 'Szacowany koszt', text: 'Z góry, według dystansu i uprawnionych zniżek.' },
];

const features = [
  { icon: Navigation, title: 'Planowanie z GPS', text: 'Trasy liczone od miejsca, w którym naprawdę stoisz — bez podstawionej pozycji.' },
  { icon: Bus, title: 'Alternatywy połączeń', text: 'Porównaj dostępne tramwaje, autobusy i inne rzeczywiste połączenia — wybierz trasę, która Ci odpowiada.' },
  { icon: Footprints, title: 'Dojścia bez niespodzianek', text: 'Dojście do przystanku, piesze przesiadki i droga do celu — z czasem i dystansem, gdy są dostępne.' },
  { icon: Receipt, title: 'Koszt z góry', text: 'Szacowany koszt FairRide wynika z dystansu i zniżek, do których masz prawo.' },
  { icon: History, title: 'Historia celów', text: 'Ostatnie cele zapisane na tym urządzeniu wybierzesz bez ponownego wpisywania. Usuniesz je w każdej chwili.' },
  { icon: Wallet, title: 'Portfel i przejazdy', text: 'Zrób check-in przy wejściu i check-out na końcu. Opłata zależy od kilometrów zmierzonych przez GPS.' },
];

export function HomePage({ appPath }: { appPath: string }) {
  return (
    <div className="hp">
      <header className="hp-bar">
        <Link href="/home" className="brand"><span className="brand-mark"><Navigation size={19} /></span>FairRide</Link>
        <nav className="hp-bar-links" aria-label="Główna nawigacja">
          <Link href="/sign-in" className="nav-link" data-testid="link-home-app-top">Login</Link>
          <Link href="/home" className="nav-link" data-testid="link-home-about">About</Link>
        </nav>
      </header>
      <main>
        <section className="hp-hero">
          <div className="hp-wrap wrap">
            <div className="eyebrow">KRAKÓW · PLANER PODRÓŻY</div>
            <h1>Wiesz, którędy jedziesz. <span>I ile to kosztuje.</span></h1>
            <p>Zaplanuj przejazd z prawdziwej pozycji GPS, porównaj dostępne połączenia komunikacji miejskiej i zobacz szacowany koszt FairRide, zanim ruszysz w drogę.</p>
            <div className="hp-cta">
              <Link href={appPath} className="btn hp-gold" data-testid="link-home-app">Zaplanuj trasę <ArrowRight size={16} /></Link>
              <Link href="/prices" className="btn hp-ghost" data-testid="link-home-prices-cta">Zobacz cennik</Link>
            </div>
          </div>
        </section>

        <section className="hp-sec">
          <div className="hp-wrap">
            <div className="eyebrow">JAK TO DZIAŁA</div>
            <h2>Cztery kroki do trasy</h2>
            <ol className="hp-flow">
              {flow.map(({ icon: Icon, title, text }) => (
                <li className="hp-step" key={title}>
                  <span className="hp-ico"><Icon size={20} /></span>
                  <div><h3>{title}</h3><p>{text}</p></div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="hp-sec" style={{ paddingTop: 0 }}>
          <div className="hp-wrap">
            <div className="eyebrow">CO DOSTAJESZ</div>
            <h2>Zrobione dla dojeżdżających</h2>
            <div className="hp-grid">
              {features.map(({ icon: Icon, title, text }, i) => (
                <article className={`hp-card${i === 3 ? ' wide' : ''}`} key={title}>
                  <span className="hp-ico"><Icon size={19} /></span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="hp-band">
          <div className="hp-wrap">
            <div>
              <div className="eyebrow">WYPRÓBUJ</div>
              <h2 style={{ margin: '6px 0 0' }}>Bilety i portfel</h2>
            </div>
            <p className="subheading" style={{ lineHeight: 1.6 }}><Ticket size={15} style={{ verticalAlign: '-3px' }} /> Bez kupowania biletu: wybierz transport, zrób check-in i rozlicz zmierzony dystans przy check-out.</p>
            <div className="hp-cta" style={{ margin: 0 }}>
              <Link href={appPath} className="btn" data-testid="link-home-app-bottom">Przejdź do aplikacji <ArrowRight size={16} /></Link>
              <Link href="/prices" className="btn btn-secondary" data-testid="link-home-prices-bottom">Cennik</Link>
            </div>
          </div>
        </section>
      </main>
      <footer className="hp-foot">
        <p style={{ margin: '0 0 4px' }}>FairRide — planer podróży.</p>
        <Link href="/privacy" data-testid="link-home-privacy">Prywatność</Link>
        <Link href="/terms" data-testid="link-home-terms">Regulamin</Link>
      </footer>
    </div>
  );
}

export default HomePage;
