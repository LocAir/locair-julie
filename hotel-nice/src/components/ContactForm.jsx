import { useState } from 'react'
import { CalendarDays, CheckCircle2, Clock, Loader2, Lock, PhoneCall, Send } from 'lucide-react'
import { CALENDLY_URL, FORM_ENDPOINT, HOTEL, WHATSAPP, lienCalendly, lienWhatsApp } from '../config'
import WhatsAppIcon from './WhatsAppIcon'

const PROFILS = ['Étudiant', 'Salarié en mission', 'Nomade digital', 'Autre']
const DUREES = ['1 mois', '2 mois', '3 mois ou plus']

const VIDE = { nom: '', email: '', telephone: '', profil: '', duree: '', message: '', site: '' }

function valider(v) {
  const e = {}
  if (v.nom.trim().length < 2) e.nom = 'Indiquez votre prénom et votre nom.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = 'Cette adresse e-mail semble incomplète.'
  if (v.telephone.replace(/[^\d]/g, '').length < 9) e.telephone = 'Indiquez un numéro où l’on peut vous rappeler.'
  if (!v.profil) e.profil = 'Choisissez votre profil.'
  if (!v.duree) e.duree = 'Choisissez une durée.'
  return e
}

const etapes = [
  { icon: Send, titre: 'Vous nous écrivez', texte: 'Deux minutes suffisent. Aucun paiement demandé.' },
  { icon: PhoneCall, titre: 'On vous rappelle sous 24 h', texte: 'Pour comprendre votre besoin et vous proposer la bonne chambre.' },
  { icon: CheckCircle2, titre: 'Vous posez vos valises', texte: 'On vous aide à monter votre dossier simplement, puis on vous accueille.' },
]

