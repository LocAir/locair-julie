// Espace admin « Points de retrait » (onglet de admin/index.html) : tout ce
// qu'il faut pour piloter les points Click & Collect sur un seul écran.
//   - résumé : points ouverts, appareils chez les clients, retards, à reconditionner
//   - aujourd'hui : retraits prévus, retours prévus, retards (avec le n° à 4 chiffres)
//   - passages de l'agent (tous les 10 jours, table passages_agent) :
//     { action: 'passage', point_id } note un passage fait aujourd'hui
//   - saison : jours-machine loués face au point mort du playbook
//   - chaque point : stock libre aujourd'hui, commerçant relié, commission,
//     chiffre du mois, code retour (jamais affiché sur le site public)
// La liste des points vit dans _lib/pointsRetrait.js.
const { getSupabase } = require('./_lib/supabase');
const { checkAdminRole } = require('./_lib/auth');
const { POINTS_RETRAIT, pointFermeLe, CELLULES, getCellule, pointMortCellule, COMMISSION_POINT_PCT } = require('./_lib/pointsRetrait');
const { codeRetour, numeroComptoir } = require('./_lib/clickCollect');
const { todayParis, addDays, debutJourParisISO } = require('./_lib/dates');

// Flotte, charges, saison et point mort : par cellule (_lib/pointsRetrait.js → CELLULES).
const ENTRETIEN_JOURS = 10;
const { INCIDENT_OPEN_STATUSES } = require('./_lib/incidentStatus');

