/** Progressive enhancement only: each shared invitation plays once on first substantial view. */
export function mountWorksSponsors(root = document) {
  const panels = [...root.querySelectorAll('.works-sponsor:not([data-works-sponsor-mounted])')];
  if (!panels.length) return;
  panels.forEach(panel => panel.setAttribute('data-works-sponsor-mounted', ''));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches || !('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-playing');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.35 });
  panels.forEach(panel => { panel.classList.add('will-play'); observer.observe(panel); });
  reduced.addEventListener('change', event => {
    if (!event.matches) return;
    observer.disconnect();
    panels.forEach(panel => panel.classList.remove('will-play', 'is-playing'));
  }, { once: true });
}
