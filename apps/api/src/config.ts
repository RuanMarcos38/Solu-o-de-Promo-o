const readNumber = (name: string, fallback: number) => {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readList = (name: string, fallback: string[]) => {
  const value = process.env[name];
  if (!value) return fallback;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
};

export const config = {
  apiPort: readNumber('API_PORT', 3333),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  defaultKeywords: readList('DEFAULT_KEYWORDS', ['iphone', 'smart tv', 'notebook', 'air fryer']),
  minDiscountPercent: readNumber('MIN_DISCOUNT_PERCENT', 10),
  minOpportunityScore: readNumber('MIN_OPPORTUNITY_SCORE', 55),
  maxResultsPerSource: readNumber('MAX_RESULTS_PER_SOURCE', 30),
  collectIntervalSeconds: readNumber('COLLECT_INTERVAL_SECONDS', 60),
  mercadoLivreSiteId: process.env.MERCADO_LIVRE_SITE_ID ?? 'MLB'
};
