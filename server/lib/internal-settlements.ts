// Bank ledger payments duplicate the underlying card purchase/currency asset.
// Keep conversion commissions separate: they remain expenses unless allocated.
export const INTERNAL_SETTLEMENT_MERCHANTS = ['המרת קנ במטח', 'לאומי ויזה(כא)']
export function isInternalSettlement(merchant: string): boolean {
  return INTERNAL_SETTLEMENT_MERCHANTS.includes(merchant.trim())
}
