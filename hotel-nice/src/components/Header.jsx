import { useEffect, useState } from 'react'
import { HOTEL } from '../config'

export default function Header() {
  const [scrolle, setScrolle] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolle(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolle ? 'bg-creme/90 shadow-[0_1px_0_rgba(31,27,22,0.08)] backdrop-blur-md' : 'bg-transparent'
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:h-20 sm:px-6">
        <a href="#top" className="min-w-0">
          <span className="block font-display text-lg font-semibold leading-tight text-nuit sm:text-xl">
            {HOTEL.nom}
          </span>
          <span className="hidden truncate text-xs text-gris sm:block">{HOTEL.slogan}</span>
        </a>

        <nav className="flex items-center gap-6">
          <div className="hidden items-center gap-6 text-sm text-gris md:flex">
            <a href="#confort" className="hover:text-nuit">Le lieu</a>
            <a href="#pour-qui" className="hover:text-nuit">Pour qui ?</a>
            <a href="#faq" className="hover:text-nuit">FAQ</a>
          </div>
          <a
            href="#reservation"
            className="shrink-0 rounded-full bg-nuit px-4 py-2.5 text-sm font-medium text-creme transition hover:bg-nuit-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nuit sm:px-5"
          >
            Réserver mon séjour
          </a>
        </nav>
      </div>
    </header>
  )
}
