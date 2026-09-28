# Registro de cambios

Todos los cambios importantes de Habbo Inventario se anotan aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones siguen
[Versionado Semántico](https://semver.org/lang/es/).

Cada versión indica en **Migraciones de Supabase** si hace falta ejecutar un archivo
nuevo de `supabase/migrations/`. Las apps instaladas se actualizan solas, así que esa
migración debe ejecutarse **antes** de publicar el Release en GitHub.

## [Sin publicar]

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

[Sin publicar]: https://github.com/xJp-P/Habbo-inventario/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/xJp-P/Habbo-inventario/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/xJp-P/Habbo-inventario/releases/tag/v1.0.0
