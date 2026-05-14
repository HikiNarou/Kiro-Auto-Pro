import type { Page, BrowserContext } from 'playwright'

type LogCallback = (message: string) => void

export type GoogleLoginFailReason =
  | 'kiro_page_load_failed'
  | 'google_button_not_found'
  | 'google_redirect_failed'
  | 'email_input_not_found'
  | 'email_next_failed'
  | 'password_input_not_found'
  | 'password_next_failed'
  | 'challenge_required'
  | 'captcha_required'
  | 'account_disabled'
  | 'wrong_password'
  | 'bot_detection'
  | 'consent_screen_unexpected'
  | 'callback_timeout'
  | 'kiro_postauth_failed'
  | 'unknown'

export type GoogleLoginResult =
  | { success: true; finalUrl: string }
  | { success: false; reason: GoogleLoginFailReason; detail?: string }

const KIRO_SIGNIN_URL = 'https://app.kiro.dev/signin'
const KIRO_SIGNIN_PATH_RE = /\/signin(?:[/?#]|$)/i
const MAX_GOOGLE_LOGIN_ATTEMPTS = 2
const KIRO_AUTH_COOKIE_DOMAIN_RE = /(?:^|\.)kiro\.dev$|(?:^|\.)amazoncognito\.com$/i

const GOOGLE_BUTTON_LOCATORS = [
  // Kiro's /signin page (Mantine): button has unhashed `_signInButton_` class
  // prefix, hosts an <svg><use xlink:href="#Google"/></svg>, and contains
  // "Google" and "Sign in" in split flex children.
  'button[class*="_signInButton_"]:has(svg use[*|href="#Google"])',
  'button[class*="_signInButton_"]:has-text("Google")',
  'button:has(svg use[*|href="#Google"])',
  'button:has(use[*|href="#Google"])',
  'button:has-text("Google"):has-text("Sign in")',
  'button[aria-label*="Google" i]',
  'button:has-text("Google Sign in")',
  'button:has-text("Sign in with Google")',
  'button:has-text("Continue with Google")',
  'a:has-text("Google Sign in")',
  'a:has-text("Sign in with Google")',
  '[data-testid*="google" i]'
]

const EMAIL_INPUT_LOCATORS = [
  'input#identifierId',
  'input[type="email"]',
  'input[name="identifier"]'
]

const EMAIL_NEXT_LOCATORS = [
  '#identifierNext button',
  '#identifierNext',
  'button[jsname="LgbsSe"]:has-text("Next")',
  'button:has-text("Next")'
]

const PASSWORD_INPUT_LOCATORS = [
  'input[type="password"][name="Passwd"]',
  'input[type="password"][aria-label*="password" i]',
  'input[type="password"]'
]

const PASSWORD_NEXT_LOCATORS = [
  '#passwordNext button',
  '#passwordNext',
  'button[jsname="LgbsSe"]:has-text("Next")',
  'button:has-text("Next")'
]

// Google routes BOTH normal password entry AND security challenges through
// `/challenge/...` paths. `/challenge/pwd` is the password page itself —
// matching it as a "challenge" gives a guaranteed false-positive on every
// run. We only flag the subtypes that actually require user interaction
// beyond email+password.
//
// NOTE: /speedbump is NOT in this list. Speedbump is an interstitial
// ("Was this you?", "Continue") that can be auto-confirmed with a click —
// handleSpeedbumpIfPresent() does that before detection runs.
const CHALLENGE_PATH_REGEXES: Array<{ re: RegExp; kind: string }> = [
  { re: /\/challenge\/dp\b/i, kind: 'device_prompt' },        // tap-yes on phone
  { re: /\/challenge\/recaptcha\b/i, kind: 'recaptcha' },
  { re: /\/challenge\/ipp\b/i, kind: 'phone_verify' },        // SMS / call
  { re: /\/challenge\/ipe\b/i, kind: 'phone_email' },
  { re: /\/challenge\/ootp\b/i, kind: 'one_time_password' },
  { re: /\/challenge\/totp\b/i, kind: 'totp' },               // authenticator
  { re: /\/challenge\/sk\b/i, kind: 'security_key' },
  { re: /\/challenge\/kpe\b/i, kind: 'knowledge_based' },
  { re: /\/challenge\/selection\b/i, kind: 'method_selection' },
  { re: /\/challenge\/iap\b/i, kind: 'identity_proofing' },
  { re: /\/signin\/selectchallenge\b/i, kind: 'method_selection' },
  { re: /\/signin\/rejected\b/i, kind: 'rejected' },
  { re: /\/signin\/usernamerecovery\b/i, kind: 'username_recovery' },
  { re: /\/signin\/recovery\b/i, kind: 'recovery' }
]

const SPEEDBUMP_CONFIRM_SELECTORS = [
  // Real labels vary by locale / page version; match the common English and
  // generic "primary blue button" shape.
  'button:has-text("Continue")',
  'button:has-text("Confirm")',
  'button:has-text("Yes")',
  'button:has-text("It was me")',
  'button:has-text("Not now")',
  'button[jsname="LgbsSe"]',
  'div[role="button"]:has-text("Continue")'
]

const BOT_DETECTION_TEXTS = [
  'this browser or app may not be secure',
  "couldn't sign you in",
  'try using a different browser',
  'please try again later',
  'unusual activity',
  'we detected unusual activity',
  'verify it’s you'
]

const WRONG_PASSWORD_TEXTS = [
  'wrong password',
  'incorrect password',
  "couldn't find your google account",
  "couldn’t find your google account",
  'enter a valid email',
  'that account doesn’t exist',
  "that account doesn't exist"
]

const DISABLED_TEXTS = [
  'account has been disabled',
  'account disabled',
  'account has been deleted',
  'account is disabled'
]

const CONSENT_TEXTS = [
  'wants access to your google account',
  'review the permissions',
  'allow kiro',
  'permissions that kiro needs'
]

/** Google OAuth "Kiro wants to access your Google Account — Continue" screen.
 *  Lives at:
 *    accounts.google.com/signin/oauth/id
 *    accounts.google.com/signin/oauth/consent
 *    accounts.google.com/signin/oauth/warning
 *    accounts.google.com/o/oauth2/auth
 *
 *  This is a normal OAuth flow step, NOT a blocker — we just need to click
 *  "Continue" / "Allow". The button label varies ("Continue", "Allow",
 *  "Accept", "Izinkan") but the primary CTA is always `<button jsname="LgbsSe">`
 *  on these pages. */
const GOOGLE_OAUTH_CONSENT_URL_RE =
  /accounts\.google\.com\/(?:signin\/oauth\/(?:id|consent|warning|oauthchooseaccount)|o\/oauth2\/auth)/i

const GOOGLE_OAUTH_CONSENT_SELECTORS = [
  'button[jsname="LgbsSe"][data-primary-action-label]',
  'button[jsname="LgbsSe"]:has-text("Continue")',
  'button[jsname="LgbsSe"]:has-text("Allow")',
  'button[jsname="LgbsSe"]:has-text("Accept")',
  'button[jsname="LgbsSe"]:has-text("I understand")',
  'button[jsname="LgbsSe"]:has-text("Lanjutkan")', // id
  'button[jsname="LgbsSe"]:has-text("Izinkan")',   // id
  'button[jsname="LgbsSe"]:has-text("Setuju")',    // id
  'button:has-text("Continue")',
  'button:has-text("Allow")',
  'button:has-text("Accept")',
  'button:has-text("I understand")',
  'button:has-text("Lanjutkan")',
  'button:has-text("Izinkan")',
  'button:has-text("Setuju")',
  'div[role="button"]:has-text("Continue")',
  'div[role="button"]:has-text("Allow")',
  'div[role="button"]:has-text("Accept")',
  'div[role="button"]:has-text("Lanjutkan")',
  'div[role="button"]:has-text("Izinkan")'
]

async function humanDelay(min = 120, max = 320): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min
  return new Promise((r) => setTimeout(r, ms))
}

async function typeHuman(page: Page, text: string): Promise<void> {
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: Math.floor(Math.random() * 90) + 40 })
  }
}

