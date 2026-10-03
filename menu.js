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

// Sommaire « Sur cette page » des guides et des villes : un menu déroulant
// sur téléphone (fermé), ouvert d'office sur ordinateur.
(function(){
  var navs = document.querySelectorAll('nav.som');
  navs.forEach(function(n){
    var p = n.querySelector('p'), ol = n.querySelector('ol');
    if (!p || !ol || n.querySelector('details')) return;
    var d = document.createElement('details'), s = document.createElement('summary');
    s.textContent = p.textContent;
    var nb = document.createElement('span'); nb.className = 'som-nb';
    nb.textContent = ol.children.length + ' parties';
    s.appendChild(nb);
    d.appendChild(s); d.appendChild(ol);
    n.replaceChild(d, p);
    if (window.matchMedia('(min-width:900px)').matches) d.open = true;
    ol.addEventListener('click', function(e){ if (e.target.closest('a') && !window.matchMedia('(min-width:900px)').matches) d.open = false; });
  });
})();
