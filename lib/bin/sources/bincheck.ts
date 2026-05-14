import { request } from 'undici'
import type { BinInfo } from '../types'

/**
 * bincheck.io — DataTables-style API used by their /bin-search page.
 *
 *   GET https://bincheck.io/api/v1.5/fectch?<DataTables params>
 *
 * Discovered selectors (verified live 2026-05-14):
 *   columns: BIN, card_brand, card_type, card_level, country_name, issuer_name
 *   filters: filter_brand, filter_country (alpha-2 lowercased), filter_type,
 *            filter_level, filter_issuer, search[value]
 *   pagination: start, length (max 100 in the UI)
 *
 * Response shape:
 *   {
 *     draw: 1,
 *     recordsTotal: <int>,
 *     recordsFiltered: <int>,
 *     data: [{ BIN, country_name, card_brand, card_type, card_level,
 *              issuer_name, country_code2 }]
 *   }
 *
 * For BIN-detail (single-card view) bincheck.io renders /details/<bin> as
 * server-side HTML — those rows are scraped separately by the scraper
 * source. This file is the structured search/list endpoint used both for
 * filter-driven discovery and for cheap "what bank/scheme is this BIN?"
 * lookups when only the BIN is known.
 *
 * Cloudflare protects the host with passive challenges. Direct calls
 * without an established session cookie are rejected with HTML 403. We
 * warm a cookie jar by GETting /bin-search first, then replay the API
 * request with those cookies attached. The jar is reused for the
 * lifetime of the module (15 min TTL) to avoid re-warming on every call.
 */

export type BincheckSearchOptions = {
  /** filter_country — alpha-2, lowercased ("us", "id"). */
  countryAlpha2?: string
  /** filter_brand — uppercased ("VISA", "MASTERCARD", "CHINA UNION PAY"). */
  brand?: string
  /** filter_type — uppercased ("CREDIT", "DEBIT"). */
  type?: string
  /** filter_level — uppercased ("CLASSIC", "PLATINUM", …). */
  level?: string
  /** filter_issuer — exact bank name as the API returns it. */
  issuer?: string
  /** Substring search across all columns. */
  search?: string
  /** Pagination: 0-based row offset. */
  start?: number
  /** Pagination: page size (1..100). */
  length?: number
  /** Per-request timeout (ms). Default 12000. */
  timeoutMs?: number
  /** Override base URL for self-hosted mirrors. */
  baseUrl?: string
  /** Optional HTTP proxy (set via HTTPS_PROXY env). Read here for log only. */
  log?: (msg: string) => void
}

export type BincheckSearchRow = {
  BIN: number | string
  country_name: string
  card_brand: string
  card_type: string
  card_level: string
  issuer_name: string
  country_code2: string
}

export type BincheckSearchResult =
  | {
      ok: true
      total: number
      filtered: number
      rows: BinInfo[]
    }
  | { ok: false; reason: 'rate_limited' | 'forbidden' | 'error'; detail?: string }

const DEFAULT_BASE = 'https://bincheck.io'

type CookieJar = { cookies: Record<string, string>; warmedAt: number }
const WARM_TTL_MS = 15 * 60 * 1000
const jarsByBase = new Map<string, CookieJar>()

function parseSetCookies(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const raw = headers['set-cookie']
  if (!raw) return {}
  const list = Array.isArray(raw) ? raw : [raw]
  const out: Record<string, string> = {}
  for (const line of list) {
    const m = /^([^=]+)=([^;]*)/.exec(line)
    if (m) out[m[1].trim()] = m[2].trim()
  }
  return out
}

function jarToHeader(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

async function warmJar(baseUrl: string, timeoutMs: number, log: (m: string) => void): Promise<Record<string, string>> {
  const cached = jarsByBase.get(baseUrl)
  if (cached && Date.now() - cached.warmedAt < WARM_TTL_MS) return cached.cookies
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await request(`${baseUrl}/bin-search`, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: ac.signal
    })
    const cookies = parseSetCookies(res.headers as any)
    // Drain body so the connection can be reused.
    await res.body.text().catch(() => '')
    jarsByBase.set(baseUrl, { cookies, warmedAt: Date.now() })
    if (Object.keys(cookies).length === 0) {
      log('[bincheck] warm: no cookies issued (CF may still 403)')
    }
    return cookies
  } finally {
    clearTimeout(t)
  }
}