async function findFirstVisible(
  page: Page,
  selectors: string[],
  timeoutMs: number
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  const pollMs = Math.max(150, Math.min(500, Math.floor(timeoutMs / Math.max(selectors.length, 1))))

  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const visibleSel = `${sel}:visible`
      try {
        const visible = page.locator(visibleSel).first()
        if (await visible.isVisible({ timeout: pollMs }).catch(() => false)) {
          return visibleSel
        }
      } catch {
        // Some future selector engines may reject an appended :visible. Fall
        // through to the original selector so a valid locator is still usable.
      }

      try {
        const candidates = page.locator(sel)
        const count = Math.min(await candidates.count().catch(() => 0), 8)
        for (let i = 0; i < count; i++) {
          const candidate = candidates.nth(i)
          if (await candidate.isVisible({ timeout: 50 }).catch(() => false)) {
            return `${sel} >> nth=${i}`
          }
        }
      } catch {
        continue
      }
    }
    await page.waitForTimeout(150)
  }
  return null
}

async function clickFirst(
  page: Page,
  selectors: string[],
  timeoutMs: number
): Promise<boolean> {
  const sel = await findFirstVisible(page, selectors, timeoutMs)
  if (!sel) return false
  try {
    await humanDelay(140, 320)
    const target = page.locator(sel).first()
    await target.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {})
    await target.click({ timeout: 5000 })
    return true
  } catch {
    return false
  }
}

function isKiroHost(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host.endsWith('app.kiro.dev') || host === 'kiro.dev'
  } catch {
    return false
  }
}

function isGoogleHost(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('accounts.google.com')
  } catch {
    return false
  }
}

function isCognitoHost(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('amazoncognito.com')
  } catch {
    return false
  }
}

