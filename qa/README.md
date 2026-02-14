# Polymarket Scanner QA

Automated QA tests for the deployed scanner at https://polymarket-scanner-cyan.vercel.app

## Usage

```bash
./qa/test-scanner.sh
```

## What it tests

1. **API Tests** — `/api/markets` returns sufficient markets with news and live prices; `/api/prices` responds correctly
2. **Frontend Tests** — HTML contains expected functions/sections, no duplicate function definitions or brace mismatches
3. **Logic Tests** — No expired-but-active markets with mid-range prices (indicating stale data)

## Output

Results are printed to stdout and saved to `qa/latest-report.txt` with a UTC timestamp.
