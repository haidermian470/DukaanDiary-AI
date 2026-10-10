import { Link } from 'react-router-dom'
import { ArrowLeft, CirclePause } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Feedback from '../components/ui/Feedback'

export default function PendingScreen({ title, bank = false }) {
  return <><PageHeader title={title} />{bank && <p className="demo-note">DEMO — NO REAL BANK CONNECTION</p>}<Feedback title="Not available yet"><CirclePause size={32} className="text-indigo" /><p>This service is not connected. No records have been changed.</p><Link className="button" to="/"><ArrowLeft size={16} />Back to overview</Link></Feedback></>
}