function isGooglePasswordPage(url: string): boolean {
  try {
    const u = new URL(url)
    if (!u.hostname.endsWith('accounts.google.com')) return false
    return /\/(?:(?:v\d+\/signin)|(?:signin\/v\d+)|signin)\/challenge\/pwd\b/i.test(u.pathname)
  } catch {
    return false
  }
}

type Blocker =
  | { kind: 'challenge'; subtype: string }
  | { kind: 'captcha' }
  | { kind: 'bot' }
  | { kind: 'wrong_password'; detail: string }
  | { kind: 'disabled'; detail: string }
  | { kind: 'consent' }

async function detectBlocker(page: Page): Promise<Blocker | null> {
  const url = page.url()

  // OAuth consent screen has its own auto-handler — never treat it as a
  // blocker. Body text on this page contains "wants access" (matches
  // CONSENT_TEXTS) AND the page hosts an invisible reCAPTCHA v3 iframe,
  // so without this short-circuit detectBlocker false-positives twice.
  if (GOOGLE_OAUTH_CONSENT_URL_RE.test(url)) {
    return null
  }

  for (const { re, kind } of CHALLENGE_PATH_REGEXES) {
    if (re.test(url)) return { kind: 'challenge', subtype: kind }
  }

  let bodyText = ''
  try {
    bodyText = ((await page.textContent('body', { timeout: 1500 })) ?? '').toLowerCase()
  } catch {
    bodyText = ''
  }

  for (const t of DISABLED_TEXTS) if (bodyText.includes(t)) return { kind: 'disabled', detail: t }
  for (const t of WRONG_PASSWORD_TEXTS)
    if (bodyText.includes(t)) return { kind: 'wrong_password', detail: t }
  for (const t of BOT_DETECTION_TEXTS) if (bodyText.includes(t)) return { kind: 'bot' }
  for (const t of CONSENT_TEXTS) if (bodyText.includes(t)) return { kind: 'consent' }

  // reCAPTCHA v3 renders a 0x0 invisible iframe on most Google pages and must
  // NOT be treated as a blocker — otherwise every single page is "captcha".
  // Only flag when the challenge is actually presented to the user: either
  // an interactive v2 iframe with a non-trivial size, or the explicit
  // `/challenge/recaptcha` URL path (already matched above).
  const interactiveCaptcha = await page
    .locator(
      'iframe[src*="recaptcha/api2/bframe"], iframe[title*="recaptcha challenge" i], div#captcha-container:visible, img[alt*="captcha" i]:visible'
    )
    .first()
    .isVisible()
    .catch(() => false)
  if (interactiveCaptcha) {
    // Size guard: some bframe iframes preload at 0x0 before the challenge
    // actually drops. Require > 50px before counting as blocking.
    const box = await page
      .locator('iframe[src*="recaptcha/api2/bframe"], iframe[title*="recaptcha challenge" i]')
      .first()
      .boundingBox()
      .catch(() => null)
    if (!box || box.width > 50) {
      return { kind: 'captcha' }
    }
  }

  return null
}

function classifyBlocker(b: Blocker | null): GoogleLoginResult {
  if (!b) return { success: false, reason: 'unknown' }
  switch (b.kind) {
    case 'challenge':
      return { success: false, reason: 'challenge_required', detail: b.subtype }
    case 'captcha':
      return { success: false, reason: 'captcha_required' }
    case 'bot':
      return { success: false, reason: 'bot_detection' }
    case 'wrong_password':
      return { success: false, reason: 'wrong_password', detail: b.detail }
    case 'disabled':
      return { success: false, reason: 'account_disabled', detail: b.detail }
    case 'consent':
      return { success: false, reason: 'consent_screen_unexpected' }
  }
}

async function waitForHostChange(
  page: Page,
  allowedHosts: string[],
  timeoutMs: number,
  log: LogCallback
): Promise<'matched' | 'blocker' | 'timeout'> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const hostname = new URL(page.url()).hostname
    if (allowedHosts.some((h) => hostname.endsWith(h))) return 'matched'

    // Auto-resolve the speedbump interstitial before it gets misclassified.
    if (await handleSpeedbumpIfPresent(page, log)) {
      // Loop around; next iteration re-reads hostname.
      continue
    }

    // Auto-resolve the OAuth scope-consent screen — fresh GSuite accounts
    // hit it on every first-time Kiro authorization.
    if (await handleGoogleOAuthConsentIfPresent(page, log)) {
      continue
    }

    const blocker = await detectBlocker(page)
    if (blocker) {
      log(`[google-login] blocker while waiting for ${allowedHosts.join('|')}: ${blocker.kind}`)
      return 'blocker'
    }
    await page.waitForTimeout(500)
  }
  return 'timeout'
}

async function handleSpeedbumpIfPresent(page: Page, log: LogCallback): Promise<boolean> {
  // Speedbump lives at /speedbump or /signin/speedbump — it's a soft "confirm
  // you're you" prompt that auto-resolves with one click. Don't fail on it.
  const url = page.url()
  if (!/\/speedbump/i.test(url)) return false

  log('[google-login] Google speedbump detected, auto-confirming')
  // Wait a beat so the primary action button is rendered.
  await page.waitForTimeout(800)
  const clicked = await clickFirst(page, SPEEDBUMP_CONFIRM_SELECTORS, 8000)
  if (!clicked) {
    log('[google-login] speedbump confirm button not found — giving up')
    return false
  }
  // Let the navigation happen before the caller re-checks host.
  await page.waitForTimeout(1500)
  return true
}

