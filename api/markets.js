export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  
  try {
    const pages = await Promise.all([
      fetchPage(0, 100),
      fetchPage(100, 100),
      fetchPage(200, 100)
    ]);
    const all = pages.flat();
    
    // Dedupe
    const seen = new Set();
    const markets = all.filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
    
    res.status(200).json({ count: markets.length, markets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function fetchPage(offset, limit) {
  const url = `https://gamma-api.polymarket.com/markets?closed=false&limit=${limit}&offset=${offset}&order=volume24hr&ascending=false`;
  try {
    const r = await fetch(url);
    if (r.ok) return await r.json();
  } catch(e) {}
  return [];
}
