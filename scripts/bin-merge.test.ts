import assert from 'node:assert/strict'
import { mergeBinInfo, type BinInfo } from '../lib/bin/types'

const now = Date.now()

const rows: BinInfo[] = [
  {
    bin: '464993',
    source: 'local-db',
    fetchedAt: now,
    scheme: 'visa',
    type: 'debit',
    bank: { name: 'TAMARA BANK', phone: '62-21-252-5888' },
    country: { alpha2: 'ID', name: 'Indonesia' }
  },
  {
    bin: '464993',
    source: 'binlist',
    fetchedAt: now,
    bank: { name: 'Pt Bank Hsbc Indonesia' }
  },
  {
    bin: '464993',
    source: 'bincheck-details',
    fetchedAt: now,
    bank: { name: 'PT BANK HSBC INDONESIA' }
  },
  {
    bin: '464993',
    source: 'vccgenerator',
    fetchedAt: now,
    bank: { name: 'HSBC' }
  }
]

const merged = mergeBinInfo(rows)
assert.ok(merged)
assert.equal(merged.bank?.name, 'HSBC')
assert.equal(merged.bank?.phone, undefined)
assert.equal(merged.scheme, 'visa')
assert.equal(merged.country?.alpha2, 'ID')

const offlineOnly = mergeBinInfo([rows[0]])
assert.equal(offlineOnly?.bank?.name, 'TAMARA BANK')
assert.equal(offlineOnly?.bank?.phone, '62-21-252-5888')

process.stdout.write('bin merge regression tests passed\n')
