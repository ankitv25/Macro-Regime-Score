// Tiny helper for the ?id= drilldown pattern used by pillar.html and
// indicator.html - real page loads, no client-side routing library.

export function queryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}
