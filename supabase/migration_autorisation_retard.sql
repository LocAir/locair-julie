-- La case "J'autorise Loc'Air à débiter ma carte pour tout jour de retard de
-- restitution" (#f-retard sur index.html) est obligatoire pour payer, mais
-- son acceptation n'était jusqu'ici jamais enregistrée : seules les 2 autres
-- cases (CGV/CGL, conditions d'utilisation) avaient une ligne d'audit dans
-- cgv_acceptations. Sans cette trace, impossible de prouver le consentement
-- du client à ce prélèvement automatique en cas de litige — alors même que
-- le contrat (Article 5) affirme que cette autorisation a été donnée.
alter table cgv_acceptations drop constraint if exists cgv_acceptations_type_check;
alter table cgv_acceptations add constraint cgv_acceptations_type_check
  check (type in ('cgv_location', 'conditions_utilisation', 'autorisation_retard'));
