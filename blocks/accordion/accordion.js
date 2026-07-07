import { loadCopy } from '../../scripts/scripts.js';

export default async function decorate(block) {
  const copy = await loadCopy(import.meta.url);
  [...block.children].forEach((row) => {
    const label = row.children[0];
    const summary = document.createElement('summary');
    summary.className = 'accordion-item-label';
    summary.append(...label.childNodes);

    const body = row.children[1];
    body.className = 'accordion-item-body';

    const details = document.createElement('details');
    details.className = 'accordion-item';
    details.append(summary, body);
    row.replaceWith(details);
  });

  const items = [...block.querySelectorAll('details.accordion-item')];
  if (!items.length) return;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'accordion-toggle';

  const updateToggle = () => {
    const allOpen = items.every((item) => item.open);
    toggle.textContent = allOpen ? (copy.collapseAll || 'Collapse All') : (copy.expandAll || 'Expand All');
    toggle.setAttribute('aria-expanded', String(allOpen));
  };

  toggle.addEventListener('click', () => {
    const expand = !items.every((item) => item.open);
    items.forEach((item) => {
      item.open = expand;
    });
    updateToggle();
  });

  items.forEach((item) => {
    item.addEventListener('toggle', updateToggle);
  });

  const toolbar = document.createElement('div');
  toolbar.className = 'accordion-toolbar';
  toolbar.append(toggle);
  block.prepend(toolbar);

  updateToggle();
}
