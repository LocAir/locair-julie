-- Ajoute la colonne fenetre_photo_path sur reservations pour stocker le chemin
-- Supabase Storage de la photo de fenêtre prise lors de la réservation.
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS fenetre_photo_path text;
