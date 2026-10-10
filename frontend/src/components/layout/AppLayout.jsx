import { NavLink, Link, Outlet, useLocation } from 'react-router-dom'
import { LayoutDashboard, BookOpen, Mic, Handshake, ShieldCheck, ReceiptText, Landmark, MessageCircle, ChartNoAxesCombined, FileChartColumn, Settings, Menu, X, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import BrandLogo from './BrandLogo'

const navigation = [
  ['/', 'Overview', LayoutDashboard], ['/transactions', 'Rokad', BookOpen], ['/voice', 'Voice Khata', Mic], ['/credit', 'Khata', Handshake], ['/payment-check', 'Tasdeeq', ShieldCheck], ['/ai-entry', 'AI entry', Sparkles], ['/receipts', 'Receipts', ReceiptText], ['/dummy-bank', 'Dummy Bank', Landmark], ['/assistant', 'AI Munshi', MessageCircle], ['/insights', 'Expense insights', ChartNoAxesCombined], ['/reports', 'Reports', FileChartColumn], ['/settings', 'Settings', Settings],
]

function initials(name) {
  return (name || '?').trim().slice(0, 2).toUpperCase() || '?'
}

// Moves focus to the main region. With hash routing, a plain "#main" link would be
// read by the router as a page path, so focus is moved directly instead.
function focusMain(event) {
  event?.preventDefault()
  const main = document.getElementById('main')
  main?.focus()
  main?.scrollIntoView?.({ block: 'start' })
}

export default function AppLayout({ profile, mode = 'demo', notice }) {
  const [menu, setMenu] = useState(false)
  const location = useLocation()
  const toggleRef = useRef(null)
  const navRef = useRef(null)
  const firstRender = useRef(true)

  useEffect(() => {
    // Announce page changes to keyboard and screen-reader users, but not on first load.
    if (firstRender.current) { firstRender.current = false; return }
    document.getElementById('main')?.focus({ preventScroll: true })
    window.scrollTo(0, 0)
  }, [location.pathname])

  useEffect(() => {
    if (!menu) return
    navRef.current?.querySelector('a')?.focus()
    const onKey = (event) => {
      if (event.key === 'Escape') { setMenu(false); toggleRef.current?.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menu])

  const close = () => setMenu(false)
  const subtitle = mode === 'live' ? profile.store : `${profile.store} · Sample workspace`
  return <>
    <a href="#main" className="skip-link" onClick={focusMain}>Skip to content</a>
    <header className="app-header"><Link to="/" className="brand" onClick={close} aria-label={`DukaanDiary home, ${subtitle}`}><BrandLogo alt="" /><span className="brand-subtitle">{subtitle}</span></Link><button ref={toggleRef} type="button" className="icon-button menu-toggle" aria-label={menu ? 'Close navigation' : 'Open navigation'} aria-expanded={menu} aria-controls="main-navigation" onClick={() => setMenu(!menu)}>{menu ? <X /> : <Menu />}</button><Link className="avatar" to="/settings" aria-label="Profile and settings">{initials(profile.name)}</Link></header>
    <div className="app-shell"><nav ref={navRef} id="main-navigation" aria-label="Main navigation" className={`sidebar ${menu ? 'is-open' : ''}`}>{navigation.map(([path, label, Icon]) => <NavLink key={path} to={path} end={path === '/'} onClick={close}><Icon size={19} /><span>{label}</span></NavLink>)}<div className="sidebar-note">AICON 2026<br /><span>{mode === 'live' ? 'Live workspace' : 'Demo workspace'}</span></div></nav>
      <main id="main" tabIndex={-1} inert={menu || undefined}>{mode === 'live' ? notice : <div className="demo-notice"><span className="status-dot" />Sample data only · Changes stay in this tab and reset on reload</div>}<Outlet /></main>
    </div>
    <nav className="bottom-nav" aria-label="Quick navigation" inert={menu || undefined}>{navigation.slice(0, 5).map(([path, label, Icon], index) => <NavLink key={path} to={path} end={path === '/'} className={index === 2 ? 'voice-link' : ''}><span><Icon size={22} /></span><small>{index === 2 ? 'AI Quick' : label}</small></NavLink>)}</nav>
  </>
}
