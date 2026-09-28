import { Mail, MapPin } from 'lucide-react'
import { HOTEL, WHATSAPP, lienWhatsApp } from '../config'
import WhatsAppIcon from './WhatsAppIcon'

export default function Footer() {
  return (
    <footer className="bg-nuit pt-14 pb-28 text-creme/80 sm:pb-14">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 sm:px-6 md:grid-cols-3">
        <div>
          <p className="font-display text-2xl text-creme">{HOTEL.nom}</p>
          <p className="mt-2 text-sm">{HOTEL.slogan}</p>
        </div>
        <ul className="space-y-3 text-sm">
          <li className="flex items-center gap-3"><MapPin className="h-4 w-4 text-sable-300" aria-hidden />{HOTEL.adresse}</li>
          {WHATSAPP.numero && (
            <li className="flex items-center gap-3">
              <WhatsAppIcon className="h-4 w-4 text-sable-300" />
              <a href={lienWhatsApp()} target="_blank" rel="noopener noreferrer" className="hover:text-creme">WhatsApp</a>
            </li>
          )}
          <li className="flex items-center gap-3">
            <Mail className="h-4 w-4 text-sable-300" aria-hidden />
            <a href={`mailto:${HOTEL.email}`} className="hover:text-creme">{HOTEL.email}</a>
          </li>
        </ul>
        <div className="md:text-right">
          <a href="#reservation" className="inline-flex rounded-full bg-creme px-6 py-3 text-sm font-medium text-nuit transition hover:bg-sable-100">
            Réserver mon séjour
          </a>
          <p className="mt-4 text-xs text-creme/50">© {new Date().getFullYear()} {HOTEL.nom} · Séjours d'octobre à mars</p>
        </div>
      </div>
    </footer>
  )
}
