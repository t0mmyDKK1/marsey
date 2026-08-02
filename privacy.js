/* Sletteknap til privatlivssiden. Holdt adskilt fra script.js, så forsidens
   logik ikke indlæses på en statisk tekstside. */
(function () {
  var KEYS = [
    "rdr2thon-calm",
    "rdr2thon-spoilerfree",
    "rdr2thon-embed-consent",
    "rdr2thon-journal-drafts",
    "rdr2thon-journal-vote",
    "rdr2thon-last-visit",
    "rdr2thon-seen-entries",
  ];

  var button = document.querySelector("#clear-data");
  var status = document.querySelector("#clear-status");
  if (!button || !status) return;

  button.addEventListener("click", function () {
    var removed = 0;
    try {
      KEYS.forEach(function (key) {
        if (localStorage.getItem(key) !== null) removed++;
        localStorage.removeItem(key);
      });
    } catch (error) {
      status.textContent =
        "Din browser blokerer for lokal lagring, så der er intet gemt at slette.";
      return;
    }
    status.textContent = removed
      ? "Slettet. " +
        removed +
        " gemte indstillinger er fjernet fra denne enhed."
      : "Der var ikke gemt noget på denne enhed.";
  });
})();
