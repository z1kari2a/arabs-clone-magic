import type { Currency } from "../erp-types";

/** Find the exchange rate (units-per-USD) for a currency code, or 0 if unknown. */
export function findRate(currencies: Currency[] | undefined, code?: string): number {
  return currencies?.find((c) => c.code === code)?.rate ?? 0;
}

/**
 * Convert an amount priced at `fromRate` into the equivalent amount at `toRate`.
 * Both rates share the same base currency (USD): rate = units-per-USD.
 */
export function convertByRate(amount: number, fromRate: number, toRate: number): number {
  return fromRate > 0 ? amount * (toRate / fromRate) : 0;
}
