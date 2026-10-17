(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  // Make the reference-style shortcuts feel real without replacing existing routing logic.
  $$('[data-shortcut]').forEach(btn => btn.addEventListener('click', () => {
    const planner = $('#homeDestinationSearch');
    planner?.click();
  }));

  $('#homeNotificationButton')?.addEventListener('click', () => {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = 'Geen nieuwe belangrijke OV-meldingen.';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2300);
  });

  // Ticket segmented visual behaviour (ticketing itself remains owned by the existing backend/product flow).
  $$('.ticket-segmented button').forEach(btn => btn.addEventListener('click', () => {
    $$('.ticket-segmented button').forEach(x => x.classList.toggle('active', x === btn));
  }));

  // Use the user's actual browser locale greeting.
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Goedemorgen!' : hour < 18 ? 'Goedemiddag!' : 'Goedenavond!';
  const g = $('.poster-greeting > span');
  if (g) g.textContent = greeting;

  // Home brand always returns to the home view via the existing navigation hash.
  $('.poster-wordmark')?.addEventListener('click', e => {
    e.preventDefault();
    $('.bottom-nav [data-target="home"]')?.click();
  });
})();