/**
 * Auto-resolve the Google OAuth scope-consent screen.
 *
 * Fresh GSuite accounts that have never authorised Kiro before get sent here:
 *   accounts.google.com/signin/oauth/id?...client_id=...kiro-prod...
 *
 * The page renders a "Kiro wants to access your Google Account" prompt with
 * a single primary CTA ("Continue" / "Allow"). Without a click, the OAuth
 * flow stalls and Kiro's callback never fires — surfaces as either
 * `callback_timeout` or our text-matching `consent_screen_unexpected`
 * misclassification.
 *
 * Returns true if we clicked through, so the caller knows to re-check host
 * on the next loop iteration.
 */
async function handleGoogleOAuthConsentIfPresent(
  page: Page,
  log: LogCallback
): Promise<boolean> {
  const url = page.url()
  if (!GOOGLE_OAUTH_CONSENT_URL_RE.test(url)) return false

  // Body-text sanity: the OAuth consent always mentions "wants access" or
  // "permissions". Skip if neither is present — we may have caught a
  // different /oauth/* route.
  let bodyText = ''
  try {
    bodyText = ((await page.textContent('body', { timeout: 1500 })) ?? '').toLowerCase()
  } catch {
    bodyText = ''
  }
  const isConsent =
    bodyText.includes('wants access') ||
    bodyText.includes('permission') ||
    bodyText.includes('izinkan') ||
    bodyText.includes('lanjutkan') ||
    bodyText.includes('setuju') ||
    bodyText.includes('accept') ||
    bodyText.includes('allow')
  const hasConsentPath = /\/signin\/oauth\/(?:id|consent|warning)\b/i.test(url)
  if (!isConsent && !hasConsentPath) return false

  log('[google-login] Google OAuth scope-consent screen detected, auto-confirming')
  // Render delay — the primary CTA is JS-instantiated on these pages.
  await page.waitForTimeout(1200)
  const clicked = await clickFirst(page, GOOGLE_OAUTH_CONSENT_SELECTORS, 10000)
  if (!clicked) {
    log('[google-login] OAuth consent CTA not found — staying on page')
    return false
  }
  // Allow the post-consent redirect chain (back through Cognito) to settle.
  await page.waitForTimeout(2000)
  return true
}

async function handleKiroConsentIfPresent(page: Page, log: LogCallback): Promise<void> {
  // ONLY click consent-style buttons that are INSIDE a real dialog / modal
  // container. Without that scope guard, a loose `button:has-text("Continue")`
  // will pick up any page-level "Continue" / "Get started" button on Kiro's
  // onboarding or pricing screens and fling the user off the authenticated
  // landing page. The modal scope keeps us out of the rest of the DOM.
  const modalScopes = [
    '[role="dialog"]',
    '[role="alertdialog"]',
    '.mantine-Modal-content',
    '[class*="Modal-content"]',
    '[class*="modal-content"]'
  ]
  const consentLabels = [
    'button:has-text("Allow")',
    'button:has-text("Accept")',
    'button:has-text("I agree")',
    'button:has-text("Authorize")',
    'button:has-text("Grant access")',
    'button[data-testid="allow-button"]'
  ]
  try {
    for (const scope of modalScopes) {
      const modal = page.locator(scope).first()
      const visible = await modal.isVisible({ timeout: 250 }).catch(() => false)
      if (!visible) continue
      for (const btn of consentLabels) {
        const clickable = modal.locator(btn).first()
        const btnVisible = await clickable.isVisible({ timeout: 250 }).catch(() => false)
        if (!btnVisible) continue
        await humanDelay(140, 320)
        await clickable.click({ timeout: 4000 }).catch(() => {})
        log(`[google-login] clicked consent button inside ${scope}: ${btn}`)
        await humanDelay(400, 900)
        return
      }
    }
  } catch {}
}

async function hasVisibleKiroSigninChoices(page: Page): Promise<boolean> {
  return page
    .locator(
      [
        'button[class*="_signInButton_"]',
        'button:has-text("Google Sign in")',
        'button:has-text("GitHub Sign in")',
        'button:has-text("Builder ID Sign in")',
        'button:has-text("Your organization Sign in")'
      ].join(', ')
    )
    .first()
    .isVisible({ timeout: 300 })
    .catch(() => false)
}

async function hasAuthenticatedKiroShell(page: Page, email: string): Promise<boolean> {
  const checks = [
    page.getByText(email, { exact: false }).first(),
    page.locator('button[class*="_accountButton_"]').first(),
    page.locator('button:has-text("New session")').first()
  ]

  for (const locator of checks) {
    const visible = await locator.isVisible({ timeout: 300 }).catch(() => false)
    if (visible) return true
  }
  return false
}

