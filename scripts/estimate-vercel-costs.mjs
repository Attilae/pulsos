// Planning model, checked 2026-10-01. All service costs are USD before tax.
// This reads no credentials, performs no network calls, and changes no files.
// Run: node scripts/estimate-vercel-costs.mjs [monthly-active-users ...]
export const assumptions = {
  usdPerEur: 1.1355,
  vercelPlatform: 20,
  vercelCredit: 20,
  cpuPerHour: 0.184, // Frankfurt planning rate; deployed region unverified.
  memoryPerGbHour: 0.0152,
  invocationsPerMillion: 0.6,
  originPerGb: 0.06, // Starting rate, not a verified deployed regional rate.
  analyticsPerEvent: 0.00003,
  buildCpuMinutes: 406, // Measured last-30-day project total, rounded UI value.
  buildPerCpuMinute: 0.0035,
  blobStorageGb: 0.20039,
  blobStoragePerGb: 0.023,
  blobSimplePerMillion: 0.4,
  blobAdvancedPerMillion: 5,
  blobAdvancedOperations: 27,
  isrReadPerMillion: 0.4,
  sessionsPerUser: 8,
  savesPerSession: 15,
  otherApiCallsPerSession: 5,
  staticRequestsPerSession: 70,
  analyticsPerSession: 10,
  staticGbPerSession: 0.025,
  blobFractionOfStaticBytes: 0.5,
  blobMissFraction: 0.2,
  ordinaryApiTransferGb: 0.00002,
  aiApiTransferGb: 0.00006,
  ordinaryCpuSeconds: 0.05,
  ordinaryWallSeconds: 0.5,
  aiCpuSecondsPerAttempt: 0.1,
  aiWallSecondsPerAttempt: 60,
  functionMemoryGb: 2,
  paidFraction: 0.1,
  newFreeFraction: 0.2, // Fraction of free MAU spending their lifetime trial.
  freeTrialGenerations: 3,
  normalProGenerations: 20,
  quotaProGenerations: 50,
  normalInputTokens: 10000,
  normalOutputTokens: 4000, // Includes billable reasoning, not just visible JSON.
  normalRetryFraction: 0.1,
  quotaAttempts: 2,
  quotaTotalOutputTokens: 18000,
  aiInputPerMillion: 0.25,
  aiOutputPerMillion: 2,
  openRouterCreditFee: 0.055,
  observedInvocations: 1600, // Rounded dashboard value, all environments.
  observedCpuSeconds: 21 * 60 + 59,
  observedMemoryGbHours: 44.9,
  monthlyPriceEur: 5.99,
  annualPriceEur: 49,
  paymentPercent: 0.07, // 5% base + 1.5% international + 0.5% subscription.
  paymentFixedUsd: 0.5,
  bankPayoutPercent: 0.01,
};

const a = assumptions;
const r = n => Math.round(n * 10000) / 10000;
const eur = usd => usd / a.usdPerEur;

function cdnTier(requests, gb) {
  if (requests <= 1e6 && gb <= 1000) return 0;
  if (requests <= 10e6 && gb <= 50000) return 20;
  if (requests <= 50e6 && gb <= 50000) return 100;
  if (requests <= 150e6 && gb <= 50000) return 300;
  throw new Error('Beyond modeled Flat Rate CDN capacity; price on demand.');
}

