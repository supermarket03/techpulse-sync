import yahooFinance from 'yahoo-finance2';
import { createClient } from '@supabase/supabase-js';

const SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'META', 'GOOGL'];
const DELAY_MS = 500;
const MAX_RETRIES = 3;

// Simple delay
const delay = ms => new Promise(r => setTimeout(r, ms));

// Fetch stock with retries
async function fetchStockData(symbol, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const quote = await yahooFinance.quoteSummary(symbol, {
        modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'assetProfile']
      });

      const price = quote.price ?? {};
      const detail = quote.summaryDetail ?? {};
      const stats = quote.defaultKeyStatistics ?? {};
      const profile = quote.assetProfile ?? {};

      const pe_ratio =
        stats.trailingPE ?? (stats.trailingEps && price.regularMarketPrice ? price.regularMarketPrice / stats.trailingEps : null);
      const volume_avg = detail.averageVolume ?? price.averageDailyVolume10Day ?? null;

      return {
        symbol,
        date: new Date().toISOString().split('T')[0],
        price: price.regularMarketPrice ?? null,
        market_cap: price.marketCap ?? null,
        volume_avg,
        pe_ratio,
        eps: stats.trailingEps ?? null,
        sector: profile.sector ?? null,
        industry: profile.industry ?? null,
        source: 'yahoo-finance2',
        raw_profile: profile
      };
    } catch (err) {
      console.error(`Attempt ${attempt} failed for ${symbol}:`, err.message);
      if (attempt === retries) throw err;
      await delay(DELAY_MS * attempt);
    }
  }
}

// Main handler
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const results = { processed: 0, successes: [], failures: [] };

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase env variables');

    const supabase = createClient(supabaseUrl, supabaseKey);

    for (let i = 0; i < SYMBOLS.length; i++) {
      const symbol = SYMBOLS[i];
      results.processed++;

      try {
        const stockData = await fetchStockData(symbol);
        const { error } = await supabase
          .from('daily_market_data')
          .upsert(stockData, { onConflict: 'symbol,date' });

        if (error) throw new Error(error.message);

        results.successes.push({ symbol, price: stockData.price, market_cap: stockData.market_cap });
        console.log(`✓ ${symbol} done`);

        if (i < SYMBOLS.length - 1) await delay(DELAY_MS);
      } catch (err) {
        console.error(`✗ ${symbol} failed:`, err.message);
        results.failures.push({ symbol, error: err.message });
      }
    }

    return res.status(200).json({ ...results, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Fatal error:', err);
    return res.status(500).json({ error: err.message, ...results });
  }
}