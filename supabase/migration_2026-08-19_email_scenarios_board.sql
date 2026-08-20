-- Board "emails et SMS actifs" (demande d'Aly, 2026-08-19) — ajoute le suivi
-- des modifications sur email_scenarios : jusqu'ici, activer/désactiver un
-- scénario ne laissait aucune trace de quand ni par qui.
alter table email_scenarios add column if not exists updated_at timestamptz not null default now();
alter table email_scenarios add column if not exists updated_by text;