async function validateKiroPostAuth(
  page: Page,
  email: string,
  log: LogCallback
): Promise<GoogleLoginResult> {
  const deadline = Date.now() + 20000
  let lastUrl = page.url()

  while (Date.now() < deadline) {
    lastUrl = page.url()
    let host = ''
    try {
      host = new URL(lastUrl).hostname
    } catch {}

    if (!host.endsWith('app.kiro.dev') && host !== 'kiro.dev') {
      await page.waitForTimeout(500)
      continue
    }

    await handleKiroConsentIfPresent(page, log)

    const hasAuthShell = await hasAuthenticatedKiroShell(page, email)
    const hasSigninChoices = await hasVisibleKiroSigninChoices(page)
    const stillOnSignin = KIRO_SIGNIN_PATH_RE.test(lastUrl)

    if (hasAuthShell) {
      await page.waitForTimeout(1000)
      return { success: true, finalUrl: page.url() }
    }

    if (!stillOnSignin && !hasSigninChoices) {
      await page.waitForTimeout(1000)
      return { success: true, finalUrl: page.url() }
    }

    await page.waitForTimeout(700)
  }

  const signinVisible = await hasVisibleKiroSigninChoices(page)
  return {
    success: false,
    reason: 'kiro_postauth_failed',
    detail: `landed on ${page.url()}${signinVisible ? ' with sign-in buttons still visible' : ''}`
  }
}

async function clearKiroAuthState(
  page: Page,
  context: BrowserContext,
  log: LogCallback
): Promise<void> {
  try {
    const before = await context.cookies()
    const matching = before.filter((cookie) =>
      KIRO_AUTH_COOKIE_DOMAIN_RE.test(cookie.domain.replace(/^\./, '').toLowerCase())
    )
    if (matching.length > 0) {
      await context.clearCookies({ domain: KIRO_AUTH_COOKIE_DOMAIN_RE })
      log(`[google-login] cleared ${matching.length} Kiro/Cognito cookies before OAuth attempt`)
    }
  } catch (e) {
    log(`[google-login] Kiro/Cognito cookie cleanup failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`)
  }

  try {
    if (!isKiroHost(page.url())) return
    await page.evaluate(() => {
      try {
        window.localStorage.clear()
      } catch {}
      try {
        window.sessionStorage.clear()
      } catch {}
    })
  } catch {
    // Storage cleanup is best-effort. The next navigation still gets a fresh
    // Cognito state because cookies were already pruned.
  }
}

