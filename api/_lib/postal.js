// Extrait un code postal français (5 chiffres) d'une adresse en texte libre —
// repli quand aucun code postal structuré n'a été capturé (réservation
// manuelle, adresse saisie sans passer par l'autocomplete).
function extractPostalCode(adresse) {
  const m = String(adresse || '').match(/\b(\d{5})\b/);
  return m ? m[1] : null;
}

module.exports = { extractPostalCode };
