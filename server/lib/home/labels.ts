import type { HomeTransaction } from './types.js'
export interface MerchantAlias {
  raw_pattern: string
  canonical_name: string
  match_type: string
}
export function displayName(
  merchant: string,
  aliases: MerchantAlias[],
): string {
  const raw = merchant.toLowerCase()
  return (
    aliases.find((a) => {
      const pattern = a.raw_pattern.toLowerCase()
      if (a.match_type === 'exact') return raw === pattern
      if (a.match_type === 'regex') {
        try {
          return new RegExp(a.raw_pattern, 'i').test(merchant)
        } catch {
          return false
        }
      }
      return raw.includes(pattern)
    })?.canonical_name ?? merchant
  )
}
export function transactionLabel(tx: HomeTransaction): string {
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
