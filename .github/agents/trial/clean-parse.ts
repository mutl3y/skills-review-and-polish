/**
 * Parse a non-negative integer from user input.
 * Returns null when the value is missing or not a safe integer string.
 */
export function parseNonNegativeInt(input: string | undefined | null): number | null {
  if (input == null) {
    return null;
  }

  const trimmed = input.trim();
  if (trimmed === "" || !/^\d+$/.test(trimmed)) {
    return null;
  }

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    return null;
  }

  return value;
}
