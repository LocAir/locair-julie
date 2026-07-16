// Checklist matériel à récupérer au box avant de partir en tournée — un
// transporteur donné, un jour donné. Synchronisée avec ses missions du jour
// (livraisons/changements = matériel à emporter, récupérations = comptent
// seulement pour les items fixes ci-dessous, rien n'est installé).
//
// Items fixes : toujours 1 fois par jour dès qu'il y a au moins une mission,
// peu importe leur nombre (le sac de transport et les outils ne se
// multiplient pas avec le nombre de clients).
const ITEMS_FIXES = {
  diable:               1,
  sac_transport:        1,
  sac_kit_calfeutrage:  1,
  bac_vidange_petit:    1,
  bac_vidange_grand:    1,
  microfibre:           1,
  lingette:             1,
};

// Le kit de calfeutrage est universel pour tous les types de fenêtre, sauf
// Vélux/toit qui exige un kit dédié — seule "Vélux / toit" contient "lux"
// parmi les valeurs possibles du site (voir index.html, .win-card).
function kitPourFenetre(fenetre) {
  return String(fenetre || '').toLowerCase().includes('lux') ? 'velux' : 'universel';
}

async function computeChecklistBox(supabase, transporteurId, dateISO) {
  const { data: livs, error } = await supabase
    .from('livraisons')
    .select(`
      id, type, statut,
      reservation:reservations ( quantite, fenetre, reservation_appareils ( appareil:appareils ( numero ) ) )
    `)
    .eq('transporteur_id', transporteurId)
    .eq('date_prevue', dateISO)
    .eq('masquee', false)
    .not('statut', 'in', '(annule,refusee)');
  if (error) throw error;

  const missions = livs || [];
  const climatiseurs = [];
  const kits = { universel: 0, velux: 0 };

  missions.forEach(l => {
    if (!['livraison', 'changement'].includes(l.type)) return;
    const kit = kitPourFenetre(l.reservation?.fenetre);
    const numeros = ((l.reservation?.reservation_appareils) || [])
      .map(ra => ra.appareil?.numero).filter(n => n != null);
    if (numeros.length) {
      numeros.forEach(numero => climatiseurs.push({ numero, mission_id: l.id, kit }));
      numeros.forEach(() => { kits[kit]++; });
    } else {
      // Appareil pas encore assigné (mission créée à la main) — le besoin de
      // matériel ne doit pas disparaître pour autant, on retombe sur la
      // quantité commandée.
      const qty = l.reservation?.quantite || 1;
      for (let i = 0; i < qty; i++) kits[kit]++;
    }
  });

  climatiseurs.sort((a, b) => a.numero - b.numero);

  return {
    date: dateISO,
    nb_missions: missions.length,
    climatiseurs,
    kits,
    fixe: missions.length > 0 ? ITEMS_FIXES : null,
  };
}

module.exports = { computeChecklistBox, kitPourFenetre, ITEMS_FIXES };
