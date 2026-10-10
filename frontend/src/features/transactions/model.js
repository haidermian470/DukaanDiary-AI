export const typeLabels = { sale: 'Sale', purchase: 'Purchase', expense: 'Expense', payment_received: 'Payment received', payment_made: 'Payment made' }
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
export function toMinor(value) {
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(String(value))) return null
  const [whole, fraction = ''] = String(value).split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}
export const money = (minor) => `PKR ${new Intl.NumberFormat('en-PK', { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(minor / 100)}`
export function validateTransaction(value) {
  const errors = {}
  if (!['sale', 'purchase', 'expense'].includes(value.type)) errors.type = 'Choose sale, purchase, or expense.'
  if (!value.description.trim()) errors.description = 'Enter a description.'
  const amount = toMinor(value.amount)
  const paid = toMinor(value.paid)
  if (amount === null || amount <= 0) errors.amount = 'Enter a positive amount with up to 2 decimal places (maximum 999,999,999.99).'
  if (paid === null || paid < 0 || (amount !== null && paid > amount)) errors.paid = 'Enter a paid amount between zero and the total.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date) || Number.isNaN(Date.parse(value.date)) || new Date(value.date).toISOString().slice(0, 10) !== value.date) errors.date = 'Choose a valid date.'
  if (!value.category) errors.category = 'Choose a category.'
  if (paid !== null && amount !== null && paid < amount && !value.party.trim()) errors.party = 'Enter the customer or supplier for an outstanding balance.'
  return errors
}
export const paymentStatus = (row) => (row.settledPaid ?? row.paid) === row.amount ? 'Paid' : (row.settledPaid ?? row.paid) > 0 ? 'Partially paid' : 'Unpaid'
export function periodRange(period, custom, day = today()) {
  if (period === 'custom') return custom
  if (period === 'all') return { start: '', end: '' }
  const date = new Date(`${day}T00:00:00Z`)
  if (period === 'week') date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  if (period === 'month') date.setUTCDate(1)
  return { start: date.toISOString().slice(0, 10), end: day }
}
export const inRange = (row, range) => (!range.start || row.date >= range.start) && (!range.end || row.date <= range.end)
