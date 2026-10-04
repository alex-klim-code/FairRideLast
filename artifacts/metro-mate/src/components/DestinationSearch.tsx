import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Clock, MapPin, Search, X } from 'lucide-react';
import { Form } from './ui/form';
import { searchDestinationSuggestions, type GeocodingResult } from '../services/geocoding';
import type { RoutePoint } from '../services/routing';
import type { RecentDestination } from '../services/destination-history';

type Props = {
  destination: RoutePoint | null;
  onChoose: (point: RoutePoint) => void;
  onClear: () => void;
  recentDestinations: RecentDestination[];
  historyError: string;
  onRemoveRecent: (point: RecentDestination) => void;
  onClearHistory: () => void;
};

export function DestinationSearch({ destination, onChoose, onClear, recentDestinations, historyError, onRemoveRecent, onClearHistory }: Props) {
  const form = useForm<{ query: string }>({ defaultValues: { query: '' } });
  const query = form.watch('query');
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [error, setError] = useState('');
  const [activeResult, setActiveResult] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef<AbortController | null>(null);
  const version = useRef(0);
  const editingSelectedDestination = useRef(false);
  const cancel = () => {
    version.current++; request.current?.abort();
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
  };
  useEffect(() => {
    if (!destination && editingSelectedDestination.current) {
      editingSelectedDestination.current = false;
      return;
    }
    cancel();
    form.setValue('query', destination?.name ?? '');
    setOpen(false); setResults([]); setStatus('idle');
  }, [destination, form]);
  useEffect(() => () => { cancel(); }, []);
  const recent = recentDestinations.filter(point => !query.trim() || point.name.toLocaleLowerCase('pl').includes(query.trim().toLocaleLowerCase('pl')));
  const choose = (point: RoutePoint) => {
    cancel(); setOpen(false); setStatus('idle'); setResults([]); setError('');
    form.setValue('query', point.name);
    onChoose(point);
  };
  const lookup = async (value: string) => {
    cancel();
    const current = version.current;
    const controller = new AbortController();
    request.current = controller;
    setOpen(true); setStatus('loading'); setResults([]); setError('');
    try {
      const found = await searchDestinationSuggestions(value, controller.signal);
      if (version.current !== current) return;
      setResults(found); setActiveResult(-1); setStatus('success');
    } catch (cause) {
      if (version.current !== current || controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Address search failed. Please try again.');
      setStatus('error');
    }
  };
  const submit = form.handleSubmit(({ query: value }) => lookup(value));
  const clear = () => {
    cancel(); form.setValue('query', ''); setStatus('idle'); setResults([]); setOpen(false); onClear();
  };
  return <><Form {...form}><form className="destination-search-form" onSubmit={submit}>
    <div className="route-search">
      <button type="submit" className="destination-submit" aria-label="Szukaj adresu lub miejsca"
        disabled={status === 'loading' || query.trim().length < 3}
        data-testid="button-search-destination"><Search size={17} aria-hidden="true"/></button>
      <input {...form.register('query')} className="searchbox map-search" maxLength={200}
        onChange={event => {
          cancel();
          // Invalidate transport immediately; retain the new query when the destination clears.
          if (destination) { editingSelectedDestination.current = true; onClear(); }
          form.setValue('query', event.target.value);
          const value = event.target.value;
          setError(''); setActiveResult(-1); setResults([]); setOpen(true);
          setStatus(value.trim().length >= 3 ? 'loading' : 'idle');
          if (value.trim().length >= 3) timer.current = setTimeout(() => { void lookup(value); }, 250);
        }}
        onFocus={() => setOpen(true)} onKeyDown={event => {
          if (event.key === 'Escape') { cancel(); setOpen(false); setStatus('idle'); }
          if (open && results.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            setActiveResult(i => event.key === 'ArrowDown' ? (i + 1) % results.length : (i <= 0 ? results.length - 1 : i - 1));
          }
          if (event.key === 'Enter' && open && activeResult >= 0 && results[activeResult]) {
            event.preventDefault();
            const result = results[activeResult];
            choose({ name: result.label, lat: result.lat, lng: result.lng });
          }
        }}
        role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls="destination-result-list"
        aria-activedescendant={activeResult >= 0 ? `destination-option-${activeResult}` : undefined}
        placeholder="Dokąd chcesz jechać? Adres lub miejsce" aria-label="Search for a destination"
        data-testid="input-search-destination"
        style={{ paddingLeft: 48, paddingRight: 40 }}/>
      {(query || destination) && <button type="button" className="destination-clear" onClick={clear}
        aria-label="Clear destination" data-testid="button-clear-destination"><X size={16}/></button>}
      {open && <div className="destination-suggestions" data-testid="destination-suggestions">
         {recentDestinations.length > 0 && <section aria-label="Recent destinations" data-testid="section-recent-destinations">
           <div className="recent-destinations-heading">
             <span>Recent destinations</span>
             <button type="button" onClick={onClearHistory} data-testid="button-clear-destination-history">Clear history</button>
           </div>
           {recent.map((point, index) => <div className="recent-destination-row" key={`${point.name}:${point.lat}:${point.lng}`}>
             <button type="button" onClick={() => choose(point)} data-testid={`button-recent-destination-${index}`}>
               <Clock size={15}/><span><strong>{point.name}</strong></span>
             </button>
             <button type="button" className="remove-recent-destination" onClick={() => onRemoveRecent(point)}
               aria-label={`Remove ${point.name} from recent destinations`} title="Remove from history"
               data-testid={`button-remove-recent-destination-${index}`}><X size={16}/></button>
           </div>)}
           {recent.length === 0 && <div className="suggestion-note" data-testid="status-no-matching-recent">No recent destinations match this search.</div>}
         </section>}
         {historyError && <div className="suggestion-note" role="alert" data-testid="status-history-storage-error">{historyError}</div>}
        <div aria-live="polite" aria-atomic="true">
          {status === 'idle' && !destination && query.trim().length < 3 && <div className="suggestion-note">Wpisz co najmniej 3 znaki, aby zobaczyć pasujące adresy i miejsca.</div>}
          {status === 'loading' && <div className="suggestion-note" role="status" data-testid="status-search-loading">Szukam pasujących adresów i miejsc…</div>}
          {status === 'error' && <div className="suggestion-note" role="alert" data-testid="status-search-error">{error}</div>}
          {status === 'success' && results.length === 0 && <div className="suggestion-note" data-testid="status-search-empty">Nie znaleziono miejsc. Dopisz miasto lub spróbuj innej nazwy.</div>}
        </div>
         <div role="listbox" id="destination-result-list" aria-label="Pasujące adresy i miejsca">{results.map((result, index) => <button type="button" key={result.id} role="option" aria-selected={activeResult === index} id={`destination-option-${index}`}
          style={activeResult === index ? { background: '#edf3eb' } : undefined} onClick={() => choose({ name: result.label, lat: result.lat, lng: result.lng })}
          data-testid={`destination-result-${index}`}><MapPin size={15}/><span><strong>{result.name}</strong><small>{result.label}</small></span></button>)}</div>
      </div>}
    </div>
  </form></Form>
    <div className="pz-address-credit" data-testid="text-search-attribution"><a href="https://www.geoapify.com/" target="_blank" rel="noreferrer" data-testid="link-geocoding-provider">Geoapify</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" data-testid="link-search-attribution">OpenStreetMap</a></div>
  </>;
}