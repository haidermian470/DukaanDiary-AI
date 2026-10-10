import { CalendarDays } from 'lucide-react'

export default function DateFilter({ period, onPeriod, custom, onCustom, allowAll = false }) {
  return <div className="date-filter">
    <div className="filter-pills" role="group" aria-label="Date range">
      {[['today', 'Today (Aaj)'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Custom'], ...(allowAll ? [['all', 'All dates']] : [])].map(([key, label]) => <button type="button" key={key} aria-pressed={period === key} onClick={() => onPeriod(key)}>{key === 'custom' && <CalendarDays size={16} />}{label}</button>)}
    </div>
    {period === 'custom' && <div className="custom-dates"><label>From<input type="date" value={custom.start} max={custom.end || undefined} onChange={(e) => onCustom({ ...custom, start: e.target.value })} /></label><label>To<input type="date" min={custom.start || undefined} value={custom.end} onChange={(e) => onCustom({ ...custom, end: e.target.value })} /></label>{(!custom.start || !custom.end || custom.start > custom.end) && <p role="alert">Choose a valid start and end date.</p>}</div>}
  </div>
}
