let cache = { data: null, ts: 0 };
const CACHE_TTL = 60000; // 60 seconds

async function fetchPrices() {
  const now = Date.now();
  if (cache.data && (now - cache.ts) < CACHE_TTL) return cache.data;

  const results = {};

  // Crypto from CoinGecko
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,ripple&vs_currencies=usd&include_24hr_change=true', {
      headers: { 'User-Agent': 'PolymarketScanner/1.0' },
      signal: AbortSignal.timeout(8000)
    });
    if (r.ok) {
      const d = await r.json();
      if (d.bitcoin) results.btc = { price: d.bitcoin.usd, change24h: d.bitcoin.usd_24h_change };
      if (d.ethereum) results.eth = { price: d.ethereum.usd, change24h: d.ethereum.usd_24h_change };
      if (d.solana) results.sol = { price: d.solana.usd, change24h: d.solana.usd_24h_change };
      if (d.ripple) results.xrp = { price: d.ripple.usd, change24h: d.ripple.usd_24h_change };
    }
  } catch(e) {}

  // Gold from CoinGecko (they track it as a commodity)
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether-gold&vs_currencies=usd&include_24hr_change=true', {
      headers: { 'User-Agent': 'PolymarketScanner/1.0' },
      signal: AbortSignal.timeout(5000)
    });
    if (r.ok) {
      const d = await r.json();
      if (d['tether-gold']) results.gold = { price: d['tether-gold'].usd, change24h: d['tether-gold'].usd_24h_change };
    }
  } catch(e) {}

  // S&P 500 via Yahoo Finance
  try {
    const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=1d', {
      headers: { 'User-Agent': 'PolymarketScanner/1.0' },
      signal: AbortSignal.timeout(8000)
    });
    if (r.ok) {
      const d = await r.json();
      const meta = d?.chart?.result?.[0]?.meta;
      if (meta) {
        const price = meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose || meta.previousClose;
        const change24h = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
        const marketState = meta.currentTradingPeriod?.regular;
        const now = Math.floor(Date.now() / 1000);
        const marketOpen = marketState ? (now >= marketState.start && now <= marketState.end) : false;
        results.sp500 = { price, change24h, marketOpen };
      }
    }
  } catch(e) {}

  // Fallback: if Yahoo fails for S&P, try another approach
  if (!results.sp500) {
    try {
      const r = await fetch('https://query2.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=1d', {
        headers: { 'User-Agent': 'PolymarketScanner/1.0' },
        signal: AbortSignal.timeout(5000)
      });
      if (r.ok) {
        const d = await r.json();
        const meta = d?.chart?.result?.[0]?.meta;
        if (meta) {
          results.sp500 = {
            price: meta.regularMarketPrice,
            change24h: meta.chartPreviousClose ? ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100 : 0,
            marketOpen: false
          };
        }
      }
    } catch(e) {}
  }

  results.fetchedAt = new Date().toISOString();
  cache = { data: results, ts: now };
  return results;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

  try {
    const prices = await fetchPrices();
    res.status(200).json(prices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export { fetchPrices };
