import { addDays, addMonths, format, startOfWeek } from 'date-fns'
import { formatILS } from '@/utils/currency'
import type {
  BriefResponse,
  CommitmentsResponse,
  ProjectsResponse,
  ReviewQueueResponse,
  RunwayResponse,
  TrailStatus,
} from './types'

/** Synthetic preview household. No imported data or personal labels. */
export function createHomeFixtures(today = new Date()) {
  const date = (offset: number) => format(addDays(today, offset), 'yyyy-MM-dd')
  const asOf = date(0)
  const events: RunwayResponse['events'] = [
    {
      date: date(3),
      label: 'Mortgage',
      amount: -4250,
      kind: 'mortgage',
      estimated: false,
    },
    {
      date: date(6),
      label: 'Card settlement',
      amount: -3680,
      kind: 'card',
      estimated: true,
    },
    {
      date: date(9),
      label: 'Tuition',
      amount: -1650,
      kind: 'obligation',
      estimated: false,
    },
    {
      date: date(12),
      label: 'Family loan',
      amount: -800,
      kind: 'obligation',
      estimated: false,
    },
    {
      date: date(14),
      label: 'Salary',
      amount: 19200,
      kind: 'salary',
      estimated: true,
    },
    {
      date: date(33),
      label: 'Mortgage',
      amount: -4250,
      kind: 'mortgage',
      estimated: false,
    },
    {
      date: date(36),
      label: 'Card settlement',
      amount: -4100,
      kind: 'card',
      estimated: true,
    },
    {
      date: date(39),
      label: 'Tuition',
      amount: -1650,
      kind: 'obligation',
      estimated: false,
    },
    {
      date: date(42),
      label: 'Family loan',
      amount: -800,
      kind: 'obligation',
      estimated: false,
    },
    {
      date: date(44),
      label: 'Salary',
      amount: 19200,
      kind: 'salary',
      estimated: true,
    },
  ]
  let balance = 18650
  const days = Array.from({ length: 56 }, (_, i) => {
    if (i > 0) balance -= 135 // Illustrative daily household spending estimate.
    balance += events
      .filter((e) => e.date === date(i))
      .reduce((sum, e) => sum + e.amount, 0)
    return { date: date(i), balance }
  })
  const runway: RunwayResponse = {
    asOf,
    openingBalance: 18650,
    balanceAsOf: `${asOf}T08:00:00+03:00`,
    accounts: [
      { label: 'Checking 1', balance: 14300, asOf },
      { label: 'Checking 2', balance: 4350, asOf },
    ],
    days,
    events,
    low: days.reduce((low, day) => (day.balance < low.balance ? day : low)),
    nextSalary: { date: date(14), amount: 19200 },
    warnings: [
      'Card settlements and salary dates are estimates. Daily spending is estimated at ₪135.',
    ],
    freshness: [
      { label: 'Checking', through: date(-1), stale: false },
      { label: 'Cards', through: date(-1), stale: false },
    ],
  }
  const months = Array.from({ length: 6 }, (_, i) =>
    format(addMonths(today, i - 5), 'yyyy-MM'),
  )
  const trail = (statuses: TrailStatus[], amount: number) =>
    months.map((month, i) => ({
      month,
      status: statuses[i],
      amount: statuses[i] === 'paid' ? amount : null,
    }))
  const paid: TrailStatus[] = ['paid', 'paid', 'paid', 'paid', 'paid', 'paid']
  const commitments: CommitmentsResponse = {
    months,
    obligations: [
      {
        id: 'demo-mortgage',
        name: 'Mortgage',
        kind: 'mortgage',
        expectedAmount: 4250,
        cadence: 'monthly',
        trail: trail(paid, 4250),
        note: null,
        confirmed: true,
      },
      {
        id: 'demo-tuition',
        name: 'Tuition',
        kind: 'tuition',
        expectedAmount: 1650,
        cadence: 'monthly',
        trail: trail([...paid.slice(0, 5), 'due'], 1650),
        note: null,
        confirmed: true,
      },
      {
        id: 'demo-tax',
        name: 'Municipal tax',
        kind: 'tax',
        expectedAmount: 780,
        cadence: 'bimonthly',
        trail: trail(['none', 'paid', 'none', 'paid', 'none', 'due'], 780),
        note: null,
        confirmed: true,
      },
      {
        id: 'demo-hoa',
        name: 'Building fee',
        kind: 'hoa',
        expectedAmount: 320,
        cadence: 'monthly',
        trail: trail([...paid.slice(0, 5), 'late'], 320),
        note: '₪40 short of the expected payment',
        confirmed: true,
      },
      {
        id: 'demo-utility',
        name: 'Water bill',
        kind: 'utility',
        expectedAmount: 145,
        cadence: 'bimonthly',
        trail: trail(
          ['none', 'paid', 'none', 'paid', 'none', 'unconfirmed'],
          145,
        ),
        note: 'Detected from past payments',
        confirmed: false,
      },
    ],
    repayments: [
      {
        id: 'demo-loan',
        name: 'Family loan',
        remaining: 11200,
        original: 24000,
        monthly: 800,
        endDate: format(addMonths(today, 14), 'yyyy-MM-dd'),
        source: 'manual',
      },
    ],
    recurring: {
      annualTotal: 1704,
      items: [
        {
          merchant: 'Cloud backup',
          amount: 360,
          cadence: 'yearly',
          annualized: 360,
          lastSeen: date(-340),
          flag: 'renewal-soon',
          flagDetail: 'Renews next month',
        },
        {
          merchant: 'Phone plan',
          amount: 79,
          cadence: 'monthly',
          annualized: 948,
          lastSeen: date(-4),
          flag: 'price-up',
          flagDetail: '+₪10 per month',
        },
        {
          merchant: 'מוזיקה לדוגמה',
          amount: 33,
          cadence: 'monthly',
          annualized: 396,
          lastSeen: date(-2),
          flag: 'new',
          flagDetail: 'First seen this month',
        },
      ],
    },
  }
  const brief: BriefResponse = {
    weekOf: format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
    headline: 'Looking steady. Two things worth a look.',
    notices: [
      {
        id: 'demo-double',
        severity: 'action',
        title: 'Corner Pharmacy may have charged you twice',
        body: '₪240 on two days in a row. Check with the merchant if you only bought once.',
        chart: null,
        evidence: [
          {
            id: 'demo-double-2',
            date: date(-2),
            label: 'Corner Pharmacy',
            rawMerchant: 'CORNER PHARM 118',
            amount: -240,
          },
          {
            id: 'demo-double-1',
            date: date(-3),
            label: 'Corner Pharmacy',
            rawMerchant: 'CORNER PHARM 118',
            amount: -240,
          },
        ],
        evidenceCount: 2,
        agentPrompt:
          'Using this synthetic SpendWise example, review a possible double charge of ₪240 on two consecutive days.',
      },
      {
        id: 'demo-short',
        severity: 'action',
        title: 'Building fee is ₪40 short',
        body: 'The expected fee is ₪320. The latest payment was ₪280.',
        chart: null,
        evidence: [],
        evidenceCount: 0,
        agentPrompt:
          'Using this synthetic SpendWise example, help me review a building fee: expected ₪320, latest payment ₪280, a ₪40 shortfall. Explain what to verify before changing the standing order.',
      },
      {
        id: 'demo-groceries',
        severity: 'watch',
        title: 'Groceries are trending up',
        body: 'Monthly spending rose 16% over the last three months. Worth checking what changed.',
        chart: { points: [1950, 1880, 2040, 2100, 2180, 2262] },
        evidence: [],
        evidenceCount: 0,
        agentPrompt:
          'Using this synthetic SpendWise example, investigate groceries rising from ₪1,950 to ₪2,262 over three months. Compare merchant frequency, basket sizes and unusual purchases; ask for transaction evidence before drawing conclusions.',
      },
      {
        id: 'demo-cash',
        severity: 'info',
        title: 'Cash stays above zero',
        body: `The forecast low is ${formatILS(runway.low?.balance ?? 0)} before the next estimated salary. Keep estimates in mind.`,
        chart: null,
        evidence: [],
        evidenceCount: 0,
        agentPrompt:
          'Review the SpendWise household runway using current balances, expected payments and salary timing. Identify uncertain estimates and the lowest forecast balance. Do not make transfers or change payments.',
      },
    ],
    coverage: {
      uncategorizedShare: 0.32,
      reviewMerchants: 4,
      lastImportAt: `${asOf}T08:00:00+03:00`,
      freshness: [
        { label: 'Checking', through: date(-1), stale: false },
        { label: 'Cards', through: date(-1), stale: false },
      ],
    },
  }
  const reviewQueue: ReviewQueueResponse = {
    uncategorizedShare: 0.32,
    categories: [
      'Groceries',
      'Dining',
      'Transport',
      'Utilities',
      'Subscriptions',
      'Healthcare',
      'Shopping',
      'Entertainment',
      'Insurance',
      'Transfer',
      'Other',
    ].map((name) => ({ id: name, name })),
    items: [
      {
        key: 'corner market',
        name: 'שוק השכונה',
        bankNames: ['שוק השכונה בע"מ'],
        count: 12,
        total: 2340,
        olderCount: 3,
        examples: [
          { id: 'q1', date: date(-2), amount: -184, label: 'שוק השכונה' },
          { id: 'q2', date: date(-9), amount: -212, label: 'שוק השכונה' },
          { id: 'q3', date: date(-16), amount: -96, label: 'שוק השכונה' },
        ],
        suggestion: {
          categoryId: 'Groceries',
          categoryName: 'Groceries',
          reason: 'You filed 9 of 10 earlier charges here as Groceries.',
        },
        setsRule: true,
      },
      {
        key: 'city power',
        name: 'City Power',
        bankNames: ['CITY POWER 2023 LTD'],
        count: 3,
        total: 1290,
        olderCount: 0,
        examples: [
          { id: 'q4', date: date(-5), amount: -430, label: 'City Power' },
          { id: 'q5', date: date(-66), amount: -405, label: 'City Power' },
          { id: 'q6', date: date(-127), amount: -455, label: 'City Power' },
        ],
        suggestion: null,
        setsRule: true,
      },
      {
        key: 'transfer|neighbor',
        name: 'דנה לוי',
        bankNames: ['העברה דיגיטל'],
        count: 2,
        total: 900,
        olderCount: 0,
        examples: [
          { id: 'q7', date: date(-4), amount: -450, label: 'העברה דיגיטל' },
          { id: 'q8', date: date(-35), amount: -450, label: 'העברה דיגיטל' },
        ],
        suggestion: null,
        setsRule: false,
      },
      {
        key: 'streamly',
        name: 'Streamly',
        bankNames: ['Streamly'],
        count: 1,
        total: 49,
        olderCount: 0,
        examples: [
          { id: 'q9', date: date(-11), amount: -49, label: 'Streamly' },
        ],
        suggestion: {
          categoryId: 'Subscriptions',
          categoryName: 'Subscriptions',
          reason:
            'Your rule for \u2068Stream\u2069 files this under Subscriptions.',
        },
        setsRule: true,
      },
    ],
  }
  const projects: ProjectsResponse = {
    projects: [
      {
        tag: 'demo-apartment',
        label: 'Apartment project',
        net: 28400,
        status: 'open',
        lastActivity: date(-3),
      },
      {
        tag: 'demo-trip',
        label: 'Summer trip',
        net: 7450,
        status: 'ended',
        lastActivity: date(-48),
      },
    ],
  }
  return { runway, commitments, brief, projects, reviewQueue }
}
