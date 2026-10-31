/**
 * install.js — "Get the app": how to install the site on a phone.
 *
 * The guide (#installAppBox in index.html) opens from Settings ("Get the
 * app"), the login screen ("Get the app on your phone"), the push setting's
 * hint and the @ inbox. It opens the steps for the visitor's own device
 * (iPhone/iPad, Android or computer) and keeps the others one tap away.
 * Where the browser can install it directly (Chrome, Edge, Samsung Internet
 * on Android and computers), an "Install the app" button does it in one tap.
 * Inside the installed app, it says so instead.
 *
 * Depends on: state.js (firetable), jQuery
 */

firetable.install = {
  prompt: null, // the browser's install prompt, when it offers one

  isApp: function () {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  },
  isIOS: function () {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  },
  isPhone: function () {
    return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  },
  platform: function () {
    var i = firetable.install;
    if (i.isIOS()) return "ios";
    if (/Android/.test(navigator.userAgent)) return "android";
    return "desktop";
  },

  open: function () {
    var i = firetable.install;
    var dlg = document.getElementById("installAppBox");
    if (!dlg) return;
    var mine = i.platform();
    $(dlg).find(".installSteps").each(function () {
      this.open = !i.isApp() && this.getAttribute("data-platform") === mine;
    });
    // this device's steps first
    $(dlg).find('.installSteps[data-platform="' + mine + '"]').insertAfter("#installNow");
    i.render();
    if (!dlg.open) dlg.showModal();
  },

  render: function () {
    var i = firetable.install;
    var app = i.isApp();
    $("#installIntro").prop("hidden", app);
    $("#installDone").prop("hidden", !app);
    $("#installNow").prop("hidden", app || !i.prompt);
    $("#getAppCard").prop("hidden", app);
    // the login screen suggests it on phones (or wherever the browser can install it)
    $("#welcomeGetApp").prop("hidden", app || !(i.isPhone() || i.prompt));
  },

  init: function () {
    var i = firetable.install;
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault(); // show our own button instead of the browser's mini bar
      i.prompt = e;
      i.render();
    });
    window.addEventListener("appinstalled", function () {
      i.prompt = null;
      i.render();
    });
    if (window.matchMedia) {
      var mq = window.matchMedia("(display-mode: standalone)");
      if (mq.addEventListener) mq.addEventListener("change", i.render);
    }
    $(document).on("click", ".showInstallGuide", function (e) {
      e.preventDefault();
      i.open();
    });
    $("#installNow").on("click", function () {
      var p = i.prompt;
      if (!p) return;
      i.prompt = null;
      p.prompt();
      p.userChoice.then(function (choice) {
        if (choice && choice.outcome === "accepted") document.getElementById("installAppBox").close();
      }).catch(function () {}).then(i.render);
    });
    i.render();
  }
};
