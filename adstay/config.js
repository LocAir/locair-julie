// Branchement de la base AdStay (projet Supabase séparé de Loc'Air).
// Supabase → Project Settings → API : copier « Project URL » et la clé « anon public ».
// La clé « anon » est faite pour être publique (les droits sont protégés dans la base).
// Tant que c'est vide : la tablette montre les exemples de donnees.js et
// l'espace partenaires affiche « pas encore branché ».
window.ADSTAY_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
