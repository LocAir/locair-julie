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
const { roleHasAccess } = require('./_lib/permissions');
const { POINTS_RETRAIT, pointFermeLe, CELLULES, getCellule, pointMortCellule, COMMISSION_POINT_PCT } = require('./_lib/pointsRetrait');
const { codeRetour, numeroComptoir, occupationParPoint } = require('./_lib/clickCollect');
const { chargerStocks } = require('./_lib/stockPoints');
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
    const stockTable = await chargerStocks(supabase, { force: true });

    // Stock d'un point (25/11/2026) : il peut évoluer d'un point à l'autre et
    // dans le temps, avec l'accord du gérant. Chaque changement est gardé
    // (qui, quand, avant → après, pourquoi) et le commerçant reçoit une trace
    // écrite par e-mail. Baisser sous les locations déjà prévues : refusé
    // sauf confirmation (forcer).
    if (b.action === 'stock') {
      if (!roleHasAccess(a.role, 'partenaires') && a.role !== 'administrateur') return res.status(403).json({ error: 'Réservé au gérant.' });
      if (stockTable === false) return res.status(503).json({ error: 'Table stock_points à créer dans Supabase (SQL du 25/11).' });
      const p = POINTS_RETRAIT.find((x) => x.id === String(b.point_id || ''));
      if (!p) return res.status(400).json({ error: 'Point inconnu' });
      const nouveau = Number(b.stock);
      if (!Number.isInteger(nouveau) || nouveau < 0 || nouveau > 30) return res.status(400).json({ error: 'Stock : un nombre entre 0 et 30.' });
      if (nouveau === p.stock) return res.status(400).json({ error: 'C’est déjà le stock du point.' });
      if (b.accord !== true) return res.status(400).json({ error: 'Cochez « Le gérant est d’accord ».' });
      const raison = String(b.raison || '').trim().slice(0, 300);
      if (raison.length < 3) return res.status(400).json({ error: 'Écrivez la raison (ex. place en plus dans la réserve).' });
      const auj0 = todayParis();
      if (nouveau < p.stock && !b.forcer) {
        const occ = await occupationParPoint(supabase, [p], auj0, addDays(auj0, 60), { avecAttente: true }).catch(() => ({}));
        const pic = occ[p.id] || 0;
        if (pic > nouveau) return res.status(409).json({ error: `Jusqu’à ${pic} climatiseur${pic > 1 ? 's' : ''} déjà loué${pic > 1 ? 's' : ''} en même temps sur les 60 prochains jours : le stock ne peut pas descendre à ${nouveau} sans les déplacer.`, pic, confirmer: true });
      }
      const ancien = p.stock;
      const par = a.nom || a.role;
      const { error: e1 } = await supabase.from('stock_points').upsert({ point_id: p.id, stock: nouveau, updated_at: new Date().toISOString(), updated_by: par }, { onConflict: 'point_id' });
      if (e1) throw e1;
      await supabase.from('stock_points_historique').insert({ point_id: p.id, ancien, nouveau, raison, accord_gerant: true, par }).then(() => {}, () => {});
      await chargerStocks(supabase, { force: true });
      // Trace écrite au commerçant (s'il a un e-mail).
      let prevenu = false;
      if (p.partenaire_code && !p.test) {
        const { data: part } = await supabase.from('partenaires').select('nom, email').eq('code', String(p.partenaire_code).toLowerCase()).maybeSingle();
        if (part && part.email) {
          const { sendBrevoEmail } = require('./_lib/brevo');
          const r = await sendBrevoEmail({
            to: part.email, senderName: 'Loc’Air Partenaires', replyTo: 'partenaires.locair@outlook.com',
            subject: `Votre stock Loc’Air passe à ${nouveau} climatiseur${nouveau > 1 ? 's' : ''}`,
            html: `<div style="font-family:Arial,sans-serif;color:#0E1726;max-width:560px"><h2 style="color:#1A5EDB;margin:0 0 12px">Votre stock change</h2><p>Comme convenu ensemble, le stock de <b>${String(p.nom).replace(/[<>&]/g, '')}</b> passe de <b>${ancien}</b> à <b>${nouveau}</b> climatiseur${nouveau > 1 ? 's' : ''}, à partir d’aujourd’hui.</p><p>Rien d’autre ne change : mêmes règles, mêmes 20 %.</p><p style="color:#4B5873;font-size:13px">Une question : 06 63 79 87 56 · partenaires.locair@outlook.com</p></div>`,
          }).catch(() => ({ ok: false }));
          prevenu = !!r.ok;
        }
      }
      return res.status(200).json({ ok: true, ancien, nouveau, commercant_prevenu: prevenu });
    }

    // Retour pas validé au comptoir (appareil en retard qui bloque sa place) :
    // le gérant le note rendu à la main, avec la raison (25/11/2026).
    if (b.action === 'rendu_manuel') {
      if (!roleHasAccess(a.role, 'partenaires') && a.role !== 'administrateur') return res.status(403).json({ error: 'Réservé au gérant.' });
      const id = Number(b.reservation_id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Réservation inconnue' });
      const raison = String(b.raison || '').trim().slice(0, 300);
      if (raison.length < 3) return res.status(400).json({ error: 'Écrivez la raison (ex. rapporté, retour oublié au comptoir).' });
      const { data: r, error: e0 } = await supabase.from('reservations').select('id, ref, statut, source_channel, remis_at, rendu_at, point_retrait_id, instructions_acces').eq('id', id).maybeSingle();
      if (e0) throw e0;
      if (!r || r.source_channel !== 'click_collect') return res.status(404).json({ error: 'Location Click & Collect introuvable.' });
      if (r.rendu_at) return res.status(200).json({ ok: true, deja: true });
      if (!r.remis_at) return res.status(409).json({ error: 'Cet appareil n’a jamais été retiré : rien à débloquer.' });
      const maintenant = new Date().toISOString();
      const trace = `[Rendu noté à la main le ${todayParis()} par ${a.nom || a.role} : ${raison}]`;
      const patch = { rendu_at: maintenant, instructions_acces: ((r.instructions_acces ? r.instructions_acces + '\n' : '') + trace).slice(0, 2000) };
      if (r.statut === 'confirmee') patch.statut = 'terminee'; // remboursée/annulée : statut gardé
      // Revenu au point : à nettoyer avant de repartir, comme un retour au comptoir.
      let { data: maj, error: e1 } = await supabase.from('reservations').update({ ...patch, etat_retour: 'a_reconditionner' }).eq('id', r.id).is('rendu_at', null).select('id');
      if (e1 && /etat_retour|42703|does not exist/.test(String(e1.message) + (e1.code || ''))) ({ data: maj, error: e1 } = await supabase.from('reservations').update(patch).eq('id', r.id).is('rendu_at', null).select('id'));
      if (e1) throw e1;
      if (maj && maj.length) {
        await supabase.from('reservations').update({ rendu_at: maintenant, statut: 'terminee' })
          .eq('reservation_origine_id', r.id).eq('statut', 'confirmee').then(() => {}, () => {});
      }
      return res.status(200).json({ ok: true, ref: r.ref });
    }

    if (b.action === 'passage') {
      const id = String(b.point_id || '');
      if (!POINTS_RETRAIT.some((p) => p.id === id)) return res.status(400).json({ error: 'Point inconnu' });
      const { error: e } = await supabase.from('passages_agent').insert({ point_id: id, fait_le: todayParis() });
      if (e) return res.status(500).json({ error: /passages_agent|42P01/.test(e.message + (e.code || '')) ? 'Table passages_agent à créer dans Supabase' : e.message });
      return res.status(200).json({ ok: true });
    }
    // Convention, art. 7 : transfert de plein droit à la société d'exploitation.
    // Notification écrite (email + SMS) à chaque commerçant des points ouverts :
    // dénomination, SIRET/RCS et date d'effet. « apercu » montre le texte et les
    // destinataires sans rien envoyer ; « envoyer » envoie (une fois par commerçant).
    if (b.action === 'transfert') {
      if (a.role !== 'administrateur') return res.status(403).json({ error: 'Réservé au propriétaire.' });
      const nom = String(b.denomination || '').trim().slice(0, 120);
      const siret = String(b.siret || '').replace(/\s/g, '').slice(0, 20);
      const date = String(b.date_effet || '').slice(0, 10);
      if (nom.length < 2 || !/^\d{9}(\d{5})?$/.test(siret) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Dénomination, SIRET (ou SIREN) et date d’effet requis.' });
      }
      const codes = POINTS_RETRAIT.filter((p) => !p.test && !p.exemple && p.partenaire_code).map((p) => String(p.partenaire_code).toLowerCase());
      const { data: parts } = codes.length ? await supabase.from('partenaires').select('id, nom, email, telephone, actif').in('code', codes) : { data: [] };
      const dest = (parts || []).filter((p) => p.actif !== false && (p.email || p.telephone));
      const dateFr = new Date(date + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      const sirFmt = siret.length === 14 ? `${siret.slice(0, 3)} ${siret.slice(3, 6)} ${siret.slice(6, 9)} ${siret.slice(9)}` : siret.replace(/(\d{3})(?=\d)/g, '$1 ');
      const sms = `Loc'Air : comme prévu à l'article 7 de notre convention, elle est transférée à ${nom} (SIRET ${sirFmt}) à partir du ${dateFr}. Rien ne change pour vous : mêmes règles, mêmes 20 %, mêmes contacts. Une question ? 06 63 79 87 56`;
      const html = `<div style="font-family:Arial,sans-serif;color:#0E1726;max-width:560px">
<h2 style="color:#1A5EDB;margin:0 0 12px">Loc’Air devient ${nom.replace(/[<>&]/g, '')}</h2>
<p>Comme prévu à l’<b>article 7</b> de notre convention de partenariat, la convention, le matériel et vos virements sont transférés à :</p>
<p style="margin:14px 0;padding:14px 16px;background:#EFF4FD;border-radius:12px"><b>${nom.replace(/[<>&]/g, '')}</b><br>SIRET / RCS : ${sirFmt}<br>À partir du <b>${dateFr}</b></p>
<p><b>Rien ne change pour vous</b> : mêmes règles, mêmes 20 %, mêmes contacts, même espace partenaire. Vos relevés et vos virements viendront de ${nom.replace(/[<>&]/g, '')}.</p>
<p style="color:#4B5873;font-size:13px">Loc’Air · 06 63 79 87 56 · partenaires.locair@outlook.com</p></div>`;
      if (b.etape !== 'envoyer') return res.status(200).json({ apercu: true, destinataires: dest.map((p) => p.nom), sms, html });
      const { sendBrevoEmail, sendBrevoSms } = require('./_lib/brevo');
      const cle = `transfert_${siret}`;
      let envoyes = 0;
      for (const p of dest) {
        const { data: deja } = await supabase.from('email_log').select('id').eq('scenario', cle).eq('destinataire', String(p.id)).limit(1);
        if (deja && deja.length) continue;
        let okEnvoi = false;
        if (p.email) okEnvoi = !!(await sendBrevoEmail({ to: p.email, subject: `Votre convention Loc’Air : transfert à ${nom}`, html, senderName: "Loc'Air", replyTo: 'partenaires.locair@outlook.com' }).catch(() => ({}))).ok || okEnvoi;
        if (p.telephone) okEnvoi = !!(await sendBrevoSms({ to: p.telephone, content: sms }).catch(() => ({}))).ok || okEnvoi;
        await supabase.from('email_log').insert({ scenario: cle, canal: 'email', destinataire: String(p.id), modele: 'transfert_societe', statut: okEnvoi ? 'envoye' : 'erreur', contenu: sms }).then(() => {}, () => {});
        if (okEnvoi) envoyes++;
      }
      return res.status(200).json({ ok: true, envoyes, total: dest.length });
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

    // non_retires : payé mais jamais venu chercher (la location est finie) :
    // plus un retrait à faire, mais un client à appeler (30 jours au plus).
    const aujourdhui = { retraits: [], retours: [], retards: [], non_retires: [] };
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
        if (!r.remis_at && r.date_debut <= auj && r.date_fin >= auj) aujourdhui.retraits.push(ligne(r, p));
        else if (!r.remis_at && r.date_fin < auj && r.date_fin >= addDays(auj, -30)) aujourdhui.non_retires.push(ligne(r, p));
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
        stock: p.stock || 0, stock_code: p.stock_code, stock_modifie: !!p.stock_modifie, libres: Math.max(0, (p.stock || 0) - occupe), dehors, a_venir: aVenir, a_reconditionner: recond,
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
        points_ouverts: pts.length, en_points: enPoints, micro_box: Math.max(0, c.flotte - enPoints), flotte_depassee: enPoints > c.flotte,
        jours_machine: jm, capacite, occupation_pct: capacite ? Math.round(jm / capacite * 1000) / 10 : 0,
        point_mort: pointMortCellule(c, COMMISSION_POINT_PCT),
        remplissage_pct: remPct, pub: remPct == null ? null : remPct >= 90 ? 'pause' : remPct >= 85 ? 'baisser' : 'normale',
        ca_saison_cents: pts.reduce((s, p) => s + p.saison.ca_cents, 0),
        commissions_saison_cents: pts.reduce((s, p) => s + p.saison.commission_cents, 0),
      };
    });

    // Contrôle du stock (chaque jour) : locations prévues qui dépassent le
    // stock d'un point sur les 60 prochains jours, et flotte dépassée.
    {
      const reelsPts = POINTS_RETRAIT.filter((p) => !p.test && !p.exemple);
      const pics = reelsPts.length ? await occupationParPoint(supabase, reelsPts, auj, addDays(auj, 60), { avecAttente: false }).catch(() => ({})) : {};
      points.forEach((pt) => { if (pics[pt.id] != null) { pt.pic_60j = pics[pt.id]; pt.surbooke = pics[pt.id] > pt.stock; } });
    }
    let stockHistorique = [];
    if (stockTable) {
      const { data: h } = await supabase.from('stock_points_historique').select('point_id, ancien, nouveau, raison, accord_gerant, par, created_at').order('created_at', { ascending: false }).limit(40);
      stockHistorique = (h || []).map((x) => ({ ...x, point: (POINTS_RETRAIT.find((p) => p.id === x.point_id) || {}).nom || x.point_id }));
    }

    // Remboursée ou annulée mais appareil encore chez le client : c'est un
    // retard à suivre (et il bloque sa place), pas une location oubliée.
    {
      const { data: dehorsR } = await supabase.from('reservations').select(CHAMPS)
        .eq('source_channel', 'click_collect').in('statut', ['remboursee', 'annulee'])
        .not('remis_at', 'is', null).is('rendu_at', null).limit(200).then((x) => x, () => ({ data: [] }));
      (dehorsR || []).forEach((r) => {
        const p = POINTS_RETRAIT.find((x) => x.id === r.point_retrait_id);
        if (!p || p.test) return;
        aujourdhui.retards.push(Object.assign(ligne(r, p), { jours_retard: Math.max(0, Math.round((Date.parse(auj) - Date.parse(r.date_fin)) / 864e5)), rembourse: true }));
      });
    }
    const tri = (l) => l.sort((x, y) => x.point.localeCompare(y.point) || x.client.localeCompare(y.client));
    tri(aujourdhui.retraits); tri(aujourdhui.retours); aujourdhui.retards.sort((x, y) => y.jours_retard - x.jours_retard);

    // Les montants (20 % à virer, chiffre du mois et de la saison,
    // commissions) sont réservés aux rôles qui ont accès aux finances
    // (administrateur, comptabilité) — comme le reste de l'admin.
    const finances = roleHasAccess(a.role, 'finances');
    if (!finances) {
      points.forEach((p) => { p.a_virer_cents = 0; p.mois = { locations: p.mois.locations, ca_cents: null, commission_cents: null }; p.saison = { jours_machine: p.saison.jours_machine, ca_cents: null, commission_cents: null }; });
      cellules.forEach((c) => { c.ca_saison_cents = null; c.commissions_saison_cents = null; });
    }
    return res.status(200).json({
      finances,
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
      stock_table: stockTable !== false,
      stock_historique: stockHistorique,
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
