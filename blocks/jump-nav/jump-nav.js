export default function decorate(block) {
  const ul = block.querySelector('ul');
  const cta = block.querySelector('p.button-wrapper');

  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'Page Sections'); // TODO: localization
  nav.append(ul);
  if (cta) nav.append(cta);

  block.replaceChildren(nav);

  const container = block.closest('.jump-nav-container');

  const links = [...ul.querySelectorAll('a[href*="#"]')];
  const targets = links
    .map((a) => {
      try {
        return document.getElementById(new URL(a.href).hash.slice(1));
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (!targets.length) return;

  const resizeObserver = new ResizeObserver(() => {
    const height = `calc(${container.offsetHeight}px + 1.2em)`;
    targets.forEach((t) => { t.style.scrollMarginTop = height; });
  });
  resizeObserver.observe(container);

  const hash = window.location.hash.slice(1);
  const initial = (hash && links.find((a) => a.href.endsWith(`#${hash}`))) || links[0];
  if (initial) initial.setAttribute('aria-current', 'location');

  const prefersReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  links.forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = new URL(a.href).hash.slice(1);
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      const behavior = prefersReduced() ? 'auto' : 'smooth';
      target.scrollIntoView({ behavior });
      a.scrollIntoView({ behavior, inline: 'center', block: 'nearest' });
      window.history.pushState(null, '', `#${id}`);
    });
  });

  const observer = new IntersectionObserver(() => {
    const mostVisible = targets
      .map((t) => {
        const r = t.getBoundingClientRect();
        const visible = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
        return { t, px: visible > 0 ? visible * r.width : 0 };
      })
      .filter((item) => item.px > 0)
      .sort((a, b) => b.px - a.px)[0];

    if (!mostVisible) return;
    const active = links.find((a) => a.href.endsWith(`#${mostVisible.t.id}`));
    if (!active) return;

    links.forEach((a) => a.removeAttribute('aria-current'));
    active.setAttribute('aria-current', 'location');

    const sticky = Math.abs(container.getBoundingClientRect().top) < 1;
    if (sticky) {
      active.scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth', inline: 'center', block: 'nearest' });
    }
  }, { threshold: [0, 0.25, 0.5, 0.75, 1.0] });

  targets.forEach((t) => observer.observe(t));
}
