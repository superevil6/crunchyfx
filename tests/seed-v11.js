// Before the app boots (desktop and web suites): the browser store exactly as CrunchySFX v1.1 left it
// (tests/fixtures/v1.1.js, made by v1.1's own save functions), so the suites prove the current build reads it.
(function () {
  localStorage.clear();
  const st = window.SFX_V11.localStorage.store;
  Object.keys(st).forEach(function (k) { localStorage.setItem(k, st[k]); });
})();
