import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import TransactionForm from '../src/features/transactions/TransactionForm'
import Transactions from '../src/features/transactions/Transactions'
import { makeDemoRecords } from '../src/services/demo'
import Credit from '../src/features/credit/Credit'
import DummyBank from '../src/features/bank/DummyBank'
import DraftEntry from '../src/features/ai/DraftEntry'
import Assistant from '../src/features/ai/Assistant'
import ReceiptAnalyzer from '../src/features/documents/ReceiptAnalyzer'
import PaymentChecker from '../src/features/documents/PaymentChecker'

afterEach(cleanup)

test('manual entry validates, permits review edits, and saves only on confirmation', async () => {
  const user = userEvent.setup()
  const save = vi.fn()
  render(<MemoryRouter initialEntries={['/transactions/new']}><Routes><Route path="/transactions/new" element={<TransactionForm records={[]} save={save} />} /><Route path="/transactions" element={<p>Returned to ledger</p>} /></Routes></MemoryRouter>)
  await user.click(screen.getByRole('button', { name: 'Review transaction' }))
  expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
  expect(save).not.toHaveBeenCalled()
  await user.type(screen.getByLabelText('Amount (PKR)'), '1250.25')
  await user.clear(screen.getByLabelText('Amount paid now (PKR)'))
  await user.type(screen.getByLabelText('Amount paid now (PKR)'), '250.25')
  await user.type(screen.getByLabelText('Description'), 'Test flour sale')
  await user.type(screen.getByLabelText('Customer'), 'Sample customer')
  await user.selectOptions(screen.getByLabelText('Category'), 'Groceries')
  await user.click(screen.getByRole('button', { name: 'Review transaction' }))
  expect(screen.getByRole('heading', { name: 'Review transaction' })).toBeTruthy()
  expect(save).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Edit details' }))
  expect(screen.getByLabelText('Description').value).toBe('Test flour sale')
  await user.click(screen.getByRole('button', { name: 'Review transaction' }))
  await user.click(screen.getByRole('button', { name: 'Confirm sample entry' }))
  expect(save).toHaveBeenCalledTimes(1)
  expect(save.mock.calls[0][0]).toMatchObject({ amount: 125025, paid: 25025, source: 'manual' })
  expect(screen.getByText('Returned to ledger')).toBeTruthy()
})

test('editing a record with repayment history is blocked', () => {
  render(<MemoryRouter initialEntries={['/transactions/sample-2/edit']}><Routes><Route path="/transactions/:id/edit" element={<TransactionForm records={makeDemoRecords()} save={vi.fn()} />} /></Routes></MemoryRouter>)
  expect(screen.getByRole('heading', { name: 'This record has linked payments' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Review transaction' })).toBeNull()
})

test('search filters transactions and delete requires confirmation', async () => {
  // jsdom has no native dialog layout; this shim tests the confirmation state only.
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
  const user = userEvent.setup()
  const remove = vi.fn()
  render(<MemoryRouter><Transactions records={makeDemoRecords()} remove={remove} /></MemoryRouter>)
  await user.type(screen.getByRole('textbox', { name: 'Search transactions' }), 'Bijli')
  expect(screen.getByText('Dukan Bijli Bill')).toBeTruthy()
  expect(screen.queryByText('Weekly stock delivery')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Delete Dukan Bijli Bill' }))
  expect(remove).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(remove).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Delete Dukan Bijli Bill' }))
  await user.click(screen.getByRole('button', { name: 'Delete transaction' }))
  expect(remove).toHaveBeenCalledWith('sample-4')
})

test('credit payment requires review before settling the selected obligation', async () => {
  const user = userEvent.setup()
  const settle = vi.fn()
  render(<Credit records={makeDemoRecords()} settle={settle} />)
  await user.type(screen.getByLabelText('Search party'), 'Ali')
  await user.click(screen.getByRole('button', { name: 'View khata' }))
  await user.type(screen.getByLabelText('Payment amount (PKR)'), '500')
  await user.click(screen.getByRole('button', { name: 'Review payment' }))
  expect(settle).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Confirm sample payment' }))
  expect(settle.mock.calls[0][0]).toMatchObject({ obligationId: 'sample-2', amount: 50000 })
})

test('bank imports require choosing a balance and confirming', async () => {
  const user = userEvent.setup()
  const importBank = vi.fn()
  render(<DummyBank records={makeDemoRecords()} importBank={importBank} />)
  await user.click(screen.getAllByRole('button', { name: 'Import' })[0])
  expect(screen.getByRole('button', { name: 'Confirm sample import' }).disabled).toBe(true)
  await user.selectOptions(screen.getByLabelText('Link to existing obligation'), 'sample-2')
  expect(importBank).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Confirm sample import' }))
  expect(importBank.mock.calls[0][1]).toBe('sample-2')
})

test('voice fallback preserves text and reports unavailable AI without claiming a draft', async () => {
  const user = userEvent.setup()
  render(<MemoryRouter><DraftEntry voice /></MemoryRouter>)
  expect(screen.getByRole('button', { name: 'Start microphone' }).disabled).toBe(true)
  await user.type(screen.getByLabelText('Editable transcript'), 'Ali ne 1000 wapas kiye')
  await user.click(screen.getByRole('button', { name: 'Create draft' }))
  expect(screen.getByLabelText('Editable transcript').value).toBe('Ali ne 1000 wapas kiye')
  expect(screen.getByText(/AI transaction parsing is not connected/)).toBeTruthy()
})

test('sample AI draft retains its source and is not saved before confirmation', async () => {
  const user = userEvent.setup()
  const save = vi.fn()
  render(<MemoryRouter><TransactionForm records={[]} save={save} initialDraft={{ source: 'AI text', type: 'sale', amount: '100', paid: '100', description: 'Sample', category: 'Groceries' }} /></MemoryRouter>)
  await user.click(screen.getByRole('button', { name: 'Review transaction' }))
  expect(save).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Confirm sample entry' }))
  expect(save.mock.calls[0][0].source).toBe('AI text')
})

test('assistant answers from sample records and identifies missing AI service', async () => {
  const user = userEvent.setup()
  render(<Assistant records={makeDemoRecords()} />)
  await user.click(screen.getByRole('button', { name: 'What were my sales this week?' }))
  expect(screen.getByText(/Recorded sample sales: PKR 10,300/)).toBeTruthy()
  await user.type(screen.getByLabelText('Your question'), 'Forecast next year')
  await user.click(screen.getByRole('button', { name: 'Send' }))
  expect(screen.getByText(/This question was not sent to an AI service/)).toBeTruthy()
})

test('receipt starts without extracted fields and payment examples are explicitly synthetic', async () => {
  const user = userEvent.setup()
  const receipt = render(<MemoryRouter><ReceiptAnalyzer /></MemoryRouter>)
  expect(screen.getByLabelText('Total (PKR)').value).toBe('')
  expect(screen.getByRole('button', { name: 'Analyze receipt' }).disabled).toBe(true)
  receipt.unmount()
  render(<PaymentChecker />)
  await user.selectOptions(screen.getByLabelText('Synthetic result example'), 'mismatch')
  expect(screen.getByText(/unrelated to any selected image/)).toBeTruthy()
  expect(screen.getByText(/claims PKR 1,500/)).toBeTruthy()
})