function buildQuery(opts: BincheckSearchOptions): string {
  const COLS = ['BIN', 'card_brand', 'card_type', 'card_level', 'country_name', 'issuer_name']
  const p = new URLSearchParams()
  p.set('draw', '1')
  COLS.forEach((name, i) => {
    p.set(`columns[${i}][data]`, name)
    p.set(`columns[${i}][name]`, name)
    p.set(`columns[${i}][searchable]`, 'true')
    p.set(`columns[${i}][orderable]`, 'true')
    p.set(`columns[${i}][search][value]`, '')
    p.set(`columns[${i}][search][regex]`, 'false')
  })
  p.set('start', String(opts.start ?? 0))
  p.set('length', String(Math.min(100, Math.max(1, opts.length ?? 25))))
  p.set('search[value]', opts.search ?? '')
  p.set('search[regex]', 'false')
  p.set('filter_brand', (opts.brand ?? '').toUpperCase())
  p.set('filter_country', (opts.countryAlpha2 ?? '').toLowerCase())
  p.set('filter_type', (opts.type ?? '').toUpperCase())
  p.set('filter_level', (opts.level ?? '').toUpperCase())
  p.set('filter_issuer', opts.issuer ?? '')
  p.set('_', String(Date.now()))
  return p.toString()
}

function rowToBinInfo(r: BincheckSearchRow): BinInfo {
  const bin = String(r.BIN).replace(/\D+/g, '')
  return {
    bin,
    source: 'bincheck',
    fetchedAt: Date.now(),
    scheme: r.card_brand?.toLowerCase().replace(/\s+/g, '-') || undefined,
    type: r.card_type?.toLowerCase() || undefined,
    brand: r.card_level && r.card_brand ? `${r.card_brand} ${r.card_level}`.trim() : undefined,
    country: r.country_code2
      ? {
          alpha2: r.country_code2.toUpperCase(),
          name: r.country_name
        }
      : undefined,
    bank: r.issuer_name ? { name: r.issuer_name } : undefined,
    raw: r
  }
}

export async function searchBincheck(
  opts: BincheckSearchOptions = {}
): Promise<BincheckSearchResult> {
  const log = opts.log ?? (() => {})
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '')
  const url = `${baseUrl}/api/v1.5/fectch?${buildQuery(opts)}`
  const timeoutMs = opts.timeoutMs ?? 12_000

  const jar = await warmJar(baseUrl, timeoutMs, log).catch(() => ({}))
  const headers: Record<string, string> = {
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    Referer: `${baseUrl}/bin-search`,
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  }
  if (Object.keys(jar).length > 0) headers.Cookie = jarToHeader(jar)

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await request(url, { method: 'GET', headers, signal: ac.signal })
    clearTimeout(timer)
    if (res.statusCode === 429) {
      return { ok: false, reason: 'rate_limited' }
    }
    if (res.statusCode === 403) {
      log(`[bincheck] 403 — cloudflare challenge active`)
      // Drop cached jar so the next call re-warms.
      jarsByBase.delete(baseUrl)
      return { ok: false, reason: 'forbidden' }
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return { ok: false, reason: 'error', detail: `HTTP ${res.statusCode}` }
    }
    const ct = String((res.headers as any)['content-type'] ?? '')
    if (!ct.includes('json')) {
      // CF interstitial returns HTML even on 200 sometimes — refuse to parse.
      jarsByBase.delete(baseUrl)
      return { ok: false, reason: 'forbidden', detail: 'non-json response' }
    }
    const json = (await res.body.json()) as {
      draw?: number
      recordsTotal?: number
      recordsFiltered?: number
      data?: BincheckSearchRow[]
    }
    const rows = (json.data ?? []).map(rowToBinInfo)
    return {
      ok: true,
      total: json.recordsTotal ?? rows.length,
      filtered: json.recordsFiltered ?? rows.length,
      rows
    }
  } catch (e) {
    clearTimeout(timer)
    return {
      ok: false,
      reason: 'error',
      detail: `network: ${e instanceof Error ? e.message : String(e)}`
    }
  }
}

/** Single-BIN lookup against the search endpoint. Returns the first match
 *  (bincheck stores 1 canonical row per BIN). Falls back to {ok:false}. */
export async function lookupBincheck(
  bin: string,
  opts: Omit<BincheckSearchOptions, 'search' | 'start' | 'length'> = {}
): Promise<BincheckSearchResult> {
  const cleaned = bin.replace(/\D+/g, '')
  if (cleaned.length < 6 || cleaned.length > 8) {
    return { ok: false, reason: 'error', detail: 'bin must be 6–8 digits' }
  }
  return searchBincheck({ ...opts, search: cleaned, start: 0, length: 1 })
}
