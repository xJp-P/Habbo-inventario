# Habbo Inventario

Aplicación de escritorio (Windows y macOS) para llevar la compra y venta de furnis en **Habbo.es**: precios de venta, stock, costo promedio, ganancias esperadas y realizadas, alertas de pérdida y compras en tiempo real desde **SniperMercadillo** (extensión de G-Earth), aunque los snipers corran en servidores remotos.

> Proyecto de fans, sin relación con Sulake ni con Habbo. Habbo, los nombres y las imágenes de los furnis son de Sulake Oy.
> La app funciona **solo con el hotel Habbo.es**. No tiene soporte para Habbo Origins ni para otros hoteles.

## Qué hace

| Vista | Qué muestra |
|---|---|
| **Resumen** | Tasa del Lingo, mercancía en venta (inversión, retorno, ganancia y margen), compras del Sniper por revisar, ventas realizadas, datos rápidos y alerta de furnis con pérdida |
| **Mercadillo** | Solo lo que está **publicado** en el mercadillo de Habbo.es (por el Sniper o por ti): precio de lista, unidades, costo promedio y ganancia esperada neta de lo publicado. Al hacer clic: lo que te entraría, la comisión, el precio mínimo para no perder y sus lotes |
| **Inventario** | Cada lote, en tres pestañas: **Comprado** (en mano), **Publicado** (con candado) y **Vendido**; un lote vive en una sola. Arriba, destacadas, las compras que llegaron del Sniper ("huérfanas") para ponerles precio y activarlas. **Publicar** pasa al mercadillo todas las unidades en mano de un furni (por ejemplo, lo que venía del Excel) y **Retirar** lo deshace. Vender una parte divide el lote y congela el precio real de venta |
| **Ajustes** | Tokens de tus snipers (uno por VPS), importar desde Excel, catálogo de Habbo.es, tema y cuenta |

## Cómo funciona

```
 VPS 1 ─ G-Earth + SniperMercadillo ─┐
 VPS 2 ─ G-Earth + SniperMercadillo ─┼──►  Supabase (tu proyecto)  ◄──►  Habbo Inventario (tu PC)
 VPS n ─ G-Earth + SniperMercadillo ─┘     Postgres + tiempo real          app de escritorio
```

- Los datos viven en **tu propio proyecto de Supabase** (Postgres). Cada usuario de la app usa el suyo.
- Los snipers escriben directo en Supabase con un token propio; tu PC no expone ningún puerto ni tu IP.
- La app se entera al instante de cada compra (Supabase Realtime) y la muestra para ponerle precio.

## Instalar

1. Descarga el instalador desde **Releases**:

   | Sistema | Archivo |
   |---|---|
   | Windows 10/11 | `Habbo-Inventario-Windows-x.y.z.exe` |
   | Mac con Apple Silicon | `Habbo-Inventario-Mac-x.y.z-arm64.dmg` |
   | Mac con Intel | `Habbo-Inventario-Mac-x.y.z-x64.dmg` |

2. **Windows:** si aparece "Windows protegió tu PC", pulsa *Más información → Ejecutar de todas formas* (la app no está firmada con certificado de pago).
   **macOS:** la app no está notarizada. Si dice que "está dañada", arrástrala a *Aplicaciones* y ejecuta una vez:

   ```bash
   xattr -cr "/Applications/Habbo Inventario.app"
   ```

## Preparar Supabase (una sola vez, ~5 minutos)

