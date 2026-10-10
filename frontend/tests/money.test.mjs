import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMoney, parseOptionalMoney, toDecimalString, MoneyFormatError } from '../src/services/money.js'

test('backend decimal strings convert exactly to paisa', () => {
  assert.equal(parseMoney('5000.00'), 500000)
  assert.equal(parseMoney('0.29'), 29)
  assert.equal(parseMoney('0.1'), 10)
  assert.equal(parseMoney('12'), 1200)
  assert.equal(parseMoney('-2000.50'), -200050)
  assert.equal(parseMoney('-0.00'), 0)
  assert.equal(parseMoney('1.500'), 150)
  assert.equal(parseMoney('999999999999.99'), 99999999999999)
})

test('values that would need rounding or are malformed are rejected', () => {
  for (const value of ['1.005', '1e5', 'NaN', '', ' ', '1,000', '+5', '.5', '5.', null, undefined, {}, 1.5, Number.NaN]) {
    assert.throws(() => parseMoney(value), MoneyFormatError, String(value))
  }
})

test('floating-point traps do not affect conversion', () => {
  // 0.1 + 0.2 style errors cannot happen because no float arithmetic is used.
  assert.equal(parseMoney('0.10') + parseMoney('0.20'), parseMoney('0.30'))
  assert.equal(parseMoney('1234567.89'), 123456789)
})

test('optional amounts keep null and integers are accepted as whole rupees', () => {
  assert.equal(parseOptionalMoney(null), null)
  assert.equal(parseOptionalMoney(undefined), null)
  assert.equal(parseMoney(25), 2500)
})

test('paisa format back to backend decimal strings', () => {
  assert.equal(toDecimalString(500000), '5000.00')
  assert.equal(toDecimalString(29), '0.29')
  assert.equal(toDecimalString(0), '0.00')
  assert.equal(toDecimalString(-200050), '-2000.50')
  assert.throws(() => toDecimalString(1.5), TypeError)
  for (const value of ['0.01', '12.30', '5000.00', '-7.05', '999999999999.99']) assert.equal(toDecimalString(parseMoney(value)), value)
})
