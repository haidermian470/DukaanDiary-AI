import { Link } from 'react-router-dom'
import { ShoppingBag, ArrowUpRight, Truck, Pencil, Trash2, ChevronRight } from 'lucide-react'
import { money } from '../../features/transactions/model'
import { SETTLEMENT_LABELS, categoryLabel, statusTone, typeLabel } from '../../services/adapters'
import { DemoTag } from '../ui'

const ICONS = { sale: ShoppingBag, purchase: Truck, expense: ArrowUpRight }

/** Ledger rows for backend transactions. Balances and statuses come from the server. */
export default function TransactionRows({ rows, onVoid, compact = false }) {
  return <div className="ledger-list">{rows.map((row) => {
    const Icon = ICONS[row.type] ?? ShoppingBag
    const incoming = row.type === 'sale'
    return <article className="ledger-row" key={row.id}>
      <span className={`record-icon ${incoming ? 'green' : 'red'}`}><Icon size={20} /></span>
      <div className="record-detail">
        <Link to={`/transactions/${row.id}`} className="record-link"><strong>{row.description}</strong></Link>
        <span>{row.party || 'No customer or supplier'} · {row.date}</span>
        <small>{typeLabel(row.type)} · {categoryLabel(row.category)}{row.isOverdue ? ' · Overdue' : ''}</small>
        <DemoTag show={row.isDemo} />
      </div>
      <div className="record-amount">
        <strong className={incoming ? 'text-green' : 'text-red'}>{money(row.amount)}</strong>
        <span className={`badge ${statusTone(row.status)}`}>{SETTLEMENT_LABELS[row.status] ?? row.status}</span>
        {row.outstanding > 0 && <small className="record-due">{money(row.outstanding)} due</small>}
      </div>
      {compact ? <Link className="icon-button" to={`/transactions/${row.id}`} aria-label={`Open ${row.description}`} title="Open"><ChevronRight size={18} /></Link>
        : <div className="row-actions">
          <Link className="icon-button" to={`/transactions/${row.id}/edit`} aria-label={`Edit ${row.description}`} title="Edit"><Pencil size={17} /></Link>
          <button type="button" className="icon-button danger" onClick={() => onVoid(row)} aria-label={`Void ${row.description}`} title="Void"><Trash2 size={17} /></button>
        </div>}
    </article>
  })}</div>
}
