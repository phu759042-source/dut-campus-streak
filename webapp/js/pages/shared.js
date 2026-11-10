import { html } from 'preact';
import { Icon } from '../ui.js';
import { back } from '../router.js';

export function PageHeader({ title, subtitle, actions, noBack = false }) {
  return html`<header class="page-head slide-down">
    ${!noBack && html`<button class="icon-btn" aria-label="Quay lại" onClick=${() => back('/')}><${Icon} name="back" /></button>`}
    <div class="grow">
      <h1>${title}</h1>
      ${subtitle && html`<div class="muted small">${subtitle}</div>`}
    </div>
    ${actions}
  </header>`;
}
