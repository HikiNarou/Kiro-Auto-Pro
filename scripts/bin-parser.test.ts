import assert from 'node:assert/strict'
import { parseCli } from './bin'

const ENV_KEYS = [
  'npm_config_country',
  'npm_config_scheme',
  'npm_config_bank',
  'npm_config_json'
]
const savedEnv = new Map<string, string | undefined>()
for (const key of ENV_KEYS) {
  savedEnv.set(key, process.env[key])
  delete process.env[key]
}

function assertCascade(
  argv: string[],
  expected: { country: string; scheme?: string; bank?: string }
): void {
  const parsed = parseCli(argv)
  assert.equal(parsed.cmd, 'cascade')
  assert.equal(parsed.country, expected.country)
  assert.equal(parsed.scheme, expected.scheme)
  assert.equal(parsed.bank, expected.bank)
}

assertCascade(['cascade', '--country', 'Indonesia', '--scheme', 'VISA'], {
  country: 'Indonesia',
  scheme: 'VISA'
})

assertCascade(['cascade', '--country=Indonesia', '--scheme=VISA'], {
  country: 'Indonesia',
  scheme: 'VISA'
})

assertCascade(['cascade', 'Indonesia', 'VISA'], {
  country: 'Indonesia',
  scheme: 'VISA'
})

assertCascade(['cascade', 'Indonesia', 'VISA', 'BANK', 'CENTRAL', 'ASIA'], {
  country: 'Indonesia',
  scheme: 'VISA',
  bank: 'BANK CENTRAL ASIA'
})

assertCascade(['--', 'cascade', 'Indonesia', 'VISA', 'BANK', 'CENTRAL', 'ASIA'], {
  country: 'Indonesia',
  scheme: 'VISA',
  bank: 'BANK CENTRAL ASIA'
})

assertCascade(['cascade', '--country', 'Indonesia', 'VISA', 'BANK', 'CENTRAL', 'ASIA'], {
  country: 'Indonesia',
  scheme: 'VISA',
  bank: 'BANK CENTRAL ASIA'
})

assertCascade(['cascade', '--country=Indonesia', 'VISA', 'BANK', 'CENTRAL', 'ASIA'], {
  country: 'Indonesia',
  scheme: 'VISA',
  bank: 'BANK CENTRAL ASIA'
})

const search = parseCli([
  'search',
  'Indonesia',
  'VISA',
  'credit',
  'BANK',
  'CENTRAL',
  'ASIA',
  '25'
])
assert.equal(search.cmd, 'search')
assert.equal(search.country, 'Indonesia')
assert.equal(search.scheme, 'VISA')
assert.equal(search.type, 'credit')
assert.equal(search.bank, 'BANK CENTRAL ASIA')
assert.equal(search.limit, 25)

const explicitWins = parseCli([
  'cascade',
  '--country',
  'Indonesia',
  '--scheme',
  'VISA',
  '--bank',
  'BANK CENTRAL ASIA',
  'SHOULD',
  'NOT',
  'OVERRIDE'
])
assert.equal(explicitWins.country, 'Indonesia')
assert.equal(explicitWins.scheme, 'VISA')
assert.equal(explicitWins.bank, 'BANK CENTRAL ASIA')

process.env.npm_config_country = 'Indonesia'
process.env.npm_config_scheme = 'VISA'
process.env.npm_config_bank = 'BANK CENTRAL ASIA'
process.env.npm_config_json = 'true'
const npmConfigFallback = parseCli(['cascade'])
assert.equal(npmConfigFallback.cmd, 'cascade')
assert.equal(npmConfigFallback.country, 'Indonesia')
assert.equal(npmConfigFallback.scheme, 'VISA')
assert.equal(npmConfigFallback.bank, 'BANK CENTRAL ASIA')
assert.equal(npmConfigFallback.json, true)

process.env.npm_config_country = 'true'
process.env.npm_config_scheme = 'true'
process.env.npm_config_bank = 'true'
const npmBooleanConfigWithPositionals = parseCli([
  'cascade',
  'Indonesia',
  'VISA',
  'BANK',
  'CENTRAL',
  'ASIA'
])
assert.equal(npmBooleanConfigWithPositionals.country, 'Indonesia')
assert.equal(npmBooleanConfigWithPositionals.scheme, 'VISA')
assert.equal(npmBooleanConfigWithPositionals.bank, 'BANK CENTRAL ASIA')

for (const [key, value] of savedEnv) {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

process.stdout.write('bin parser regression tests passed\n')