export default function ContactForm() {
  const [valeurs, setValeurs] = useState(VIDE)
  const [erreurs, setErreurs] = useState({})
  const [statut, setStatut] = useState('idle') // idle | envoi | succes | echec

  const maj = (champ) => (ev) => {
    setValeurs((v) => ({ ...v, [champ]: ev.target.value }))
    if (erreurs[champ]) setErreurs((e) => ({ ...e, [champ]: undefined }))
  }

  const soumettre = async (ev) => {
    ev.preventDefault()
    const e = valider(valeurs)
    setErreurs(e)
    if (Object.keys(e).length) {
      document.getElementById(`champ-${Object.keys(e)[0]}`)?.focus()
      return
    }
    if (valeurs.site) return setStatut('succes') // pot de miel anti-robots

    setStatut('envoi')
    try {
      if (FORM_ENDPOINT) {
        const { site, ...donnees } = valeurs
        const rep = await fetch(FORM_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ ...donnees, _subject: `Demande de séjour — ${donnees.nom}` }),
        })
        if (!rep.ok) throw new Error('Envoi refusé')
      } else {
        await new Promise((r) => setTimeout(r, 900)) // mode démo
      }
      setStatut('succes')
    } catch {
      setStatut('echec')
    }
  }

  const champ = (nom) =>
    `w-full rounded-xl border bg-white px-4 py-3 text-base text-encre placeholder:text-gris/60 transition focus:outline-none focus:ring-4 ${
      erreurs[nom] ? 'border-red-400 focus:ring-red-100' : 'border-sable-200 focus:border-foret focus:ring-foret/10'
    }`

  const Erreur = ({ nom }) =>
    erreurs[nom] ? (
      <p id={`err-${nom}`} className="mt-1.5 text-sm text-red-600">
        {erreurs[nom]}
      </p>
    ) : null

  const aria = (nom) => ({
    id: `champ-${nom}`,
    'aria-invalid': Boolean(erreurs[nom]),
    'aria-describedby': erreurs[nom] ? `err-${nom}` : undefined,
  })

  return (
    <section id="reservation" className="py-16 sm:py-24">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 sm:px-6 lg:grid-cols-5 lg:gap-14">
        {/* Colonne gauche : réassurance */}
        <div className="lg:col-span-2">
          <p className="text-sm font-medium tracking-widest text-sable-500 uppercase">Demande prioritaire</p>
          <h2 className="mt-3 font-display text-3xl font-medium tracking-tight text-nuit sm:text-4xl">
            Dites-nous ce que vous cherchez. On s'occupe de vous trouver la bonne chambre.
          </h2>
          <p className="mt-4 text-gris">
            Les chambres disponibles cet hiver sont en nombre limité. Laissez-nous vos
            coordonnées : un membre de l'équipe vous aide personnellement, sans engagement.
          </p>

          <ol className="mt-8 space-y-5">
            {etapes.map(({ icon: Icon, titre, texte }, i) => (
              <li key={titre} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-nuit text-sm font-semibold text-creme">
                  {i + 1}
                </span>
                <div>
                  <p className="flex items-center gap-2 font-medium text-nuit">
                    <Icon className="h-4 w-4 text-foret" aria-hidden /> {titre}
                  </p>
                  <p className="mt-0.5 text-sm text-gris">{texte}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-8 rounded-2xl border border-sable-200 bg-sable-100/60 p-5">
            <p className="text-sm font-medium text-nuit">Vous préférez échanger directement ?</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {WHATSAPP.numero && (
                <a
                  href={lienWhatsApp()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#25D366] px-5 py-3 text-sm font-medium text-white transition hover:brightness-95"
                >
                  <WhatsAppIcon className="h-4 w-4" /> Écrire sur WhatsApp
                </a>
              )}
              {CALENDLY_URL && (
                <a
                  href={lienCalendly()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-nuit/20 bg-creme px-5 py-3 text-sm font-medium text-nuit transition hover:border-nuit"
                >
                  <CalendarDays className="h-4 w-4" aria-hidden /> Réserver un appel
                </a>
              )}
            </div>
            <p className="mt-3 text-xs text-gris">
              Ou par téléphone :{' '}
              <a href={`tel:${HOTEL.telephone.replace(/\s/g, '')}`} className="font-medium text-nuit underline underline-offset-4">
                {HOTEL.telephone}
              </a>
            </p>
          </div>
        </div>

        {/* Colonne droite : formulaire */}
        <div className="lg:col-span-3">
          <div className="rounded-3xl border border-sable-200 bg-white p-6 shadow-xl shadow-sable-300/20 sm:p-9">
            {statut === 'succes' ? (
              <div className="flex flex-col items-center py-10 text-center" role="status" aria-live="polite">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-foret-50 text-foret">
                  <CheckCircle2 className="h-9 w-9" aria-hidden />
                </span>
                <h3 className="mt-6 font-display text-2xl font-medium text-nuit">
                  Merci {valeurs.nom.split(' ')[0]}, c'est bien reçu !
                </h3>
                <p className="mt-3 max-w-md text-gris">
                  Votre demande prioritaire est entre de bonnes mains. Nous vous recontactons
                  sous 24 h au <strong className="text-nuit">{valeurs.telephone}</strong> ou par
                  e-mail pour vous aider à trouver la chambre qui vous correspond.
                </p>
                {CALENDLY_URL && (
                  <div className="mt-8 w-full max-w-md rounded-2xl bg-sable-100 p-5">
                    <p className="font-medium text-nuit">Pour aller plus vite, choisissez dès maintenant votre créneau d'appel (15 min).</p>
                    <a
                      href={lienCalendly({ nom: valeurs.nom, email: valeurs.email })}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-nuit px-6 py-3.5 font-medium text-creme transition hover:bg-nuit-700"
                    >
                      <CalendarDays className="h-5 w-5" aria-hidden /> Choisir mon créneau
                    </a>
                  </div>
                )}
                {WHATSAPP.numero && (
                  <a
                    href={lienWhatsApp(`Bonjour, je viens d'envoyer une demande sur votre site (${valeurs.nom}, ${valeurs.profil}, ${valeurs.duree}).`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-foret underline underline-offset-4"
                  >
                    <WhatsAppIcon className="h-4 w-4" /> Une question urgente ? Écrivez-nous sur WhatsApp
                  </a>
                )}
                <p className="mt-6 inline-flex items-center gap-2 text-sm text-gris">
                  <Clock className="h-4 w-4" aria-hidden /> Pensez à vérifier vos spams
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setValeurs(VIDE)
                    setStatut('idle')
                  }}
                  className="mt-8 text-sm font-medium text-gris underline underline-offset-4 hover:text-nuit"
                >
                  Envoyer une autre demande
                </button>
              </div>
            ) : (
              <form onSubmit={soumettre} noValidate className="space-y-5">
                <div>
                  <label htmlFor="champ-nom" className="mb-1.5 block text-sm font-medium text-nuit">Prénom & Nom</label>
                  <input type="text" autoComplete="name" placeholder="Camille Martin" value={valeurs.nom} onChange={maj('nom')} className={champ('nom')} {...aria('nom')} />
                  <Erreur nom="nom" />
                </div>

                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="champ-email" className="mb-1.5 block text-sm font-medium text-nuit">Adresse e-mail</label>
                    <input type="email" autoComplete="email" inputMode="email" placeholder="camille@email.fr" value={valeurs.email} onChange={maj('email')} className={champ('email')} {...aria('email')} />
                    <Erreur nom="email" />
                  </div>
                  <div>
                    <label htmlFor="champ-telephone" className="mb-1.5 block text-sm font-medium text-nuit">Numéro de téléphone</label>
                    <input type="tel" autoComplete="tel" inputMode="tel" placeholder="06 12 34 56 78" value={valeurs.telephone} onChange={maj('telephone')} className={champ('telephone')} {...aria('telephone')} />
                    <Erreur nom="telephone" />
                  </div>
                </div>

                <fieldset>
                  <legend className="mb-2 block text-sm font-medium text-nuit">Votre profil</legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" id="champ-profil" tabIndex={-1}>
                    {PROFILS.map((p) => (
                      <label
                        key={p}
                        className={`cursor-pointer rounded-xl border px-3 py-3 text-center text-sm transition has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-foret/20 ${
                          valeurs.profil === p ? 'border-foret bg-foret-50 font-medium text-foret' : 'border-sable-200 text-nuit hover:border-sable-300'
                        }`}
                      >
                        <input type="radio" name="profil" value={p} checked={valeurs.profil === p} onChange={maj('profil')} className="sr-only" />
                        {p}
                      </label>
                    ))}
                  </div>
                  <Erreur nom="profil" />
                </fieldset>

                <fieldset>
                  <legend className="mb-2 block text-sm font-medium text-nuit">Durée souhaitée</legend>
                  <div className="grid grid-cols-3 gap-2" id="champ-duree" tabIndex={-1}>
                    {DUREES.map((d) => (
                      <label
                        key={d}
                        className={`cursor-pointer rounded-xl border px-3 py-3 text-center text-sm transition has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-foret/20 ${
                          valeurs.duree === d ? 'border-foret bg-foret-50 font-medium text-foret' : 'border-sable-200 text-nuit hover:border-sable-300'
                        }`}
                      >
                        <input type="radio" name="duree" value={d} checked={valeurs.duree === d} onChange={maj('duree')} className="sr-only" />
                        {d}
                      </label>
                    ))}
                  </div>
                  <Erreur nom="duree" />
                </fieldset>

                <div>
                  <label htmlFor="champ-message" className="mb-1.5 block text-sm font-medium text-nuit">
                    Votre message <span className="font-normal text-gris">(facultatif)</span>
                  </label>
                  <textarea id="champ-message" rows={4} placeholder="Date d'arrivée souhaitée, besoins particuliers, questions…" value={valeurs.message} onChange={maj('message')} className={`${champ('message')} resize-y`} />
                </div>

                {/* Pot de miel : invisible pour les humains */}
                <div aria-hidden className="absolute -left-[9999px]">
                  <label>Ne pas remplir <input type="text" tabIndex={-1} autoComplete="off" value={valeurs.site} onChange={maj('site')} /></label>
                </div>

                {statut === 'echec' && (
                  <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
                    Oups, l'envoi n'a pas fonctionné. Réessayez, ou appelez-nous au {HOTEL.telephone}.
                  </p>
                )}

                <button
                  type="submit"
                  disabled={statut === 'envoi'}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-nuit px-6 py-4 text-base font-medium text-creme transition hover:bg-nuit-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nuit disabled:cursor-wait disabled:opacity-70"
                >
                  {statut === 'envoi' ? (
                    <><Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Envoi en cours…</>
                  ) : (
                    <><Send className="h-5 w-5" aria-hidden /> Envoyer ma demande prioritaire</>
                  )}
                </button>

                <p className="flex items-center justify-center gap-1.5 text-center text-xs text-gris">
                  <Lock className="h-3.5 w-3.5" aria-hidden />
                  Sans engagement · aucun paiement · vos données ne sont jamais revendues
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
