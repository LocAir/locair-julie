import { useEffect, useState } from 'react'

/** Barre d'action collée en bas sur mobile, masquée une fois le formulaire visible. */
export default function MobileCta() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const form = document.getElementById('reservation')
    let formVisible = false
    const maj = () => setVisible(window.scrollY > 500 && !formVisible)
    const obs = new IntersectionObserver(([e]) => {
      formVisible = e.isIntersecting
      maj()
    })
    if (form) obs.observe(form)
    window.addEventListener('scroll', maj, { passive: true })
    return () => {
      obs.disconnect()
      window.removeEventListener('scroll', maj)
    }
  }, [])

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-sable-200 bg-creme/95 p-3 backdrop-blur transition-transform duration-300 sm:hidden ${
        visible ? 'translate-y-0' : 'translate-y-full'
      }`}
    >
      <a href="#reservation" tabIndex={visible ? 0 : -1} className="flex w-full items-center justify-center rounded-full bg-foret py-3.5 font-medium text-creme">
        Demander mes disponibilités
      </a>
    </div>
  )
}
