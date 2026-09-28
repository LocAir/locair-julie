import { useState } from 'react'
import { Plus } from 'lucide-react'

const questions = [
  {
    q: 'Quelle est la durée minimale de séjour ?',
    r: "Un mois. Vous pouvez ensuite prolonger mois par mois, jusqu'à fin mars, selon vos besoins. Un stage de 6 semaines ou une mission de 4 mois ? On vous aide à trouver la formule qui colle à vos dates.",
  },
  {
    q: 'Le ménage est-il vraiment inclus ?',
    r: "Oui. Votre chambre est nettoyée chaque semaine et le linge (draps et serviettes) est changé. Vous gardez bien sûr votre intimité : on s'organise avec vous pour le créneau qui vous arrange.",
  },
  {
    q: 'Comment valider mon dossier ?',
    r: "C'est simple et rapide : une pièce d'identité, un justificatif de situation (carte étudiant, contrat de travail, attestation de mission ou de revenus) et c'est tout. Après votre demande, nous vous rappelons et nous vous aidons à rassembler les documents — pas de paperasse inutile, pas de garant introuvable.",
  },
  {
    q: 'Y a-t-il un dépôt de garantie ?',
    r: "Un dépôt raisonnable, sans commune mesure avec une location classique (souvent 2 mois de loyer). Il vous est intégralement restitué à votre départ après un rapide état des lieux. Pas de frais d'agence, jamais.",
  },
  {
    q: 'Qu’est-ce qui est compris dans le prix mensuel ?',
    r: "Tout le quotidien : électricité, eau, chauffage, Wi-Fi haut débit, ménage hebdomadaire, linge de lit et de toilette, et l'accès à la réception 24 h/24. Vous n'avez aucun abonnement à ouvrir.",
  },
  {
    q: 'Puis-je recevoir du courrier et des colis ?',
    r: "Oui, la réception réceptionne votre courrier et vos colis et vous prévient dès leur arrivée. Pratique pour vos démarches administratives ou vos achats en ligne.",
  },
]

export default function Faq() {
  const [ouvert, setOuvert] = useState(0)

  return (
    <section id="faq" className="bg-sable-100 py-16 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="mb-10 text-center">
          <p className="text-sm font-medium tracking-widest text-sable-500 uppercase">FAQ</p>
          <h2 className="mt-3 font-display text-3xl font-medium tracking-tight text-nuit sm:text-4xl">
            Vos questions, nos réponses franches
          </h2>
        </div>

        <div className="divide-y divide-sable-200 overflow-hidden rounded-3xl border border-sable-200 bg-creme">
          {questions.map(({ q, r }, i) => {
            const estOuvert = ouvert === i
            return (
              <div key={q}>
                <h3>
                  <button
                    type="button"
                    id={`faq-q-${i}`}
                    aria-expanded={estOuvert}
                    aria-controls={`faq-r-${i}`}
                    onClick={() => setOuvert(estOuvert ? -1 : i)}
                    className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left font-medium text-nuit transition hover:bg-sable-100/60 focus-visible:bg-sable-100/60 focus-visible:outline-none sm:px-8"
                  >
                    {q}
                    <Plus
                      className={`h-5 w-5 shrink-0 text-foret transition-transform duration-300 ${estOuvert ? 'rotate-45' : ''}`}
                      aria-hidden
                    />
                  </button>
                </h3>
                <div
                  id={`faq-r-${i}`}
                  role="region"
                  aria-labelledby={`faq-q-${i}`}
                  className={`grid transition-all duration-300 ease-out ${estOuvert ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
                >
                  <div className="overflow-hidden">
                    <p className="px-6 pb-6 leading-relaxed text-gris sm:px-8">{r}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <p className="mt-8 text-center text-sm text-gris">
          Une autre question ?{' '}
          <a href="#reservation" className="font-medium text-nuit underline underline-offset-4">
            Écrivez-nous, on vous aide.
          </a>
        </p>
      </div>
    </section>
  )
}
