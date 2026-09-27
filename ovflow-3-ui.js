(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const groups = {
    home: ['#homeDashboard'],
    plan: ['#journeyPlanner'],
    live: ['#quickLivePanel', '#liveTripSession'],
    stops: ['section.hero', '.stats-grid', '.departures-panel'],
    map: ['#mapSection']
  };
  const all = [...new Set(Object.values(groups).flat())];
  const technical = ['.technical-details', '.technical-footer'];

  function show(view, {focus=false} = {}) {
    if (!groups[view]) view = 'home';
    document.body.dataset.ovView = view;
    all.forEach(sel => $$(sel).forEach(el => el.classList.add('ov-view-hidden')));
    groups[view].forEach(sel => $$(sel).forEach(el => el.classList.remove('ov-view-hidden')));
    technical.forEach(sel => $$(sel).forEach(el => el.classList.toggle('ov-view-hidden', view !== 'stops')));
    $$('.bottom-nav .nav-item[data-target]').forEach(btn => btn.classList.toggle('active', btn.dataset.target === view));
    history.replaceState(null, '', `#${view}`);
    window.scrollTo({top: 0, behavior: 'smooth'});
    if (focus && view === 'plan') setTimeout(() => $('#plannerFrom')?.focus(), 250);
    if (focus && view === 'stops') setTimeout(() => $('#stopSearchInput')?.focus(), 250);
    if (view === 'map') setTimeout(() => window.dispatchEvent(new Event('resize')), 180);
  }

  $$('.bottom-nav .nav-item[data-target]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      show(btn.dataset.target, {focus:true});
    }, true);
  });
  $('#homePlanAction')?.addEventListener('click', (e) => { e.stopImmediatePropagation(); show('plan', {focus:true}); }, true);
  $('#homeStopAction')?.addEventListener('click', (e) => { e.stopImmediatePropagation(); show('stops', {focus:true}); }, true);
  $('#homeLiveAction')?.addEventListener('click', (e) => { e.stopImmediatePropagation(); show('live'); }, true);
  $('#homeMapAction')?.addEventListener('click', (e) => { e.stopImmediatePropagation(); show('map'); }, true);
  $('.brand')?.addEventListener('click', (e) => { e.preventDefault(); show('home'); });

  const initial = location.hash.slice(1);
  show(groups[initial] ? initial : 'home');
})();
