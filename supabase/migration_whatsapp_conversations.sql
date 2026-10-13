-- Mémoire conversationnelle pour l'agent WhatsApp IA de Loc'Air
-- À coller dans Supabase → SQL Editor avant de déployer whatsapp-webhook.js v2

create table if not exists whatsapp_conversations (
  phone      text primary key,                -- numéro WhatsApp du client (ex: "33612345678")
  messages   jsonb not null default '[]'::jsonb, -- tableau [{role, content}] des 20 derniers échanges
  updated_at timestamptz not null default now()
);

-- Index pour retrouver rapidement les conversations récentes
create index if not exists whatsapp_conversations_updated_at on whatsapp_conversations(updated_at desc);

-- Nettoyage automatique : supprimer les conversations inactives depuis plus de 30 jours
-- (fonction appelée par le cron-daily existant si on l'y ajoute, ou manuellement)
create or replace function purge_old_whatsapp_conversations() returns void language sql as $$
  delete from whatsapp_conversations
  where updated_at < now() - interval '30 days';
$$;
