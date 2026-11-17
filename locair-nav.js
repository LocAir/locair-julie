document.addEventListener('DOMContentLoaded', function() {
  const burger = document.querySelector('.ld-burger');
  const nav = document.querySelector('.ld-nav-links');
  if (!burger || !nav) return;

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
