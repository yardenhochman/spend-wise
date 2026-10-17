import { extractLeumiMortgageSnapshot } from './leumi-mortgage-import.js'

/** Read every mortgage's details before allowing the caller to replace its snapshot. */
export async function collectLeumiMortgageTracks(
  overview: unknown,
  fetchDetails: (mortgageKey: string) => Promise<unknown>,
): Promise<Record<string, unknown>> {
  const initial = extractLeumiMortgageSnapshot(overview)
  if (initial.trackCoverage.expected === 0) {
    throw new Error('Mortgage overview has no loan tracks')
  }
  const loanInfoResponses: unknown[] = []
  for (const mortgage of initial.mortgages) {
    if (!mortgage.mortgageKey) throw new Error('Mortgage identity is missing')
    try {
      loanInfoResponses.push(await fetchDetails(mortgage.mortgageKey))
    } catch {
      // Bank responses and transport errors can contain account IDs or session data.
      throw new Error('Mortgage track request failed')
    }
  }
  const enriched = {
    ...(overview as Record<string, unknown>),
    loanInfoResponses,
  }
  const { trackCoverage } = extractLeumiMortgageSnapshot(enriched)
  if (trackCoverage.status !== 'complete') {
    throw new Error(
      `Mortgage track coverage incomplete: ${trackCoverage.retrieved}/${trackCoverage.expected}`,
    )
  }
  return enriched
}
