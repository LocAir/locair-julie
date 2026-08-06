// Système générique de promotions/codes promo — remplace les hardcodages
// historiques (PROMO_CODES dans checkout.js, pourcentages fixes de
// _lib/promo.js) par une table pilotable depuis l'admin (voir
// admin-promotions.js) : Aly peut créer/modifier/désactiver un code sans
// jamais redéployer le site.
//
// Le mécanisme "prénom + %" de _lib/promo.js (utilisé par le parrainage et
// la relance des clients dormants) reste un filet de secours : tant
// qu'aucune ligne équivalente n'existe en base — ou si la table n'existe
// pas encore (migration pas encore collée) — le comportement historique
// continue de fonctionner à l'identique. Rien ne casse jamais un paiement.
const { matchPromoPct } = require('./promo');

// Renvoie null si les conditions sont remplies, sinon un code expliquant
// pourquoi l'offre ne s'applique pas à cette réservation.
function checkPromotionConditions(promo, { days, cityId, dateDebut }) {
  const today = dateDebut || new Date().toISOString().slice(0, 10);
  if (promo.date_debut && today < promo.date_debut) return 'pas_encore_active';
  if (promo.date_fin && today > promo.date_fin) return 'expiree';
  if (promo.duree_min_jours != null && days < promo.duree_min_jours) return 'duree_trop_courte';
  if (promo.duree_max_jours != null && days > promo.duree_max_jours) return 'duree_trop_longue';
  if (Array.isArray(promo.villes_ids) && promo.villes_ids.length && cityId && !promo.villes_ids.includes(cityId)) return 'ville_non_couverte';
  return null;
}

// Cherche une offre active correspondant au code saisi, vérifie ses
// conditions par rapport à la réservation en cours, et renvoie la remise à
// appliquer. Ne jette jamais : en cas de souci base de données (ou avant
// que la migration soit collée), on retombe silencieusement sur l'ancien
// système (prénom+% déterministe) plutôt que de bloquer un paiement.
async function resolvePromotion(supabase, { code, prenom, email, baseCents, days, cityId, dateDebut }) {
  const normalizedCode = (code || '').trim().toUpperCase();
  if (!normalizedCode) return { discountCents: 0, promotionId: null, source: null };

  try {
    const { data: promo, error } = await supabase
      .from('promotions').select('*')
      .eq('actif', true)
      .ilike('code', normalizedCode)
      .maybeSingle();
    if (!error && promo) {
      const rejection = checkPromotionConditions(promo, { days, cityId, dateDebut });
      if (!rejection) {
        if (promo.max_utilisations != null && promo.nb_utilisations >= promo.max_utilisations) {
          return { discountCents: 0, promotionId: null, source: 'db_rejected' };
        }
        // "1 fois par client" — vérifié seulement si demandé, pour éviter
        // une requête supplémentaire sur toutes les offres illimitées.
        if (promo.max_utilisations_client != null && email) {
          const { count } = await supabase
            .from('promotions_utilisations').select('id', { count: 'exact', head: true })
            .eq('promotion_id', promo.id).eq('client_email', email.trim().toLowerCase());
          if ((count || 0) >= promo.max_utilisations_client) {
            return { discountCents: 0, promotionId: null, source: 'db_rejected' };
          }
        }
        const discountCents = promo.type_remise === 'pourcentage'
          ? Math.round(baseCents * Number(promo.valeur) / 100)
          : Math.round(Number(promo.valeur) * 100);
        return { discountCents: Math.max(0, Math.min(discountCents, baseCents)), promotionId: promo.id, source: 'db' };
      }
      // Une offre existe pour ce code mais ses conditions ne sont pas
      // remplies (ex. durée trop courte, ville non couverte, expirée) —
      // pas de repli sur l'ancien système pour ce même code : sinon un
      // code désactivé ou périmé recommencerait à fonctionner via le
      // mécanisme prénom+%.
      return { discountCents: 0, promotionId: null, source: 'db_rejected' };
    }
  } catch (e) {
    console.error('[promotions] resolvePromotion:', e.message);
  }

  // Filet de secours : ancien système "PRENOM10/20/30" en dur, inchangé.
  const pct = matchPromoPct(normalizedCode, prenom);
  if (pct > 0) return { discountCents: Math.round(baseCents * pct / 100), promotionId: null, source: 'legacy' };
  return { discountCents: 0, promotionId: null, source: null };
}

// Best-effort — n'échoue jamais la réservation si l'écriture rate (base
// indisponible, migration pas encore collée...).
async function recordPromotionUsage(supabase, { promotionId, reservationId, email, montantRemiseCents }) {
  if (!promotionId) return;
  try {
    await supabase.from('promotions_utilisations').insert({
      promotion_id: promotionId,
      reservation_id: reservationId || null,
      client_email: (email || '').trim().toLowerCase() || null,
      montant_remise_cents: montantRemiseCents || 0,
    });
    await supabase.rpc('increment_promotion_usage', { p_promotion_id: promotionId });
  } catch (e) {
    console.error('[promotions] recordPromotionUsage:', e.message);
  }
}

module.exports = { resolvePromotion, checkPromotionConditions, recordPromotionUsage };
