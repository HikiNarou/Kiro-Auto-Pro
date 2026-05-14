# kiro-auto

Bulk register + upgrade [Kiro IDE](https://kiro.dev) accounts. GSuite → Google OAuth register → Stripe checkout → Pro.

Stealth browser via Camoufox (Firefox) atau Chromium + playwright-extra stealth.

## Fitur

- **Register** akun Kiro bulk via Google OAuth di `app.kiro.dev/signin`
- **Upgrade to Pro** otomatis: hydrate session → klik Upgrade → fill Stripe checkout → verify Pro
- VCC pool dengan Luhn validation, per-card use-state, multi-attempt on decline
- Auth mode `hydrate_or_login` — pakai cookies dulu, fallback ke fresh Google login kalau expired
- 3DS handling: auto-flip headless → headed, pause for manual, atau fail
- Anti-bot: camoufox fingerprint patches, humanize mouse, geoip resolve, stealth plugin

## Requirements

- Node.js 20+
- Akun GSuite (`email:password` per line)
- Camoufox auto-download di first run (~170MB)

## Quick start

```powershell
git clone <repo> kiro-auto
cd kiro-auto
npm install
npm run install-browser

# 1. Isi accounts
cp accounts/gsuite.example.txt accounts/gsuite.txt
# edit → email:password per line

cp accounts/vcc.example.json accounts/vcc.json
# edit → isi VCC asli

# 2. Register
npm run register -- --count 5 -y

# 3. Upgrade ke Pro
npm run upgrade -- --count 5 -y
```

## Commands

| Command | Fungsi |
|---------|--------|
| `npm run register` | Bulk register akun Kiro via Google OAuth |
| `npm run upgrade` | Upgrade akun ke Pro via Stripe checkout |
| `npm run bin` | BIN search / finder / generator (multi-source) |
| `npm run switch` | Legacy aor* token switcher |
| `npm run typecheck` | TypeScript check |

Tanpa flag → interactive menu. Dengan flag + `-y` → non-interactive.

### Register flags

```
--count 5 --concurrency 2 --proxy http://user:pass@host:port
--engine camoufox|chromium-stealth|chromium-vanilla
--headed --no-humanize --no-geoip
```

### Upgrade flags

```
--count 5 --auth-mode hydrate_or_login|google_login|hydrate
--on3ds auto_flip|pause|fail --3ds-timeout-s 300
--max-vcc-attempts 3 --headed
--only alice@x.com,bob@x.com
--session-file show/sessions/alice.123.json
```

## File layout

```
accounts/
├── gsuite.txt              # email:password per line (gitignored)
├── gsuite.state.json       # per-account register state
├── vcc.json                # VCC pool (gitignored)
└── vcc.state.json          # per-VCC use-state

show/
├── sessions/               # captured Kiro sessions per account
├── results.json            # register records
├── upgrade-results.json    # upgrade records
├── upgrade-state.json      # per-account upgrade state
└── diagnostics/            # failure dumps (screenshot + HTML + buttons)
```

## VCC format

`accounts/vcc.json` — array of cards:

```json
[
  {
    "number": "4242 4242 4242 4242",
    "expMonth": 12,
    "expYear": 2029,
    "cvc": "123",
    "billing": {
      "name": "Jane Doe",
      "country": "US",
      "line1": "1600 Amphitheatre Parkway",
      "city": "Mountain View",
      "state": "CA",
      "postalCode": "94043"
    }
  }
]
```

Accept: `expiry: "MM/YY"` instead of expMonth+expYear. `country` wajib ISO alpha-2 (`US`, `ID`, `GB`). Luhn-invalid cards ditolak saat load.

## Auth modes

| Mode | Behavior |
|------|----------|
| `hydrate` | Pakai session JSON only. Fastest, fragile. |
| `google_login` | Fresh OAuth every run. Robust, slower. |
| `hydrate_or_login` (default) | Hydrate first, fallback ke Google login kalau expired. |

## 3DS handling

Issuer Indonesia hampir selalu trigger 3DS. Default `--on3ds auto_flip` → close headless browser, relaunch headed, retry flow. `pause` → tunggu user selesaikan 3DS manual. `fail` → skip akun.

## Failure modes

Per-akun di `show/results.json` / `show/upgrade-results.json`:

- `google_button_not_found` — DOM berubah, update selector
- `challenge_required` — Google 2FA / device verify
- `captcha_required` — butuh residential IP
- `bot_detection` — fingerprint/IP flagged
- `upgrade_button_not_found` — check `show/diagnostics/` dump
- `stripe_declined` / `stripe_validation` — VCC issue
- `threeds_required_headless` — pakai `--on3ds auto_flip` atau `--headed`

## Troubleshooting

Upgrade fail silent? Check `show/diagnostics/<email>.<reason>.<ts>.{png,html,buttons.json}` — screenshot + full HTML + visible button inventory saat fail.

Akun sudah Pro tapi state bilang failed? Run `npm run upgrade` lagi — Pro badge detection via `aria-label="Current plan: KIRO PRO"` auto-detect and skip.

Reset state: delete `accounts/*.state.json` atau `show/upgrade-state.json`.

## Disclaimer

For personal automation of accounts you own. Patuhi Google Workspace TOS, Kiro TOS, dan hukum lokal.

## BIN Search / Finder / Generator

Multi-source BIN tool — `npm run bin` (interactive) atau subcommands:

```powershell
npm run bin                                                  # interactive menu
npm run bin -- lookup --bin 418832                           # multi-source lookup
npm run bin -- search --country us --scheme visa --type credit --limit 25
npm run bin -- cascade --country "United States" --scheme VISA --bank "1ST SOURCE BANK"
npm run bin -- generate --bin 418832 --count 10
npm run bin -- generate --bin 418832 --count 5 --billing accounts/billing.json --append accounts/vcc.json
npm run bin -- refresh-db
```

### Sources (priority order, earlier wins on merge)

| Source | Type | Notes |
|--------|------|-------|
| `cache` | offline | `show/bin-cache.json`, 30-day TTL |
| `local-db` | offline | iannuttall/binlist-data, ~343k BIN, auto-bootstrap on first run |
| `binlist` | HTTP API | `lookup.binlist.net`, free, 5/h rate limit |
| `bincheck` | HTTP API | `bincheck.io/api/v1.5/fectch` (DataTables), CF-warmed cookie jar |
| `bincheck-details` | HTML scrape | `bincheck.io/details/<bin>`, no captcha |
| `vccgenerator` | HTTP API | `/fetchdata/get-binsearch-params/` + `/get-bin-info/`, CSRF-aware |
| `bincodes` | stealth-browser | `bincodes.com/bin-checker/`, captcha+camoufox; opt-in via `--enable-scrapers` |

### Common flags

```
--json                emit machine-readable JSON
--enable-scrapers     allow heavy browser-based sources (bincodes)
--proxy <url>         outbound HTTP/SOCKS proxy
--sources a,b,c       restrict source priority list
--cache <path>        cache file (default show/bin-cache.json)
--local-db <path>     local BIN dataset (default accounts/bin-database.json)
--limit N             search result cap (default 50)
```

### Generator → VCC pool

`generate` produces Luhn-valid PANs from a BIN prefix and writes them straight into the VCC pool the upgrade flow consumes — no manual JSON editing required.

Default behavior (zero flags beyond `--bin` + `--count`):

- Cards are appended to `accounts/vcc.json` (the pool `npm run upgrade` reads).
- Each card gets a fresh randomized billing block from the country preset table, keyed off the BIN's issuer country. Indonesia BINs get Indonesian names + Jakarta/Surabaya/Bandung addresses; US BINs get US names + state/postcode pairs; etc.
- Built-in country presets: US, ID, GB, SG, MY, AU, CA, DE, FR, JP, IN, PH, TH, BR, NL. Anything else falls back to US.
- Duplicates (matching `id` OR identical PAN+expiry) are skipped automatically.

```powershell
# Auto-saves 10 cards to accounts/vcc.json with faked Indonesian billing
npm run bin -- generate --bin 447242 --count 10

# Override destination (writes a fresh file instead of appending)
npm run bin -- generate --bin 447242 --count 10 --out accounts/vcc-batch1.json

# Print only, do not touch the pool
npm run bin -- generate --bin 447242 --count 10 --no-save
```

Optional shared billing — only when every card should share one cardholder + address:

```powershell
npm run bin -- generate --bin 447242 --count 10 --billing accounts/billing.json
```

Billing template shape (only used when `--billing` is passed):

```json
{
  "name": "Cardholder Name",
  "country": "US",
  "line1": "123 Some St",
  "city": "San Francisco",
  "state": "CA",
  "postalCode": "94105"
}
```

Generated cards drop straight into `npm run upgrade` after the next run. No manual edit step.

## License

MIT
