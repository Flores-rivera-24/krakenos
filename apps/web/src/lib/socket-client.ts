// Punto de entrada ÚNICO a `socket.io-client`. `lib/socket.ts` lo importa con
// `import()` para que la librería (≈11 kB gzip) viaje en su propio chunk y no en
// la carga inicial: quien está en el login o en la portada no abre ningún socket.
export { io } from 'socket.io-client';