const CHAMPS = 'id, ref, prenom, nom, tel, point_retrait_id, date_debut, date_fin, quantite, statut, remis_at, rendu_at, prix_total_cents, partenaire_commission_cents, partenaire_commission_payee, created_at, source';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const a = await checkAdminRole(req, supabase);
  if (!a.ok) return res.status(401).json({ error: 'Non autorisé' });

  try {
    const b = req.body || {};
    if (b.action === 'passage') {
      const id = String(b.point_id || '');
      if (!POINTS_RETRAIT.some((p) => p.id === id)) return res.status(400).json({ error: 'Point inconnu' });
      const { error: e } = await supabase.from('passages_agent').insert({ point_id: id, fait_le: todayParis() });
      if (e) return res.status(500).json({ error: /passages_agent|42P01/.test(e.message + (e.code || '')) ? 'Table passages_agent à créer dans Supabase' : e.message });
      return res.status(200).json({ ok: true });
    }
    const auj = todayParis();
    const debutMois = auj.slice(0, 8) + '01';
    const debutMoisISO = debutJourParisISO(debutMois); // minuit à Paris, comme l'espace partenaire
    const depuis = addDays(auj, -200);
    const debutSaison = auj.slice(0, 4) + '-05-01'; // la saison de l'année (dépose en mai)

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
      point: p ? p.nom : '', cellule: p ? p.cellule : null, quantite: qte(r), date_debut: r.date_debut, date_fin: r.date_fin });

    const aujourdhui = { retraits: [], retours: [], retards: [] };
    let dehorsTotal = 0, aReconditionner = 0;

    // Dernier passage de l'agent par point (table absente : rien, sans erreur).
    const dernierPassage = {};
    let passagesTable = true;
    {
      const { data: pas, error: ep } = await supabase.from('passages_agent').select('point_id, fait_le')
        .gte('fait_le', addDays(auj, -200)).order('fait_le', { ascending: false }).limit(1000);
      if (ep) passagesTable = false;
      (pas || []).forEach((x) => { if (!dernierPassage[x.point_id]) dernierPassage[x.point_id] = x.fait_le; });
    }

    // Signalements ouverts (casse, panne, manque…) sur des locations Click & Collect.
    const resaPoint = new Map(resas.map((r) => [r.id, r]));
    let signalements = [];
    {
      const { data: inc } = await supabase.from('incidents').select('id, reservation_id, type, description, created_at, statut')
        .in('statut', INCIDENT_OPEN_STATUSES).order('created_at', { ascending: true }).limit(300);
      signalements = (inc || []).filter((i) => resaPoint.has(i.reservation_id)).map((i) => {
        const r = resaPoint.get(i.reservation_id);
        const pt = POINTS_RETRAIT.find((x) => x.id === r.point_retrait_id);
        return { id: i.id, type: i.type, ref: r.ref, client: client(r), point: pt ? pt.nom : '', cellule: pt ? pt.cellule : null, test: !!(pt && pt.test),
          description: String(i.description || '').replace(/^\[[^\]]*\]\s*/, '').slice(0, 140),
          jours: Math.max(0, Math.round((Date.parse(auj) - Date.parse(String(i.created_at).slice(0, 10))) / 864e5)) };
      }).filter((x) => !x.test);
    }

    const points = POINTS_RETRAIT.map((p) => {
      // Les lignes « prolongation » ne sont pas des appareils en plus : la
      // location d'origine porte déjà la nouvelle date de fin (webhook.js).
      const lesSiennes = resas.filter((r) => r.point_retrait_id === p.id && r.source !== 'site_prolongation');
      const sesProlongations = resas.filter((r) => r.point_retrait_id === p.id && r.source === 'site_prolongation');
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
      const duMois = lesSiennes.concat(sesProlongations).filter((r) => String(r.created_at || '') >= debutMoisISO);
      const caMois = duMois.reduce((s, r) => s + (r.prix_total_cents || 0), 0);
      const comMois = duMois.reduce((s, r) => s + (Number.isFinite(r.partenaire_commission_cents) ? r.partenaire_commission_cents : Math.round((r.prix_total_cents || 0) * p.commission_pct / 100)), 0);

      const part = partenaires.find((x) => String(x.code || '').toLowerCase() === String(p.partenaire_code || '').toLowerCase()) || null;
      // 20 % des mois passés pas encore virés (à virer entre le 1er et le 5).
      const aVirer = lesSiennes.concat(sesProlongations)
        .filter((r) => !r.partenaire_commission_payee && String(r.created_at || '') < debutMoisISO)
        .reduce((s, r) => s + (Number.isFinite(r.partenaire_commission_cents) ? r.partenaire_commission_cents : Math.round((r.prix_total_cents || 0) * p.commission_pct / 100)), 0);
      // Saison en cours (depuis le 1er mai) : jours-machine, chiffre et 20 %.
      const deSaison = lesSiennes.filter((r) => r.date_debut >= debutSaison);
      const saisonJM = deSaison.reduce((s, r) => s + qte(r) * Math.max(0, Math.round((Date.parse(r.date_fin) - Date.parse(r.date_debut)) / 864e5)), 0);
      const saisonTout = deSaison.concat(sesProlongations.filter((r) => r.date_debut >= debutSaison));
      const saisonCA = saisonTout.reduce((s, r) => s + (r.prix_total_cents || 0), 0);
      const saisonCom = saisonTout.reduce((s, r) => s + (Number.isFinite(r.partenaire_commission_cents) ? r.partenaire_commission_cents : Math.round((r.prix_total_cents || 0) * p.commission_pct / 100)), 0);
      return {
        cellule: p.cellule,
        saison: { jours_machine: saisonJM, ca_cents: saisonCA, commission_cents: saisonCom },
        a_virer_cents: p.test || p.exemple ? 0 : aVirer,
        id: p.id, nom: p.nom, ville: p.ville, adresse: p.adresse, horaires: p.horaires,
        exemple: !!p.exemple, test: !!p.test, ferme_aujourdhui: pointFermeLe(p, auj),
        stock: p.stock || 0, libres: Math.max(0, (p.stock || 0) - occupe), dehors, a_venir: aVenir, a_reconditionner: recond,
        commission_pct: p.commission_pct,
        dernier_passage: dernierPassage[p.id] || null,
        jours_sans_passage: dernierPassage[p.id] ? Math.round((Date.parse(auj) - Date.parse(dernierPassage[p.id])) / 864e5) : null,
        commercant: part ? { nom: part.nom || part.code, code: part.code, telephone: part.telephone || null, rib_ok: !!(part.iban && String(part.iban).trim()), actif: part.actif !== false } : null,
        partenaire_code: p.partenaire_code || null,
        code_retour: codeRetour(p, part),
        mois: { locations: duMois.filter((r) => r.source !== 'site_prolongation').length, ca_cents: caMois, commission_cents: comMois },
      };
    });

    // Remplissage des 7 prochains jours, par ville (playbook Cellule 1) :
    // à 85 % on baisse la pub de la zone, à 90 % on la met en pause.
    // Seulement les vrais points ouverts (ni exemple, ni test).
    const jours = Array.from({ length: 7 }, (_, k) => addDays(auj, k));
    const parVille = {};
    POINTS_RETRAIT.filter((p) => !p.test && !p.exemple).forEach((p) => {
      const v = parVille[p.ville] || (parVille[p.ville] = { ville: p.ville, cellule: p.cellule, points: 0, places: 0, pris: 0 });
      v.points += 1; v.places += (p.stock || 0) * jours.length;
      resas.filter((r) => r.point_retrait_id === p.id && r.source !== 'site_prolongation' && r.statut === 'confirmee' && !r.rendu_at)
        .forEach((r) => jours.forEach((j) => { if ((r.date_debut <= j && r.date_fin > j) || (r.remis_at && j === auj)) v.pris += qte(r); }));
    });
    const remplissage = Object.values(parVille).map((v) => {
      const pct = v.places ? Math.min(100, Math.round(v.pris / v.places * 100)) : 0;
      return { ville: v.ville, cellule: v.cellule, points: v.points, pct, pub: pct >= 90 ? 'pause' : pct >= 85 ? 'baisser' : 'normale' };
    }).sort((x, y) => y.pct - x.pct);

    // Saison en cours : jours-machine loués (appareils × jours), points réels.
    const reels = new Set(POINTS_RETRAIT.filter((p) => !p.test && !p.exemple).map((p) => p.id));
    const joursMachine = resas.filter((r) => reels.has(r.point_retrait_id) && r.source !== 'site_prolongation' && r.date_debut >= debutSaison)
      .reduce((s, r) => s + qte(r) * Math.max(0, Math.round((Date.parse(r.date_fin) - Date.parse(r.date_debut)) / 864e5)), 0);
    const entretienEnRetard = points.filter((p) => !p.test && !p.exemple && (p.jours_sans_passage == null || p.jours_sans_passage > ENTRETIEN_JOURS)).length;

    // Une carte par cellule : le tableau global de l'admin.
    const cellules = CELLULES.map((c) => {
      const pts = points.filter((p) => p.cellule === c.id && !p.test && !p.exemple);
      const enPoints = pts.reduce((s, p) => s + (p.stock || 0), 0);
      const jm = pts.reduce((s, p) => s + p.saison.jours_machine, 0);
      const capacite = c.flotte * c.jours_saison;
      const rem = remplissage.filter((v) => v.cellule === c.id);
      const remPct = rem.length ? Math.round(rem.reduce((s, v) => s + v.pct * v.points, 0) / rem.reduce((s, v) => s + v.points, 0)) : null;
      return {
        id: c.id, nom: c.nom, flotte: c.flotte, depose: c.depose, fin_saison: c.fin_saison, pub_jour: c.pub_jour,
        charges_mois: c.charges.box + c.charges.agent + c.charges.pub,
        points_ouverts: pts.length, en_points: enPoints, micro_box: Math.max(0, c.flotte - enPoints),
        jours_machine: jm, capacite, occupation_pct: capacite ? Math.round(jm / capacite * 1000) / 10 : 0,
        point_mort: pointMortCellule(c, COMMISSION_POINT_PCT),
        remplissage_pct: remPct, pub: remPct == null ? null : remPct >= 90 ? 'pause' : remPct >= 85 ? 'baisser' : 'normale',
        ca_saison_cents: pts.reduce((s, p) => s + p.saison.ca_cents, 0),
        commissions_saison_cents: pts.reduce((s, p) => s + p.saison.commission_cents, 0),
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
        entretien_en_retard: passagesTable ? entretienEnRetard : 0,
      },
      cellules,
      saison: { jours_machine: joursMachine, point_mort: pointMortCellule(getCellule('c1'), COMMISSION_POINT_PCT) },
      micro_box: { flotte: CELLULES.reduce((s, c) => s + c.flotte, 0), en_points: POINTS_RETRAIT.filter((p) => !p.test && !p.exemple).reduce((s, p) => s + (p.stock || 0), 0) },
      signalements,
      passages_table: passagesTable,
      entretien_jours: ENTRETIEN_JOURS,
      aujourdhui,
      remplissage,
      points,
    });
  } catch (e) {
    console.error('[admin-points-retrait]', e.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
