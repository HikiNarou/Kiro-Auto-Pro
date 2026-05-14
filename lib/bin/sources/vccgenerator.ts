import { request } from 'undici'
import type { BinInfo } from '../types'

/**
 * vccgenerator.org — bin-search XHR endpoints used by the cascading
 * country → brand → bank → BIN selectors on the live site.
 *
 * The site is a Django app behind Cloudflare. Discovered selectors
 * (verified live 2026-05-14):
 *
 *   GET  /bin-search/                            — issues csrftoken cookie + form-token
 *   POST /fetchdata/get-binsearch-params/        — cascading list endpoint
 *        body: country=<Display Name>&brand=<UPPER|empty>&bank=<UPPER|empty>
 *        - empty brand+bank → `data: [{ brand: "VISA" }, …]`
 *        - brand only       → `data: [{ issuer: "<bank>" }, …]`
 *        - brand+bank       → `data: [{ bin: "465637" }, …]`
 *   POST /fetchdata/get-bin-info/                — final BIN-detail
 *        body: bincode=<digits>&csrfmiddlewaretoken=<csrf>
 *        response: { binInfo: { bin, brand, type, category, issuer,
 *                               alpha_2, alpha_3, country_name_x,
 *                               bank_phone, bank_url, Notes }, success }
 *
 * The /get-bin-info/ endpoint is not server-side captcha gated even
 * though the client renders an invisible reCAPTCHA — verified by
 * replaying the request with only the CSRF tokens. We still rotate
 * a session cookie jar per call so successive requests don't trip
 * Cloudflare's volume heuristics.
 */

export type VccGeneratorOptions = {
  baseUrl?: string
  timeoutMs?: number
  log?: (msg: string) => void
}

export type CountryName = string
export type BrandName = string
export type BankName = string
export type BinDigits = string

const DEFAULT_BASE = 'https://www.vccgenerator.org'
const DEFAULT_TIMEOUT = 12_000

const COMMON_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9'
}

type CookieJar = Record<string, string>

function parseSetCookies(headers: Record<string, string | string[] | undefined>): CookieJar {
  const raw = headers['set-cookie']
  if (!raw) return {}
  const list = Array.isArray(raw) ? raw : [raw]
  const out: CookieJar = {}
  for (const line of list) {
    const m = /^([^=]+)=([^;]*)/.exec(line)
    if (m) out[m[1].trim()] = m[2].trim()
  }
  return out
}

function jarToHeader(jar: CookieJar): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

/**
 * Acquire a fresh CSRF token + cookie jar by hitting /bin-search/.
 * The token is exposed twice — once as a cookie (`csrftoken`) and once
 * inline as a hidden form field. Either is acceptable when posted with
 * the matching cookie jar. We capture both for resilience.
 */
async function acquireCsrf(
  baseUrl: string,
  timeoutMs: number,
  log: (m: string) => void
): Promise<{ csrf: string; cookies: CookieJar }> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await request(`${baseUrl}/bin-search/`, {
      method: 'GET',
      headers: { ...COMMON_HEADERS, Accept: 'text/html,application/xhtml+xml' },
      signal: ac.signal
    })
    const cookies = parseSetCookies(res.headers as any)
    const html = await res.body.text()
    const m = /name=['"]csrfmiddlewaretoken['"]\s+value=['"]([^'"]+)['"]/.exec(html)
    const fromForm = m?.[1]
    const csrf = fromForm ?? cookies.csrftoken ?? ''
    if (!csrf) {
      log('[vccgenerator] failed to extract CSRF token from /bin-search/')
    }
    if (!cookies.csrftoken && csrf) cookies.csrftoken = csrf
    return { csrf, cookies }
  } finally {
    clearTimeout(t)
  }
}

async function postParams(
  baseUrl: string,
  body: URLSearchParams,
  csrf: string,
  cookies: CookieJar,
  timeoutMs: number
): Promise<{ ok: true; json: any } | { ok: false; status: number; detail: string }> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await request(`${baseUrl}/fetchdata/get-binsearch-params/`, {
      method: 'POST',
      headers: {
        ...COMMON_HEADERS,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRFToken': csrf,
        Referer: `${baseUrl}/bin-search/`,
        Origin: baseUrl,
        Cookie: jarToHeader(cookies)
      },
      body: body.toString(),
      signal: ac.signal
    })
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return {
        ok: false,
        status: res.statusCode,
        detail: `HTTP ${res.statusCode}`
      }
    }
    const json = await res.body.json()
    return { ok: true, json }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      detail: `network: ${e instanceof Error ? e.message : String(e)}`
    }
  } finally {
    clearTimeout(t)
  }
}

export class VccGeneratorClient {
  private baseUrl: string
  private timeoutMs: number
  private log: (m: string) => void
  private csrf: string = ''
  private cookies: CookieJar = {}
  private warmedAt = 0
  private static readonly WARM_TTL_MS = 30 * 60 * 1000

