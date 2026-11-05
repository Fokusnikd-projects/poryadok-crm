// Online demo build (GitHub Pages): no integration server, data lives only in the browser.
// Set at build time: VITE_STATIC_DEMO=1 vite build
export const STATIC_DEMO = import.meta.env?.VITE_STATIC_DEMO === '1';
export const LOCAL_RUN_GUIDE = 'https://github.com/Fokusnikd-projects/poryadok-crm#как-протестировать-у-себя-рекомендуемый-способ';
