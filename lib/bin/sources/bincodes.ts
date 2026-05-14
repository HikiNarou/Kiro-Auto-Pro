import type { BinInfo } from '../types'
import { launchStealthBrowser, type BrowserEngine } from '../../browser'

/**
 * bincodes.com — captcha-protected BIN-checker.
 *
 * The /bin-checker/ form posts back to itself with `bin-input=<digits>` plus
 * an invisible reCAPTCHA + hCaptcha pair. Direct curl-style requests are
 * rejected by the captcha gate, so this source uses a stealth browser
 * (Camoufox by default) to drive the form like a human and scrape the
 * resulting result page.
 *
 * The scraper is "best effort":
 *   - it tries to fill the BIN input and click Check
 *   - if a visible captcha challenge appears it returns `captcha_required`
 *     so the caller can retry with a different IP / engine
 *   - on success it parses the result panel into a BinInfo
 *
 * This is the heaviest source by far (full browser launch). The aggregator
 * only escalates to it when the lighter API/JSON sources have all failed
 * AND the user has explicitly enabled scraper sources.
 */

export type BincodesScrapeOptions = {
  /** Stealth engine. Default 'camoufox'. */
  engine?: BrowserEngine
  /** Run headed for manual captcha solve. Default headless. */
  headless?: boolean
  /** Outbound proxy. Recommended residential IP for production runs. */
  proxyUrl?: string
  /** Per-page navigation timeout (ms). Default 45_000. */
  timeoutMs?: number
  log?: (msg: string) => void
}

export type BincodesScrapeResult =
  | { ok: true; info: BinInfo }
  | {
      ok: false
      reason:
        | 'captcha_required'
        | 'not_found'
        | 'rate_limited'
        | 'invalid'
        | 'browser_failed'
        | 'parse_failed'
        | 'error'
      detail?: string
    }

const URL_HOME = 'https://www.bincodes.com/bin-checker/'

export async function scrapeBincodes(
  bin: string,
  options: BincodesScrapeOptions = {}
): Promise<BincodesScrapeResult> {
  const cleaned = bin.replace(/\D+/g, '')
  if (cleaned.length < 6 || cleaned.length > 8) {
    return { ok: false, reason: 'invalid', detail: 'bin must be 6–8 digits' }
  }
  const log = options.log ?? (() => {})
  const timeoutMs = options.timeoutMs ?? 45_000

  let session: Awaited<ReturnType<typeof launchStealthBrowser>> | null = null
  try {
    session = await launchStealthBrowser({
      engine: options.engine ?? 'camoufox',
      headless: options.headless ?? true,
      proxyUrl: options.proxyUrl,
      humanize: true,
      geoip: !!options.proxyUrl,
      log
    })
  } catch (e) {
    return {
      ok: false,
      reason: 'browser_failed',
      detail: e instanceof Error ? e.message : String(e)
    }
  }

  try {
    const { page } = session
    page.setDefaultTimeout(timeoutMs)
    page.setDefaultNavigationTimeout(timeoutMs)
    await page.goto(URL_HOME, { waitUntil: 'domcontentloaded' })

    // Cookie banner / privacy popup is a known interruption — dismiss
    // any visible accept button before trying to interact with the form.
    await dismissBanners(page).catch(() => {})

    const input = page.locator('input[name="bin-input"]').first()
    if ((await input.count()) === 0) {
      return { ok: false, reason: 'parse_failed', detail: 'bin input not found' }
    }
    await input.fill(cleaned)

    // The form has no name; click the only submit input.
    const submit = page.locator('input[type="submit"][value="Check"]').first()
    if ((await submit.count()) === 0) {
      return { ok: false, reason: 'parse_failed', detail: 'submit button not found' }
    }
    await Promise.allSettled([
      page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }),
      submit.click()
    ])

    // Check for hard captcha gate first.
    if (await isCaptchaVisible(page)) {
      return { ok: false, reason: 'captcha_required' }
    }

    const parsed = await parseResultPage(page)
    if (parsed.kind === 'not_found') return { ok: false, reason: 'not_found' }
    if (parsed.kind === 'rate_limited') return { ok: false, reason: 'rate_limited' }
    if (parsed.kind === 'parsed') {
      const info = mapToBinInfo(cleaned, parsed.fields)
      return { ok: true, info }
    }
    return { ok: false, reason: 'parse_failed', detail: parsed.detail }
  } catch (e) {
    return {
      ok: false,
      reason: 'error',
      detail: e instanceof Error ? e.message : String(e)
    }
  } finally {
    try {
      await session.close()
    } catch {}
  }
}

async function dismissBanners(page: any): Promise<void> {
  const candidates = [
    'button:has-text("Accept all")',
    'button:has-text("Accept All")',
    'button:has-text("Accept")',
    'button:has-text("I agree")',
    'button:has-text("Got it")',
    'button:has-text("OK")',
    '[aria-label*="consent" i] button',
    '#cookie-banner button'
  ]
  for (const sel of candidates) {
    try {
      const loc = page.locator(sel).first()
      if (await loc.isVisible({ timeout: 750 })) {
        await loc.click({ timeout: 1500 })
      }
    } catch {}
  }
}

