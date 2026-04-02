// Central config — all values read from Vite env vars (frontend/.env).
// Add frontend/.env to .gitignore; it is written by install.ps1 during setup.

export const API_KEY  = import.meta.env.VITE_API_KEY  || ''
export const API_URL  = import.meta.env.VITE_API_URL  || 'http://localhost:3000'
export const WS_URL   = import.meta.env.VITE_WS_URL   || 'ws://localhost:3001'
