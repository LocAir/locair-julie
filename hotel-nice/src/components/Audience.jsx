import { Briefcase, GraduationCap, Laptop } from 'lucide-react'

const profils = [
  {
    icon: GraduationCap,
    titre: 'Étudiants',
    accroche: 'Pour un semestre, un stage ou une transition.',
    texte:
      "Vous arrivez à Nice pour vos études ? Nous vous aidons à trouver un logement sans garant introuvable ni bail d'un an : une chambre calme, un bureau pour réviser, et tout est compris.",
    points: ['Durée calée sur votre semestre', 'Budget clair, sans surprise', 'Proche des transports'],
  },
  {
    icon: Briefcase,
    titre: 'Saisonniers & salariés en mission',
    accroche: 'Un logement immédiat, sans prise de tête.',
    texte:
      "Un contrat qui démarre lundi ? On vous aide à être logé en quelques jours. Vous posez vos valises, on gère le linge, le ménage et les charges. Vous vous concentrez sur votre travail.",
    points: ['Entrée rapide', 'Ménage hebdomadaire inclus', 'Facture possible pour votre employeur'],
  },
  {
    icon: Laptop,
    titre: 'Nomades digitaux & télétravailleurs',
    accroche: 'Le combo bureau + soleil d’hiver.',
    texte:
      "Travaillez face à la Méditerranée plutôt que sous la grisaille. Nous vous aidons à trouver le bon pied-à-terre : Wi-Fi fibre fiable, vrai poste de travail, et la mer à deux pas pour la pause.",
    points: ['Wi-Fi pro haut débit', 'Bureau et chaise ergonomique', 'Formule au mois, renouvelable'],
  },
]

export default function Audience() {
  return (
    <section id="pour-qui" className="bg-sable-100 py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <p className="text-sm font-medium tracking-widest text-sable-500 uppercase">Pour qui ?</p>
          <h2 className="mt-3 font-display text-3xl font-medium tracking-tight text-nuit sm:text-4xl">
            Quel que soit votre projet, on vous aide à trouver votre place.
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {profils.map(({ icon: Icon, titre, accroche, texte, points }) => (
            <article
              key={titre}
              className="flex flex-col rounded-3xl border border-sable-200 bg-creme p-7 transition hover:-translate-y-1 hover:shadow-xl hover:shadow-sable-300/30"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-foret-50 text-foret">
                <Icon className="h-6 w-6" aria-hidden />
              </span>
              <h3 className="mt-5 font-display text-xl font-medium text-nuit">{titre}</h3>
              <p className="mt-1 text-sm font-medium text-foret">{accroche}</p>
              <p className="mt-4 text-sm leading-relaxed text-gris">{texte}</p>
              <ul className="mt-5 space-y-2 border-t border-sable-200 pt-5 text-sm text-nuit">
                {points.map((p) => (
                  <li key={p} className="flex items-start gap-2">
                    <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sable-500" />
                    {p}
                  </li>
                ))}
              </ul>
              <a href="#reservation" className="mt-6 text-sm font-medium text-nuit underline decoration-sable-300 underline-offset-4 hover:decoration-nuit">
                Je veux être aidé(e) →
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
