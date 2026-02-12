/**
 * Round a number to N decimal places using standard rounding.
 */
export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
