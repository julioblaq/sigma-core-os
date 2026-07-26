import { listMarketNews, type MarketNewsItem } from '../news/index.js';

export interface SigmaDailyReport {
  generatedAt: string;
  headline: string;
  watchlist: Array<{ symbol: string; last: number; changePercent: number | null }>;
  news: MarketNewsItem[];
}

function symbols(value?: string | string[]): string[] {
  const items = (Array.isArray(value) ? value.join(',') : value ?? 'NVDA,TSLA,MSFT,AMZN,META').split(/[\s,]+/).map(v => v.trim().toUpperCase()).filter(Boolean);
  if (!items.length || items.some(item => !/^[A-Z0-9.-]{1,12}$/.test(item))) throw new Error('A valid watchlist is required');
  return [...new Set(items)].slice(0, 12);
}

async function quote(symbol: string) {
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=1d`);
  if (!response.ok) throw new Error(`Quote lookup failed for ${symbol}`);
  const meta = (await response.json() as any).chart?.result?.[0]?.meta;
  const last = Number(meta?.regularMarketPrice);
  const previous = Number(meta?.regularMarketPreviousClose ?? meta?.previousClose);
  if (!Number.isFinite(last)) throw new Error(`Quote lookup returned no price for ${symbol}`);
  return { symbol, last, changePercent: Number.isFinite(previous) && previous ? +(((last - previous) / previous) * 100).toFixed(2) : null };
}

export async function buildSigmaDaily(input: { watchlist?: string | string[] } = {}): Promise<SigmaDailyReport> {
  const watchlist = symbols(input.watchlist);
  const [quotes, news] = await Promise.all([Promise.all(watchlist.map(quote)), listMarketNews({ symbols: ['SPY', 'QQQ', ...watchlist.slice(0, 3)], limit: 8 })]);
  return { generatedAt: new Date().toISOString(), headline: 'Sigma Daily market research draft — review required before publication.', watchlist: quotes, news: news.items };
}
