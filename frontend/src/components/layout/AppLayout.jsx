import { NavLink, Link, Outlet, useLocation } from 'react-router-dom'
import { LayoutDashboard, BookOpen, Mic, Handshake, ShieldCheck, ReceiptText, Landmark, MessageCircle, ChartNoAxesCombined, FileChartColumn, Settings, Store, Menu, X, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

const navigation = [
  ['/', 'Overview', LayoutDashboard], ['/transactions', 'Rokad', BookOpen], ['/voice', 'Voice Khata', Mic], ['/credit', 'Khata', Handshake], ['/payment-check', 'Tasdeeq', ShieldCheck], ['/ai-entry', 'AI entry', Sparkles], ['/receipts', 'Receipts', ReceiptText], ['/dummy-bank', 'Dummy Bank', Landmark], ['/assistant', 'AI Munshi', MessageCircle], ['/insights', 'Expense insights', ChartNoAxesCombined], ['/reports', 'Reports', FileChartColumn], ['/settings', 'Settings', Settings],
]
export default function AppLayout({ profile }) {
  const [menu, setMenu] = useState(false)
  const location = useLocation()
  useEffect(() => {
    document.getElementById('main')?.focus()
    window.scrollTo(0, 0)
  }, [location.pathname])
  const close = () => setMenu(false)
  return <>
    <a href="#main" className="skip-link">Skip to content</a>
    <header className="app-header"><Link to="/" className="brand" onClick={close}><span className="brand-mark"><Store size={23} /></span><span><strong>DukaanDiary AI <small>PK</small></strong><span className="brand-subtitle">{profile.store} · Sample workspace</span></span></Link><button className="icon-button menu-toggle" aria-label={menu ? 'Close navigation' : 'Open navigation'} aria-expanded={menu} aria-controls="main-navigation" onClick={() => setMenu(!menu)}>{menu ? <X /> : <Menu />}</button><Link className="avatar" to="/settings" aria-label="Profile and settings">{profile.name.slice(0, 2).toUpperCase()}</Link></header>
    <div className="app-shell"><nav id="main-navigation" aria-label="Main navigation" className={`sidebar ${menu ? 'is-open' : ''}`}>{navigation.map(([path, label, Icon]) => <NavLink key={path} to={path} end={path === '/'} onClick={close}><Icon size={19} /><span>{label}</span></NavLink>)}<div className="sidebar-note">AICON 2026<br /><span>Demo workspace</span></div></nav>
      <main id="main" tabIndex={-1}><div className="demo-notice"><span className="status-dot" />Sample data only · Changes stay in this tab and reset on reload</div><Outlet /></main>
    </div>
    <nav className="bottom-nav" aria-label="Quick navigation">{navigation.slice(0, 5).map(([path, label, Icon], index) => <NavLink key={path} to={path} end={path === '/'} className={index === 2 ? 'voice-link' : ''}><span><Icon size={22} /></span><small>{index === 2 ? 'AI Quick' : label}</small></NavLink>)}</nav>
  </>
}
