document.addEventListener('DOMContentLoaded', function() {
  var burger = document.querySelector('.ld-burger');
  var nav = document.querySelector('.ld-nav-links');
  if (!burger || !nav) return;

  function closeMenu() {
    nav.classList.remove('open');
    burger.setAttribute('aria-expanded', 'false');
    burger.classList.remove('is-open');
  }

  burger.addEventListener('click', function() {
    var isOpen = nav.classList.toggle('open');
    burger.setAttribute('aria-expanded', isOpen);
    burger.classList.toggle('is-open', isOpen);
  });

  /* Ferme en cliquant un lien */
  nav.querySelectorAll('a').forEach(function(a) {
    a.addEventListener('click', closeMenu);
  });

  /* Ferme en cliquant en dehors du menu */
  document.addEventListener('click', function(e) {
    if (!nav.contains(e.target) && !burger.contains(e.target)) {
      closeMenu();
    }
  });

  /* Ferme avec Echap */
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeMenu();
  });
});
