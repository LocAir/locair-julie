// Clé publique VAPID — non secrète par construction (c'est la clé privée qui
// signe les envois), safe à exposer telle quelle au navigateur.
module.exports = async (req, res) => {
  return res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
};
