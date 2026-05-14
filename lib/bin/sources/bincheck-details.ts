import { request } from 'undici'
import type { BinInfo } from '../types'

/**
 * bincheck.io detail page — `/details/<bin>` returns server-rendered HTML
 * with three labelled tables. We scrape it as a low-cost fallback when
 * the JSON `api/v1.5/fectch` endpoint is rate-limited or behind a CF
 * challenge that the JSON path fails. No captcha on this route.
 *
 * Discovered selectors (verified live 2026-05-14, BIN 418832):
 *   table[1] rows:
 *     BIN/IIN | Card Brand | Card Type | Card Level
 *     Issuer Name / Bank | Issuer's / Bank's Website | Issuer / Bank Phone
 *   table[2] rows:
 *     Commercial Card? | Prepaid Card? | Reloadable Card?
 *   table[3] rows:
 *     ISO Country Name | Country Flag | ISO Country Code A2
 *     ISO Country Code A3 | ISO Country Currency
 *
 * Free-tier rows commonly read "API Only" — we treat those as `undefined`.
 */

export type BincheckDetailsOptions = {
  baseUrl?: string
  timeoutMs?: number
  log?: (msg: string) => void
}

export type BincheckDetailsResult =
  | { ok: true; info: BinInfo }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'error'; detail?: string }

const DEFAULT_BASE = 'https://bincheck.io'

export async function lookupBincheckDetails(
  bin: string,
  opts: BincheckDetailsOptions = {}
): Promise<BincheckDetailsResult> {
  const cleaned = bin.replace(/\D+/g, '')
  if (cleaned.length < 6 || cleaned.length > 8) {
    return { ok: false, reason: 'error', detail: 'bin must be 6–8 digits' }
  }
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '')
  const timeoutMs = opts.timeoutMs ?? 12_000
  const log = opts.log ?? (() => {})

  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await request(`${baseUrl}/details/${cleaned}`, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: ac.signal
    })
    if (res.statusCode === 404) return { ok: false, reason: 'not_found' }
    if (res.statusCode === 403) {
      log('[bincheck-details] 403 — cloudflare challenge')
      return { ok: false, reason: 'forbidden' }
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return { ok: false, reason: 'error', detail: `HTTP ${res.statusCode}` }
    }
    const html = await res.body.text()
    const fields = parseRows(html)
    const lower = (k: string) => fields[k.toLowerCase()]
    if (!lower('bin/iin') && !lower('bin')) return { ok: false, reason: 'not_found' }
    return { ok: true, info: toBinInfo(cleaned, fields) }
  } catch (e) {
    return {
      ok: false,
      reason: 'error',
      detail: `network: ${e instanceof Error ? e.message : String(e)}`
    }
  } finally {
    clearTimeout(t)
  }
}

function parseRows(html: string): Record<string, string> {
  // Strip tags row-by-row from <tr>…</tr> blocks. Cheap regex parser is
  // fine here — bincheck's tables are simple and consistently structured.
  const out: Record<string, string> = {}
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let trMatch: RegExpExecArray | null
  while ((trMatch = trRe.exec(html))) {
    const cells: string[] = []
    const cellRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRe.exec(trMatch[1]))) {
      cells.push(stripTags(cellMatch[1]))
    }
    if (cells.length < 2) continue
    const key = cells[0].trim().toLowerCase().replace(/[?:]+$/, '').trim()
    const value = cells.slice(1).join(' ').trim()
    if (key && value) out[key] = value
  }
  return out
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function toBinInfo(bin: string, f: Record<string, string>): BinInfo {
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = f[k.toLowerCase()]
      if (!v) continue
      if (/^-+$/.test(v.trim())) continue
      if (/^api only$/i.test(v)) continue
      return v
    }
    return undefined
  }
  const out: BinInfo = { bin, source: 'bincheck-details', fetchedAt: Date.now(), raw: f }
  const scheme = pick('card brand')
  if (scheme) out.scheme = scheme.toLowerCase().replace(/\s+/g, '-')
  const type = pick('card type')
  if (type) out.type = type.toLowerCase()
  const level = pick('card level')
  if (level && scheme) out.brand = `${scheme} ${level}`.trim()
  const prepaid = pick('prepaid card')
  if (prepaid) out.prepaid = /^(yes|true|y)$/i.test(prepaid)
  const issuer = pick('issuer name / bank', 'issuer / bank', 'issuer name', 'bank')
  const url = pick("issuer's / bank's website", 'bank website')
  const phone = pick('issuer / bank phone', 'bank phone')
  if (issuer || url || phone) {
    out.bank = {}
    if (issuer) out.bank.name = issuer
    if (url) out.bank.url = url.replace(/^https?:\/\//, '')
    if (phone) out.bank.phone = phone
  }
  const country_name = pick('iso country name')
  const a2 = pick('iso country code a2')
  const a3 = pick('iso country code a3')
  const currency = pick('iso country currency')
  if (country_name || a2 || a3 || currency) {
    out.country = {}
    if (country_name) out.country.name = country_name
    if (a2) out.country.alpha2 = a2.toUpperCase().slice(0, 2)
    if (a3) out.country.alpha3 = a3.toUpperCase().slice(0, 3)
    if (currency) out.country.currency = currency.toUpperCase().slice(0, 3)
  }
  return out
}
