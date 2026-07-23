// Checklist matériel à récupérer au box avant de partir en tournée — un
// transporteur donné, un jour donné. Synchronisée avec ses missions du jour
// (livraisons/changements = matériel à emporter, récupérations = comptent
// seulement pour les items fixes ci-dessous, rien n'est installé).
//
// Items fixes : toujours 1 fois par jour dès qu'il y a au moins une mission,
// peu importe leur nombre (le sac de transport et les outils ne se
// multiplient pas avec le nombre de clients). bac_vidange_* ne concerne que
// les jours avec récupération (filtré côté transporteur/index.html) — les
// autres sont dans le sac en permanence. Le kit de calfeutrage n'est plus
// ici : il est dynamique, voir kits ci-dessous et ITEMS_DYNAMIQUES.
const ITEMS_FIXES = {
  diable:            1,
  sac_transport:     1,
  bac_vidange_petit: 1,
  bac_vidange_grand: 1,
  velcro_secours:    1,
  boite_piles:       1,
  microfibre:        1,
  lingette:          1,
};

// Items dynamiques : un jeu complet par climatiseur installé ce jour-là
// (télécommande, kit de calfeutrage, rouleau velcro, notice, enveloppe) —
// le kit de calfeutrage est déjà compté dans `kits` (par type de fenêtre),
// les autres se multiplient à l'identique par le même total d'appareils.
const ITEMS_DYNAMIQUES = ['telecommande', 'rouleau_velcro', 'notice', 'enveloppe_locair'];

// Le kit de calfeutrage est universel pour tous les types de fenêtre, sauf
// Vélux/toit qui exige un kit dédié — seule "Vélux / toit" contient "lux"
// parmi les valeurs possibles du site (voir index.html, .win-card).
function kitPourFenetre(fenetre) {
  return String(fenetre || '').toLowerCase().includes('lux') ? 'velux' : 'universel';
}

// Une réservation peut mélanger plusieurs types de fenêtre (ex. 2 climatiseurs
// sur porte coulissante + 1 sur Vélux, voir reservation_fenetres) — construit
// la liste des kits à prendre, un par appareil de la mission. Repli sur
// l'ancien comportement (un seul type pour toute la réservation) si la
// répartition par type est absente : réservations créées avant cette
// fonctionnalité, ou via le formulaire de création manuelle admin.
function kitSequenceForReservation(reservation, unitCount) {
  const detail = reservation?.reservation_fenetres || [];
  if (!detail.length) {
    const kit = kitPourFenetre(reservation?.fenetre);
    return Array.from({ length: unitCount }, () => kit);
  }
  const seq = [];
  detail.forEach(d => {
    const kit = kitPourFenetre(d.type);
    for (let i = 0; i < d.quantite; i++) seq.push(kit);
  });
  // La quantité a pu changer après la réservation initiale (appareil ajouté
  // à la main) — plutôt que de sous-compter le matériel à prendre, on
  // reporte sur le dernier type connu de la répartition.
  while (seq.length < unitCount) seq.push(seq[seq.length - 1] || kitPourFenetre(reservation?.fenetre));
  return seq.slice(0, unitCount);
}

async function computeChecklistBox(supabase, transporteurId, dateISO) {
  const { data: livs, error } = await supabase
    .from('livraisons')
    .select(`
      id, type, statut,
      reservation:reservations ( quantite, fenetre, reservation_appareils ( appareil:appareils ( numero ) ), reservation_fenetres ( type, quantite ) )
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
    const numeros = ((l.reservation?.reservation_appareils) || [])
      .map(ra => ra.appareil?.numero).filter(n => n != null);
    // Appareil pas encore assigné (mission créée à la main) — le besoin de
    // matériel ne doit pas disparaître pour autant, on retombe sur la
    // quantité commandée.
    const unitCount = numeros.length || (l.reservation?.quantite || 1);
    const kitSeq = kitSequenceForReservation(l.reservation, unitCount);
    numeros.forEach((numero, i) => climatiseurs.push({ numero, mission_id: l.id, kit: kitSeq[i] }));
    kitSeq.forEach(kit => { kits[kit]++; });
  });

  climatiseurs.sort((a, b) => a.numero - b.numero);

  // Un jeu d'items dynamiques par climatiseur installé aujourd'hui (même
  // total que les kits de calfeutrage, un par appareil).
  const installCount = kits.universel + kits.velux;

  return {
    date: dateISO,
    nb_missions: missions.length,
    climatiseurs,
    kits,
    install_count: installCount,
    fixe: missions.length > 0 ? ITEMS_FIXES : null,
    dynamique: installCount > 0 ? ITEMS_DYNAMIQUES : null,
  };
}

module.exports = { computeChecklistBox, kitPourFenetre, ITEMS_FIXES, ITEMS_DYNAMIQUES };
