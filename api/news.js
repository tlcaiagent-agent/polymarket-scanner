export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'Missing q parameter' });

  try {
    const searchTerms = extractSearchTerms(q);
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(searchTerms)}&hl=en-US&gl=US&ceid=US:en`;
    const r = await fetch(rssUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PolymarketScanner/1.0)' }
    });
    if (!r.ok) return res.status(502).json({ error: 'Failed to fetch news' });

    const xml = await r.text();
    const items = parseRssItems(xml).slice(0, 5);
    res.status(200).json({ query: searchTerms, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function extractSearchTerms(question) {
  // Remove common prediction market phrasing
  let q = question
    .replace(/^will\s+/i, '')
    .replace(/\?$/g, '')
    .replace(/\bby\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(,?\s*\d{4})?\b/gi, '')
    .replace(/\bin\s+(january|february|march|april|may|june|july|august|september|october|november|december)(\s+\d{4})?\b/gi, '')
    .replace(/\bafter the\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\s+meeting\b/gi, '')
    .replace(/\b(reach|hit|close above|end above|end up on)\b/gi, '')
    .replace(/\b(before|after|by|on)\s+\d{1,2}\/\d{1,2}\b/gi, '')
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, '')
    .replace(/\$[\d,.]+/g, match => match) // keep dollar amounts
    .trim();

  // Expand common abbreviations
  q = q.replace(/\bS&P\b/g, 'S&P 500');
  q = q.replace(/\bETH\b/g, 'Ethereum');
  q = q.replace(/\bBTC\b/g, 'Bitcoin');
  q = q.replace(/\bFed\b/g, 'Federal Reserve');

  // Trim to reasonable length
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