| Paso | Dónde | Qué hacer |
|---|---|---|
| 1 | [supabase.com](https://supabase.com) | Crea un proyecto (el plan gratis alcanza) |
| 2 | SQL Editor | Ejecuta, **en orden**, cada archivo de [`supabase/migrations/`](supabase/migrations/): pega su contenido y pulsa **Run** (`20260927000000_esquema_inicial.sql`, luego `20260928000000_eventos_sniper.sql`, `20260929000000_precio_lista_y_comision.sql`, `20260930000000_venta_neta_mercadillo.sql`, `20261001000000_publicacion_manual.sql` y `20261002000000_publicar_furni.sql`) |
| 3 | Authentication → Users | **Add user** con tu email y contraseña, marcando *Auto Confirm User* |
| 4 | Authentication → Sign In / Providers → Email | Desactiva *Allow new users to sign up* (nadie más puede crearse cuenta en tu proyecto) |
| 5 | Project Settings → API | Copia la **Project URL** y la **anon public key** |

Al abrir la app por primera vez te pide la URL y la clave, y después tu email y contraseña. La sesión queda guardada y cifrada con la llave de tu sistema operativo.

> Usa siempre la clave **anon / publishable**. La app rechaza la `service_role`: esa clave salta todas las protecciones.

### Seguridad

| Capa | Qué protege |
|---|---|
| Seguridad por filas (RLS) | Cada fila tiene dueño; solo tu usuario ve y cambia lo suyo |
| Clave anon sin permisos | Con la clave pública sola no se lee ni una tabla; solo se puede llamar a la función del sniper, que exige token |
| Tokens de sniper | Uno por VPS, revocables uno por uno. En la base solo queda su huella SHA-256 |
| Solo Habbo.es | La función del sniper rechaza cualquier otro hotel |
| Servidor local de la app | Escucha solo en `127.0.0.1` y bloquea peticiones de páginas web |

### Comisión del mercadillo

Toda ganancia esperada (Mercadillo, Inventario y Resumen) descuenta la comisión que cobra el mercadillo de Habbo.es al vender a un precio *p* en créditos:

```
comisión = ⌈(p² + 16000·p) / 800000⌉      (2 → 1 · 150 → 4 · 2.500 → 58 · 99.999 → 14.500)
```

Se calcula con aritmética entera, igual en la interfaz (`public/js/core/comision.js`) y en la base (`comision_mercadillo`); `npm run verificar` comprueba que coinciden de 0 a 200.000 créditos. El precio mínimo para no perder y la alerta de pérdida también la tienen en cuenta. Los precios en lingos (intercambios directos) no pagan comisión.

Al registrar la venta de un lote **Publicado**, escribes el precio del mercadillo (por defecto, el de lista) y se guarda lo que **entró a tu monedero**: el precio menos la comisión, que queda aparte en `comision_venta`. Así la ganancia realizada y el ROI salen de los créditos reales. La venta de un lote Comprado guarda el precio que anotes.

## Conectar SniperMercadillo

1. En la app: **Ajustes → Conexión con SniperMercadillo → Crear token** (uno por cada VPS). Cópialo: se muestra una sola vez.
2. En la configuración del sniper de ese VPS: la Project URL, la anon key y ese token.

El bot envía tres tipos de evento a un único endpoint (`registrar_eventos_sniper`):

| Evento | Qué pasa en el Inventario |
|---|---|
| **compra** | Entra como lote **huérfano** ("Por revisar"): cuenta en tu stock, pero no está en venta hasta que le confirmes un precio |
| **publicar** | Las unidades pasan a **Publicado** (con candado y su precio de lista), tomadas en orden FIFO; si es una parte del lote, el lote se divide |
| **recuperar** | Las unidades publicadas vuelven a **Comprado** (FIFO), sin precio de lista |

Los reintentos del bot con el mismo `id_externo` se ignoran en silencio. Lo publicado no se edita a mano: solo se registra su venta cuando se vende.

El contrato completo (campos, FIFO, respuesta y códigos) está en [`docs/INTEGRACION-SNIPER.md`](docs/INTEGRACION-SNIPER.md).

## Pasar tus datos desde el Excel

Si llevabas todo en la plantilla de Excel (hojas *Inventario*, *Mercadillo* y *Resumen*): **Ajustes → Importar desde Excel**. Los nombres se corrigen al oficial de Habbo.es y todo entra en una sola transacción (o entra todo, o nada).

Ojo: la hoja *Inventario* del Excel corresponde a la vista **Mercadillo** de la app, y la hoja *Mercadillo* a la vista **Inventario**.

También desde el código fuente, con comparación de totales contra el Excel:

```bash
npm run migrar -- "ruta/al/archivo.xlsx"
```

| Opción | Efecto |
|---|---|
| `--reemplazar` | Borra tus furnis y lotes antes de importar |
| `--mantener-nombres` | No corrige los nombres al oficial de Habbo.es |
| `--demo` | Importa a la base local del modo demo |

## Datos en tu equipo

La base de datos está en Supabase; en tu PC solo queda:

| Sistema | Carpeta |
|---|---|
| Windows | `%APPDATA%\Habbo Inventario\` |
| macOS | `~/Library/Application Support/Habbo Inventario/` |

| Archivo | Contenido |
|---|---|
| `.env` | URL y anon key de Supabase (si las configuraste desde la app) |
| `sesion-supabase.json` | Tu sesión, cifrada con la llave del sistema operativo |
| `furnidata-es.json`, `iconos/` | Catálogo e iconos de Habbo.es (se pueden borrar; se vuelven a bajar) |

## Desarrollo

Requisitos: **Node.js 22.12 o superior**.

```bash
npm install
cp .env.example .env
npm start
```

| Comando | Qué hace |
|---|---|
| `npm start` | Abre la app de escritorio (usa el `.env` de la raíz) |
| `npm run demo` | La app completa **sin Supabase**: Postgres local (PGlite) con el mismo esquema y tu Excel importado. En Ajustes simula compras, publicaciones y recuperaciones del Sniper |
| `npm run web` | La app en el navegador (http://127.0.0.1:3435) contra tu Supabase |
| `npm run verificar` | Pruebas de la lógica, la seguridad (RLS, clave anon, tokens) y la API sobre Postgres local |
| `npm run supabase:probar` | Revisa tu proyecto real: conexión, esquema instalado, que la clave anon no vea datos y tu sesión |
| `npm run prueba-arranque` | Abre Electron, comprueba que la interfaz cargó y se cierra |
| `npm run build:win` / `build:mac` | Genera el instalador en `dist/` (el de Mac, solo desde una Mac) |

Los instaladores oficiales se generan en GitHub Actions (`.github/workflows/build.yml`) al publicar una etiqueta `v*`.

### Estructura

```
electron/            proceso principal y puente seguro (preload)
backend/
  server.js          arma el servidor local: conexión Supabase + catálogo + API
  db/                cliente de Supabase, errores, y cliente local (PGlite) para pruebas y demo
  services/          conexión y sesión, reglas del negocio, catálogo Habbo.es, importador de Excel, demo
  routes/api.js      API local que usa la interfaz
  core/              utilidades, cálculos del Resumen y seguridad de la API local
supabase/migrations/ esquema de la base de datos (tablas, vistas, RLS y funciones)
public/              interfaz (HTML/CSS/JS con React 18 sin compilación)
scripts/             migración, pruebas, prueba de Supabase y modo navegador/demo
docs/                integración con SniperMercadillo
```

### Base de datos

| Tabla / vista | Vista de la app | Contenido |
|---|---|---|
| `config` | — | Ajustes por usuario (tasa del Lingo) |
| `furnis` | Mercadillo | Nombre oficial único, classname, revisión del icono, moneda y precio de venta |
| `compras` | Inventario | Lotes: estado (`comprado`, `publicado`, `vendido`), cantidad, precio de compra, precio de lista, `publicado_por` (`sniper` o `manual`), precio real al vender (neto si fue en el mercadillo), `comision_venta`, `origen_id` (lote dividido), `fuente`, `id_externo`, `pendiente` (huérfano), `instancia`, `notas` |
| `tokens_sniper` | Ajustes | Nombre, prefijo y huella de cada token |
| `eventos_sniper` | — | Bitácora de cada evento del bot, con `id_externo` único (idempotencia) |
| `v_compras`, `v_furnis` | — | Todos los cálculos del Excel (costo, ganancia, margen, stock, costo promedio, estado, pérdida) más la comisión del mercadillo y el precio de lista de lo publicado, con RLS |
| `registrar_eventos_sniper` | — | Entrada única de los snipers: compra, publicar y recuperar (token + hotel Habbo.es + FIFO + idempotencia) |
| `vender_lote`, `revertir_venta`, `publicar_furni`, `publicar_lote`, `retirar_lote`, `activar_pendientes`, `crear_compra`, `importar_excel`, `fusionar_furnis` | — | Operaciones de varias escrituras, cada una en una transacción |

## Licencia

MIT. Ver [LICENSE](LICENSE).
