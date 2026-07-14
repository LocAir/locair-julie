// Extension de fichier déduite du content-type — partagé entre les flux
// d'upload transporteur (preuves de mission) et admin (vidéos tutoriel).
// Non strict : un content-type inconnu retombe sur mp4 plutôt que de
// rejeter l'upload.
const EXT_BY_TYPE = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
};

module.exports = { EXT_BY_TYPE };
