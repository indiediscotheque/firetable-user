/**
 * seasons.js — Seasonal defaults: room avatar themes, string lights, snow.
 *
 * config.js can override each one (avatarset, avatarSeasons, lightsMonths,
 * snowMonths). firetable-hostbot reads this file and config.js from the live
 * site (its SITE_URL setting), so the bot's trading-card avatars and !lights
 * replies follow whatever is set here. Keep it plain data: no DOM, no other
 * globals, so it also runs outside a browser.
 */

/**
 * Seasonal room avatar themes, checked against the visitor's local date.
 * months are 1-12. Used only when ftconfigs.avatarset is empty.
 * Override with ftconfigs.avatarSeasons, or set it to false to turn off.
 */
var AVATAR_SEASONS = [
  { months: [10], style: "set2" } // October: spooky monsters
];
/**
 * Months (1-12) when the stage string lights turn on by themselves, checked
 * against the visitor's local date. The manual "lights" switch in Firebase
 * turns them on any time of year.
 * Override with ftconfigs.lightsMonths, or set it to false to turn off.
 */
var LIGHTS_MONTHS = [12]; // December
/**
 * Months (1-12) with subtle snowfall on the stage (visitor's local date).
 * Override with ftconfigs.snowMonths, or set it to false to turn off.
 */
var SNOW_MONTHS = [1, 2]; // January and February
