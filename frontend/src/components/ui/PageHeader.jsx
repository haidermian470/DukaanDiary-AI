export default function PageHeader({ title, actions }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  )
}
