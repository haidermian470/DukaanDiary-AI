import { afterEach, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import AppLayout from '../src/components/layout/AppLayout'

afterEach(cleanup)

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function renderLayout(path = '/transactions') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route element={<AppLayout profile={{ name: 'Ahmed', store: 'Test Store' }} />}><Route path="*" element={<Where />} /></Route></Routes></MemoryRouter>)
}

test('skip link focuses the main region without changing the route', async () => {
  const user = userEvent.setup()
  renderLayout()
  await user.click(screen.getByText('Skip to content'))
  expect(screen.getByTestId('where').textContent).toBe('/transactions')
  expect(document.activeElement).toBe(document.getElementById('main'))
})

test('main region is not focused on first load', () => {
  renderLayout()
  expect(document.activeElement).not.toBe(document.getElementById('main'))
})

test('mobile menu moves focus into navigation, makes content inert, and closes with Escape', async () => {
  const user = userEvent.setup()
  renderLayout()
  const toggle = screen.getByRole('button', { name: 'Open navigation' })
  await user.click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(document.getElementById('main').hasAttribute('inert')).toBe(true)
  expect(document.activeElement.closest('#main-navigation')).not.toBeNull()
  await user.keyboard('{Escape}')
  expect(screen.getByRole('button', { name: 'Open navigation' }).getAttribute('aria-expanded')).toBe('false')
  expect(document.getElementById('main').hasAttribute('inert')).toBe(false)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open navigation' }))
})
