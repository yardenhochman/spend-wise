import type { HomeTransaction } from './types.js'
export { displayName, type MerchantAlias } from '../merchant-labels.js'
export function transactionLabel(
  tx: Pick<HomeTransaction, 'merchant' | 'display_name'>,
): string {
  return tx.display_name || tx.merchant
}
/** Checking ledger issuer names, not card purchases or card service fees. */
export function cardIssuer(merchant: string): string | null {
  if (/עמל|דמי|fee|commission/i.test(merchant)) return null
  const value = merchant.toLowerCase().replace(/[\s.()"׳״'_-]/g, '')
  if (/מאסטרק[א]?רד|mastercard/.test(value)) return 'mastercard'
  if (/ויזה|visa/.test(value)) return 'visa'
  if (/ישראכרט|isracard/.test(value)) return 'isracard'
  if (/^כאל|^לכאל|^cal$/.test(value)) return 'cal'
  if (/^מקס|^max(?:it|finance|$)/.test(value)) return 'max'
  if (value.startsWith('הבינלאומיכא')) return 'international-card'
  if (/cardsettlement|סילוקכרטיס|חיובכרטיס/.test(value)) return 'card'
  return null
}
export function isObligationNoise(t: HomeTransaction): boolean {
  return (
    !!t.is_internal ||
    !!cardIssuer(t.merchant) ||
    /עמל|משיכ.*מזומ|\batm\b|bank fees|commission|cash withdrawal/i.test(
      `${t.merchant} ${t.category_name ?? ''}`,
    )
  )
}
export function formatMoney(amount: number): string {
  return `${amount < 0 ? '-' : ''}₪${Math.round(Math.abs(amount)).toLocaleString('en-US')}`
}

/** Isolate names inside English sentences without changing their stored spelling. */
export function isolateName(name: string): string {
  return `\u2068${name.replace(/[\u2066-\u2069]/g, '')}\u2069`
}
export function serviceName(
  tx: Pick<HomeTransaction, 'merchant' | 'display_name'>,
): string {
  const label = transactionLabel(tx)
  if (tx.display_name && tx.display_name !== tx.merchant) return label
  if (/^amazon[\s*.-]+prime\b/i.test(`${tx.merchant} ${label}`))
    return 'Amazon Prime'
  return /(?:google[\s*.-]*)?youtube[\s*.-]*premiu(?:m)?/i.test(
    `${tx.merchant} ${label}`,
  )
    ? 'YouTube Premium'
    : label
}
export function serviceKey(
  tx: Pick<HomeTransaction, 'merchant' | 'display_name'>,
): string {
  return serviceName(tx)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, '')
}
export function isBuildingFee(tx: HomeTransaction): boolean {
  const name = `${tx.merchant} ${transactionLabel(tx)}`
  if (
    /ועד|\bhoa\b|building management|building maintenance|אחזקת (?:בניין|מבנה)/i.test(
      name,
    )
  )
    return true
  // Israeli building management fees are almost always billed as "דמי ניהול".
  return /דמי ניהול|property management/i.test(name)
}
export function stableAmounts(amounts: number[], tolerance = 0.05): boolean {
  if (!amounts.length) return false
  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length
  return (
    mean > 0 &&
    Math.sqrt(
      amounts.reduce((sum, a) => sum + (a - mean) ** 2, 0) / amounts.length,
    ) /
      mean <=
      tolerance
  )
}
