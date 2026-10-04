export function transitErrorMessage(error: unknown): string {
  const failure = error as { status?: number; data?: { error?: unknown } } | null;
  const message = failure?.data?.error;
  if (typeof message === 'string' && message.trim()) return message.slice(0, 500);
  if (failure?.status === 429) return 'Limit zapytań o trasę został osiągnięty. Odczekaj i spróbuj później.';
  if (failure?.status === 503) return 'Wyznaczanie tras jest chwilowo niedostępne. Spróbuj później.';
  return 'Nie udało się pobrać połączeń. Sprawdź połączenie z internetem i spróbuj ponownie.';
}