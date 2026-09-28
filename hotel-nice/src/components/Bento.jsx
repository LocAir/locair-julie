import { BedDouble, Droplets, Flame, Laptop, ShieldCheck, Sparkles, UserRound, Wifi, Zap } from 'lucide-react'
import Photo from './Photo'
import RoomCarousel from './RoomCarousel'
import { IMAGES } from '../config'

const badgesChambre = [
  { icon: Wifi, label: 'Wi-Fi Pro inclus' },
  { icon: Laptop, label: 'Bureau dédié' },
  { icon: BedDouble, label: 'Linge fourni' },
]

const services = [
  { icon: Zap, label: 'Électricité' },
  { icon: Droplets, label: 'Eau' },
  { icon: Flame, label: 'Chauffage' },
  { icon: Wifi, label: 'Wi-Fi fibre' },
  { icon: Sparkles, label: 'Ménage hebdo' },
]

export default function Bento() {
  return (
    <section id="confort" className="py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mb-10 max-w-2xl sm:mb-14">
          <p className="text-sm font-medium tracking-widest text-sable-500 uppercase">Immersion & confort</p>
          <h2 className="mt-3 font-display text-3xl font-medium tracking-tight text-nuit sm:text-4xl">
            Nous vous aidons à vous sentir chez vous, dès le premier soir.
          </h2>
        </div>

        {/* Grille Bento : 1 colonne sur mobile, asymétrique sur grand écran */}
        <div className="grid auto-rows-[minmax(0,auto)] grid-cols-1 gap-4 md:grid-cols-6 lg:gap-5">
          {/* Bloc 1 — Réception (grand format) */}
          <article className="relative overflow-hidden rounded-3xl bg-nuit text-creme md:col-span-6 lg:col-span-4 lg:row-span-2 lg:min-h-[36rem]">
            <Photo
              src={IMAGES.reception.src}
              alt={IMAGES.reception.alt}
              label="Photo de la réception"
              className="h-64 w-full sm:h-80 lg:absolute lg:inset-0 lg:h-full"
            />
            <div aria-hidden className="absolute inset-0 hidden bg-gradient-to-t from-nuit via-nuit/40 to-transparent lg:block" />
            <div className="relative p-6 sm:p-8 lg:absolute lg:inset-x-0 lg:bottom-0 lg:p-10">
              <span className="inline-flex items-center gap-2 rounded-full bg-creme/10 px-3 py-1 text-xs font-medium text-sable-300 backdrop-blur">
                <ShieldCheck className="h-4 w-4" aria-hidden /> Présence humaine 24/7
              </span>
              <h3 className="mt-4 font-display text-2xl font-medium sm:text-3xl">Un accueil professionnel et sécurisé</h3>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-creme/80 sm:text-base">
                Fini les annonces douteuses et les propriétaires injoignables. Ici, une équipe est
                là jour et nuit : accès sécurisé, réception toujours ouverte, et quelqu'un pour
                vous aider au moindre souci. Vous n'êtes pas seul dans une location entre
                particuliers — vous êtes accompagné.
              </p>
            </div>
          </article>

          {/* Bloc 2 — Carrousel des chambres */}
          <article className="md:col-span-3 lg:col-span-2 lg:row-span-2">
            <RoomCarousel slides={IMAGES.chambres} badges={badgesChambre} />
          </article>

          {/* Bloc 3 — Services tout inclus */}
          <article className="flex flex-col justify-between rounded-3xl bg-foret p-6 text-creme sm:p-8 md:col-span-3 lg:col-span-3">
            <div>
              <p className="text-xs font-medium tracking-widest text-sable-300 uppercase">Tout inclus</p>
              <h3 className="mt-2 font-display text-2xl font-medium">Un seul loyer, zéro facture surprise</h3>
              <p className="mt-2 text-sm leading-relaxed text-creme/80">
                Pas d'abonnement à ouvrir, pas de compteur à relever. On vous aide à simplifier
                votre budget : tout est compris dans votre formule mensuelle.
              </p>
            </div>
            <ul className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {services.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-2 rounded-xl bg-creme/10 px-3 py-2.5 text-sm">
                  <Icon className="h-4 w-4 shrink-0 text-sable-300" aria-hidden />
                  {label}
                </li>
              ))}
            </ul>
          </article>

          {/* Bloc 4 — Photo d'ambiance + mot de l'équipe */}
          <article className="relative overflow-hidden rounded-3xl md:col-span-6 lg:col-span-3">
            <div className="grid h-full grid-cols-1 sm:grid-cols-2">
              <Photo src={IMAGES.services.src} alt={IMAGES.services.alt} label="Photo d'ambiance" className="h-48 w-full sm:h-full" />
              <div className="flex flex-col justify-center bg-sable-100 p-6 sm:p-7">
                <UserRound className="h-6 w-6 text-foret" aria-hidden />
                <p className="mt-3 font-display text-lg leading-snug text-nuit">
                  « Notre rôle : vous aider à trouver le bon logement et vous installer sans stress. »
                </p>
                <p className="mt-2 text-sm text-gris">— L'équipe de réception</p>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  )
}
