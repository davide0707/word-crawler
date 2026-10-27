/*
 * Word Crawler (estensione): piccolo controllo su ogni pagina. Se la pagina è tra le letture salvate,
 * chiede al servizio dell'estensione di rimettere i segni (senza animazione). Non legge la pagina e
 * non manda niente fuori dal browser: passa solo l'indirizzo al servizio dell'estensione.
 */
(function () {
  'use strict';
  if (window.top !== window || window.__wcRestoreAsked) return;
  window.__wcRestoreAsked = true;
  try { chrome.runtime.sendMessage({ type: 'wc:check', url: location.href }).catch(function () {}); } catch (e) { /* estensione aggiornata o disattivata */ }
})();
