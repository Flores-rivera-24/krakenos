// El subpath `hls.js/light` (build ligera: sin subtítulos/DRM/audio alternativo,
// US-185) no trae sus propios tipos. Su API es un subconjunto en runtime de la
// build completa, con la MISMA superficie de tipos, así que los reexportamos.
declare module 'hls.js/light' {
  export * from 'hls.js';
  export { default } from 'hls.js';
}
