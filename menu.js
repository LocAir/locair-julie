// Menu plein écran (bouton ☰) — partagé par les pages au style Atelier.
(function(){
  var b = document.getElementById('burger'), m = document.getElementById('menu');
  if (!b || !m) return;
  function ouvrir(o){
    b.setAttribute('aria-expanded', o ? 'true' : 'false');
    b.setAttribute('aria-label', o ? 'Fermer le menu' : 'Ouvrir le menu');
    document.body.classList.toggle('menu-ouvert', o);
    if (o){ m.hidden = false; requestAnimationFrame(function(){ m.classList.add('on'); }); var f = m.querySelector('a'); if (f) f.focus(); }
    else { m.classList.remove('on'); setTimeout(function(){ if (b.getAttribute('aria-expanded') === 'false') m.hidden = true; }, 350); }
  }
  b.addEventListener('click', function(){ ouvrir(b.getAttribute('aria-expanded') !== 'true'); });
  m.addEventListener('click', function(e){ if (e.target.closest('a')) ouvrir(false); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && b.getAttribute('aria-expanded') === 'true'){ ouvrir(false); b.focus(); } });
})();
