import logo from '../../assets/logo.png'

/** The DukaanDiary logo (icon and wordmark). The image carries the name, so alt text repeats it. */
export default function BrandLogo({ className = 'brand-logo', alt = 'DukaanDiary' }) {
  return <img className={className} src={logo} alt={alt} width="419" height="160" decoding="async" />
}
