/**
 * Get the current minute bucket as ISO string: YYYY-MM-DDTHH:MM:00Z
 */
export function minuteBucket(date: Date = new Date()): string {
  const iso = date.toISOString();
  // Replace seconds and milliseconds with 00.000Z, then trim to seconds
  return iso.replace(/:\d{2}\.\d{3}Z$/, ':00Z');
}

/**
 * Get today's date as YYYY-MM-DD in UTC.
 */
export function todayUTC(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Get current month as YYYY-MM in UTC.
 */
export function monthUTC(date: Date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a short run ID.
 */
export function generateRunId(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}-${rand}`;
}

/**
 * Calculate ms until the next occurrence of a given second offset within the current minute.
 */
export function msUntilOffset(offsetSec: number, now: Date = new Date()): number {
  const currentSec = now.getSeconds() + now.getMilliseconds() / 1000;
  let diff = offsetSec - currentSec;
  if (diff < 0) diff += 60;
  return Math.max(0, diff * 1000);
}
