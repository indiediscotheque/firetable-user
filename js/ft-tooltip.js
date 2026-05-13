/**
 * <ft-tooltip> — single source-of-truth tooltip web component.
 *
 * Usage:
 *   <ft-tooltip label="Some hint">
 *     <button>...</button>
 *   </ft-tooltip>
 *
 * Attributes:
 *   label      — tooltip text (can be updated dynamically)
 *   placement  — top (default) | bottom | left | right
 *
 * CSS custom properties from the outer document are inherited through
 * the shadow DOM, so --font-family, --color-text-light, --color-bg-t2,
 * and --radius-sm all work without any extra config.
 */
class FtTooltip extends HTMLElement {
  static get observedAttributes() {
    return ['label', 'placement'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this._render();

    // Suppress tooltip when focus arrives via pointer (mouse/touch click).
    // Cleared on focusout so keyboard focus on the same element later still works.
    this.addEventListener('pointerdown', () => {
      this.setAttribute('data-pointer-active', '');
    });
    this.addEventListener('focusout', () => {
      this.removeAttribute('data-pointer-active');
    });
    // Safety: if pointer press lands on a non-focusable child, focusout never fires.
    this.addEventListener('pointerup', () => {
      setTimeout(() => {
        if (!this.contains(document.activeElement)) {
          this.removeAttribute('data-pointer-active');
        }
      }, 100);
    });
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (!this.shadowRoot || oldVal === newVal) return;
    if (name === 'label') {
      const tip = this.shadowRoot.querySelector('.tip');
      if (tip) tip.textContent = newVal || '';
    }
    // placement is CSS-only (host attribute selectors) — no JS needed.
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-flex;
          position: relative;
          /* Don't swallow flex/grid sizing from the outer layout */
          align-items: center;
          justify-content: center;
        }

        .tip {
          position: absolute;
          padding: 0.2rem 0.5rem;
          font-size: 0.7rem;
          font-family: var(--font-family, sans-serif);
          font-weight: 400;
          text-transform: none;
          letter-spacing: 0;
          line-height: 1.4;
          white-space: nowrap;
          color: var(--color-text-light, #fff);
          background: var(--color-bg-t2, rgba(0,0,0,0.85));
          border-radius: var(--radius-sm, 3px);
          pointer-events: none;
          opacity: 0;
          transition: opacity 150ms ease;
          z-index: 1000;

          /* Default: above (top) */
          bottom: calc(100% + 0.5rem);
          left: 50%;
          transform: translateX(-50%);
        }

        /* ── Placement variants ── */
        :host([placement="bottom"]) .tip {
          bottom: auto;
          top: calc(100% + 0.5rem);
          left: 50%;
          transform: translateX(-50%);
        }

        :host([placement="left"]) .tip {
          bottom: auto;
          left: auto;
          right: calc(100% + 0.6rem);
          top: 50%;
          transform: translateY(-50%);
        }

        :host([placement="right"]) .tip {
          bottom: auto;
          left: calc(100% + 0.75rem);
          top: 50%;
          transform: translateY(-50%);
        }

        /* On narrow screens, right-placed tooltips flip to below so they
           don't escape the viewport (matches the old header_icon behaviour). */
        @media (max-width: 799px) {
          :host([placement="right"]) .tip {
            left: 50%;
            top: calc(100% + 0.5rem);
            right: auto;
            transform: translateX(-50%);
          }
        }

        /* ── Visibility ── */
        :host(:hover) .tip { opacity: 1; }

        /* Show on keyboard focus, but not when clicked with a pointer
           (data-pointer-active is set on pointerdown, cleared on focusout) */
        :host(:focus-within:not([data-pointer-active])) .tip { opacity: 1; }

        /* Don't show if empty */
        .tip:empty {
          display: none;
        }
      </style>
      <slot></slot>
      <div class="tip" role="tooltip"></div>
    `;
    // Set text safely (avoids XSS from dynamic DJ names etc.)
    this.shadowRoot.querySelector('.tip').textContent = this.getAttribute('label') || '';
  }
}

customElements.define('ft-tooltip', FtTooltip);
