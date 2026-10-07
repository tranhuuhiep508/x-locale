export function cliInitCommand(): string {
  // The UI serves API requests at /api on this origin, including through Vite's proxy.
  return `loc init -u ${window.location.origin} -k <API_KEY>`
}
