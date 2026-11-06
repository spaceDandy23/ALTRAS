const oneDecimal = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
});

export function formatResearchNumber(value: number | null, fallback = 'Not available'): string {
  return value === null ? fallback : oneDecimal.format(value);
}

export function formatResearchPercent(value: number | null, fallback = 'Not available'): string {
  return value === null ? fallback : `${oneDecimal.format(value)}%`;
}

export function formatResearchPoints(value: number | null, fallback = 'Not available'): string {
  if (value === null) return fallback;
  return `${value > 0 ? '+' : ''}${oneDecimal.format(value)} pts`;
}
