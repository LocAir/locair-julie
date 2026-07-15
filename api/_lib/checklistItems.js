// Checklists administrables (installation / récupération) — Module 5,
// Parties 5 et 7. Distinctes de checklist_box (matériel à prendre au box).
async function getActiveChecklistItems(supabase, workflow) {
  const { data, error } = await supabase
    .from('checklist_items')
    .select('id, libelle, ordre')
    .eq('workflow', workflow).eq('actif', true)
    .order('ordre', { ascending: true });
  if (error) throw error;
  return data || [];
}

// Vérifie que la checklist envoyée par le transporteur coche bien tous les
// items actifs — renvoie un message d'erreur ou null si tout est bon, plus
// le snapshot à figer sur la mission (traçabilité même si la liste évolue).
function validateChecklistReponses(items, reponses) {
  const r = reponses && typeof reponses === 'object' ? reponses : {};
  const manquants = items.filter(i => r[i.id] !== true);
  if (manquants.length) {
    return { error: `Checklist incomplète : ${manquants.map(i => i.libelle).join(', ')}` };
  }
  const snapshot = items.map(i => ({ id: i.id, libelle: i.libelle, coche: true }));
  return { snapshot };
}

module.exports = { getActiveChecklistItems, validateChecklistReponses };
