document.addEventListener('DOMContentLoaded', function() {
  const burger = document.querySelector('.ld-burger');
  const nav = document.querySelector('.ld-nav-links');
  if (!burger || !nav) return;
  burger.addEventListener('click', function() {
    const open = nav.classList.toggle('open');
    burger.setAttribute('aria-expanded', open);
  });
  nav.querySelectorAll('a').forEach(function(a) {
    a.addEventListener('click', function() {
      nav.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
    });
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      nav.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
    }
  });
});
