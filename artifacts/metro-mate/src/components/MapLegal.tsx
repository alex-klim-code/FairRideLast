import { Link } from 'wouter';

export function MapLegal({ kind }: { kind: 'privacy' | 'terms' }) {
  return <section className="surface pad" style={{ maxWidth: 760, margin: '24px auto', lineHeight: 1.8 }}>
    <div className="eyebrow">FAIRRIDE · INFORMACJE</div>
    <h1>{kind === 'privacy' ? 'Prywatność i lokalizacja' : 'Warunki korzystania'}</h1>
    {kind === 'privacy' ? <>
      <p>Po wyrażeniu zgody przeglądarka udostępnia FairRide rzeczywistą lokalizację urządzenia.
        Nie używamy zastępczej pozycji pasażera. Możesz cofnąć zgodę w ustawieniach przeglądarki.</p>
      <p>Mapa Google przekazuje Google informacje potrzebne do wyświetlenia oglądanego obszaru.
        Po wybraniu celu lub naciśnięciu przycisku wyznaczania trasy współrzędne startu i celu trafiają przez serwer do Google Routes API.
        Nie zapisujemy wyników Google Routes ani współrzędnych tras w bazie danych lub dziennikach zapytań.</p>
      <p>Ostatnie cele — tylko nazwy i współrzędne wybranych miejsc — są zapisywane lokalnie na tym urządzeniu.
        Możesz usunąć pojedynczy wpis lub wyczyścić historię. Przeglądanie historii nie wysyła zapytań.
        Podpowiedzi adresów podczas pisania przekazują treść wyszukiwania dostawcy Geoapify; nie wpisuj informacji poufnych.</p>
      <p>Od check-in do check-out dystans jest mierzony z kolejnych wiarygodnych punktów GPS na tym urządzeniu.
        Aktywny przejazd i ostatnie punkty pomiaru są zapisywane lokalnie; po check-out punkty GPS są usuwane z potwierdzenia.
        Zmiana zakładki nie zatrzymuje pomiaru. Przeglądarka może jednak wstrzymać GPS w tle lub po zablokowaniu telefonu;
        kilometrów z przerw w pomiarze nie doliczamy.</p>
      <p>Ustalona pozycja GPS jest wysyłana przez serwer do Geoapify, aby pokazać adres startu.
        Brak adresu nie blokuje planowania z prawdziwych współrzędnych. FairRide nie loguje zapytań, adresów ani pozycji GPS;
        odpowiedź z adresem startu pozostaje w pamięci bieżącego widoku. Po zakupie biletu
        nazwy startu i celu są zachowane w lokalnym bilecie na tym urządzeniu. Geoapify może przechowywać dane zapytań API,
        zwykle do 24 godzin dla udanych zapytań. Dane adresowe: Geoapify i © OpenStreetMap contributors (ODbL).</p>
    </> : <>
      <p>Planowanie tras w FairRide korzysta z danych Google. Szacowany koszt przejazdu obliczamy według taryfy FairRide.</p>
      <p>Rzeczywiste wskazówki transportu publicznego pochodzą z Google Maps.
        Dostępność, rozkłady, czasy i ceny zależą od danych dostawcy oraz przewoźników i mogą się zmieniać.
        Sprawdź aktualny rozkład i wymagany bilet u przewoźnika przed podróżą.</p>
      <p>Korzystanie z usług Google w FairRide podlega również warunkom Google.
        Niniejsze informacje nie zastępują regulaminu operatora transportu.</p>
    </>}
    <p><a href="https://maps.google.com/help/terms_maps/" target="_blank" rel="noopener noreferrer">Warunki Google Maps</a>
      {' · '}<a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Polityka prywatności Google</a></p>
    <Link href="/login" className="btn btn-secondary">Powrót do FairRide</Link>
  </section>;
}