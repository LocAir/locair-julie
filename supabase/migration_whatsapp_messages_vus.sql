create table if not exists whatsapp_messages_vus (
  msg_id text primary key,
  vu_le  timestamptz not null default now()
);

-- Nettoyage automatique des entrées de plus de 24h (lancé via pg_cron si disponible,
-- sinon la table reste petite car Meta ne réessaie pas au-delà de quelques heures)
