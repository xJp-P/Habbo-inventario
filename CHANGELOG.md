# Registro de cambios

Todos los cambios importantes de Habbo Inventario se anotan aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones siguen
[Versionado Semántico](https://semver.org/lang/es/).

Cada versión indica en **Migraciones de Supabase** si hace falta ejecutar un archivo
nuevo de `supabase/migrations/`. Las apps instaladas se actualizan solas, así que esa
migración debe ejecutarse **antes** de publicar el Release en GitHub.

## [Sin publicar]

## [1.6.1] - 2026-09-30

### Añadido

- **Errores visibles y fáciles de enviar**. Todo error queda registrado durante la sesión
  con su detalle y se ve en una ventana fija («Errores de esta sesión»): el último error
  destacado y un informe completo (versión, equipo, estado de las migraciones y cada error
  con la petición, el código y dónde falló) en un recuadro seleccionable, con «Copiar
  detalles». Se abre desde un botón rojo en la cabecera (aparece cuando hay errores) o con
  «Ver detalles» en el aviso de error, que ahora dura más. En la app de escritorio copia al
  portapapeles del sistema.
- Los errores inesperados del servidor local traen **dónde** fallaron (archivo y línea), sin
  la carpeta de instalación, que lleva el nombre del usuario del equipo.
- **Registro de errores en un archivo**: `registro-errores.log`, en la carpeta de datos de
  la app. Anota una línea al arrancar (versión y sistema), los errores del servidor local
  que no son del usuario (inesperados, sin conexión, Supabase sin respuesta, base sin
  esquema) y los que ve la interfaz (secciones, bloques o filas que no se pudieron dibujar,
  peticiones sin respuesta). Tacha tokens y claves, recorta las rutas y, al pasar de ~1 MB,
  guarda el anterior como `registro-errores.anterior.log`. La ventana de errores lo indica
  y, en la app de escritorio, tiene «Abrir la carpeta».

### Corregido

- **Adiós al spinner infinito al abrir la app**. Si la carga inicial fallaba, la app se
  quedaba cargando para siempre y solo mostraba un aviso de 4 segundos (o nada, si la
  petición no respondía). Ahora abre la ventana «No se pudieron cargar tus datos» con el
  detalle, «Copiar detalles» y «Reintentar», y la sección muestra lo mismo si la cierras.
  Cada petición de la carga tiene un tiempo máximo de 30 s: si no responde, es un error
  visible. Si falla una recarga posterior, se conservan los datos que había.
- **Una sección que falla ya no tumba la app**. Si algo falla al dibujar una sección (por
  ejemplo, un lote con un dato raro), solo esa sección lo dice, con su mensaje, «Ver y
  copiar detalles» y «Reintentar»; el menú y las demás secciones siguen funcionando.
- La Auditoría ya no se queda girando si su primera carga falla: muestra el motivo y
  «Reintentar».
- **El servidor local ya no espera a Supabase sin fin**. Cada petición a Supabase espera
  como mucho 25 s (menos que la ventana, que espera 30): pasado ese tiempo se corta y el
  error lo dice claro («Supabase no respondió en 25 s. Revisa tu internet o si tu proyecto
  está pausado o muy lento»), sin reintentos que multipliquen la espera. Un fallo de red
  también se explica en claro («No se pudo conectar con Supabase»).
- **Cada sección carga lo suyo**. El resumen, los furnis, los lotes y lo «por revisar»
  llegan por separado, y cada sección espera solo lo que usa: si falla una parte, solo las
  secciones que la necesitan lo dicen («No se pudo cargar: tus lotes»), con el detalle y
  «Reintentar»; las demás funcionan. Cada parte se muestra en cuanto llega.
- **Ajustes siempre disponible**, aunque no llegue ningún dato: desde ahí se puede revisar
  la conexión, la cuenta o la versión.
- **Un lote o un keko con un dato raro ya no tapan el resto**. En el Inventario y el
  Mercadillo, cada tarjeta de keko y cada fila tienen su propia barrera: si una falla, solo
  ella dice «no se pudo mostrar» (con «Detalles» y «Reintentar») y lo demás se ve normal.
- Los errores internos al dibujar se explican en lenguaje claro (por ejemplo «un dato con
  formato inesperado»), con su código original en el detalle.

## [1.6.0] - 2026-09-29

### Añadido

- **Inventario y Mercadillo por keko**. Las dos vistas se dividen en una tarjeta por keko:
  primero los kekos manuales (del más antiguo al más nuevo), luego los de los Snipers
  (también por antigüedad) y al final lo que no tiene keko. Ninguna tarjeta se pliega ni
  se recorta: todo se ve haciendo scroll. La cabecera de cada keko lleva su cabeza de
  Habbo.es (o su inicial), si es manual o de qué Sniper, desde cuándo existe y el resumen
  de la pestaña (lotes, unidades y costo; o la ganancia esperada o realizada), con las
  compras «por revisar» en ámbar. Al bajar, la cabecera y la fila de títulos se quedan
  arriba hasta que llega el siguiente keko; con sitio para todas las columnas, las de
  todos los bloques quedan alineadas. Arriba, «Ir a» salta a cualquier keko y marca el que
  estás viendo. Los kekos sin nada en esa pestaña se nombran en una línea al final.
- **«+ Compra» en cada keko** (pestaña Comprado): abre la compra con ese keko ya elegido.

### Cambiado

- En la pestaña Publicado del Inventario la etiqueta dice solo «Publicado»: el precio de
  lista ya está en «Venta c/u». El detalle de un lote ya no repite su keko.
- En el Mercadillo, cada fila resume un furni **en ese keko**, y el detalle muestra la
  comisión pagada y la ganancia realizada en ese keko.

### Corregido

- **Las partes de un lote ya no pierden su keko**. Desde la 1.1.0, al publicar, vender o
  retirar **una parte** de un lote, o al separar una unidad LTD, la fila nueva nacía sin
  keko (lo publicado o vendido de una parte aparecía como «sin keko» y la unidad LTD
  separada contaba como «sin keko» en la Auditoría). Ahora conservan el keko de su lote, y
  al volver a Comprado solo se juntan con su lote de origen si sigue en el mismo keko. La
  migración devuelve su keko a lo publicado y vendido que lo había perdido; lo que está en
  mano sin keko se sigue asignando en la Auditoría, como hasta ahora.
- **«Publicar», «Vendido» y «Retirar» de un furni solo tocan un keko**. Antes tomaban
  unidades de cualquier keko (las más antiguas primero), aunque estuvieran en otra cuenta
  de Habbo. Ahora actúan sobre el keko desde donde se pulsan (ver *Inventario y Mercadillo
  por keko*).

### Migraciones de Supabase

- `20261014000000_inventario_por_keko.sql` (requiere la `20261013000000`). Sin ella, la
  app muestra igual los bloques por keko; publicar, vender o retirar desde un keko
  funciona si ese furni no tiene lotes en otro keko, y si los tiene pide instalarla (sin
  ella la base tomaría unidades de otro keko).

## [1.5.2] - 2026-09-29

### Corregido

- **Auditoría: «Vinieron de otro keko» ya no se inventa un origen**. Con un sobrante, la
  bandeja ofrecía «Volvieron de <keko> (N allá)» por **cada** otro keko que tuviera
  unidades de ese furni en la app, incluidos los kekos manuales. Era una conjetura escrita
  como un hecho (p. ej. «Volvieron de xJp (10 allá)» en un sobrante de -JDark, con xJp
  como keko manual) y pulsarla por error descuadraba el stock de ese keko. Ahora solo se
  sugiere con **evidencia**: el otro keko tiene Sniper y su propia foto dice que allí
  faltan unidades de ese furni («Vinieron de KekoB (allá faltan 2)»). Para lo demás hay un
  botón neutro, «Vinieron de otro keko…», que abre un formulario donde eliges el keko de
  origen (los manuales, marcados como tales) y la cantidad.

### Migraciones de Supabase

- `20261013000000_origen_con_evidencia.sql` (requiere la `20261012000000`). Sin ella,
  ningún keko llega con evidencia: todos los orígenes se eligen en el formulario.

## [1.5.1] - 2026-09-29

### Cambiado

- **Auditoría: «Quitar de la auditoría» donde se entiende**. Afecta a todo el furni, así
  que su lugar depende de cuántas líneas de costo tenga: sin costos del Sniper, en la misma
  fila que «+ Registrar entrada», a la derecha; con un solo tramo, en la misma línea del
  tramo, junto a su «+»; con varios tramos, en la cabecera del furni, junto al «+N» (al pie
  de la última línea parecía que quitaba solo ese tramo). Ya no ocupa una fila propia. Es
  un botón secundario (gris) con el ícono «−».
- **Resumen: la tasa del Lingo es un dato fijo** («50 cr» con un candado): en Habbo.es un
  Lingo vale 50 cr, así que ya no se edita. La lógica sigue intacta (estado, guardado y la
  ruta de la tasa, para darle otro uso más adelante) y los cálculos usan la tasa guardada;
  si alguna vez guardaste otra, la tarjeta lo avisa y ofrece «Usar 50 cr». La etiqueta de
  la cabecera ya no dice que se cambia en el Resumen.

### Corregido

- **Workflow de GitHub (Instaladores)**: al publicar el borrador, GitHub crea la etiqueta
  `v<versión>` y esa etiqueta volvía a disparar el workflow: compilaba Windows y Mac otra
  vez y el trabajo `publicar` fallaba con «La version vX ya esta publicada». Pasaba en cada
  versión desde la 1.0.0. Ahora un primer trabajo, `revisar`, pregunta a GitHub si esa
  versión ya está publicada: si la ejecución la disparó la etiqueta, termina en verde sin
  compilar nada; si se pidió a mano (Run workflow) una versión ya publicada, falla ahí
  mismo, antes de gastar minutos en compilar. Una etiqueta que no coincide con el
  `package.json` también se rechaza al inicio. Los borradores anteriores se buscan en todas
  las páginas de Releases (antes, solo en las 30 primeras).

## [1.5.0] - 2026-09-29

### Agregado

- **Eliminar tokens con limpieza profunda**: al eliminar un token revocado (o todos), el
  modal deja elegir entre el **borrado simple** (solo el token; se conserva lo que envió su
  Sniper, como hasta ahora) y la **limpieza profunda**: el token y todos los datos de su
  keko (lotes en mano, publicados y vendidos, la foto del inventario, las exclusiones de la
  auditoría, su registro como keko manual) más el historial de eventos de ese token. Antes
  de confirmar, el modal muestra cuánto se borra y pide marcar «Entiendo». Un keko es una
  cuenta de Habbo: su nombre no distingue mayúsculas.
- **Regla de seguridad**: la limpieza profunda se bloquea, y el modal explica por qué, si el
  keko tiene algún token **activo** (su Sniper sigue gestionando ese inventario). La base lo
  vuelve a comprobar en la misma transacción que borra, con los tokens bloqueados: si algo
  cambió con el modal abierto, se niega sin borrar nada.

### Migraciones de Supabase

- `20261012000000_limpieza_tokens.sql` (requiere la `20261011000000`). Sin ella, el borrado
  simple funciona igual y la limpieza profunda pide instalarla.

## [1.4.0] - 2026-09-29

### Agregado

- **Costos por tramo en la Auditoría**: el Sniper manda un elemento por cada precio de
  compra del mismo furni (uno por lote de su cartera) y la bandeja muestra una línea por
  tramo («2 unidades a 1.500 cr c/u»), cada una con su propia entrada a su costo exacto, más
  una línea para lo que sobra sin costo conocido. Cada lote que la app ya tiene en ese keko
  se descuenta del tramo con su mismo costo, y lo que explican las unidades sin keko
  («Son de este keko») no se propone.
- **Eliminar tokens revocados**: en Ajustes, cada token revocado tiene una papelera para
  borrarlo de la base de datos, y con dos o más, «Eliminar los N revocados». Un token activo
  no se puede eliminar (primero se revoca). Lo que envió ese sniper se conserva.
- **Auditoría en vivo**: la foto del inventario que envía cada sniper llega al instante
  (Supabase Realtime, migración `20261011000000`). El número del menú y la vista de
  Auditoría se ponen al día solos, y si aparecen diferencias **nuevas** (un furni que
  cuadraba y ya no, o una diferencia que creció), un aviso lo dice. La misma foto repetida
  (el Sniper la reenvía tras cada tanda), resolver diferencias o lo que ya había al abrir la
  app no avisan.
- **Notificaciones del sistema (Windows)**: si la app está minimizada o en segundo plano,
  las diferencias nuevas de la Auditoría y un catálogo de Habbo.es con furnis nuevos llegan
  como notificación de Windows, con el nombre y el ícono de la app. Al hacer clic, la
  ventana vuelve al frente y abre la Auditoría de ese keko. Si estás mirando la app, no
  sale ninguna. Dos avisos del mismo keko en menos de 2 minutos: el segundo reemplaza al
  primero, sin sonido. El proceso usa el mismo AUMID que el acceso directo del instalador
  (el `appId`).
- **Avisos en el Dock (Mac)**: sin firma de código, macOS no muestra notificaciones de la
  app, así que el aviso es el Dock: el ícono rebota una vez y muestra un globo con los
  avisos sin ver (los de un mismo keko cuentan una vez). Al volver a la app, o al hacer clic
  en el ícono del Dock, el globo desaparece y la ventana vuelve al frente (también si estaba
  minimizada).
- **Ajustes → Notificaciones**: interruptores para las diferencias de la Auditoría y los
  furnis nuevos del catálogo (encendidos por defecto; se guardan en este equipo), el estado
  de la auditoría en vivo (o el aviso de que falta la migración `20261011000000`) y
  «Enviar una de prueba», que sale aunque estés mirando la app, para comprobar que Windows
  muestra el nombre y el ícono de Habbo Inventario.

### Cambiado

- **«Comparar de nuevo»** en la Auditoría gira mientras trabaja, vuelve a pedir la
  comparación a la base y recarga los datos de la app (nombres, lotes y el número del menú);
  al terminar, un aviso dice cómo quedó. También aparece cuando aún no llegó ningún
  inventario.
- **Catálogo de Habbo.es automático**: cada vez que se abre la app (y cada 6 h mientras
  siga abierta) busca en segundo plano si Habbo.es publicó un catálogo nuevo, leyendo solo
  su versión; lo descarga únicamente si cambió. Si eso cambia nombres o íconos de tus
  furnis, la app recarga sus datos sin avisar. Antes solo se refrescaba si tenía más de
  24 h o con el botón de Ajustes.
- Modo demo: el inventario simulado manda un elemento por cada precio de compra, como el
  Sniper: el primer furni trae un sobrante con un lote fundido (`costo_medio`), otro tramo
  y una unidad sin costo, y los números LTD de cada furni van en su primer elemento.

### Migraciones de Supabase

- `20261010000000_costos_por_tramo.sql` (requiere la `20261009000000`). Ejecútala **antes**
  de publicar esta versión. Sin ella, los elementos por costo entran igual y la bandeja
  propone su promedio como en la 1.3.0.
- `20261011000000_inventario_en_vivo.sql` (requiere la `20261010000000`). Publica
  `inventario_habbo` en Realtime. Sin ella, la Auditoría no se pone al día sola ni avisa
  (se ve al abrirla o con «Comparar de nuevo»).

## [1.3.0] - 2026-09-29

### Agregado

- **Costos del Sniper en la Auditoría**: el Sniper envía lo que costó cada furni según su
  cartera (FIFO) y la bandeja lo usa al registrar la entrada de un sobrante o de un furni
  no registrado: cantidad y costo ya propuestos. El costo solo se propone para las
  unidades que el Sniper conoce (si sobran 3 y conoce 2, propone 2; las demás van aparte)
  y, si es un promedio de lotes a precios distintos, lo avisa: «El precio es un promedio
  calculado (FIFO)».
- **Ventana de novedades**: la primera vez que abres la app después de una actualización,
  una ventana cuenta lo nuevo de esa versión, en palabras sencillas. Sale una sola vez por
  versión. Esta primera trae también lo de la 1.2.0, que se publicó antes de que existiera.

### Cambiado

- Modo demo: el inventario simulado solo incluye lo del keko del Sniper y lo sin keko (lo
  de los kekos manuales está en otra cuenta), trae costos y siempre muestra un furni sin
  registrar.

### Migraciones de Supabase

- `20261009000000_costos_auditoria.sql` (requiere la `20261008000000`). Ejecútala **antes**
  de publicar esta versión. Sin ella, el inventario del Sniper con costos entra igual (la
  base los ignora) y la bandeja no propone costo.

## [1.2.0] - 2026-09-29

### Agregado

- **Kekos manuales**: registra en **Ajustes → Kekos** las cuentas de Habbo sin Sniper (una
  bodega, un keko de tradeos). Nunca se auditan, así que sus furnis no aparecen en las
  auditorías de tus snipers. Se pueden renombrar (sus lotes cambian con ellos) y borrar
  cuando ya no les quedan unidades.
- **«+ Compra» pide el keko** (obligatorio): los de tus snipers y los manuales, con
  «Nuevo keko manual…» para crearlo ahí mismo. Queda elegido el último que usaste.
- **«Venta» pide de qué keko salen** las unidades y solo ofrece lo de ese keko, para no
  descontar unidades de un keko con Sniper. Desde «Vender» en un lote, el keko es el suyo.
- **Asignar unidades sin keko**: lo que estaba en mano sin keko (compras manuales, Excel o
  del Sniper antes de su primer inventario) se ordena por furni, con casillas y cantidad,
  enviando cada tanda al keko que corresponda.

### Cambiado

- **Ajustes → Conexión con SniperMercadillo** muestra los tres datos que pide el Sniper,
  con los mismos nombres que su ⚙️ Ajustes: **URL del proyecto** y **clave pública**, cada
  una con su botón de copiar, y el token de cada VPS. Antes mostraba la dirección completa
  del endpoint, y pegarla en «URL del proyecto» hacía que todo envío del bot respondiera
  404. La dirección completa sigue en «Ejemplo de envío».
- La tabla de tokens muestra el **keko** que aprendió cada sniper.
- El keko que se escribe en «¿En qué keko están?» de la Auditoría queda registrado como
  keko manual.

### Migraciones de Supabase

- `20261008000000_kekos_manuales.sql` (requiere la `20261007000000`). Ejecútala **antes**
  de publicar esta versión. Sin ella, la app sigue funcionando como la 1.1.0: «+ Compra»
  y «Venta» no piden keko y Ajustes avisa que falta.

## [1.1.0] - 2026-09-28

### Agregado

- **Auditoría del inventario de Habbo**: cada sniper envía el inventario completo de su
  keko al iniciar sesión (`auditar_inventario`) y la app lo compara en vivo con lo que
  tiene en mano, mostrando solo las diferencias:
  - **Sobrantes**: «Son de este keko» (lotes sin keko asignado, sin pedir costo),
    «Volvieron de otro keko», entrada con costo o «Quitar de la auditoría».
  - **Faltantes**: «Las vendí…» (sale de los lotes de ese keko), «Están en otro keko»
    o borrar.
  - **LTD con otro número de serie**: corregir el número con un clic.
  - **Furnis sin registrar** (decoración, regalos, un tradeo olvidado): lista plegada
    para agregarlos con costo o quitarlos de la auditoría. Una exclusión vale mientras
    su cantidad no cambie.
  - **Unidades sin keko** que sobran: moverlas al keko donde están o borrarlas.
- **Kekos**: cada lote sabe en qué keko de Habbo está. El Sniper aprende su keko: sus
  compras quedan ahí, publica primero lo de ese keko y lo recuperado vuelve a él. El
  detalle del lote en el Inventario muestra su keko.
- Modo demo: «Inventario» en Ajustes simula el envío del inventario de un keko.

### Corregido

- Conectar con Supabase fallaba con «Invalid path specified in request URL» si la
  Project URL se pegaba con `/rest/v1/` (como la muestra el panel de Supabase). Ahora la
  app deja solo la dirección base del proyecto, también en una conexión ya guardada.
- Con un proyecto de Supabase recién creado (sin tablas), el asistente se quedaba en
  «Conectar» con el error «Could not find the table 'public.compras'». Ahora reconoce
  la base vacía y pasa al paso de instalarla.
- Si una prueba de `npm run verificar` falla, la suite termina con error en vez de
  quedar esperando.

### Migraciones de Supabase

Ejecutar `20261007000000_auditoria_inventario.sql` (la app lo avisa y permite copiarla
desde el aviso ámbar). Sin ella, la auditoría no está disponible; el resto funciona igual.

## [1.0.0] - 2026-09-28

Primera versión pública. Funciona solo con el hotel **Habbo.es**.

### Agregado

- **Inventario por lotes** en tres estados: Comprado (en mano), Publicado (en el
  mercadillo) y Vendido. Lo que está en mano solo tiene costo; el precio, la ganancia y
  el margen aparecen al publicar o al vender. Vender una parte divide el lote y congela
  el precio real de venta.
- **Comisión exacta del mercadillo de Habbo.es**: `⌈(p² + 16000·p) / 800000⌉`, igual en
  la interfaz y en la base. La ganancia esperada y la realizada son netas, y la app
  calcula el precio de lista mínimo para no perder.
- **Publicar y retirar a mano**, por lote o por furni (lo más antiguo primero, FIFO). Al
  publicar se puede escribir el precio de lista o el neto que quieres recibir.
- **Mercadillo**: solo lo publicado, con **Vendido** y **Retirar** en cada fila (por
  precio de lista si hay varios).
- **Ventas manuales** fuera del Sniper: tradeos (sin comisión, en créditos o lingos) y
  ventas desde otro keko en el mercadillo (se guarda el neto).
- **Conexión con SniperMercadillo**: los snipers de los VPS envían compras,
  publicaciones y recuperaciones directo a Supabase con un token por VPS (revocable;
  en la base solo queda su huella). La app las recibe al instante y las muestra en
  «Llegaron del Sniper» para revisarlas.
- **LTD**: número de serie junto al nombre (#45). Un LTD es siempre una sola unidad.
- **Resumen**: la ganancia esperada sale solo de lo publicado; aparte, lo que tienes en
  mano (unidades y costo), las ventas realizadas y las alertas de lo publicado con
  pérdida. Incluye la tasa del lingo.
- **Importar desde Excel** (hojas Inventario, Mercadillo y Resumen), con los nombres
  corregidos al oficial de Habbo.es.
- **Catálogo oficial de Habbo.es**: buscador de furnis con nombres e iconos.
- **Seguridad**: seguridad por filas (RLS) en Supabase, sesión cifrada con la llave del
  sistema operativo y rechazo de la clave `service_role`.
- **Modo demo** con una base local, para probar sin Supabase.
- **Asistente de configuración** al abrir la app por primera vez: crear el proyecto de
  Supabase, conectar la app, instalar la base (copia cada migración con un clic y
  detecta cuáles faltan usando solo la clave pública) y crear tu usuario. Si una
  actualización trae una migración nueva que aún no ejecutaste, la app lo avisa y
  abre la misma lista.
- **Instaladores** para Windows (x64) y macOS (Apple Silicon e Intel).
- **Actualizaciones automáticas** desde GitHub Releases: al abrirse, la app busca una
  versión nueva y la instala. En Ajustes → Versión también se puede buscar a mano.

### Migraciones de Supabase

Instalación nueva: ejecutar en orden todos los archivos de `supabase/migrations/`, de
`20260927000000_esquema_inicial.sql` a `20261006000000_numero_ltd.sql`.

[Sin publicar]: https://github.com/xJp-P/Habbo-inventario/compare/v1.6.1...HEAD
[1.6.1]: https://github.com/xJp-P/Habbo-inventario/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/xJp-P/Habbo-inventario/compare/v1.5.2...v1.6.0
[1.5.2]: https://github.com/xJp-P/Habbo-inventario/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/xJp-P/Habbo-inventario/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/xJp-P/Habbo-inventario/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/xJp-P/Habbo-inventario/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/xJp-P/Habbo-inventario/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/xJp-P/Habbo-inventario/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/xJp-P/Habbo-inventario/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/xJp-P/Habbo-inventario/releases/tag/v1.0.0
