// Exact money conversion between the backend's decimal strings and integer paisa.
//
// The backend sends money as strings such as "5000.00" (PostgreSQL NUMERIC(14,2)).
// The frontend keeps amounts as whole paisa (integers) so that no arithmetic runs on
// binary floating-point values. These helpers never round: a value that cannot be
// represented exactly is rejected so a display bug cannot silently change an amount.

export class MoneyFormatError extends Error {
  constructor(value) {
    super('The server returned an amount in an unexpected format.')
    this.name = 'MoneyFormatError'
    this.code = 'invalid_money'
    this.value = value
  }
}

const DECIMAL = /^(-)?(\d{1,15})(?:\.(\d+))?$/

/** Convert a backend decimal string (e.g. "5000.00", "-12.5") to integer paisa. */
export function parseMoney(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) < 1e13) return value * 100
  if (typeof value !== 'string') throw new MoneyFormatError(value)
  const match = DECIMAL.exec(value.trim())
  if (!match) throw new MoneyFormatError(value)
  const [, sign, whole, fraction = ''] = match
  // Extra fractional digits are allowed only when they are zeros ("1.500" but not "1.505").
  if (fraction.length > 2 && /[^0]/.test(fraction.slice(2))) throw new MoneyFormatError(value)
  const minor = Number(whole) * 100 + Number(fraction.slice(0, 2).padEnd(2, '0'))
  if (!Number.isSafeInteger(minor)) throw new MoneyFormatError(value)
  return sign && minor !== 0 ? -minor : minor
}

/** Like parseMoney, but null/undefined stay null (for optional amounts). */
export function parseOptionalMoney(value) {
  return value === null || value === undefined ? null : parseMoney(value)
}

/** Convert integer paisa to the decimal string the backend expects ("5000.00"). */
export function toDecimalString(minor) {
  if (!Number.isSafeInteger(minor)) throw new TypeError('Amount must be a whole number of paisa.')
  const negative = minor < 0
  const absolute = Math.abs(minor)
  const text = `${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
  return negative ? `-${text}` : text
}
