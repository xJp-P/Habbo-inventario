// public/js/datos/changelogs.js — novedades por version.
//
// Mismo sistema que Proyecto_Cartera (public/js/datos/changelogs.js): texto inerte, ni
// una linea de logica. Lo consume la ventana de novedades post-actualizacion: `App`
// compara la version que corre contra `localStorage.lastSeenVersion` y, si difieren y hay
// entrada para esa version, la muestra una sola vez.
//
// Reglas de redaccion (las comprueba npm run verificar):
//   - Idioma sencillo y amable, pensando en quien usa la app: que puede hacer ahora y
//     para que le sirve. Nada tecnico (bases de datos, migraciones, formatos, servidores).
//   - Cada version que se publique despues de la 1.2.0 necesita su entrada.
//   - Si varias versiones llegan juntas en una sola actualizacion, sus novedades van en la
//     entrada de la ultima, separadas por una linea que empieza con «—».

export const CHANGELOGS = {
  // La 1.2.0 salio antes de que existiera esta ventana: sus novedades se anuncian aqui,
  // junto con las de la 1.3.0, para que una sola actualizacion las cuente todas.
  '1.3.0': [
    'Tu Sniper ahora te dice cuánto te costó cada furni. Al registrar en Auditoría un furni que te sobra o que no tenías anotado, el precio de compra ya viene puesto: solo revisas y confirmas.',
    'Si el Sniper conoce el precio de solo algunas unidades, la app te propone únicamente esas. Las demás las anotas aparte con su propio precio, así tus cuentas no se descuadran.',
    'Cuando ese precio es un promedio de compras hechas a precios distintos, lo verás marcado con un aviso, para que sepas que no es el precio exacto de cada unidad.',
    'Esta ventana es nueva: cada vez que la app se actualice, aquí te contaremos lo que cambió.',
    '— También llegó con la versión 1.2.0 —',
    'Kekos manuales: registra en Ajustes tus cuentas sin Sniper, como una bodega o un keko de tradeos. Sus furnis nunca aparecen en las auditorías de tus snipers.',
    'Al anotar una compra eliges en qué keko está. La app recuerda el último que usaste y, si hace falta, puedes crear un keko nuevo ahí mismo.',
    'Al anotar una venta eliges de qué keko salen los furnis, y solo ves lo que ese keko tiene. Así una venta desde tu bodega nunca descuenta furnis de un keko con Sniper.',
    'Ordena lo que tenías sin keko: desde Ajustes, una lista por furni con casillas te deja enviar cada grupo al keko que le corresponde, en las tandas que quieras.',
    'Conectar un Sniper nuevo es más fácil: Ajustes te muestra los datos que te pide, cada uno con su botón de copiar, y la lista de tus snipers dice en qué keko trabaja cada uno.',
  ],
};
