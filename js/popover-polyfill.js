/*! @oddbird/popover-polyfill 0.7.3 | BSD-3-Clause, Copyright (c) 2022-2023 OddBird | https://github.com/oddbird/popover-polyfill
 * The HTML popover attribute for browsers without it (Safari before 17: older iPads).
 * Applies itself only where popover is missing. Its styles are also in css/looks.css,
 * because the security policy blocks the <style> it injects in Safari before 16.4. */
"use strict";(()=>{var X=globalThis.Event||class{},h=class extends X{oldState;newState;constructor(t,o={}){let n=Object.assign({},o);delete n.oldState,delete n.newState,super(t,n),this.oldState=String(o.oldState||""),this.newState=String(o.newState||"")}},q=new WeakMap;function x(e,t,o){q.set(e,setTimeout(()=>{q.has(e)&&e.dispatchEvent(new h("toggle",{cancelable:!1,oldState:t,newState:o}))},0))}var R=globalThis.ShadowRoot||function(){},Z=globalThis.HTMLDialogElement||function(){},b=new WeakMap,d=new WeakMap,f=new WeakMap,E=new WeakMap;function P(e){return E.get(e)||"hidden"}var H=new WeakMap;function M(e){return[...e].pop()}function U(e){let t=e.popoverTargetElement;if(!(t instanceof HTMLElement))return;let o=P(t);e.popoverTargetAction==="show"&&o==="showing"||e.popoverTargetAction==="hide"&&o==="hidden"||(o==="showing"?T(t,!0,!0):m(t,!1)&&(H.set(t,e),k(t)))}function m(e,t){return!(e.popover!=="auto"&&e.popover!=="manual"&&e.popover!=="hint"||!e.isConnected||t&&P(e)!=="showing"||!t&&P(e)!=="hidden"||e instanceof Z&&e.hasAttribute("open")||document.fullscreenElement===e)}function z(e){if(!e)return 0;let t=d.get(document)||new Set,o=f.get(document)||new Set;return o.has(e)?[...o].indexOf(e)+t.size+1:t.has(e)?[...t].indexOf(e)+1:0}function ee(e){let t=$(e),o=te(e);return z(t)>z(o)?t:o}function y(e){let t,o=f.get(e)||new Set,n=d.get(e)||new Set,r=o.size>0?o:n.size>0?n:null;return r?(t=M(r),t.isConnected?t:(r.delete(t),y(e))):null}function _(e){for(let t of e||[])if(!t.isConnected)e.delete(t);else return t;return null}function w(e){return typeof e.getRootNode=="function"?e.getRootNode():e.parentNode?w(e.parentNode):e}function $(e){for(;e;){if(e instanceof HTMLElement&&e.popover==="auto"&&E.get(e)==="showing")return e;if(e=e instanceof Element&&e.assignedSlot||e.parentElement||w(e),e instanceof R&&(e=e.host),e instanceof Document)return}}function te(e){for(;e;){let t=e.popoverTargetElement;if(t instanceof HTMLElement)return t;if(e=e.parentElement||w(e),e instanceof R&&(e=e.host),e instanceof Document)return}}function K(e,t){let o=new Map,n=0;for(let a of t||[])o.set(a,n),n+=1;o.set(e,n),n+=1;let r=null;function l(a){if(!a)return;let u=!1,p=null;for(;!u;){if(p=$(a)||null,p===null||!o.has(p))return;(e.popover==="hint"||p.popover==="auto")&&(u=!0),u||(a=p.parentElement)}let C=o.get(p)??null;(r===null||o.get(r)<C)&&(r=p)}return l(e.parentElement||w(e)),r}function oe(e){return e.hidden||e instanceof R||(e instanceof HTMLButtonElement||e instanceof HTMLInputElement||e instanceof HTMLSelectElement||e instanceof HTMLTextAreaElement||e instanceof HTMLOptGroupElement||e instanceof HTMLOptionElement||e instanceof HTMLFieldSetElement)&&e.disabled||e instanceof HTMLInputElement&&e.type==="hidden"||e instanceof HTMLAnchorElement&&e.href===""?!1:typeof e.tabIndex=="number"&&e.tabIndex!==-1}function ne(e){if(e.shadowRoot&&e.shadowRoot.delegatesFocus!==!0)return null;let t=e;t.shadowRoot&&(t=t.shadowRoot);let o=t.querySelector("[autofocus]");if(o)return o;{let l=t.querySelectorAll("slot");for(let a of l){let u=a.assignedElements({flatten:!0});for(let p of u){if(p.hasAttribute("autofocus"))return p;if(o=p.querySelector("[autofocus]"),o)return o}}}let n=e.ownerDocument.createTreeWalker(t,NodeFilter.SHOW_ELEMENT),r=n.currentNode;for(;r;){if(oe(r))return r;r=n.nextNode()}}function re(e){var t;(t=ne(e))==null||t.focus()}var A=new WeakMap;function k(e){if(!m(e,!1))return;let t=e.ownerDocument;if(!e.dispatchEvent(new h("beforetoggle",{cancelable:!0,oldState:"closed",newState:"open"}))||!m(e,!1))return;let o=!1,n=e.popover,r=null,l=K(e,d.get(t)||new Set),a=K(e,f.get(t)||new Set);if(n==="auto"&&(N(f.get(t)||new Set,o,!0),g(l||t,o,!0),r="auto"),n==="hint"&&(a?(g(a,o,!0),r="hint"):(N(f.get(t)||new Set,o,!0),l?(g(l,o,!0),r="auto"):r="hint")),n==="auto"||n==="hint"){if(n!==e.popover||!m(e,!1))return;y(t)||(o=!0),r==="auto"?(d.has(t)||d.set(t,new Set),d.get(t).add(e)):r==="hint"&&(f.has(t)||f.set(t,new Set),f.get(t).add(e))}A.delete(e);let u=t.activeElement;e.classList.add(":popover-open"),E.set(e,"showing"),b.has(t)||b.set(t,new Set),b.get(t).add(e),Y(H.get(e),!0),re(e),o&&u&&e.popover==="auto"&&A.set(e,u),x(e,"closed","open")}function T(e,t=!1,o=!1){var u,p;if(!m(e,!0))return;let n=e.ownerDocument;if(["auto","hint"].includes(e.popover)&&(g(e,t,o),!m(e,!0)))return;let r=d.get(n)||new Set,l=r.has(e)&&M(r)===e;if(Y(H.get(e),!1),H.delete(e),o&&(e.dispatchEvent(new h("beforetoggle",{oldState:"open",newState:"closed"})),l&&M(r)!==e&&g(e,t,o),!m(e,!0)))return;(u=b.get(n))==null||u.delete(e),r.delete(e),(p=f.get(n))==null||p.delete(e),e.classList.remove(":popover-open"),E.set(e,"hidden"),o&&x(e,"open","closed");let a=A.get(e);a&&(A.delete(e),t&&a.focus())}function ie(e,t=!1,o=!1){let n=y(e);for(;n;)T(n,t,o),n=y(e)}function N(e,t=!1,o=!1){let n=_(e);for(;n;)T(n,t,o),n=_(e)}function V(e,t,o,n){let r=!1,l=!1;for(;r||!l;){l=!0;let a=null,u=!1;for(let p of t)if(p===e)u=!0;else if(u){a=p;break}if(!a)return;for(;P(a)==="showing"&&t.size;)T(M(t),o,n);t.has(e)&&M(t)!==e&&(r=!0),r&&(n=!1)}}function g(e,t,o){var r,l;let n=e.ownerDocument||e;if(e instanceof Document)return ie(n,t,o);if((r=f.get(n))!=null&&r.has(e)){V(e,f.get(n),t,o);return}N(f.get(n)||new Set,t,o),(l=d.get(n))!=null&&l.has(e)&&V(e,d.get(n),t,o)}var I=new WeakMap;function F(e){if(!e.isTrusted)return;let t=e.composedPath()[0];if(!t)return;let o=t.ownerDocument||t;if(!y(o))return;let r=ee(t);if(r&&e.type==="pointerdown")I.set(o,r);else if(e.type==="pointerup"){let l=I.get(o)===r;I.delete(o),l&&g(r||o,!1,!0)}}var D=new WeakMap;function Y(e,t=!1){if(!e)return;D.has(e)||D.set(e,e.getAttribute("aria-expanded"));let o=e.popoverTargetElement;if(o instanceof HTMLElement&&o.popover==="auto")e.setAttribute("aria-expanded",String(t));else{let n=D.get(e);n?e.setAttribute("aria-expanded",n):e.removeAttribute("aria-expanded")}}var G=globalThis.ShadowRoot||function(){},se="popover-polyfill";function Q(){return typeof HTMLElement<"u"&&typeof HTMLElement.prototype=="object"&&"popover"in HTMLElement.prototype&&"showPopover"in HTMLElement.prototype}function L(e,t,o){let n=e[t];Object.defineProperty(e,t,{value(r){return n.call(this,o(r))}})}var le=/(^|[^\\]):popover-open\b/g;function ae(){return typeof globalThis.CSSLayerBlockRule=="function"}function pe(e){var n;let t=ae(),o=(e??((n=window.POPOVER_POLYFILL_OPTIONS)==null?void 0:n.layerName)??se).split(".").map(r=>CSS.escape(r)).join(".");return`
${t?`@layer ${o} {`:""}
  :where([popover]) {
    position: fixed;
    z-index: 2147483647;
    inset: 0;
    padding: 0.25em;
    width: fit-content;
    height: fit-content;
    border-width: initial;
    border-color: initial;
    border-image: initial;
    border-style: solid;
    background-color: canvas;
    color: canvastext;
    overflow: auto;
    margin: auto;
  }

  :where([popover]:not(.\\:popover-open)) {
    display: none;
  }

  :where(dialog[popover].\\:popover-open) {
    display: block;
  }

  :where(dialog[popover][open]) {
    display: revert;
  }

  :where([anchor].\\:popover-open) {
    inset: auto;
  }

  :where([anchor]:popover-open) {
    inset: auto;
  }

  @supports not (background-color: canvas) {
    :where([popover]) {
      background-color: white;
      color: black;
    }
  }

  @supports (width: -moz-fit-content) {
    :where([popover]) {
      width: -moz-fit-content;
      height: -moz-fit-content;
    }
  }

  @supports not (inset: 0) {
    :where([popover]) {
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
    }
  }
${t?"}":""}
`}var S=null;function B(e,t){let o=pe(t);if(S===null)try{S=new CSSStyleSheet,S.replaceSync(o)}catch{S=!1}if(S===!1||!e.adoptedStyleSheets){let n=document.createElement("style");n.textContent=o,e instanceof Document?e.head.prepend(n):e.prepend(n)}else e.adoptedStyleSheets=[S,...e.adoptedStyleSheets]}function J(e){if(typeof window>"u")return;let t=e==null?void 0:e.layerName;window.ToggleEvent=window.ToggleEvent||h;function o(i){return i!=null&&i.includes(":popover-open")&&(i=i.replace(le,"$1.\\:popover-open")),i}L(Document.prototype,"querySelector",o),L(Document.prototype,"querySelectorAll",o),L(Element.prototype,"querySelector",o),L(Element.prototype,"querySelectorAll",o),L(Element.prototype,"matches",o),L(Element.prototype,"closest",o),L(DocumentFragment.prototype,"querySelectorAll",o),Object.defineProperties(HTMLElement.prototype,{popover:{enumerable:!0,configurable:!0,get(){if(!this.hasAttribute("popover"))return null;let i=(this.getAttribute("popover")||"").toLowerCase();return i===""||i=="auto"?"auto":i=="hint"?"hint":"manual"},set(i){i===null?this.removeAttribute("popover"):this.setAttribute("popover",i)}},showPopover:{enumerable:!0,configurable:!0,writable:!0,value(i={}){k(this)}},hidePopover:{enumerable:!0,configurable:!0,writable:!0,value(){T(this,!0,!0)}},togglePopover:{enumerable:!0,configurable:!0,writable:!0,value(i={}){return typeof i=="boolean"&&(i={force:i}),E.get(this)==="showing"&&i.force===void 0||i.force===!1?T(this,!0,!0):(i.force===void 0||i.force===!0)&&k(this),E.get(this)==="showing"}}});let n=Element.prototype.attachShadow;n&&Object.defineProperties(Element.prototype,{attachShadow:{enumerable:!0,configurable:!0,writable:!0,value(i){let s=n.call(this,i);return B(s,t),s}}});let r=HTMLElement.prototype.attachInternals;r&&Object.defineProperties(HTMLElement.prototype,{attachInternals:{enumerable:!0,configurable:!0,writable:!0,value(){let i=r.call(this);return i.shadowRoot&&B(i.shadowRoot,t),i}}});let l=new WeakMap;function a(i){Object.defineProperties(i.prototype,{popoverTargetElement:{enumerable:!0,configurable:!0,set(s){if(s===null)this.removeAttribute("popovertarget"),l.delete(this);else if(s instanceof Element)this.setAttribute("popovertarget",""),l.set(this,s);else throw new TypeError("popoverTargetElement must be an element or null")},get(){if(this.localName!=="button"&&this.localName!=="input"||this.localName==="input"&&this.type!=="reset"&&this.type!=="image"&&this.type!=="button"||this.disabled||this.form&&this.type==="submit")return null;let s=l.get(this);if(s&&s.isConnected)return s;if(s&&!s.isConnected)return l.delete(this),null;let c=w(this),v=this.getAttribute("popovertarget");return(c instanceof Document||c instanceof G)&&v&&c.getElementById(v)||null}},popoverTargetAction:{enumerable:!0,configurable:!0,get(){let s=(this.getAttribute("popovertargetaction")||"").toLowerCase();return s==="show"||s==="hide"?s:"toggle"},set(s){this.setAttribute("popovertargetaction",s)}}})}a(HTMLButtonElement),a(HTMLInputElement);let u=i=>{if(i.defaultPrevented)return;let s=i.composedPath(),c=s[0];if(!(c instanceof Element)||c!=null&&c.shadowRoot)return;let v=w(c);if(!(v instanceof G||v instanceof Document))return;let W=s.find(O=>{var j;return(j=O.matches)==null?void 0:j.call(O,"[popovertargetaction],[popovertarget]")});if(W){U(W),i.preventDefault();return}},p=i=>{let s=i.key,c=i.target;if(!i.defaultPrevented&&c&&(s==="Escape"||s==="Esc")){let v=c.ownerDocument||c;g(v,!0,!0)}};(i=>{i.addEventListener("click",u),i.addEventListener("keydown",p),i.addEventListener("pointerdown",F),i.addEventListener("pointerup",F)})(document),B(document,t)}Q()||J();})();

