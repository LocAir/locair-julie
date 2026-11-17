document.addEventListener('DOMContentLoaded', function() {
  var burger = document.querySelector('.ld-burger');
  var nav = document.querySelector('.ld-nav-links');
  if (!burger || !nav) return;

  /* Injecte un bouton Fermer (×) dans l'overlay mobile la première fois */
  var closeBtn = document.createElement('button');
  closeBtn.className = 'ld-nav-close';
  closeBtn.setAttribute('aria-label', 'Fermer le menu');
  closeBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  nav.prepend(closeBtn);

  function openMenu() {
    nav.classList.add('open');
    burger.setAttribute('aria-expanded', 'true');
    burger.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function closeMenu() {
    nav.classList.remove('open');
    burger.setAttribute('aria-expanded', 'false');
    burger.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  closeBtn.addEventListener('click', closeMenu);

  burger.addEventListener('click', function() {
    if (nav.classList.contains('open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  nav.querySelectorAll('a').forEach(function(a) {
    a.addEventListener('click', closeMenu);
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeMenu();
  });
});
