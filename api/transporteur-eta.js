const { getSupabase } = require('./_lib/supabase');
const { verifyTransporteurToken } = require('./_lib/auth');
const { geocodeAddress } = require('./_lib/geo');
const { computeEtaMinutes } = require('./_lib/routing');

// Calcule le temps de trajet réel (Google Routes) entre la position du
// livreur au moment où il appuie sur "Prévenir le client" (position fraîche
// envoyée par le navigateur, pas la dernière position trackée en base — voir
// transporteur/index.html, ouvrirPrevenirModal()) et l'adresse de la
// mission — pour remplacer le "environ 30 minutes" fixe du message
// pré-rempli par une estimation réelle. Renvoie toujours 200 (même en cas
// d'échec, minutes:null) : ne doit jamais empêcher le livreur d'envoyer son
// SMS, seulement enrichir le message quand c'est possible.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const transporteurId = await verifyTransporteurToken(req, supabase);
  if (!transporteurId) return res.status(401).json({ error: 'Session invalide' });

  const body = req.body || {};
  const livraisonId = parseInt(body.livraison_id);
  const lat = parseFloat(body.lat);
  const lng = parseFloat(body.lng);
  if (!livraisonId) return res.status(400).json({ error: 'livraison_id manquant' });
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: 'Position invalide' });
  }

  try {
    const { data: livraison } = await supabase
      .from('livraisons').select('id, reservation:reservations(adresse)')
      .eq('id', livraisonId).eq('transporteur_id', transporteurId).maybeSingle();
    if (!livraison || !livraison.reservation?.adresse) return res.status(200).json({ minutes: null });

    const destination = await geocodeAddress(livraison.reservation.adresse);
    if (!destination) return res.status(200).json({ minutes: null });

    const minutes = await computeEtaMinutes({ lat, lng }, destination);
    return res.status(200).json({ minutes });
  } catch (err) {
    console.error('[Transporteur ETA]', err.message);
    return res.status(200).json({ minutes: null });
  }
};
