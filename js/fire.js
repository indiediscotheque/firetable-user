// The room's fire, behind the DJ playing: js/flame.js draws it in #fyre (a
// plain canvas, no libraries), js/room.js places and sizes the box for the DJ
// (positionFyreAtActiveDJ, which sets its data-fire-scale), and chat.js lights
// it with each 🔥. The live stage for other sites draws the
// same fire with the same engine.
(function () {
	"use strict";
	var flame = null;

	/** The fire, made the first time it's lit (nothing runs before someone sends a 🔥). */
	function fyre() {
		if (flame) return flame;
		var el = document.getElementById('fyre');
		if (!el || typeof window.ftFlame !== 'function') return null;
		flame = window.ftFlame(el);
		flame.setScale(Number(el.getAttribute('data-fire-scale')) || 1);
		if (typeof firetable !== 'undefined') firetable.fyreStage = flame;
		return flame;
	}

	window.firetableIgniteFyre = function (count) {
		var f = fyre();
		if (f) f.ignite(count);
	};
	window.firetableSetFyreIntensity = function (count) {
		if (flame) return flame.setIntensity(count);
		if (count > 0) { var f = fyre(); if (f) f.setIntensity(count); }
	};
})();
