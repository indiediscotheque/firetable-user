// iPhone/iPad: keep maximum-scale=1 so tapping a small text field doesn't
// auto-zoom the page (iOS still allows pinch-zoom). Other devices get normal
// pinch-zoom. Loaded in <head> (not inline) so the page can use a strict CSP.
if (/iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
	document.querySelector('meta[name="viewport"]').setAttribute("content", "width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover");
}
