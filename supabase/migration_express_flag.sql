-- Ajout du flag express sur les réservations
-- Indique si le client a choisi la livraison Express J0 sous 2h (+60 €)
-- Avant cette migration, le champ était absent — toutes les anciennes
-- réservations ont express = false par défaut (comportement correct).
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS express boolean NOT NULL DEFAULT false;
