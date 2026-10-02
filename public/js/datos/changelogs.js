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
  '1.7.0': [
    'Tu Sniper ahora anota tus ventas solo: cuando alguien compra uno de tus furnis en el mercadillo, la venta aparece en Vendido del keko correcto, con lo que te entró y la ganancia. Ya no tienes que marcarla a mano.',
    'En Vendido, lo que anotó el Sniper lleva la etiqueta «Vendido · Sniper» y la hora exacta de la venta.',
    'Si el Sniper no sabe a qué lote pertenece una venta (por ejemplo, un furni que aún no tienes anotado), no se pierde: queda en la nueva pestaña «Por asignar» del Inventario, con un número azul en el menú. Desde ahí la asignas al lote correcto o la descartas.',
    'Si vas a marcar a mano una venta en un keko donde el Sniper ya las anota, la app te pregunta primero, para que no se cuente dos veces.',
    'Te avisamos de cada venta: dentro de la app y, si está minimizada, con una notificación que abre directo ese keko. Si vendes varias seguidas, llegan juntas en un solo aviso. Puedes apagarlo en Ajustes → Notificaciones.',
    'Arreglado: cuando el Sniper retira una oferta, ya no puede devolver a tu inventario un lote de otro keko.',
  ],
  '1.6.1': [
    'Si algo falla al abrir la app, ya no se queda cargando para siempre: te muestra qué pasó en una ventana fija, con un botón para copiar los detalles (o sacarles una foto con calma) y otro para reintentar.',
    'Arriba a la derecha aparece un botón rojo cuando hubo errores: ábrelo cuando quieras para verlos y copiarlos, y así enviarlos para que se revisen.',
    'Si una sección no se puede mostrar, solo esa sección lo avisa: el menú y el resto de la app siguen funcionando.',
    'Cada sección carga lo suyo: si falla una parte de tus datos, solo las secciones que la usan lo avisan y las demás siguen funcionando. Ajustes se abre siempre.',
    'Si un lote o un keko trae un dato raro, solo esa fila o esa tarjeta lo avisa; el resto de tu Inventario y tu Mercadillo se ve normal.',
    'Si tus datos tardan demasiado en llegar, la app te lo dice a los pocos segundos en vez de esperar sin fin.',
    'Los errores también quedan anotados en un archivo dentro de la carpeta de la app, para poder revisarlos aunque nadie haya alcanzado a sacar una foto.',
  ],
  '1.6.0': [
    'Tu Inventario y tu Mercadillo ahora se ordenan por keko: cada keko tiene su propia tarjeta con su cara de Habbo, cuántos lotes y unidades tiene y lo que costaron. Ya no hace falta abrir un lote para saber dónde está.',
    'Primero van tus kekos manuales, del más antiguo al más nuevo; después los de tus Snipers, y al final lo que aún no tiene keko. Todas las tarjetas se ven abiertas: bajas y lo ves todo.',
    'Al bajar, el nombre del keko y los títulos de las columnas se quedan arriba, así nunca pierdes de vista en qué keko estás. Con «Ir a» saltas directo a cualquier keko.',
    'Cada tarjeta tiene su botón «+ Compra», que abre la compra con ese keko ya elegido.',
    '«Publicar», «Vendido» y «Retirar» ahora solo mueven las unidades del keko donde los pulsas. Antes podían tomar unidades de otro keko.',
    'Arreglado: al publicar, vender o separar un LTD de solo una parte de un lote, esa parte ya no pierde su keko. Lo publicado y lo vendido que lo había perdido lo recupera solo.',
  ],
  '1.5.2': [
    'Auditoría más honesta: ya no te sugiere que unos furnis «volvieron» de otro keko sin pruebas. Solo lo propone cuando la foto de ese otro keko confirma que allí faltan; para todo lo demás, incluidos tus kekos manuales, eliges tú de dónde vinieron.',
  ],
  '1.5.1': [
    'Auditoría más ordenada: «Quitar de la auditoría» ya no ocupa una fila propia. Si el furni tiene un solo precio, va al lado de «Registrar entrada»; si tiene varios, sube junto al nombre del furni, porque quita el furni entero.',
    'La tasa del Lingo ahora se muestra fija en 50 créditos, como en Habbo.es: ya no hace falta tocarla. Si alguna vez guardaste otra, el Resumen te avisa y la deja en 50 con un clic.',
  ],
  '1.5.0': [
    'Al eliminar un token revocado ahora decides qué pasa con lo que envió su Sniper: conservarlo todo, o hacer una limpieza profunda que borra también los lotes, las ventas y el inventario de su keko.',
    'Antes de borrar ves exactamente cuánto se va, y tienes que confirmarlo. Si ese keko todavía tiene un token activo, la limpieza se bloquea y te dice por qué, para no tocar el inventario que tu Sniper está manejando.',
  ],
  '1.4.0': [
    'Precio exacto de cada compra: si compraste el mismo furni a precios distintos, Auditoría te muestra una línea por cada precio, cada una con su botón para registrarla. Ya no hace falta conformarse con un promedio.',
    'Las unidades que ya tenías anotadas se descuentan de la línea con su mismo precio, así solo ves lo que de verdad falta registrar.',
    'El botón «Comparar de nuevo» ahora gira mientras trabaja y al terminar te cuenta cómo quedó tu inventario.',
    'Limpia tus tokens: en Ajustes, los tokens revocados tienen una papelera para eliminarlos para siempre. Lo que envió ese Sniper se conserva.',
    'El catálogo de furnis de Habbo.es se pone al día solo cada vez que abres la app. Ya no tienes que ir a Ajustes a pulsar el botón.',
    'Auditoría al instante: cuando tu Sniper envía el inventario de su keko, la Auditoría y el número del menú se actualizan solos, sin pulsar nada.',
    'Avisos en Windows: si la app está minimizada y aparece una diferencia nueva en tu inventario, o llegan furnis nuevos al catálogo, te lo dice una notificación. Haz clic en ella y la app se abre justo en la Auditoría de ese keko. Si ya estás mirando la app, no te interrumpe.',
    'En Mac, el aviso llega al Dock: el ícono rebota y muestra un número con los avisos sin ver, que desaparece al volver a la app.',
    'Tú decides qué avisos quieres: en Ajustes → Notificaciones enciendes o apagas cada uno, y con «Enviar una de prueba» ves cómo se verán.',
  ],
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
