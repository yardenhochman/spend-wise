import Dinero from 'dinero.js'

/**
 * Format a number as ILS currency string (no decimals).
 * e.g. 1234.5 → "₪1,235", -500 → "₪500"
 */
export function formatILS(n: number): string {
  return Dinero({ amount: Math.round(Math.abs(n) * 100), currency: 'ILS' })
    .setLocale('en-IL')
    .toFormat('$0,0')
}

/**
 * Split an amount into parts for component-level rendering.
 * e.g. -1234.56 → { prefix: "-", intStr: "1,234", decStr: "56" }
 */
export function splitAmount(amount: number): {
  prefix: string
  intStr: string
  decStr: string
} {
  const abs = Math.abs(amount)
  const int = Math.floor(abs)
  const dec = Math.round((abs - int) * 100)
  const intStr = int.toLocaleString('en-IL')
  const decStr = dec.toString().padStart(2, '0')
  const prefix = amount < 0 ? '-' : ''
  return { prefix, intStr, decStr }
}
