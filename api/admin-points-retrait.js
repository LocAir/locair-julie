// Espace admin « Points de retrait » (onglet de admin/index.html) : tout ce
// qu'il faut pour piloter les points Click & Collect sur un seul écran.
//   - résumé : points ouverts, appareils chez les clients, retards, à reconditionner
//   - aujourd'hui : retraits prévus, retours prévus, retards (avec le n° à 4 chiffres)
//   - chaque point : stock libre aujourd'hui, commerçant relié, commission,
//     chiffre du mois, code retour (jamais affiché sur le site public)
// Lecture seule. La liste des points vit dans _lib/pointsRetrait.js.
const { getSupabase } = require('./_lib/supabase');
const { checkAdminRole } = require('./_lib/auth');
const { POINTS_RETRAIT, pointFermeLe } = require('./_lib/pointsRetrait');
const { codeRetour, numeroComptoir } = require('./_lib/clickCollect');
const { todayParis, addDays } = require('./_lib/dates');

const CHAMPS = 'id, ref, prenom, nom, tel, point_retrait_id, date_debut, date_fin, quantite, statut, remis_at, rendu_at, prix_total_cents, partenaire_commission_cents, created_at, source';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const a = await checkAdminRole(req, supabase);
  if (!a.ok) return res.status(401).json({ error: 'Non autorisé' });

  try {
    const auj = todayParis();
    const debutMois = auj.slice(0, 8) + '01';
    const depuis = addDays(auj, -120);

    // Réservations Click & Collect récentes ou en cours. Si une colonne
    // récente manque encore dans la vraie base (migration pas passée), on
    // la retire de la lecture au lieu de tout casser.
    let cols = (CHAMPS + ', etat_retour').split(', ');
    let resas = null, error = null;
    for (let essai = 0; essai < 5; essai++) {
      ({ data: resas, error } = await supabase.from('reservations').select(cols.join(', '))
        .eq('source_channel', 'click_collect').in('statut', ['confirmee', 'terminee'])
        .gte('date_fin', depuis).order('date_debut', { ascending: true }).limit(2000));
      if (!error) break;
      const manque = cols.find((c) => String(error.message || '').includes(c));
      if (!manque || ['id', 'ref', 'point_retrait_id', 'date_debut', 'date_fin', 'statut'].includes(manque)) break;
      cols = cols.filter((c) => c !== manque);
    }
    if (error) return res.status(500).json({ error: error.message });
    resas = resas || [];

    // Commerçants reliés (même code partenaire que le point).
    const codes = POINTS_RETRAIT.map((p) => String(p.partenaire_code || '').toLowerCase()).filter(Boolean);
    let partenaires = [];
    if (codes.length) {
      const { data } = await supabase.from('partenaires').select('code, nom, telephone, iban, actif').in('code', codes);
      partenaires = data || [];
    }

    const client = (r) => `${r.prenom || ''} ${r.nom || ''}`.trim() || '—';
    const qte = (r) => Math.max(1, r.quantite || 1);
    const ligne = (r, p) => ({ id: r.id, ref: r.ref, numero: numeroComptoir(r.ref), client: client(r), tel: r.tel || null,
      point: p ? p.nom : '', quantite: qte(r), date_debut: r.date_debut, date_fin: r.date_fin });

    const aujourdhui = { retraits: [], retours: [], retards: [] };
    let dehorsTotal = 0, aReconditionner = 0;

    const points = POINTS_RETRAIT.map((p) => {
      const lesSiennes = resas.filter((r) => r.point_retrait_id === p.id);
      const actives = lesSiennes.filter((r) => r.statut === 'confirmee' && !r.rendu_at);
      // Occupé aujourd'hui = réservé sur aujourd'hui, ou retiré et pas encore rendu.
      const occupe = actives.filter((r) => (r.date_debut <= auj && r.date_fin > auj) || (r.remis_at && !r.rendu_at))
        .reduce((s, r) => s + qte(r), 0);
      const dehors = actives.filter((r) => r.remis_at).reduce((s, r) => s + qte(r), 0);
      const aVenir = actives.filter((r) => !r.remis_at && r.date_debut > auj).reduce((s, r) => s + qte(r), 0);
      const recond = lesSiennes.filter((r) => r.etat_retour === 'a_reconditionner').length;
      if (!p.test) { dehorsTotal += dehors; aReconditionner += recond; }

      actives.forEach((r) => {
        if (p.test) return;
        if (!r.remis_at && r.date_debut <= auj) aujourdhui.retraits.push(ligne(r, p));
        else if (r.remis_at && r.date_fin === auj) aujourdhui.retours.push(ligne(r, p));
        else if (r.remis_at && r.date_fin < auj) aujourdhui.retards.push(Object.assign(ligne(r, p), { jours_retard: Math.round((Date.parse(auj) - Date.parse(r.date_fin)) / 864e5) }));
      });

      // Chiffre du mois : locations payées ce mois-ci (prolongations comprises).
      const duMois = lesSiennes.filter((r) => String(r.created_at || '').slice(0, 10) >= debutMois);
      const caMois = duMois.reduce((s, r) => s + (r.prix_total_cents || 0), 0);
      const comMois = duMois.reduce((s, r) => s + (Number.isFinite(r.partenaire_commission_cents) ? r.partenaire_commission_cents : Math.round((r.prix_total_cents || 0) * p.commission_pct / 100)), 0);

      const part = partenaires.find((x) => String(x.code || '').toLowerCase() === String(p.partenaire_code || '').toLowerCase()) || null;
      return {
        id: p.id, nom: p.nom, ville: p.ville, adresse: p.adresse, horaires: p.horaires,
        exemple: !!p.exemple, test: !!p.test, ferme_aujourdhui: pointFermeLe(p, auj),
        stock: p.stock || 0, libres: Math.max(0, (p.stock || 0) - occupe), dehors, a_venir: aVenir, a_reconditionner: recond,
        commission_pct: p.commission_pct,
        commercant: part ? { nom: part.nom || part.code, code: part.code, telephone: part.telephone || null, rib_ok: !!(part.iban && String(part.iban).trim()), actif: part.actif !== false } : null,
        partenaire_code: p.partenaire_code || null,
        code_retour: codeRetour(p, part),
        mois: { locations: duMois.length, ca_cents: caMois, commission_cents: comMois },
      };
    });

    const tri = (l) => l.sort((x, y) => x.point.localeCompare(y.point) || x.client.localeCompare(y.client));
    tri(aujourdhui.retraits); tri(aujourdhui.retours); aujourdhui.retards.sort((x, y) => y.jours_retard - x.jours_retard);

    return res.status(200).json({
      date: auj,
      resume: {
        ouverts: points.filter((p) => !p.test && !p.exemple).length,
        exemples: points.filter((p) => !p.test && p.exemple).length,
        dehors: dehorsTotal,
        retards: aujourdhui.retards.length,
        a_reconditionner: aReconditionner,
      },
      aujourdhui,
      points,
    });
  } catch (e) {
    console.error('[admin-points-retrait]', e.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
