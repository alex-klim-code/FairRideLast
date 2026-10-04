import { discountFor, isDiscountId, type DiscountId, type FareQuote, type FareTransport } from './fare-policy';
import type { PassengerRide } from './passenger-ride';

export interface PassengerProfile {
  firstName: string; lastName: string; email: string; phone: string;
  photo: string | null; discountId: DiscountId;
}
export type RefillMethod = 'blik' | 'google_pay' | 'apple_pay';
export interface WalletTransaction {
  id: string; kind: 'refill' | 'ticket' | 'ride'; amountCents: number; createdAt: string;
  method?: RefillMethod; ticketId?: string; rideId?: string;
}
export interface FairRideTicket {
  id: string; purchasedAt: string; validUntil: string; status: 'active' | 'ended';
  endedAt?: string; originName: string; destinationName: string;
  transports: FareTransport[]; boardings: number; amountCents: number; baseCents: number;
  discountId: DiscountId; discountPercent: number;
}
export interface PassengerAccount {
  version: 1; userId: string; profile: PassengerProfile; balanceCents: number;
  transactions: WalletTransaction[]; tickets: FairRideTicket[]; rides: PassengerRide[];
}
export interface AccountStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export class AccountError extends Error {}
export const accountKey = (userId: string) => `fairride-passenger-v1:${encodeURIComponent(userId)}`;
export const moneyText = (cents: number) => new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(cents / 100);
const centsValid = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const methods: RefillMethod[] = ['blik', 'google_pay', 'apple_pay'];
const modes: FareTransport[] = ['BUS', 'TRAM', 'TRAIN', 'METRO', 'OTHER'];
const dateValid = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function validateProfile(input: PassengerProfile): PassengerProfile {
  if (!input || typeof input !== 'object') throw new AccountError('Niepoprawne dane profilu.');
  const text = (value: string, max: number) => {
    if (typeof value !== 'string' || value.trim().length > max) throw new AccountError('Sprawdź długość danych profilu.');
    return value.trim();
  };
  const firstName = text(input.firstName, 60), lastName = text(input.lastName, 80);
  const email = text(input.email, 160), phone = text(input.phone, 30);
  if (!firstName || !lastName) throw new AccountError('Podaj imię i nazwisko.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccountError('Podaj poprawny adres e-mail.');
  if (phone && !/^[+\d\s()-]{7,30}$/.test(phone)) throw new AccountError('Podaj poprawny numer telefonu.');
  if (!isDiscountId(input.discountId)) throw new AccountError('Wybierz poprawną ulgę.');
  if (input.photo !== null && (typeof input.photo !== 'string' || input.photo.length > 400000 ||
    !/^data:image\/(?:jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(input.photo))) {
    throw new AccountError('Zdjęcie musi być małym plikiem JPG, PNG lub WebP.');
  }
  return { firstName, lastName, email, phone, photo: input.photo, discountId: input.discountId };
}
export function createAccount(user: { id: string; firstName: string; lastName: string; email: string; phone: string }): PassengerAccount {
  return { version: 1, userId: user.id, balanceCents: 0, transactions: [], tickets: [], rides: [],
    profile: validateProfile({ firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone, photo: null, discountId: 'normal' }) };
}
function validateAccount(value: PassengerAccount, userId: string): PassengerAccount {
  const bad = () => { throw new AccountError('Nie można odczytać zapisanego portfela. Nie nadpisaliśmy danych ani salda.'); };
  if (!value || value.version !== 1 || value.userId !== userId || !centsValid(value.balanceCents) ||
    !Array.isArray(value.transactions) || !Array.isArray(value.tickets)) return bad();
  const profile = validateProfile(value.profile);
  const ids = new Set<string>();
  for (const tx of value.transactions) {
    if (!tx || typeof tx.id !== 'string' || ids.has(tx.id) || !dateValid(tx.createdAt) || !centsValid(tx.amountCents) ||
      !['refill', 'ticket', 'ride'].includes(tx.kind) || (tx.kind === 'refill' && !methods.includes(tx.method!))) return bad();
    ids.add(tx.id);
  }
  const balance = value.transactions.reduce((sum, tx) => sum + (tx.kind === 'refill' ? tx.amountCents : -tx.amountCents), 0);
  if (balance !== value.balanceCents) return bad();
  ids.clear();
  for (const ticket of value.tickets) {
    if (!ticket || typeof ticket.id !== 'string' || ids.has(ticket.id) || !dateValid(ticket.purchasedAt) || !dateValid(ticket.validUntil) ||
      !['active', 'ended'].includes(ticket.status) || !centsValid(ticket.amountCents) || !centsValid(ticket.baseCents) ||
      !isDiscountId(ticket.discountId) || ![0, 50, 100].includes(ticket.discountPercent) ||
      typeof ticket.originName !== 'string' || typeof ticket.destinationName !== 'string' ||
      !Array.isArray(ticket.transports) || !ticket.transports.every(type => modes.includes(type)) ||
      !Number.isSafeInteger(ticket.boardings) || ticket.boardings < 1 ||
      !value.transactions.some(tx => tx.kind === 'ticket' && tx.ticketId === ticket.id && tx.amountCents === ticket.amountCents)) return bad();
    ids.add(ticket.id);
  }
  // Older wallets keep all balances, transactions and archived tickets.
  const rides = value.rides === undefined ? [] : value.rides;
  if (!Array.isArray(rides)) return bad();
  ids.clear();
  const fixValid = (p: PassengerRide['lastFix']) => p === null || !!p &&
    [p.lat, p.lng, p.accuracy, p.timestamp].every(Number.isFinite) &&
    Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && p.accuracy >= 0 && p.timestamp > 0;
  for (const r of rides) {
    if (!r || typeof r.id !== 'string' || !r.id || r.id.length > 100 || ids.has(r.id) ||
      !modes.includes(r.transport) || !['active', 'completed'].includes(r.status) ||
      !dateValid(r.startedAt) || !isDiscountId(r.discountId) || ![0, 50, 100].includes(r.discountPercent) ||
      ![r.lineName, r.originName, r.destinationName].every(s => typeof s === 'string' && s.trim().length > 0 && s.length <= 160) ||
      [r.transportName, r.lineNumber].some(s => s !== undefined && (typeof s !== 'string' || !s.trim() || s.length > 160)) ||
      r.scheduledDepartureTime !== undefined && !dateValid(r.scheduledDepartureTime) ||
      !Number.isFinite(r.distanceMeters) || r.distanceMeters < 0 || r.distanceMeters > 100000000 ||
      ![r.rateCentsPerKm, r.startFeeCents, r.baseCents, r.amountCents].every(centsValid) ||
      r.baseCents !== Math.round(r.startFeeCents + r.distanceMeters / 1000 * r.rateCentsPerKm) ||
      r.amountCents !== Math.round(r.baseCents * (100 - r.discountPercent) / 100) ||
      typeof r.settled !== 'boolean' || typeof r.trackingWarning !== 'string' || r.trackingWarning.length > 240 ||
      !Number.isSafeInteger(r.samples) || r.samples < 1 || !Number.isSafeInteger(r.gapCount) || r.gapCount < 0 ||
      !fixValid(r.lastFix) || !fixValid(r.anchorFix)) return bad();
    if (r.status === 'active' && (r.settled || r.endedAt !== undefined)) return bad();
    if (r.status === 'completed' && (!dateValid(r.endedAt) || Date.parse(r.endedAt!) < Date.parse(r.startedAt) || r.lastFix || r.anchorFix)) return bad();
    const payments = value.transactions.filter(t => t.kind === 'ride' && t.rideId === r.id);
    if (r.settled ? payments.length !== 1 || payments[0].amountCents !== r.amountCents : payments.length !== 0) return bad();
    ids.add(r.id);
  }
  if (rides.filter(r => r.status === 'active').length > 1 ||
    value.transactions.some(t => t.kind === 'ride' && !rides.some(r => r.id === t.rideId && r.settled))) return bad();
  return { ...value, profile, rides };
}
export function readAccount(storage: AccountStorage, user: Parameters<typeof createAccount>[0]): PassengerAccount {
  let raw;
  try { raw = storage.getItem(accountKey(user.id)); } catch { throw new AccountError('Przeglądarka blokuje zapis portfela. Sprawdź ustawienia pamięci.'); }
  if (raw === null) return createAccount(user);
  try { return validateAccount(JSON.parse(raw), user.id); }
  catch (error) { if (error instanceof AccountError) throw error; throw new AccountError('Zapisany portfel jest uszkodzony. Nie nadpisaliśmy danych.'); }
}
export function saveAccount(storage: AccountStorage, account: PassengerAccount) {
  validateAccount(account, account.userId);
  try { storage.setItem(accountKey(account.userId), JSON.stringify(account)); }
  catch { throw new AccountError('Nie udało się zapisać operacji w tej przeglądarce. Saldo i bilet nie zostały zmienione.'); }
}
export function parseRefillAmount(value: string): number {
  if (!/^\d{1,4}(?:[.,]\d{1,2})?$/.test(value.trim())) throw new AccountError('Podaj kwotę z maksymalnie dwoma miejscami po przecinku.');
  const cents = Math.round(Number(value.trim().replace(',', '.')) * 100);
  if (!centsValid(cents) || cents < 100 || cents > 200000) throw new AccountError('Wybierz kwotę od 1 do 2000 zł.');
  return cents;
}
export function refillAccount(account: PassengerAccount, amountCents: number, method: RefillMethod, operationId: string, now = new Date()): PassengerAccount {
  if (!operationId || !methods.includes(method) || !centsValid(amountCents) || amountCents < 100 || amountCents > 200000) throw new AccountError('Niepoprawne doładowanie.');
  if (account.transactions.some(tx => tx.id === operationId)) return account;
  if (!Number.isSafeInteger(account.balanceCents + amountCents)) throw new AccountError('Przekroczono limit salda.');
  return { ...account, balanceCents: account.balanceCents + amountCents,
    transactions: [{ id: operationId, kind: 'refill', amountCents, method, createdAt: now.toISOString() }, ...account.transactions] };
}
export const getActiveTicket = (account: PassengerAccount, now = Date.now()) =>
  account.tickets.find(ticket => ticket.status === 'active' && Date.parse(ticket.validUntil) > now) ?? null;
export function purchaseTicket(account: PassengerAccount, quote: FareQuote, originName: string, destinationName: string, operationId: string, now = new Date()): PassengerAccount {
  if (!operationId || typeof originName !== 'string' || typeof destinationName !== 'string' || !destinationName.trim()) throw new AccountError('Niepoprawne dane zakupu biletu.');
  if (account.transactions.some(tx => tx.id === operationId)) return account;
  if (getActiveTicket(account, now.getTime())) throw new AccountError('Masz już aktywny bilet. Zobacz go w zakładce Bilet.');
  if (!quote.legs.length) throw new AccountError('Na trasę wyłącznie pieszą nie potrzebujesz biletu.');
  if (!centsValid(quote.totalCents) || !centsValid(quote.baseCents) || quote.totalCents > quote.baseCents ||
    !isDiscountId(quote.discountId) || discountFor(quote.discountId).percent !== quote.discountPercent ||
    !quote.legs.every(leg => modes.includes(leg.transport))) throw new AccountError('Niepoprawna wycena biletu.');
  if (account.balanceCents < quote.totalCents) throw new AccountError('Za mało środków. Doładuj portfel w Bills.');
  const ticket: FairRideTicket = {
    id: `FR-${operationId}`, purchasedAt: now.toISOString(), validUntil: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    status: 'active', originName: originName.trim().slice(0, 160), destinationName: destinationName.trim().slice(0, 160),
    transports: [...new Set(quote.legs.map(leg => leg.transport))], boardings: quote.legs.length,
    amountCents: quote.totalCents, baseCents: quote.baseCents, discountId: quote.discountId, discountPercent: quote.discountPercent,
  };
  return { ...account, balanceCents: account.balanceCents - quote.totalCents, tickets: [ticket, ...account.tickets],
    transactions: [{ id: operationId, kind: 'ticket', amountCents: quote.totalCents, ticketId: ticket.id, createdAt: now.toISOString() }, ...account.transactions] };
}
export function endTicket(account: PassengerAccount, ticketId: string, now = new Date()): PassengerAccount {
  if (!account.tickets.some(ticket => ticket.id === ticketId && ticket.status === 'active')) throw new AccountError('Ten bilet nie jest aktywny.');
  return { ...account, tickets: account.tickets.map(ticket => ticket.id === ticketId ? { ...ticket, status: 'ended', endedAt: now.toISOString() } : ticket) };
}