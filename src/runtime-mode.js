// Online demo build (GitHub Pages): no integration server, data lives only in the browser.
// Set at build time: VITE_STATIC_DEMO=1 vite build
export const STATIC_DEMO = import.meta.env?.VITE_STATIC_DEMO === '1';
