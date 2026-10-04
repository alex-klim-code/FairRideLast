type TransportType = 'BUS' | 'TRAM' | 'METRO' | 'TRAIN';

export const START_FEE = 0.50;
export const DEFAULT_RATE = 0.50;
export const rates: Record<TransportType, number> = {
  BUS: 0.40,
  TRAM: 0.50,
  METRO: 0.30,
  TRAIN: 0.50,
};

export const priceRows = [
  { name: 'Autobus', rate: rates.BUS },
  { name: 'Tramwaj', rate: rates.TRAM },
  { name: 'Metro', rate: rates.METRO },
  { name: 'Pociąg / kolej miejska', rate: rates.TRAIN },
  { name: 'Pozostałe środki transportu', rate: DEFAULT_RATE },
];

export function fare(distance: number, rate: number, startFee = START_FEE) {
  if (![distance, rate, startFee].every(value => Number.isFinite(value) && value >= 0)) {
    throw new Error('Distance, rate and start fee must be non-negative finite numbers.');
  }
  return Math.round((startFee + distance * rate) * 100) / 100;
}