import { fetchPrices } from './prices.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  
  try {
    const [pages, livePrices] = await Promise.all([
      Promise.all([fetchPage(0, 100), fetchPage(100, 100), fetchPage(200, 100)]),
      fetchPrices().catch(() => ({}))
    ]);
    const all = pages.flat();
    
    // Dedupe
    const seen = new Set();
    const markets = all.filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

    // Attach relevant live price to each market
    for (const m of markets) {
      if (!m.question) continue;
      const ql = m.question.toLowerCase();
      const relevantPrice = matchLivePrice(ql, livePrices);
      if (relevantPrice) m.relevantLivePrice = relevantPrice;
    }

    // Fetch news for top 50 markets by volume
    const topMarkets = markets
      .filter(m => m.question && m.active && !m.closed)
      .sort((a, b) => (b.volume24hr || 0) - (a.volume24hr || 0))
      .slice(0, 50);

    const queryMap = new Map();
    const marketIndexMap = new Map();
    markets.forEach((m, i) => marketIndexMap.set(m.id, i));

    for (const m of topMarkets) {
      const terms = extractSearchTerms(m.question);
      if (!queryMap.has(terms)) queryMap.set(terms, []);
      queryMap.get(terms).push(m.id);
    }

    const uniqueQueries = [...queryMap.keys()].slice(0, 25);
    const newsResults = new Map();

    const batches = [];
    for (let i = 0; i < uniqueQueries.length; i += 10) {
      batches.push(uniqueQueries.slice(i, i + 10));
    }

    for (const batch of batches) {
      const results = await Promise.allSettled(
        batch.map(async q => {
          const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
          try {
            const r = await fetch(rssUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PolymarketScanner/1.0)' },
              signal: AbortSignal.timeout(5000)
            });
            if (!r.ok) return { q, items: [] };
            const xml = await r.text();
            return { q, items: parseRssItems(xml).slice(0, 5) };
          } catch (e) {
            return { q, items: [] };
          }
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.items.length > 0) {
          newsResults.set(r.value.q, r.value.items);
        }
      }
    }

    for (const [terms, ids] of queryMap.entries()) {
      const news = newsResults.get(terms);
      if (news && news.length > 0) {
        for (const id of ids) {
          const idx = marketIndexMap.get(id);
          if (idx !== undefined) {
            markets[idx].news = news;
          }
        }
      }
    }
    
    res.status(200).json({ count: markets.length, markets, livePrices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function matchLivePrice(questionLower, prices) {
  if (!prices) return null;
  const ql = questionLower;
  if (/\bbtc\b|bitcoin/.test(ql) && prices.btc) return { asset: 'BTC', ...prices.btc };
  if (/\beth\b|ethereum/.test(ql) && prices.eth) return { asset: 'ETH', ...prices.eth };
  if (/\bsol\b|solana/.test(ql) && prices.sol) return { asset: 'SOL', ...prices.sol };
  if (/\bxrp\b|ripple/.test(ql) && prices.xrp) return { asset: 'XRP', ...prices.xrp };
  if (/\bs&p|sp500|s&p\s*500/.test(ql) && prices.sp500) return { asset: 'S&P 500', ...prices.sp500 };
  if (/\bgold\b/.test(ql) && prices.gold) return { asset: 'Gold', ...prices.gold };
  return null;
}

async function fetchPage(offset, limit) {
  const url = `https://gamma-api.polymarket.com/markets?closed=false&limit=${limit}&offset=${offset}&order=volume24hr&ascending=false`;
  try {
    const r = await fetch(url);
    if (r.ok) return await r.json();
  } catch(e) {}
  return [];
}

function extractSearchTerms(question) {
  let q = question
    .replace(/^will\s+/i, '')
    .replace(/\?$/g, '')
    .replace(/\bby\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(,?\s*\d{4})?\b/gi, '')
    .replace(/\bin\s+(january|february|march|april|may|june|july|august|september|october|november|december)(\s+\d{4})?\b/gi, '')
    .replace(/\bafter the\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\s+meeting\b/gi, '')
    .replace(/\b(reach|hit|close above|end above|end up on)\b/gi, '')
    .replace(/\b(before|after|by|on)\s+\d{1,2}\/\d{1,2}\b/gi, '')
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, '')
    .trim();
  q = q.replace(/\bS&P\b/g, 'S&P 500');
  q = q.replace(/\bETH\b/g, 'Ethereum');
  q = q.replace(/\bBTC\b/g, 'Bitcoin');
  q = q.replace(/\bFed\b/g, 'Federal Reserve');
  if (q.length > 100) q = q.substring(0, 100);
  return q;
}

function parseRssItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const pubDate = extractTag(block, 'pubDate');
    const source = extractTag(block, 'source');
    const description = extractTag(block, 'description')
      ?.replace(/<[^>]*>/g, '')?.substring(0, 200) || '';
    if (title) {
      items.push({
        title: decodeEntities(title),
        url: link || '',
        publishedAt: pubDate || '',
        source: source ? decodeEntities(source) : '',
        description: decodeEntities(description)
      });
    }
  }
  return items;
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>\\s*(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?\\s*</${tag}>`, 's'));
  return m ? m[1].trim() : null;
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
}
