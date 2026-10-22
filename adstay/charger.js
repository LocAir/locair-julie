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

  // ── Tablette installée dans un logement ──
  // Première fois : /adstay?t=CODE (QR de l'espace admin). Le code est gardé sur la tablette
  // puis retiré de l'adresse : les voyageurs ne le voient jamais.
  const CLE_T = 'adstay-tablette', CLE_L = 'adstay-logement';
  const q = new URLSearchParams(location.search);
  let codeT = q.get('t');
  if (codeT) {
    try { localStorage.setItem(CLE_T, codeT); } catch {}
    q.delete('t'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
  } else { try { codeT = localStorage.getItem(CLE_T); } catch {} }
  // Format de la base → format attendu par la tablette (même forme que donnees.js)
  const versTablette = x => ({
    id: x.id, nom: x.nom, adresse: x.adresse, lat: x.lat, lon: x.lon,
    wifi: x.wifi_reseau ? { reseau: x.wifi_reseau, motdepasse: x.wifi_mdp } : null,
    arrivee: x.arrivee, depart: x.depart, infos: x.infos || [], infos_en: x.infos_en || [],
    motHote: x.mot_hote ? { texte: x.mot_hote, texte_en: x.mot_hote_en, signature: x.signature || 'La conciergerie', signature_en: x.signature || 'The concierge team' } : null,
    sejour: x.sejour_du && x.sejour_au ? { prenoms: x.sejour_prenoms, du: x.sejour_du, au: x.sejour_au } : null,
  });
  function poserLogement(x) {
    if (!x) return;
    window.ADSTAY.logements = { [x.id]: versTablette(x) };
    window.ADSTAY_LOGEMENT = x.id; // identifiant (pas le code) : sert aux statistiques
  }
  // Lit le logement et signale « tablette allumée ». Renvoie true si ses infos ont changé.
  window.adstayLogement = async () => {
    if (!branche || !codeT) return false;
    try {
      const r = await fetch(`${C.supabaseUrl}/rest/v1/rpc/adstay_tablette`, {
        method: 'POST', headers: { ...entetes, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_code: codeT }), signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(r.status);
      const x = await r.json();
      let avant = null; try { avant = JSON.parse(localStorage.getItem(CLE_L)); } catch {}
      try { localStorage.setItem(CLE_L, JSON.stringify(x)); } catch {}
      return !!avant !== !!x || (x && avant && (x.maj !== avant.maj || x.id !== avant.id));
    } catch { return false; } // hors ligne : on garde ce qu'on a
  };
  window.ADSTAY_TABLETTE = !!codeT;

  window.ADSTAY_PRET = (async () => {
    if (!branche) return;
    if (codeT) {
      // Logement : la base d'abord, sinon la dernière version gardée (coupure Internet)
      await window.adstayLogement();
      let x = null; try { x = JSON.parse(localStorage.getItem(CLE_L)); } catch {}
      if (x) poserLogement(x); else window.ADSTAY.logements = {}; // code inconnu : jamais le logement de démo
    }
    const lire = async chemin => {
      const r = await fetch(`${C.supabaseUrl}/rest/v1/${chemin}`, { headers: entetes, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(r.status);
      return r.json();
    };
    try {
      const [formules, fiches] = await Promise.all([
        lire('formules?select=*'),
        lire('commercants?statut=eq.publie&select=id,nom,categorie,formule,accroche,accroche_en,description,description_en,'
          + 'adresse,tel,horaires,creneaux,fermes,lat,lon,offre,offre_en,lien,photo'),
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
