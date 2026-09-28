import { WHATSAPP, lienWhatsApp } from '../config'
import WhatsAppIcon from './WhatsAppIcon'

/** Bouton rond flottant, placé au-dessus de la barre d'action mobile. */
export default function WhatsAppFloat() {
  if (!WHATSAPP.numero) return null
  return (
    <a
      href={lienWhatsApp()}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Nous écrire sur WhatsApp"
      className="group fixed right-4 bottom-24 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg shadow-black/15 transition hover:scale-105 sm:right-6 sm:bottom-6"
    >
      <WhatsAppIcon className="h-7 w-7" />
      <span className="pointer-events-none absolute right-full mr-3 hidden rounded-full bg-nuit px-3 py-1.5 text-sm whitespace-nowrap text-creme opacity-0 transition group-hover:opacity-100 sm:block">
        Une question ? Écrivez-nous
      </span>
    </a>
  )
}
