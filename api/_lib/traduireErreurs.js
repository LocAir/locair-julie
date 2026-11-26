// Messages d'erreur montrés tels quels au client, traduits pour les pages en
// anglais et en espagnol (prolongation). Le français reste le texte de
// référence : un message absent de la table reste en français.
//   traduireErreurs(res, lang) : à appeler au début du handler ; chaque
//   res.json({ error }) passe alors par la traduction.
const MOIS = {
  janvier: ['January', 'enero'], février: ['February', 'febrero'], mars: ['March', 'marzo'], avril: ['April', 'abril'],
  mai: ['May', 'mayo'], juin: ['June', 'junio'], juillet: ['July', 'julio'], août: ['August', 'agosto'],
  septembre: ['September', 'septiembre'], octobre: ['October', 'octubre'], novembre: ['November', 'noviembre'], décembre: ['December', 'diciembre'],
};
const jour = (txt, k) => String(txt).replace(/^1er /, '1 ').replace(/[a-zéû]+$/, (m) => (MOIS[m] ? (k === 1 ? 'de ' : '') + MOIS[m][k] : m));

const TABLE = {
  'Trop de tentatives, réessayez dans 15 minutes.': ['Too many attempts, try again in 15 minutes.', 'Demasiados intentos, inténtalo de nuevo en 15 minutos.'],
  'Erreur serveur': ['Server error.', 'Error del servidor.'],
  'Erreur serveur réservation': ['Server error.', 'Error del servidor.'],
  'Erreur serveur paiement': ['Payment server error.', 'Error del servidor de pago.'],
  'Session expirée — reconnectez-vous à votre espace client.': ['Session expired — log in to your customer area again.', 'Sesión caducada — vuelve a entrar en tu área de cliente.'],
  'Session invalide.': ['Invalid session.', 'Sesión no válida.'],
  'Email et référence de commande requis': ['Email and order number required.', 'Email y número de pedido obligatorios.'],
  'Email et nouvelle date de fin requis': ['Email and new end date required.', 'Email y nueva fecha de fin obligatorios.'],
  'Date invalide': ['Invalid date.', 'Fecha no válida.'],
  'Vous devez accepter les CGV avant de payer.': ['Please accept the terms before paying.', 'Acepta las condiciones antes de pagar.'],
  'Réservation introuvable.': ['Booking not found.', 'Reserva no encontrada.'],
  'Aucune location trouvée — vérifiez votre email et référence de commande.': ['No rental found — check your email and order number.', 'No se ha encontrado ningún alquiler — revisa tu email y tu número de pedido.'],
  'Votre location est déjà terminée — impossible de la prolonger.': ['Your rental has already ended — it can’t be extended.', 'Tu alquiler ya ha terminado — no se puede ampliar.'],
  'La location est déjà terminée — impossible de prolonger.': ['The rental has already ended — it can’t be extended.', 'El alquiler ya ha terminado — no se puede ampliar.'],
  'Durée minimale : 1 jour.': ['Minimum: 1 day.', 'Mínimo: 1 día.'],
  'Prolongation : 90 jours maximum à la fois.': ['Extension: 90 days at most at a time.', 'Ampliación: 90 días como máximo cada vez.'],
  'Montant invalide': ['Invalid amount.', 'Importe no válido.'],
  'L’appareil a déjà été rendu au point de retrait : la location est terminée.': ['The unit has already been returned to the pick-up point: the rental is over.', 'El aparato ya se devolvió al punto de recogida: el alquiler ha terminado.'],
  'Plus d’appareil libre à votre point de retrait sur ces dates. Rapportez l’appareil à la date prévue, ou écrivez-nous pour trouver une solution.': ['No unit free at your pick-up point on these dates. Return the unit on the planned date, or write to us to find a solution.', 'No queda ningún aparato libre en tu punto en esas fechas. Devuelve el aparato en la fecha prevista o escríbenos para buscar una solución.'],
};
const MOTIFS = [
  [/^La nouvelle date doit être postérieure au (\d{4}-\d{2}-\d{2})\.$/, (m) => [`The new date must be after ${m[1]}.`, `La nueva fecha debe ser posterior al ${m[1]}.`]],
  [/^Une location Click & Collect dure (\d+) jours au plus\. Pour plus long, écrivez-nous\.$/, (m) => [`A Click & Collect rental lasts ${m[1]} days at most. For longer, write to us.`, `Un alquiler Click & Collect dura ${m[1]} días como máximo. Para más tiempo, escríbenos.`]],
  [/^Le point « (.+) » est fermé ce jour-là : choisissez un autre jour de retour\.$/, (m) => [`The “${m[1]}” point is closed that day: choose another return day.`, `El punto «${m[1]}» está cerrado ese día: elige otro día de devolución.`]],
  [/^Le Click & Collect est ouvert du (.+) au (.+) \(retour au plus tard le (.+)\)\.$/, (m) => [
    `Click & Collect runs from ${jour(m[1], 0)} to ${jour(m[2], 0)} (return by ${jour(m[3], 0)}).`,
    `El Click & Collect funciona del ${jour(m[1], 1)} al ${jour(m[2], 1)} (devolución hasta el ${jour(m[3], 1)}).`]],
];

function traduire(msg, lang) {
  if (lang !== 'en' && lang !== 'es') return msg;
  const k = lang === 'en' ? 0 : 1;
  if (TABLE[msg]) return TABLE[msg][k];
  for (const [re, f] of MOTIFS) { const m = re.exec(msg); if (m) return f(m)[k]; }
  return msg;
}

function traduireErreurs(res, lang) {
  if (lang !== 'en' && lang !== 'es') return;
  const json = res.json.bind(res);
  res.json = (o) => json(o && typeof o.error === 'string' ? { ...o, error: traduire(o.error, lang) } : o);
}

module.exports = { traduireErreurs, traduire };