async function isCaptchaVisible(page: any): Promise<boolean> {
  try {
    const challenge = await page.evaluate(() => {
      // Visible (rendered, non-zero size) reCAPTCHA / hCaptcha widgets.
      const hits: string[] = []
      const sels = [
        'iframe[src*="recaptcha"][src*="bframe"]',
        'iframe[src*="hcaptcha"][src*="hcaptcha-challenge"]',
        'div.g-recaptcha[style*="visibility: visible"]'
      ]
      for (const sel of sels) {
        for (const el of Array.from(document.querySelectorAll(sel))) {
          const r = (el as HTMLElement).getBoundingClientRect()
          if (r.width > 50 && r.height > 50) hits.push(sel)
        }
      }
      // Hard-blocked text (Cloudflare turnstile / generic captcha pages)
      const txt = document.body?.innerText ?? ''
      if (/please verify the captcha/i.test(txt)) hits.push('text:please verify')
      if (/just a moment/i.test(txt) && /cloudflare/i.test(txt)) hits.push('text:cf-challenge')
      return hits
    })
    return Array.isArray(challenge) && challenge.length > 0
  } catch {
    return false
  }
}

type ParsedResult =
  | { kind: 'parsed'; fields: Record<string, string> }
  | { kind: 'not_found' }
  | { kind: 'rate_limited' }
  | { kind: 'unknown'; detail: string }

async function parseResultPage(page: any): Promise<ParsedResult> {
  // bincodes renders a definition list / table with rows like
  //   "BIN/IIN: 412345"
  //   "Card Brand: VISA"
  // We grab everything that looks like "Label: Value" inside the
  // result panel and key it case-insensitively.
  try {
    const data = await page.evaluate(() => {
      const text = document.body?.innerText ?? ''
      const lower = text.toLowerCase()
      if (/rate limit|too many requests/.test(lower)) return { rl: true }
      if (/no record|not found|invalid bin|bin not in our database/.test(lower)) {
        return { nf: true }
      }
      const fields: Record<string, string> = {}
      const ROWS = [
        'BIN/IIN',
        'BIN',
        'Card Brand',
        'Brand',
        'Card Type',
        'Type',
        'Card Category',
        'Category',
        'Card Level',
        'Level',
        'Issuer Name',
        'Issuer',
        'Bank',
        'Issuing Bank',
        'Bank Phone',
        'Bank URL',
        'Bank Website',
        'ISO Country Name',
        'Country',
        'Country Code A2',
        'Country Code A3',
        'ISO Country Code A2',
        'ISO Country Code A3',
        'ISO Country Currency',
        'Currency'
      ]
      for (const label of ROWS) {
        const re = new RegExp(
          `(?:^|\\n)\\s*${label.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*[:\\-]\\s*([^\\n]+)`,
          'i'
        )
        const m = re.exec(text)
        if (m) fields[label.toLowerCase()] = m[1].trim()
      }
      // Also walk visible tables for label/value rows.
      const tableHits: Array<[string, string]> = []
      for (const tr of Array.from(document.querySelectorAll('table tr'))) {
        const cells = Array.from(tr.querySelectorAll('td,th')).map((td) =>
          (td.textContent ?? '').trim()
        )
        if (cells.length >= 2) tableHits.push([cells[0], cells.slice(1).join(' ').trim()])
      }
      return { fields, tableHits, rl: false, nf: false }
    })
    if (data?.rl) return { kind: 'rate_limited' }
    if (data?.nf) return { kind: 'not_found' }
    const fields: Record<string, string> = (data?.fields ?? {}) as any
    for (const [k, v] of (data?.tableHits ?? []) as Array<[string, string]>) {
      const key = String(k).toLowerCase().replace(/[?:]+$/, '').trim()
      if (key && v && !fields[key]) fields[key] = v
    }
    if (Object.keys(fields).length === 0) {
      return { kind: 'unknown', detail: 'no recognizable result rows' }
    }
    return { kind: 'parsed', fields }
  } catch (e) {
    return {
      kind: 'unknown',
      detail: e instanceof Error ? e.message : String(e)
    }
  }
}

function mapToBinInfo(bin: string, f: Record<string, string>): BinInfo {
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
  const out: BinInfo = { bin, source: 'bincodes', fetchedAt: Date.now(), raw: f }
  const scheme = pick('card brand', 'brand')
  if (scheme) out.scheme = scheme.toLowerCase().replace(/\s+/g, '-')
  const type = pick('card type', 'type')
  if (type) out.type = type.toLowerCase()
  const level = pick('card level', 'level', 'card category', 'category')
  if (level && scheme) out.brand = `${scheme} ${level}`.trim()
  const country_name = pick('iso country name', 'country')
  const a2 = pick('iso country code a2', 'country code a2')
  const a3 = pick('iso country code a3', 'country code a3')
  const currency = pick('iso country currency', 'currency')
  if (country_name || a2 || a3 || currency) {
    out.country = {}
    if (country_name) out.country.name = country_name
    if (a2) out.country.alpha2 = a2.toUpperCase().slice(0, 2)
    if (a3) out.country.alpha3 = a3.toUpperCase().slice(0, 3)
    if (currency) out.country.currency = currency.toUpperCase().slice(0, 3)
  }
  const bankName = pick('issuer name', 'issuer', 'bank', 'issuing bank')
  const bankUrl = pick('bank url', 'bank website')
  const bankPhone = pick('bank phone')
  if (bankName || bankUrl || bankPhone) {
    out.bank = {}
    if (bankName) out.bank.name = bankName
    if (bankUrl) out.bank.url = bankUrl.replace(/^https?:\/\//, '')
    if (bankPhone) out.bank.phone = bankPhone
  }
  return out
}