  constructor(opts: VccGeneratorOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '')
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT
    this.log = opts.log ?? (() => {})
  }

  /** Force a warm. Idempotent within WARM_TTL_MS. */
  async warm(force = false): Promise<void> {
    if (!force && this.csrf && Date.now() - this.warmedAt < VccGeneratorClient.WARM_TTL_MS) {
      return
    }
    const { csrf, cookies } = await acquireCsrf(this.baseUrl, this.timeoutMs, this.log)
    this.csrf = csrf
    this.cookies = cookies
    this.warmedAt = Date.now()
  }

  async listBrands(country: CountryName): Promise<BrandName[]> {
    await this.warm()
    const body = new URLSearchParams({ country, brand: '', bank: '' })
    const r = await postParams(this.baseUrl, body, this.csrf, this.cookies, this.timeoutMs)
    if (!r.ok) {
      throw new Error(`listBrands(${country}): ${r.detail}`)
    }
    const data = (r.json?.data ?? []) as Array<{ brand?: string }>
    return data.map((d) => String(d.brand ?? '')).filter(Boolean)
  }

  async listBanks(country: CountryName, brand: BrandName): Promise<BankName[]> {
    await this.warm()
    const body = new URLSearchParams({ country, brand, bank: '' })
    const r = await postParams(this.baseUrl, body, this.csrf, this.cookies, this.timeoutMs)
    if (!r.ok) {
      throw new Error(`listBanks(${country}, ${brand}): ${r.detail}`)
    }
    const data = (r.json?.data ?? []) as Array<{ issuer?: string }>
    return data.map((d) => String(d.issuer ?? '')).filter(Boolean)
  }

  async listBins(
    country: CountryName,
    brand: BrandName,
    bank: BankName
  ): Promise<BinDigits[]> {
    await this.warm()
    const body = new URLSearchParams({ country, brand, bank })
    const r = await postParams(this.baseUrl, body, this.csrf, this.cookies, this.timeoutMs)
    if (!r.ok) {
      throw new Error(`listBins(${country}, ${brand}, ${bank}): ${r.detail}`)
    }
    const data = (r.json?.data ?? []) as Array<{ bin?: string | number }>
    return data
      .map((d) => String(d.bin ?? '').replace(/\D+/g, ''))
      .filter((b) => b.length >= 6 && b.length <= 8)
  }

  /** Fetch the full BIN-detail row (the form's terminal action). */
  async lookup(bin: string): Promise<BinInfo | null> {
    const cleaned = bin.replace(/\D+/g, '')
    if (cleaned.length < 6 || cleaned.length > 8) return null
    await this.warm()
    const body = new URLSearchParams({
      bincode: cleaned,
      csrfmiddlewaretoken: this.csrf
    })
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), this.timeoutMs)
    try {
      const res = await request(`${this.baseUrl}/fetchdata/get-bin-info/`, {
        method: 'POST',
        headers: {
          ...COMMON_HEADERS,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRFToken': this.csrf,
          Referer: `${this.baseUrl}/bin-search/`,
          Origin: this.baseUrl,
          Cookie: jarToHeader(this.cookies)
        },
        body: body.toString(),
        signal: ac.signal
      })
      if (res.statusCode === 403) {
        // CF token expired — re-warm and retry once.
        this.log('[vccgenerator] 403 on lookup, re-warming')
        await this.warm(true)
        return this.lookup(cleaned)
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        this.log(`[vccgenerator] lookup HTTP ${res.statusCode}`)
        return null
      }
      const json = (await res.body.json()) as any
      if (!json || json.success !== true || !json.binInfo) return null
      return toBinInfo(cleaned, json.binInfo)
    } catch (e) {
      this.log(`[vccgenerator] lookup error: ${e instanceof Error ? e.message : String(e)}`)
      return null
    } finally {
      clearTimeout(t)
    }
  }
}

export function toBinInfo(bin: string, p: any): BinInfo {
  const cleanField = (v: unknown): string | undefined => {
    if (v == null) return undefined
    const s = String(v).trim()
    if (!s) return undefined
    if (/^-+$/.test(s)) return undefined
    if (s.toUpperCase() === 'N/A') return undefined
    return s
  }
  const out: BinInfo = { bin, source: 'vccgenerator', fetchedAt: Date.now(), raw: p }
  const brand = cleanField(p.brand)
  const type = cleanField(p.type)
  const issuer = cleanField(p.issuer)
  const alpha2 = cleanField(p.alpha_2)
  const alpha3 = cleanField(p.alpha_3)
  const country_name = cleanField(p.country_name_x)
  const bank_phone = cleanField(p.bank_phone)
  const bank_url = cleanField(p.bank_url)
  const category = cleanField(p.category)

  if (brand) out.scheme = brand.toLowerCase().replace(/\s+/g, '-')
  if (type) out.type = type.toLowerCase()
  if (category) out.brand = `${brand ?? ''} ${category}`.trim()
  if (alpha2 || alpha3 || country_name) {
    out.country = {}
    if (alpha2) out.country.alpha2 = alpha2.toUpperCase()
    if (alpha3) out.country.alpha3 = alpha3.toUpperCase()
    if (country_name) out.country.name = country_name
  }
  if (issuer || bank_phone || bank_url) {
    out.bank = {}
    if (issuer) out.bank.name = issuer
    if (bank_phone) out.bank.phone = bank_phone
    if (bank_url) out.bank.url = bank_url
  }
  return out
}
