-- Colonnes perdues au checkout : données collectées sur le site mais jamais
-- stockées en base. Toutes nullable pour ne pas casser les anciennes lignes.

-- Consentement marketing (RGPD) : preuve d'opt-in pour Brevo/emails promo
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS mkt_consent     boolean DEFAULT false;

-- Horodatage acceptation CGV (preuve légale)
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cgv_accepted_at timestamptz;

-- Type de client et SIRET (B2B / facturation)
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS type_client     text;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS siret           text;

-- Code parrain utilisé (programme parrainage — actuellement dans Stripe uniquement)
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS parrain_code    text;

-- Canal d'acquisition marketing (ex. 'google', 'instagram', 'bouche-a-oreille')
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS source_channel  text;

-- Informations logement client (type + motifs — qualification)
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS logement        text;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS motifs          text;
