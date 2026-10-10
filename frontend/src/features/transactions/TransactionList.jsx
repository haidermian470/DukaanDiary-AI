import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, ShoppingBag, Pencil, Trash2 } from 'lucide-react'
import { money, paymentStatus, typeLabels } from './model'

export default function TransactionList({ records, onDelete, compact = false }) {
  return <div className="ledger-list">{records.map((row) => {
    const incoming = ['sale', 'payment_received'].includes(row.type)
    const Icon = row.type === 'sale' ? ShoppingBag : incoming ? ArrowDownLeft : ArrowUpRight
    const settlement = row.type.startsWith('payment_')
    return <article className="ledger-row" key={row.id}>
      <span className={`record-icon ${incoming ? 'green' : 'red'}`}><Icon size={20} /></span>
      <div className="record-detail"><strong>{row.description}</strong><span>{row.party || 'No party'} · {row.date}</span><small>{typeLabels[row.type]} · {row.method}</small></div>
      <div className="record-amount"><strong className={incoming ? 'text-green' : 'text-red'}>{money(row.amount)}</strong><span className={`badge ${settlement || paymentStatus(row) === 'Paid' ? 'green' : 'amber'}`}>{settlement ? 'Linked settlement' : paymentStatus(row)}</span></div>
      {!compact && !settlement && <div className="row-actions"><Link className="icon-button" to={`/transactions/${row.id}/edit`} aria-label={`Edit ${row.description}`} title="Edit"><Pencil size={17} /></Link><button className="icon-button danger" onClick={() => onDelete(row)} aria-label={`Delete ${row.description}`} title="Delete"><Trash2 size={17} /></button></div>}
    </article>
  })}</div>
}
