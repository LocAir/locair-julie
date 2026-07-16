// Module 7, Partie 31 — chaque rôle voit uniquement ce dont il a besoin.
// `null` veut dire accès total (administrateur). Les rubriques non listées
// pour un rôle restent gérées par le contrôle admin classique (checkAdminToken)
// — cette liste ne couvre que les quelques rubriques réellement sensibles
// (finances, réglages, gestion de l'équipe), pas chaque écran de l'admin.
const DOMAINES_PAR_ROLE = {
  administrateur: null,
  operateur: ['commandes', 'logistique', 'clients', 'support', 'stock'],
  comptabilite: ['finances', 'commandes', 'partenaires', 'transporteurs'],
  support_client: ['clients', 'support', 'documents'],
};

function roleHasAccess(role, domaine) {
  const domaines = DOMAINES_PAR_ROLE[role];
  if (domaines === undefined) return false;
  if (domaines === null) return true;
  return domaines.includes(domaine);
}

module.exports = { roleHasAccess, ROLES: Object.keys(DOMAINES_PAR_ROLE) };