async function openFreshKiroSignin(
  page: Page,
  context: BrowserContext,
  log: LogCallback
): Promise<GoogleLoginResult | null> {
  await clearKiroAuthState(page, context, log)

  try {
    await page.goto(KIRO_SIGNIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
  } catch (e) {
    return {
      success: false,
      reason: 'kiro_page_load_failed',
      detail: e instanceof Error ? e.message : String(e)
    }
  }

  await clearKiroAuthState(page, context, log)

  // If stale localStorage redirected the SPA during the first load, this
  // second navigation happens after storage cleanup and gives us the real
  // unauthenticated sign-in surface.
  try {
    await page.goto(KIRO_SIGNIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
  } catch (e) {
    return {
      success: false,
      reason: 'kiro_page_load_failed',
      detail: e instanceof Error ? e.message : String(e)
    }
  }

  return null
}

function isRetryableGoogleLoginFailure(result: GoogleLoginResult): result is Extract<GoogleLoginResult, { success: false }> {
  if (result.success) return false
  return ![
    'challenge_required',
    'captcha_required',
    'account_disabled',
    'wrong_password',
    'bot_detection'
  ].includes(result.reason)
}

async function clickGoogleSigninAndWaitForOAuthStart(
  page: Page,
  log: LogCallback
): Promise<GoogleLoginResult | null> {
  const maxClickAttempts = 2

  for (let attempt = 1; attempt <= maxClickAttempts; attempt++) {
    log(
      `[google-login] clicking Google signin on app.kiro.dev${
        attempt > 1 ? ` (retry ${attempt}/${maxClickAttempts})` : ''
      }`
    )
    const clicked = await clickFirst(page, GOOGLE_BUTTON_LOCATORS, 20000)
    if (!clicked) {
      return { success: false, reason: 'google_button_not_found' }
    }

    const onCognitoOrGoogle = await waitForHostChange(
      page,
      ['accounts.google.com', 'amazoncognito.com'],
      attempt === 1 ? 15000 : 25000,
      log
    )
    if (onCognitoOrGoogle === 'matched') return null
    if (onCognitoOrGoogle === 'blocker') return classifyBlocker(await detectBlocker(page))

    const stillOnSignin = isKiroHost(page.url()) && KIRO_SIGNIN_PATH_RE.test(page.url())
    if (attempt < maxClickAttempts && stillOnSignin) {
      log('[google-login] Google signin click did not start OAuth redirect, retrying click')
      continue
    }

    return {
      success: false,
      reason: 'google_redirect_failed',
      detail: `current=${page.url()}`
    }
  }

  return {
    success: false,
    reason: 'google_redirect_failed',
    detail: `current=${page.url()}`
  }
}

async function selectGoogleAccountIfPresent(
  page: Page,
  email: string,
  log: LogCallback
): Promise<boolean> {
  if (!isGoogleHost(page.url())) return false

  const account = page.getByText(email, { exact: false }).first()
  const visible = await account.isVisible({ timeout: 1500 }).catch(() => false)
  if (!visible) return false

  try {
    await humanDelay(140, 320)
    await account.click({ timeout: 5000 })
    log('[google-login] selected existing Google session from account chooser')
    await page.waitForTimeout(1000)
    return true
  } catch {
    return false
  }
}

async function registerViaKiroGoogleOnce(
  page: Page,
  context: BrowserContext,
  email: string,
  password: string,
  log: LogCallback
): Promise<GoogleLoginResult> {
  // Step 1 — load Kiro signin page
  const opened = await openFreshKiroSignin(page, context, log)
  if (opened) return opened

  // Light pre-click warmup — some fingerprint detectors profile mouse and
  // scroll timing before the first interactive click.
  await humanDelay(400, 1000)
  try {
    const vp = page.viewportSize()
    if (vp) {
      await page.mouse.move(Math.floor(vp.width / 3), Math.floor(vp.height / 2), { steps: 4 })
      await humanDelay(150, 350)
      await page.mouse.move(Math.floor(vp.width / 2), Math.floor(vp.height / 2) + 40, { steps: 6 })
    }
  } catch {}

  // Step 2 — wait for Google OAuth host. Kiro bounces through Cognito first,
  // then to accounts.google.com; we accept either, then re-check for the
  // real Google page on the next loop.
  const oauthStartFailure = await clickGoogleSigninAndWaitForOAuthStart(page, log)
  if (oauthStartFailure) return oauthStartFailure

  // If we landed on Cognito's intermediate page, wait for the Google redirect.
  if (!page.url().includes('accounts.google.com')) {
    const onGoogle = await waitForHostChange(page, ['accounts.google.com'], 15000, log)
    if (onGoogle === 'blocker') return classifyBlocker(await detectBlocker(page))
    if (onGoogle === 'timeout') {
      return {
        success: false,
        reason: 'google_redirect_failed',
        detail: `stuck at ${page.url()}`
      }
    }
  }
  log(`[google-login] on ${new URL(page.url()).hostname}, entering email`)

  // Step 3 — email
  const emailSel = await findFirstVisible(page, EMAIL_INPUT_LOCATORS, 15000)
  let emailPromptCompleted = false
  if (emailSel) {
    try {
      await page.locator(emailSel).first().click()
      await humanDelay()
      await page.locator(emailSel).first().fill('')
      await humanDelay()
      await typeHuman(page, email)
    } catch (e) {
      return { success: false, reason: 'email_input_not_found', detail: String(e) }
    }

    await humanDelay(200, 500)
    if (!(await clickFirst(page, EMAIL_NEXT_LOCATORS, 10000))) {
      return { success: false, reason: 'email_next_failed' }
    }
    emailPromptCompleted = true
  } else if (await selectGoogleAccountIfPresent(page, email, log)) {
    emailPromptCompleted = true
  } else if (await handleGoogleOAuthConsentIfPresent(page, log)) {
    log('[google-login] email prompt skipped (active Google session), continuing OAuth')
    emailPromptCompleted = true
  } else if (isKiroHost(page.url()) || isCognitoHost(page.url())) {
    log('[google-login] email prompt skipped (active Google session), landed on callback')
    emailPromptCompleted = true
  } else {
    const blocker = await detectBlocker(page)
    if (blocker) return classifyBlocker(blocker)
    return { success: false, reason: 'email_input_not_found' }
  }

  // Step 4 — password / immediate callback / challenge
  log(
    `[google-login] ${
      emailPromptCompleted ? 'email/account step completed' : 'email submitted'
    }, waiting for password prompt`
  )
  {
    const deadline = Date.now() + 25000
    let passwordSel: string | null = null
    let reachedCallbackWithoutPassword = false
    while (Date.now() < deadline) {
      const host = new URL(page.url()).hostname
      if (host.includes('app.kiro.dev') || host.includes('amazoncognito.com')) {
        // Short-circuited (saved session) — skip to post-auth.
        log('[google-login] no password prompt, landed on callback')
        reachedCallbackWithoutPassword = true
        break
      }
      if (await handleSpeedbumpIfPresent(page, log)) continue
      // Some Workspace accounts are routed straight to OAuth consent if the
      // tenant has SSO enabled. Auto-resolve before classifying as a blocker.
      if (await handleGoogleOAuthConsentIfPresent(page, log)) continue
      const blocker = await detectBlocker(page)
      if (blocker) return classifyBlocker(blocker)
      passwordSel = await findFirstVisible(page, PASSWORD_INPUT_LOCATORS, 1500)
      if (passwordSel) break
      await page.waitForTimeout(500)
    }

    if (passwordSel) {
      try {
        await page.locator(passwordSel).first().click()
        await humanDelay()
        await page.locator(passwordSel).first().fill('')
        await humanDelay()
        await typeHuman(page, password)
      } catch (e) {
        return { success: false, reason: 'password_input_not_found', detail: String(e) }
      }
      await humanDelay(250, 550)
      if (!(await clickFirst(page, PASSWORD_NEXT_LOCATORS, 10000))) {
        return { success: false, reason: 'password_next_failed' }
      }
      log('[google-login] password submitted, waiting for Kiro callback')
    } else if (reachedCallbackWithoutPassword) {
      log('[google-login] password prompt skipped (active session?)')
    } else {
      const blocker = await detectBlocker(page)
      if (blocker) return classifyBlocker(blocker)
      if (isGooglePasswordPage(page.url())) {
        return {
          success: false,
          reason: 'password_input_not_found',
          detail: `password page rendered without a visible password input (${page.url()})`
        }
      }
      if (isGoogleHost(page.url())) {
        return {
          success: false,
          reason: 'callback_timeout',
          detail: `stuck on Google before password entry (${page.url()})`
        }
      }
      return {
        success: false,
        reason: 'callback_timeout',
        detail: `password prompt did not appear before leaving Google (${page.url()})`
      }
    }
  }

  // Step 5 — wait for return to Kiro (via Cognito). Accept either host.
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    const host = new URL(page.url()).hostname
    if (host.endsWith('app.kiro.dev') || host === 'kiro.dev') {
      // Final destination. Validate that Kiro actually accepted the callback:
      // app.kiro.dev/signin is the same host, but it is still an unauthenticated
      // page and must not be treated as a successful login.
      return validateKiroPostAuth(page, email, log)
    }
    if (await handleSpeedbumpIfPresent(page, log)) continue
    // Auto-resolve the Google OAuth scope-consent screen — fires for fresh
    // GSuite accounts that have never authorized Kiro before. Without this
    // we'd misclassify it via CONSENT_TEXTS as `consent_screen_unexpected`
    // OR time out as `callback_timeout`.
    if (await handleGoogleOAuthConsentIfPresent(page, log)) continue
    const blocker = await detectBlocker(page)
    if (blocker) return classifyBlocker(blocker)
    await page.waitForTimeout(600)
  }

  const blocker = await detectBlocker(page)
  if (blocker) return classifyBlocker(blocker)
  return { success: false, reason: 'callback_timeout', detail: `last url: ${page.url()}` }
}

export async function registerViaKiroGoogle(
  page: Page,
  context: BrowserContext,
  email: string,
  password: string,
  log: LogCallback
): Promise<GoogleLoginResult> {
  let lastFailure: Extract<GoogleLoginResult, { success: false }> | null = null

  for (let attempt = 1; attempt <= MAX_GOOGLE_LOGIN_ATTEMPTS; attempt++) {
    if (attempt > 1 && lastFailure) {
      log(
        `[google-login] retrying Google OAuth (${attempt}/${MAX_GOOGLE_LOGIN_ATTEMPTS}) after ${lastFailure.reason}`
      )
    }

    const result = await registerViaKiroGoogleOnce(page, context, email, password, log)
    if (result.success) return result

    lastFailure = result
    if (!isRetryableGoogleLoginFailure(result)) return result
  }

  return lastFailure ?? { success: false, reason: 'unknown' }
}

export type ExtractedTokens = {
  /** Access token (short-lived, bearer). */
  accessToken?: string
  /** ID token (JWT with user claims). */
  idToken?: string
  /** Refresh token (long-lived, used to mint new access tokens). */
  refreshToken?: string
  /** Cognito username / sub returned by LastAuthUser. */
  cognitoUsername?: string
  /** Cognito app client id discovered in storage key prefix. */
  cognitoClientId?: string
  /** Anything else that looked token-like we kept for debugging. */
  extra: Record<string, string>
  /** Where each field was sourced from. */
  source: Record<string, 'cookie' | 'localStorage' | 'sessionStorage'>
}

export type KiroSession = {
  email: string
  capturedAt: number
  finalUrl: string
  cookies: Array<{
    name: string
    value: string
    domain: string
    path: string
    expires?: number
    httpOnly?: boolean
    secure?: boolean
    sameSite?: 'Strict' | 'Lax' | 'None'
  }>
  localStorage: Record<string, string>
  sessionStorage: Record<string, string>
  userAgent: string
  tokens: ExtractedTokens
}

const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

function looksLikeJwt(v: string | undefined | null): boolean {
  if (!v) return false
  const s = v.trim()
  if (s.length < 40) return false
  return JWT_RE.test(s)
}

/**
 * Extract Cognito tokens from a (key → value) map. Handles two common layouts:
 *
 *   1. AWS Amplify pattern in localStorage:
 *        CognitoIdentityServiceProvider.<clientId>.LastAuthUser    = <username>
 *        CognitoIdentityServiceProvider.<clientId>.<user>.idToken
 *        CognitoIdentityServiceProvider.<clientId>.<user>.accessToken
 *        CognitoIdentityServiceProvider.<clientId>.<user>.refreshToken
 *
 *   2. Bare key names in cookies / custom storage:
 *        accessToken, idToken, refreshToken, id_token, access_token, refresh_token
 *
 * The caller merges multiple sources together; later sources override earlier
 * ones only when they look more token-like (non-empty JWT vs empty string).
 */
function extractFromMap(
  map: Record<string, string>,
  out: ExtractedTokens,
  source: 'cookie' | 'localStorage' | 'sessionStorage'
): void {
  // Amplify pattern
  const clientIdMatch = new Set<string>()
  for (const key of Object.keys(map)) {
    const m = key.match(/^CognitoIdentityServiceProvider\.([^.]+)\./i)
    if (m) clientIdMatch.add(m[1])
  }

  for (const clientId of clientIdMatch) {
    if (!out.cognitoClientId) out.cognitoClientId = clientId
    const userKey = `CognitoIdentityServiceProvider.${clientId}.LastAuthUser`
    const user = map[userKey]
    if (user && !out.cognitoUsername) {
      out.cognitoUsername = user
      out.source.cognitoUsername = source
    }
    if (!user) continue
    const prefix = `CognitoIdentityServiceProvider.${clientId}.${user}.`
    const pairs: Array<[string, keyof ExtractedTokens]> = [
      [`${prefix}idToken`, 'idToken'],
      [`${prefix}accessToken`, 'accessToken'],
      [`${prefix}refreshToken`, 'refreshToken']
    ]
    for (const [k, field] of pairs) {
      const v = map[k]
      if (v && !out[field]) {
        ;(out as any)[field] = v
        out.source[field as string] = source
      }
    }
  }

  // Bare-name fallback — only keep if the value looks like a token.
  const bareMap: Array<[RegExp, keyof ExtractedTokens]> = [
    [/^(?:access[_-]?token|accessToken)$/i, 'accessToken'],
    [/^(?:id[_-]?token|idToken)$/i, 'idToken'],
    [/^(?:refresh[_-]?token|refreshToken)$/i, 'refreshToken']
  ]
  for (const [key, v] of Object.entries(map)) {
    for (const [re, field] of bareMap) {
      if (re.test(key) && v && !out[field]) {
        // Tokens are usually JWTs — but refreshToken in Cognito is opaque.
        // Accept anything non-trivial for refreshToken; require JWT shape for id/access.
        if (field === 'refreshToken' || looksLikeJwt(v)) {
          ;(out as any)[field] = v
          out.source[field as string] = source
        }
      }
    }
  }

  // Keep anything else that looks JWT-shaped under `extra` so nothing valuable
  // is silently dropped.
  for (const [key, v] of Object.entries(map)) {
    if (looksLikeJwt(v) && !Object.values(out).includes(v)) {
      // Avoid duplicating known tokens.
      if (out.accessToken === v || out.idToken === v || out.refreshToken === v) continue
      out.extra[`${source}:${key}`] = v
    }
  }
}

function extractTokensFromSnapshot(
  cookies: KiroSession['cookies'],
  localStorage: Record<string, string>,
  sessionStorage: Record<string, string>
): ExtractedTokens {
  const out: ExtractedTokens = { extra: {}, source: {} }

  const cookieMap: Record<string, string> = {}
  for (const c of cookies) cookieMap[c.name] = c.value

  extractFromMap(localStorage, out, 'localStorage')
  extractFromMap(sessionStorage, out, 'sessionStorage')
  extractFromMap(cookieMap, out, 'cookie')

  return out
}

/** Pull all persistent auth state from the browser after a successful login.
 *  This is the Kiro session you can rehydrate into switch.ts. */
export async function captureKiroSession(
  page: Page,
  context: BrowserContext,
  email: string
): Promise<KiroSession> {
  const cookies = (await context.cookies()).map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires === -1 ? undefined : c.expires,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite as KiroSession['cookies'][number]['sameSite']
  }))

  let localStorage: Record<string, string> = {}
  let sessionStorage: Record<string, string> = {}
  let userAgent = ''
  try {
    const snapshot = await page.evaluate(() => {
      const dump = (s: Storage): Record<string, string> => {
        const out: Record<string, string> = {}
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i)
          if (k != null) out[k] = s.getItem(k) ?? ''
        }
        return out
      }
      return {
        ls: dump(window.localStorage),
        ss: dump(window.sessionStorage),
        ua: navigator.userAgent
      }
    })
    localStorage = snapshot.ls
    sessionStorage = snapshot.ss
    userAgent = snapshot.ua
  } catch {
    // Fall through with empty storage — cookie-only extraction still works.
  }

  const tokens = extractTokensFromSnapshot(cookies, localStorage, sessionStorage)

  return {
    email,
    capturedAt: Date.now(),
    finalUrl: page.url(),
    cookies,
    localStorage,
    sessionStorage,
    userAgent,
    tokens
  }
}
