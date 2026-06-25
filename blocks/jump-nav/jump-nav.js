export default function decorate(block) {
  const ul = block.querySelector('ul');
  const cta = block.querySelector('p.button-wrapper');

  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'Page Sections'); // TODO: localization
  nav.append(ul);
  if (cta) nav.append(cta);

  block.replaceChildren(nav);

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

  const observer = new IntersectionObserver((entries) => {
    const visible = entries.find((e) => e.isIntersecting);
    if (!visible) return;
    const { id } = visible.target;
    links.forEach((a) => a.setAttribute('aria-current', a.href.endsWith(`#${id}`) ? 'true' : 'false'));
  }, { rootMargin: '-20% 0px -79% 0px' });

  targets.forEach((t) => observer.observe(t));
}