export function estimate(users, compute = 'ordinary', ai = 'normal') {
  if (!Number.isFinite(users) || users <= 0) throw new Error('MAU must be positive.');
  if (!['ordinary', 'observed-ratio'].includes(compute)) throw new Error('Unknown compute scenario.');
  if (!['normal', 'quota-stress'].includes(ai)) throw new Error('Unknown AI scenario.');
  const proGenerations = ai === 'normal' ? a.normalProGenerations : a.quotaProGenerations;
  const generations = users * (a.paidFraction * proGenerations +
    (1 - a.paidFraction) * a.newFreeFraction * a.freeTrialGenerations);
  const attemptsPerGeneration = ai === 'normal' ? 1 + a.normalRetryFraction : a.quotaAttempts;
  const aiAttempts = generations * attemptsPerGeneration;
  const ordinaryCalls = users * a.sessionsPerUser * (2 * a.savesPerSession + a.otherApiCallsPerSession);
  // Provider retries occur inside one /api/compose invocation.
  const invocations = ordinaryCalls + generations;
  const analyticsEvents = users * a.sessionsPerUser * a.analyticsPerSession;
  const cdnRequests = users * a.sessionsPerUser * a.staticRequestsPerSession + invocations + analyticsEvents;
  const staticGb = users * a.sessionsPerUser * a.staticGbPerSession;
  const apiGb = ordinaryCalls * a.ordinaryApiTransferGb + generations * a.aiApiTransferGb;
  const transferGb = staticGb + apiGb;
  const originGb = apiGb + staticGb * a.blobFractionOfStaticBytes * a.blobMissFraction;
  const cpuHours = compute === 'ordinary'
    ? (ordinaryCalls * a.ordinaryCpuSeconds + aiAttempts * a.aiCpuSecondsPerAttempt) / 3600
    : invocations * a.observedCpuSeconds / a.observedInvocations / 3600;
  // Ordinary model conservatively sums request lifetimes; Fluid concurrency may reduce this.
  const memoryGbHours = compute === 'ordinary'
    ? a.functionMemoryGb * (ordinaryCalls * a.ordinaryWallSeconds + aiAttempts * a.aiWallSecondsPerAttempt) / 3600
    : invocations * a.observedMemoryGbHours / a.observedInvocations;
  const costs = {
    activeCpu: cpuHours * a.cpuPerHour,
    memory: memoryGbHours * a.memoryPerGbHour,
    invocations: invocations / 1e6 * a.invocationsPerMillion,
    origin: originGb * a.originPerGb,
    analytics: analyticsEvents * a.analyticsPerEvent,
    builds: a.buildCpuMinutes * a.buildPerCpuMinute,
    blobStorage: a.blobStorageGb * a.blobStoragePerGb,
    // Approximate one Blob request/session and the same modeled origin cache miss fraction.
    blobOperations: users * a.sessionsPerUser * a.blobMissFraction / 1e6 * a.blobSimplePerMillion +
      a.blobAdvancedOperations / 1e6 * a.blobAdvancedPerMillion,
    isrReads: users * a.sessionsPerUser / 1e6 * a.isrReadPerMillion,
  };
  const metered = Object.values(costs).reduce((sum, n) => sum + n, 0);
  const cdn = cdnTier(cdnRequests, transferGb);
  const vercel = a.vercelPlatform + cdn + Math.max(0, metered - a.vercelCredit);
  const generationTokensCost = ai === 'normal'
    ? (a.normalInputTokens * a.aiInputPerMillion + a.normalOutputTokens * a.aiOutputPerMillion) / 1e6 * attemptsPerGeneration
    : (a.normalInputTokens * a.quotaAttempts * a.aiInputPerMillion + a.quotaTotalOutputTokens * a.aiOutputPerMillion) / 1e6;
  const openRouter = generations * generationTokensCost * (1 + a.openRouterCreditFee);
  // Explicit budget placeholders, not measured Neon or email invoices.
  const databaseReserve = users <= 100 ? 10 : users <= 500 ? 20 : 30;
  const total = vercel + openRouter + databaseReserve;
  return {
    users, compute, ai,
    workload: Object.fromEntries(Object.entries({generations, aiAttempts, invocations, cdnRequests, analyticsEvents,
      transferGb, originGb, cpuHours, memoryGbHours}).map(([k, n]) => [k, r(n)])),
    costsUsd: Object.fromEntries(Object.entries(costs).map(([k, n]) => [k, r(n)])),
    meteredVercelUsd: r(metered), cdnTierUsd: cdn, vercelUsd: r(vercel),
    openRouterUsd: r(openRouter), databaseReserveUsd: databaseReserve, totalUsd: r(total), totalEur: r(eur(total)),
  };
}

export function netPayment(priceEur, vatPercent = 0, taxInclusive = true) {
  const checkout = taxInclusive ? priceEur : priceEur * (1 + vatPercent);
  const pretax = taxInclusive ? priceEur / (1 + vatPercent) : priceEur;
  return (pretax - checkout * a.paymentPercent - eur(a.paymentFixedUsd)) * (1 - a.bankPayoutPercent);
}

const requested = process.argv.slice(2).map(Number);
const counts = requested.length ? requested : [100, 500, 1000];
const payments = {
  noVat: {monthlyNetEur: r(netPayment(a.monthlyPriceEur)), annualMonthlyNetEur: r(netPayment(a.annualPriceEur) / 12)},
  taxInclusive27Percent: {monthlyNetEur: r(netPayment(a.monthlyPriceEur, .27)), annualMonthlyNetEur: r(netPayment(a.annualPriceEur, .27) / 12)},
};
const scenarios = counts.flatMap(n => [estimate(n), estimate(n, 'observed-ratio'), estimate(n, 'observed-ratio', 'quota-stress')]);
console.log(JSON.stringify({checkedOn:'2026-10-01', assumptions, payments, scenarios}, null, 2));
