// Menu (bouton ☰) : tiroir à droite. Se ferme avec la croix, Échap, un clic
// à côté du tiroir, ou un clic sur un lien. Partagé par les pages Atelier.
(function(){
  var b = document.getElementById('burger'), m = document.getElementById('menu');
  if (!b || !m) return;
  var x = m.querySelector('.mm-x');
  function ouvrir(o){
    b.setAttribute('aria-expanded', o ? 'true' : 'false');
    document.body.classList.toggle('menu-ouvert', o);
    if (o){
      m.hidden = false;
      requestAnimationFrame(function(){ requestAnimationFrame(function(){ m.classList.add('on'); }); });
      (x || m.querySelector('a')).focus();
    } else {
      m.classList.remove('on');
      setTimeout(function(){ if (b.getAttribute('aria-expanded') === 'false') m.hidden = true; }, 450);
      b.focus();
    }
  }
  b.addEventListener('click', function(){ ouvrir(true); });
  if (x) x.addEventListener('click', function(){ ouvrir(false); });
  m.addEventListener('click', function(e){ if (e.target === m || e.target.closest('a')) ouvrir(false); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && b.getAttribute('aria-expanded') === 'true') ouvrir(false); });
})();
