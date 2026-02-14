#!/usr/bin/env bash
# QA Test Script for Polymarket Scanner
# Tests API, frontend, and logic of the deployed app

set -euo pipefail

BASE_URL="https://polymarket-scanner-cyan.vercel.app"
REPORT_FILE="$(dirname "$0")/latest-report.txt"

echo "========================================" | tee "$REPORT_FILE"
echo "QA Report — $(date -u '+%Y-%m-%d %H:%M:%S UTC')" | tee -a "$REPORT_FILE"
echo "========================================" | tee -a "$REPORT_FILE"

echo "" | tee -a "$REPORT_FILE"
echo "--- API Tests ---" | tee -a "$REPORT_FILE"

# Test /api/markets
curl -s "$BASE_URL/api/markets" | python3 -c "
import json, sys
data = json.load(sys.stdin)
markets = data.get('markets', [])
prices = data.get('livePrices', {})
issues = []

if len(markets) < 20:
    issues.append(f'LOW MARKET COUNT: Only {len(markets)} markets (expected 100+)')

if not prices:
    issues.append('NO LIVE PRICES: livePrices object is empty')
else:
    for asset in ['btc', 'eth']:
        if asset not in prices and 'bitcoin' not in str(prices).lower():
            issues.append(f'MISSING PRICE: {asset} not in live prices')

for m in markets:
    q = m.get('question', '')
    price = 0.5
    try:
        price = float(json.loads(m.get('outcomePrices', '[\"0.5\"]'))[0])
    except: pass
    if 'february 11' in q.lower() or 'february 12' in q.lower():
        if price > 0.1 and price < 0.9:
            issues.append(f'STALE MARKET: \"{q[:60]}\" has past date but mid-range price {price:.2f}')

news_count = sum(1 for m in markets if m.get('news'))
if news_count == 0:
    issues.append('NO NEWS DATA: No markets have news attached')
elif news_count < 10:
    issues.append(f'LOW NEWS: Only {news_count} markets have news (expected 30+)')

if issues:
    print('ISSUES FOUND:')
    for i in issues:
        print(f'  ❌ {i}')
else:
    print('✅ API tests passed')
print(f'Stats: {len(markets)} markets, {news_count} with news, {len(prices)} live prices')
" 2>&1 | tee -a "$REPORT_FILE"

# Test /api/prices
curl -s "$BASE_URL/api/prices" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    issues = []
    if 'error' in data:
        issues.append(f'PRICE API ERROR: {data[\"error\"]}')
    if not data:
        issues.append('EMPTY PRICE RESPONSE')
    if issues:
        for i in issues:
            print(f'  ❌ {i}')
    else:
        print(f'✅ Price API OK: {json.dumps(data)[:200]}')
except Exception as e:
    print(f'  ❌ PRICE API PARSE ERROR: {e}')
" 2>&1 | tee -a "$REPORT_FILE"

echo "" | tee -a "$REPORT_FILE"
echo "--- Frontend Tests ---" | tee -a "$REPORT_FILE"

HTML=$(curl -s "$BASE_URL/")
echo "$HTML" | python3 -c "
import sys, re
from collections import Counter
html = sys.stdin.read()
issues = []

checks = [
    ('autoTrader', 'Auto-trader function'),
    ('fetchMarkets', 'Market fetcher'),
    ('renderPortfolio', 'Portfolio renderer'),
    ('Top 10', 'Top 10 section'),
    ('Mock Portfolio', 'Portfolio tab'),
]
for term, label in checks:
    if term not in html:
        issues.append(f'MISSING: {label} ({term}) not found in HTML')

funcs = re.findall(r'function\s+(\w+)\s*\(', html)
dupes = {k: v for k, v in Counter(funcs).items() if v > 1}
if dupes:
    issues.append(f'DUPLICATE FUNCTIONS: {dupes}')

if html.count('{') != html.count('}'):
    diff = html.count('{') - html.count('}')
    issues.append(f'BRACE MISMATCH: {diff} more {{ than }}')

if issues:
    print('FRONTEND ISSUES:')
    for i in issues:
        print(f'  ❌ {i}')
else:
    print('✅ Frontend structure OK')
" 2>&1 | tee -a "$REPORT_FILE"

echo "" | tee -a "$REPORT_FILE"
echo "--- Logic Tests ---" | tee -a "$REPORT_FILE"

curl -s "$BASE_URL/api/markets" | python3 -c "
import json, sys
from datetime import datetime, timezone

data = json.load(sys.stdin)
markets = data.get('markets', [])
issues = []
now = datetime.now(timezone.utc)

for m in markets:
    q = m.get('question', '')
    try:
        price = float(json.loads(m.get('outcomePrices', '[\"0.5\"]'))[0])
    except: continue
    end = m.get('endDate', '')
    if end:
        try:
            end_dt = datetime.fromisoformat(end.replace('Z', '+00:00'))
            if end_dt < now and m.get('active') and not m.get('closed'):
                if price > 0.2 and price < 0.8:
                    issues.append(f'EXPIRED+ACTIVE: \"{q[:50]}\" ended {end} but price is {price:.2f}')
        except: pass

if issues:
    print(f'LOGIC ISSUES ({len(issues)}):')
    for i in issues[:10]:
        print(f'  ❌ {i}')
else:
    print('✅ Logic tests passed')
" 2>&1 | tee -a "$REPORT_FILE"

echo "" | tee -a "$REPORT_FILE"
echo "========================================" | tee -a "$REPORT_FILE"
echo "Done." | tee -a "$REPORT_FILE"
