export default function Feedback({ kind = 'empty', title, children, action }) {
  const role = kind === 'error' ? 'alert' : ['loading', 'success'].includes(kind) ? 'status' : undefined

  return (
    <section className={`feedback feedback-${kind}`} role={role}>
      <h2>{title}</h2>
      {children}
      {action}
    </section>
  )
}
