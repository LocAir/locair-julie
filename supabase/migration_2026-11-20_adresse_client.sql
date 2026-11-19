-- Click & Collect — adresse postale du client (contrat, courrier si l'appareil
-- n'est jamais rendu). La colonne « adresse » garde l'adresse du point de retrait.
-- À coller UNE FOIS dans Supabase → SQL Editor. Le site marche aussi sans :
-- l'adresse part alors dans les consignes (instructions_acces).
alter table reservations add column if not exists adresse_client text;
