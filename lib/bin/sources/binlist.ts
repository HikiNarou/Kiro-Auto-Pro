import { request } from 'undici'
import type { BinInfo } from '../types'

/**
 * binlist.net — free public REST API.
 *
 *   GET https://lookup.binlist.net/<BIN>
 *   Headers: Accept-Version: 3
 *
 * Rate limit: 5 requests / hour per source IP, with a 5-burst allowance.
 * 404 = unknown BIN. 429 = throttled. No auth in the free tier.
 *
 * Response payload mirrors the BinInfo shape almost exactly — we keep the
 * raw JSON for debugging and copy the known fields across.
 */

export type BinlistResponse = {
  number?: { length?: number; luhn?: boolean }
  scheme?: string
  type?: string
  brand?: string
  prepaid?: boolean
  country?: {
    numeric?: string
    alpha2?: string
    name?: string
    emoji?: string
    currency?: string
    latitude?: number
    longitude?: number
  }
  bank?: {
    name?: string
    url?: string
    phone?: string
    city?: string
  }
}

export type BinlistOptions = {
  /** Override base URL (e.g. for self-hosted mirrors). */
  baseUrl?: string
  /** Per-request timeout in ms. Default 8000. */
  timeoutMs?: number
  /** Optional API key — paid-tier users get unlimited lookups. */
  apiKey?: string
  log?: (msg: string) => void
}

export type BinlistLookupResult =
  | { ok: true; info: BinInfo }
  | { ok: false; reason: 'not_found' | 'rate_limited' | 'invalid' | 'error'; detail?: string }

const DEFAULT_BASE = 'https://lookup.binlist.net'

export async function lookupBinlist(
  bin: string,
  options: BinlistOptions = {}
): Promise<BinlistLookupResult> {
  const cleaned = bin.replace(/\D+/g, '')
  if (cleaned.length < 6 || cleaned.length > 8) {
    return { ok: false, reason: 'invalid', detail: `BIN must be 6–8 digits (got ${cleaned.length})` }
  }

  const log = options.log ?? (() => {})
  const baseUrl = options.baseUrl ?? DEFAULT_BASE
  const timeoutMs = options.timeoutMs ?? 8000
  const url = `${baseUrl.replace(/\/+$/, '')}/${cleaned}`

  const headers: Record<string, string> = {
    'Accept-Version': '3',
    Accept: 'application/json',
    // Identify ourselves so binlist's abuse contact has a name to reach.
    'User-Agent': 'kiro-auto-bin/1.0 (+https://github.com/HikiNarou/Kiro-Auto-Pro)'
  }
  if (options.apiKey) headers['X-Api-Key'] = options.apiKey

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  let res: Awaited<ReturnType<typeof request>>
  try {
    res = await request(url, {
      method: 'GET',
      headers,
      signal: ac.signal
    })
  } catch (e) {
    clearTimeout(timer)
    return {
      ok: false,
      reason: 'error',
      detail: `network: ${e instanceof Error ? e.message : String(e)}`
    }
  }
  clearTimeout(timer)

  const status = res.statusCode
  if (status === 404) {
    log(`[binlist] BIN ${cleaned} not found`)
    return { ok: false, reason: 'not_found' }
  }
  if (status === 429) {
    log(`[binlist] BIN ${cleaned} rate-limited (HTTP 429)`)
    return { ok: false, reason: 'rate_limited' }
  }
  if (status < 200 || status >= 300) {
    return { ok: false, reason: 'error', detail: `HTTP ${status}` }
  }

  let payload: BinlistResponse
  try {
    payload = (await res.body.json()) as BinlistResponse
  } catch (e) {
    return {
      ok: false,
      reason: 'error',
      detail: `parse: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  return { ok: true, info: toBinInfo(cleaned, payload) }
}

export function toBinInfo(bin: string, p: BinlistResponse): BinInfo {
  const out: BinInfo = {
    bin,
    source: 'binlist',
    fetchedAt: Date.now(),
    raw: p
  }
  if (p.scheme) out.scheme = p.scheme
  if (p.type) out.type = p.type
  if (p.brand) out.brand = p.brand
  if (typeof p.prepaid === 'boolean') out.prepaid = p.prepaid
  if (p.number?.length) out.length = p.number.length
  if (typeof p.number?.luhn === 'boolean') out.luhn = p.number.luhn
  if (p.country) {
    out.country = {
      alpha2: p.country.alpha2,
      numeric: p.country.numeric,
      name: p.country.name,
      emoji: p.country.emoji,
      currency: p.country.currency,
      latitude: p.country.latitude,
      longitude: p.country.longitude
    }
  }
  if (p.bank) {
    out.bank = {
      name: p.bank.name,
      url: p.bank.url,
      phone: p.bank.phone,
      city: p.bank.city
    }
  }
  return out
}
