// Charge les fiches publiées et les formules depuis la base AdStay (si branchée).
// Sinon, ou si la base est vide ou injoignable : on garde les exemples de donnees.js.
// La dernière réponse de la base est gardée sur la tablette, au cas où Internet coupe.
(() => {
  const C = window.ADSTAY_CONFIG || {};
  const branche = !!(C.supabaseUrl && C.supabaseAnonKey);
  const entetes = branche ? { apikey: C.supabaseAnonKey, Authorization: `Bearer ${C.supabaseAnonKey}` } : {};
  const estUuid = id => /^[0-9a-f-]{36}$/i.test(String(id));

  function appliquer({ formules, fiches }) {
    if (formules?.length) window.ADSTAY.formules = formules;
    if (fiches?.length) window.ADSTAY.commercants = fiches;
  }

  window.ADSTAY_PRET = (async () => {
    if (!branche) return;
    const lire = async chemin => {
      const r = await fetch(`${C.supabaseUrl}/rest/v1/${chemin}`, { headers: entetes, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(r.status);
      return r.json();
    };
    try {
      const [formules, fiches] = await Promise.all([
        lire('formules?select=*'),
        lire('commercants?statut=eq.publie&select=id,nom,categorie,formule,accroche,description,adresse,tel,horaires,offre,lien,photo'),
      ]);
      appliquer({ formules, fiches });
      try { localStorage.setItem('adstay-cache', JSON.stringify({ formules, fiches })); } catch {}
    } catch (e) {
      try { appliquer(JSON.parse(localStorage.getItem('adstay-cache') || '{}')); } catch {}
    }
  })();

  // Statistiques : note qu'une fiche a été vue, affichée en veille ou scannée.
  // Rien n'est noté pour les fiches d'exemple (pas dans la base).
  window.adstayNoter = (commercant, type, logement = '') => {
    if (!branche || !estUuid(commercant)) return Promise.resolve();
    return fetch(`${C.supabaseUrl}/rest/v1/evenements`, {
      method: 'POST', keepalive: true,
      headers: { ...entetes, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ commercant, type, logement: String(logement).slice(0, 80) }),
    }).catch(() => {});
  };
  window.adstayEstUuid = estUuid;
})();
