// Barème Loc'Air fixe (en centimes)
function computeBareme(type, installation) {
  if (type === 'changement')  return 4000;
  if (type === 'recuperation') return 3000;
  // livraison : technicien ou autonome
  return (installation || '').startsWith('Technicien') ? 4000 : 3000;
}

module.exports = { computeBareme };
