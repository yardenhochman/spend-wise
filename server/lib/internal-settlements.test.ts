import { expect, it } from 'vitest'
import { isInternalSettlement } from './internal-settlements.js'
it('excludes bank settlements without excluding commissions or merchants', () => {
  expect(isInternalSettlement('לאומי ויזה(כא)')).toBe(true)
  expect(isInternalSettlement('המרת קנ במטח')).toBe(true)
  expect(isInternalSettlement('עמלת קנ במטח')).toBe(false)
  expect(isInternalSettlement('Visa travel shop')).toBe(false)
})
