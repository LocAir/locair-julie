import { Check, MapPin } from 'lucide-react'

const reassurances = [
  'Sans caution excessive',
  "Pas de frais d'agence",
  'Ménage et charges compris',
  'Accueil professionnel 24/7',
]

export default function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pt-28 pb-16 sm:pt-36 sm:pb-24">
      {/* halos de lumière douce */}
      <div aria-hidden className="pointer-events-none absolute -top-40 -right-32 h-[28rem] w-[28rem] rounded-full bg-sable-200/70 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -left-32 h-[24rem] w-[24rem] rounded-full bg-foret-50 blur-3xl" />

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-3xl">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-sable-300 bg-creme/70 px-3.5 py-1.5 text-xs font-medium text-foret sm:text-sm">
            <MapPin className="h-4 w-4" aria-hidden />
            Nous vous aidons à trouver votre logement à Nice · octobre → mars
          </p>

          <h1 className="font-display text-4xl leading-[1.08] font-medium tracking-tight text-nuit sm:text-5xl lg:text-6xl">
            Changez d'hiver. Posez vos valises au soleil,{' '}
            <span className="italic text-foret">on s'occupe de tout.</span>
          </h1>

          <p className="mt-6 max-w-2xl text-base leading-relaxed text-gris sm:text-lg">
            Trouver un logement temporaire à Nice, c'est souvent compliqué. Nous vous aidons à
            vous installer vite, dans le confort et la sécurité d'un hôtel — que vous soyez
            saisonnier, étudiant ou nomade. Formules flexibles au mois, charges et Wi-Fi haut
            débit inclus.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href="#reservation"
              className="inline-flex items-center justify-center rounded-full bg-foret px-7 py-4 text-base font-medium text-creme shadow-lg shadow-foret/20 transition hover:-translate-y-0.5 hover:bg-[#263d30] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foret"
            >
              Demander mes disponibilités
            </a>
            <span className="text-sm text-gris sm:ml-2">Réponse personnalisée sous 24 h · sans engagement</span>
          </div>
        </div>

        <ul className="mt-12 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {reassurances.map((r) => (
            <li
              key={r}
              className="flex items-center gap-3 rounded-2xl border border-sable-200 bg-white/60 px-4 py-3.5 text-sm font-medium text-nuit backdrop-blur"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foret text-creme">
                <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
              </span>
              {r}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
