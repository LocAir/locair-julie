const { getSupabase } = require('./_lib/supabase');
const { resolveAdminCity } = require('./_lib/city');
const { checkAdminRole } = require('./_lib/auth');
const { roleHasAccess } = require('./_lib/permissions');
const { notifyTransporteur } = require('./_lib/transporteurNotif');
const { sendBrevoEmail } = require('./_lib/brevo');
const { getSignature, withSignature } = require('./_lib/emailEngine');
const { tplPrimeTransporteur } = require('./_lib/emailTemplates');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const admin = await checkAdminRole(req, supabase);
  if (!admin.ok) return res.status(401).json({ error: 'Non autorisé' });
  if (!roleHasAccess(admin.role, 'finances')) return res.status(403).json({ error: "Ton compte n'a pas accès aux paiements transporteurs." });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    const city = await resolveAdminCity(supabase, body);
    if (!city) return res.status(404).json({ error: 'Aucune ville configurée' });
    // virements n'a pas de city_id direct — on passe par les transporteurs de
    // cette ville pour ne jamais faire fuiter les paiements d'une autre ville
    // partageant la même base Supabase.
    const { data: cityTransp } = await supabase.from('transporteurs').select('id').eq('city_id', city.id);
    const transpIds = (cityTransp || []).map(t => t.id);

    if (action === 'list') {
      if (!transpIds.length) return res.status(200).json({ virements: [] });
      const { data, error } = await supabase
        .from('virements')
        .select('id, montant_cents, statut, created_at, verse_at, transporteur:transporteurs ( id, nom )')
        .in('transporteur_id', transpIds)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return res.status(200).json({ virements: data || [] });
    }

    // Vue "revenus par livreur" : ce qui manquait jusqu'ici, l'admin ne voyait
    // un transporteur ici que s'il avait lui-même demandé un virement — aucune
    // visibilité sur ce qui est dû avant ça. Regroupe toutes les missions
    // terminées par transporteur, payées ou non, pour un aperçu complet
    // (montant à verser, déjà versé, détail mission par mission).
    if (action === 'summary') {
      const { data: transporteurs } = await supabase
        .from('transporteurs').select('id, nom, actif, siret, adresse_facturation').eq('city_id', city.id).order('nom');
      const ids = (transporteurs || []).map(t => t.id);
      if (!ids.length) return res.status(200).json({ transporteurs: [] });

      const { data: faites } = await supabase
        .from('livraisons')
        .select(`
          id, type, transporteur_id, montant_du_cents, paye, valide, fait_at,
          reservation:reservations ( prenom, nom, adresse )
        `)
        .in('transporteur_id', ids).eq('statut', 'fait')
        .order('fait_at', { ascending: false });

      const { data: demandesEnCours } = await supabase
        .from('virements').select('transporteur_id').in('transporteur_id', ids).eq('statut', 'demande');
      const enCoursSet = new Set((demandesEnCours || []).map(v => v.transporteur_id));

      const byTransp = {};
      (faites || []).forEach(f => { (byTransp[f.transporteur_id] = byTransp[f.transporteur_id] || []).push(f); });

      // 3 statuts (Partie 9) : en attente de validation humaine -> validé
      // (payable) -> payé. Seules les missions "validé" comptent pour le
      // montant réellement versable (voir verser_maintenant/marquer_verse).
      const result = (transporteurs || []).map(t => {
        const missions = byTransp[t.id] || [];
        const enAttenteValidation = missions.filter(m => !m.paye && !m.valide).reduce((s, m) => s + (m.montant_du_cents || 0), 0);
        const nonVerse = missions.filter(m => !m.paye && m.valide).reduce((s, m) => s + (m.montant_du_cents || 0), 0);
        const verse    = missions.filter(m => m.paye).reduce((s, m) => s + (m.montant_du_cents || 0), 0);
        return {
          id: t.id, nom: t.nom, actif: t.actif,
          profil_incomplet: !t.siret || !t.adresse_facturation,
          en_attente_validation_cents: enAttenteValidation, non_verse_cents: nonVerse, verse_cents: verse,
          demande_en_cours: enCoursSet.has(t.id),
          missions: missions.map(m => ({
            id: m.id, type: m.type, montant_cents: m.montant_du_cents || 0,
            statut_paiement: m.paye ? 'paye' : (m.valide ? 'valide' : 'en_attente'),
            fait_at: m.fait_at,
            client: [m.reservation?.prenom, m.reservation?.nom].filter(Boolean).join(' ') || null,
          })),
        };
      });
      return res.status(200).json({ transporteurs: result });
    }

    // Espace dédié "Factures transporteurs" (Module facture hebdomadaire,
    // 2026-08-17) : liste toutes les factures que les transporteurs de cette
    // ville ont générées eux-mêmes depuis leur espace (bouton "Facture de la
    // semaine") — l'admin les retrouve ici en PDF téléchargeable, sans avoir
    // à aller les chercher dans sa boîte mail (voir aussi
    // transporteur-facture-view.js, même lien de téléchargement des 2 côtés).
    if (action === 'list_factures_transporteur') {
      if (!transpIds.length) return res.status(200).json({ factures: [] });
      const { data, error } = await supabase
        .from('transporteur_factures')
        .select('id, transporteur_id, numero, periode_debut, periode_fin, nb_missions, montant_total_cents, envoyee_admin, access_token, created_at, transporteur:transporteurs ( id, nom, siret, adresse_facturation )')
        .in('transporteur_id', transpIds)
        .order('periode_debut', { ascending: false })
        .limit(300);
      if (error) throw error;
      return res.status(200).json({ factures: data || [] });
    }

    // Correction manuelle d'un montant après coup (Module 9) — ex. mission mal
    // tarifée, oubli d'un supplément. Autorisée même sur une mission déjà
    // versée (voulu explicitement par Aly) : le total "déjà versé" affiché
    // ici reflète alors la correction, indépendamment du montant réellement
    // transféré en banque à l'époque — à Aly de recouper si besoin.
    // montant_manuel évite qu'un recalcul ultérieur écrase cette correction
    // (voir transporteur-action.js).
    if (action === 'modifier_montant') {
      const livraisonId  = parseInt(body.livraison_id);
      const montantCents = parseInt(body.montant_cents);
      if (!livraisonId || !Number.isFinite(montantCents) || montantCents < 0) {
        return res.status(400).json({ error: 'Paramètres invalides' });
      }
      const { data: liv } = await supabase
        .from('livraisons').select('id, transporteur_id, statut')
        .eq('id', livraisonId).maybeSingle();
      if (!liv || !transpIds.includes(liv.transporteur_id)) return res.status(404).json({ error: 'Mission introuvable' });
      if (liv.statut !== 'fait') return res.status(400).json({ error: 'Mission non terminée' });

      const { error: updMontantErr } = await supabase.from('livraisons').update({ montant_du_cents: montantCents, montant_manuel: true }).eq('id', livraisonId);
      if (updMontantErr) throw updMontantErr;
      return res.status(200).json({ ok: true, montant_cents: montantCents });
    }

    // Validation humaine obligatoire avant paiement (Partie 9) — valide
    // toutes les missions terminées et pas encore validées d'un transporteur.
    if (action === 'valider') {
      const transporteurId = parseInt(body.transporteur_id);
      if (!transporteurId || !transpIds.includes(transporteurId)) return res.status(404).json({ error: 'Transporteur introuvable' });

      const { data: aValider } = await supabase
        .from('livraisons').select('id')
        .eq('transporteur_id', transporteurId).eq('statut', 'fait').eq('valide', false);
      const ids = (aValider || []).map(l => l.id);
      if (!ids.length) return res.status(400).json({ error: 'Rien à valider pour ce transporteur' });

      const { error: valideErr } = await supabase.from('livraisons').update({ valide: true, valide_at: new Date().toISOString() }).in('id', ids);
      if (valideErr) throw valideErr;
      await notifyTransporteur(supabase, transporteurId, {
        type: 'validation', message: 'Votre mission a été validée.', tag: 'validation',
      });

      return res.status(200).json({ ok: true, missions_validees: ids.length });
    }

    // Verser directement depuis l'admin, sans attendre que le livreur en fasse
    // la demande côté /transporteur — utile s'il ne pense pas à demander, ou
    // pour tout solder avant qu'il quitte l'équipe.
    if (action === 'verser_maintenant') {
      const transporteurId = parseInt(body.transporteur_id);
      if (!transporteurId || !transpIds.includes(transporteurId)) return res.status(404).json({ error: 'Transporteur introuvable' });

      const { data: faites } = await supabase
        .from('livraisons').select('id, montant_du_cents, fait_at')
        .eq('transporteur_id', transporteurId).eq('statut', 'fait').eq('paye', false).eq('valide', true);
      const montant = (faites || []).reduce((s, f) => s + (f.montant_du_cents || 0), 0);
      const ids = (faites || []).map(f => f.id);

      // Une demande de virement déjà en cours pour ce transporteur est réglée
      // par ce paiement plutôt que dupliquée avec une nouvelle ligne.
      // .limit(1) plutôt que .maybeSingle() : si une course (double clic sur
      // "demander un virement") a fini par créer 2 lignes 'demande', une
      // erreur PostgREST "multiple rows" sur .maybeSingle() serait passée
      // inaperçue faute de vérifier `error` ici, laissant croire à tort
      // qu'aucune demande n'était en cours et créant un virement 'verse' en
      // plus (audit du 2026-07-30) — .limit(1) ne peut pas échouer ainsi.
      const { data: existanteRows, error: existanteErr } = await supabase
        .from('virements').select('id').eq('transporteur_id', transporteurId).eq('statut', 'demande').limit(1);
      if (existanteErr) throw existanteErr;
      const existante = (existanteRows || [])[0] || null;

      // Rien à verser ET aucune demande à régler : vraiment rien à faire.
      // Mais s'il y a une demande en cours pour 0 € (ex. missions déjà payées
      // par ailleurs entre-temps), on la solde quand même — sinon le badge
      // "virement demandé" reste bloqué pour toujours, sans aucun moyen de
      // le faire disparaître (le bouton lui-même n'apparaissait qu'à partir
      // d'un montant positif).
      if (montant <= 0 && !existante) {
        return res.status(400).json({ error: 'Rien à verser pour ce transporteur (missions pas encore validées ?)' });
      }

      if (ids.length) {
        // .eq('paye', false) rend l'update atomique au niveau de chaque ligne :
        // si un double-clic (ou un 2e onglet admin) a déjà versé entre notre
        // lecture et notre écriture, ces lignes ne matchent plus et ne sont
        // pas mises à jour une 2e fois — comparer la taille du retour à `ids`
        // permet de détecter la collision plutôt que de créer un 2e virement
        // 'verse' pour le même montant (audit du 2026-07-30).
        const { data: updated, error: payeErr } = await supabase
          .from('livraisons').update({ paye: true }).in('id', ids).eq('paye', false).select('id');
        if (payeErr) throw payeErr;
        if ((updated || []).length !== ids.length) {
          return res.status(409).json({ error: 'Ce virement vient d\'être traité (double clic ?) — vérifie l\'historique avant de réessayer.' });
        }
      }

      if (existante) {
        const { error: virUpdErr } = await supabase.from('virements').update({ statut: 'verse', montant_cents: montant, verse_at: new Date().toISOString() }).eq('id', existante.id);
        if (virUpdErr) throw virUpdErr;
      } else {
        const { error: virInsErr } = await supabase.from('virements').insert({
          transporteur_id: transporteurId, montant_cents: montant, statut: 'verse', verse_at: new Date().toISOString(),
        });
        if (virInsErr) throw virInsErr;
      }
      if (montant > 0) {
        await notifyTransporteur(supabase, transporteurId, {
          type: 'paiement', message: `Votre rémunération a été payée (${(montant / 100).toFixed(2)} €).`, tag: 'paiement',
          montantCents: montant, missionDates: (faites || []).map(f => f.fait_at).filter(Boolean),
        });
      }

      return res.status(200).json({ ok: true, montant_cents: montant });
    }

    if (action === 'marquer_verse') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });

      const { data: virement } = await supabase.from('virements').select('*').eq('id', id).in('transporteur_id', transpIds).maybeSingle();
      if (!virement) return res.status(404).json({ error: 'Virement introuvable' });
      if (virement.statut === 'verse') return res.status(409).json({ error: 'Déjà marqué comme versé' });

      // Recalcul du montant réel au moment du virement (peut différer de la demande
      // si d'autres missions ont été terminées entre-temps). Seules les
      // missions validées par l'administration sont payables (Partie 9).
      const { data: faites } = await supabase
        .from('livraisons').select('id, montant_du_cents, fait_at')
        .eq('transporteur_id', virement.transporteur_id).eq('statut', 'fait').eq('paye', false).eq('valide', true);
      const montant = (faites || []).reduce((s, f) => s + (f.montant_du_cents || 0), 0);
      const ids = (faites || []).map(f => f.id);

      if (ids.length) {
        const { data: updated, error: payErr } = await supabase.from('livraisons').update({ paye: true }).in('id', ids).eq('paye', false).select('id');
        if (payErr) throw payErr;
        if ((updated || []).length !== ids.length) {
          return res.status(409).json({ error: 'Ce virement vient d\'être traité (double clic ?) — vérifie l\'historique avant de réessayer.' });
        }
      }
      const { error: virErr } = await supabase.from('virements').update({ statut: 'verse', montant_cents: montant, verse_at: new Date().toISOString() }).eq('id', id);
      if (virErr) throw virErr;
      // Comme verser_maintenant : si les missions sous-jacentes ont déjà été
      // payées entre-temps par une autre voie, le montant recalculé peut
      // valoir 0 — pas de notification "payée" trompeuse dans ce cas.
      if (montant > 0) {
        await notifyTransporteur(supabase, virement.transporteur_id, {
          type: 'paiement', message: `Votre rémunération a été payée (${(montant / 100).toFixed(2)} €).`, tag: 'paiement',
          montantCents: montant, missionDates: (faites || []).map(f => f.fait_at).filter(Boolean),
        });
      }

      return res.status(200).json({ ok: true, montant_cents: montant });
    }

    // Prime de fin de saison (demande d'Aly, 2026-08-17) : un bonus ponctuel
    // décidé par l'admin pour un mois donné, distinct de la rémunération au
    // barème par mission. Réutilise le mécanisme "mission autre" déjà
    // existant (type='autre', voir migration_mission_libre.sql — aucune
    // nouvelle colonne nécessaire) au lieu d'une nouvelle table : une prime
    // est une ligne livraisons de plus, elle rentre donc automatiquement
    // dans le calcul de "non_verse_cents" ci-dessus comme n'importe quelle
    // mission. Contrairement à une mission "autre" normale (créée 'a_faire',
    // à accepter/terminer par le transporteur), celle-ci est créée
    // directement 'fait' + validée : ce n'est pas une tâche à effectuer,
    // juste un montant déjà acquis à créditer.
    if (action === 'creer_prime') {
      const transporteurId = parseInt(body.transporteur_id);
      if (!transporteurId || !transpIds.includes(transporteurId)) return res.status(404).json({ error: 'Transporteur introuvable' });
      const moisStr = (body.mois || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(moisStr)) return res.status(400).json({ error: 'Mois invalide (format AAAA-MM)' });
      const montantCents = parseInt(body.montant_cents);
      if (!Number.isFinite(montantCents) || montantCents <= 0) return res.status(400).json({ error: 'Montant invalide' });

      const { data: transp } = await supabase.from('transporteurs').select('id, nom, email, city_id').eq('id', transporteurId).maybeSingle();
      if (!transp) return res.status(404).json({ error: 'Transporteur introuvable' });

      const [y, m] = moisStr.split('-').map(Number);
      const moisDebut   = `${moisStr}-01`;
      const moisSuivant = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);   // 1er du mois suivant (borne exclusive)
      const moisFin     = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);   // dernier jour du mois ciblé
      const MOIS_LABEL = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
      const moisLabel = `${MOIS_LABEL[m - 1]} ${y}`;

      // Stats du mois ciblé, pour l'email de félicitations (nombre de
      // missions terminées + montant gagné au barème ce mois-là — avant la
      // prime, qui n'existe pas encore à ce stade de la requête).
      const { data: missionsMois } = await supabase
        .from('livraisons').select('montant_du_cents')
        .eq('transporteur_id', transporteurId).eq('statut', 'fait')
        .gte('fait_at', moisDebut).lt('fait_at', moisSuivant);
      const nbMissions = (missionsMois || []).length;
      const totalGagneCents = (missionsMois || []).reduce((s, x) => s + (x.montant_du_cents || 0), 0);

      const { data: prime, error: primeErr } = await supabase.from('livraisons').insert({
        type: 'autre', city_id: transp.city_id,
        titre: `🏆 Prime de fin de saison — ${moisLabel}`,
        adresse_libre: 'Prime créditée directement — aucun déplacement.',
        transporteur_id: transporteurId, date_prevue: moisFin,
        statut: 'fait', fait_at: new Date().toISOString(),
        montant_du_cents: montantCents, montant_manuel: true, valide: true,
      }).select().single();
      if (primeErr) throw primeErr;

      // Email "best effort" : le champ email n'est pas obligatoire sur une
      // fiche transporteur (utilisé jusqu'ici seulement pour "code oublié")
      // — la prime est déjà créditée dans tous les cas, l'admin est
      // prévenue si l'email n'a pas pu partir plutôt que de le supposer.
      let emailEnvoye = false, emailErreur = null;
      if (transp.email) {
        try {
          const sig = await getSignature(supabase);
          const html = withSignature(tplPrimeTransporteur({
            nom: transp.nom, moisLabel,
            montantFmt: (montantCents / 100).toFixed(2).replace('.', ',') + ' €',
            nbMissions,
            totalGagneFmt: (totalGagneCents / 100).toFixed(2).replace('.', ',') + ' €',
          }), sig);
          const result = await sendBrevoEmail({ to: transp.email, subject: `Votre prime de fin de saison — ${moisLabel}`, html, senderName: sig.nom_expediteur });
          emailEnvoye = !!result.ok;
          if (!result.ok) emailErreur = String(result.error || '').slice(0, 300);
          await supabase.from('email_log').insert({
            reservation_id: null, scenario: 'prime_transporteur', canal: 'email',
            destinataire: transp.email, modele: 'prime_transporteur',
            statut: result.ok ? 'envoye' : 'erreur',
            erreur: result.ok ? null : emailErreur,
            contenu: html,
          }).then(() => {}, () => {});
        } catch (e) {
          emailErreur = e.message;
          console.error('[Prime transporteur email]', e.message);
        }
      }

      return res.status(200).json({
        ok: true, livraison: prime, mois_label: moisLabel,
        nb_missions_mois: nbMissions, total_gagne_cents: totalGagneCents,
        a_email: !!transp.email, email_envoye: emailEnvoye, email_erreur: emailErreur,
      });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin virements]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
