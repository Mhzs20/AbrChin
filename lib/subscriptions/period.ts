export function addBillingMonth(value: Date): Date {
  const result = new Date(value);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + 1);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));
  return result;
}

export function addBillingMonths(value: Date, months: number): Date {
  let cursor = new Date(value);
  const steps = Math.max(1, Math.floor(months));
  for (let index = 0; index < steps; index += 1) {
    cursor = addBillingMonth(cursor);
  }
  return cursor;
}

export function addGracePeriod(value: Date, days = 7): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1_000);
}
