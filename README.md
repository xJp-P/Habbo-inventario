# Habbo Inventario

Aplicación de escritorio (Windows y macOS) para llevar la compra y venta de furnis en **Habbo.es**: stock, costo promedio, precios de lista, ganancias esperadas y realizadas con la comisión exacta del mercadillo, alertas de pérdida y compras en tiempo real desde **SniperMercadillo** (extensión de G-Earth), aunque los snipers corran en servidores remotos.

> Proyecto de fans, sin relación con Sulake ni con Habbo. Habbo, los nombres y las imágenes de los furnis son de Sulake Oy.
> La app funciona **solo con el hotel Habbo.es**. No tiene soporte para Habbo Origins ni para otros hoteles.

## Contenido

- [Qué hace](#qué-hace)
- [Cómo funciona](#cómo-funciona)
- [Instalación y configuración](#instalación-y-configuración) (paso a paso)
- [Problemas comunes](#problemas-comunes)
- [Seguridad](#seguridad)
- [Comisión del mercadillo](#comisión-del-mercadillo)
- [Importar desde Excel](#importar-desde-excel)
- [Datos en tu equipo](#datos-en-tu-equipo)
- [Desarrollo](#desarrollo)
- [Licencia](#licencia)

## Qué hace

| Vista | Qué muestra |
|---|---|
| **Resumen** | Lo **publicado** (inversión, lo que te entraría, ganancia esperada y margen), lo que tienes **en mano** (unidades y costo), ventas realizadas, compras del Sniper por revisar, alertas de lo publicado con pérdida y la tasa del Lingo |
| **Mercadillo** | Solo lo que está publicado en el mercadillo de Habbo.es: precio de lista, unidades, costo promedio y ganancia neta esperada. En cada fila, **Vendido** y **Retirar** (de lo más antiguo a lo más nuevo, FIFO) |
| **Inventario** | Cada lote en tres pestañas: **Comprado** (en mano, solo costo), **Publicado** y **Vendido**. Publicar, retirar, registrar ventas fuera del Sniper (tradeos sin comisión o ventas desde otro keko) y el número de serie de los **LTD** (#45). Arriba, las compras que llegaron del Sniper para revisarlas |
| **Ajustes** | Tokens de tus snipers (uno por VPS), importar desde Excel, catálogo de Habbo.es, versión y actualizaciones, tema y cuenta |

Lo que tienes en mano no tiene precio ni ganancia: el precio aparece al publicar o al vender. Vender una parte de un lote lo divide y congela el precio real de venta.

## Cómo funciona

```
 VPS 1 ─ G-Earth + SniperMercadillo ─┐
 VPS 2 ─ G-Earth + SniperMercadillo ─┼──►  Supabase (tu proyecto)  ◄──►  Habbo Inventario (tu PC)
 VPS n ─ G-Earth + SniperMercadillo ─┘     Postgres + tiempo real          app de escritorio
```

- Los datos viven en **tu propio proyecto de Supabase** (Postgres). Cada persona que usa la app tiene el suyo: nadie ve los datos de otro.
- Los snipers escriben directo en Supabase con un token propio; tu PC no expone ningún puerto ni tu IP.
- La app se entera al instante de cada compra (Supabase Realtime) y la muestra para revisarla.
- El Sniper es opcional: sin él, todo se registra a mano.

## Instalación y configuración

Tiempo aproximado: **10 minutos**. Solo necesitas una cuenta gratuita de Supabase.

| Paso | Qué haces | Dónde |
|---|---|---|
| [1](#paso-1--crear-el-proyecto-en-supabase) | Crear el proyecto | supabase.com |
| [2](#paso-2--ejecutar-las-migraciones-en-orden) | Instalar la base de datos (10 archivos `.sql`, en orden) | SQL Editor de Supabase |
| [3](#paso-3--crear-tu-usuario-y-cerrar-el-registro) | Crear tu usuario y cerrar el registro | Authentication de Supabase |
| [4](#paso-4--copiar-la-url-y-la-clave-pública) | Copiar la URL y la clave pública | Project Settings de Supabase |
| [5](#paso-5--conectar-la-app) | Conectar la app: con el instalador **o** desde el código con `.env` | Tu PC |
| [6](#paso-6--conectar-snipermercadillo-opcional) | Conectar tus snipers (opcional) | Ajustes de la app |

### Paso 1 · Crear el proyecto en Supabase

1. Entra a [supabase.com](https://supabase.com) y crea una cuenta (el plan **Free** alcanza).
2. Pulsa **New project** y completa:

   | Campo | Qué poner |
   |---|---|
   | Name | El que quieras, por ejemplo `habbo-inventario` |
   | Database Password | Una contraseña fuerte. Guárdala en un lugar seguro: la app **no** la necesita |
   | Region | La más cercana a ti y a tus VPS |

3. Espera 1 o 2 minutos a que el proyecto termine de crearse.

> En el plan gratis, Supabase pausa los proyectos que pasan una semana sin actividad. Si te pasa, reactívalo desde el panel: tus datos siguen ahí.

### Paso 2 · Ejecutar las migraciones (en orden)

Las migraciones son los archivos de [`supabase/migrations/`](supabase/migrations/): crean las tablas, las vistas, la seguridad y las funciones de la app. Se ejecutan **una sola vez cada una y en este orden**:

| # | Archivo | Qué agrega |
|---:|---|---|
| 1 | `20260927000000_esquema_inicial.sql` | Tablas, vistas, seguridad por filas y tokens del sniper |
| 2 | `20260928000000_eventos_sniper.sql` | Eventos del Sniper: compra, publicar y recuperar |
| 3 | `20260929000000_precio_lista_y_comision.sql` | Comisión del mercadillo y precio de lista |
| 4 | `20260930000000_venta_neta_mercadillo.sql` | Las ventas en el mercadillo guardan lo que entró (neto) |
| 5 | `20261001000000_publicacion_manual.sql` | Publicar y retirar a mano |
| 6 | `20261002000000_publicar_furni.sql` | Publicar un furni completo |
| 7 | `20261003000000_vender_retirar_furni.sql` | Vendido y Retirar desde el Mercadillo |
| 8 | `20261004000000_venta_en_mano.sql` | Ventas manuales (tradeos y otros kekos) |
| 9 | `20261005000000_sin_precio_de_referencia.sql` | Lo que está en mano solo tiene costo |
| 10 | `20261006000000_numero_ltd.sql` | Número de serie de los LTD |

Para cada archivo, en orden:

1. En Supabase, abre **SQL Editor** (menú de la izquierda) y pulsa **New query** (o el **+**).
2. Abre el archivo (en tu copia del proyecto o en GitHub con el botón *Raw*), copia **todo** su contenido y pégalo en el editor.
3. Pulsa **Run** (o `Ctrl + Enter`). Debe responder *Success. No rows returned*.
4. Si Supabase avisa *Potential issue detected* (algunas migraciones reemplazan funciones de la anterior), confirma con **Run this query**.

Cada archivo comprueba que el anterior se haya ejecutado. Si te saltas uno, verás un error como *«Falta ejecutar antes 20261002000000_publicar_furni.sql»*: ejecuta el que falta y sigue desde ahí.

> **Al actualizar la app:** si el [`CHANGELOG.md`](CHANGELOG.md) de una versión nueva indica una migración, ejecútala igual que estas, sin volver a correr las anteriores.

### Paso 3 · Crear tu usuario y cerrar el registro

La app no tiene registro abierto: el único usuario de tu proyecto lo creas tú.

1. **Authentication → Users → Add user → Create new user**: escribe tu email y una contraseña, marca **Auto Confirm User** y pulsa **Create user**.
2. **Authentication → Sign In / Providers**: desactiva **Allow new users to sign up** y guarda. Así nadie más puede crearse una cuenta en tu proyecto.

Ese email y esa contraseña son los que usarás para entrar a la app.

### Paso 4 · Copiar la URL y la clave pública

| Dato | Dónde está | Cómo se ve |
|---|---|---|
| **Project URL** | Project Settings → **Data API** (o el botón **Connect** de arriba) | `https://abcd1234.supabase.co` |
| **Clave pública** | Project Settings → **API Keys**: la *Publishable key*, o en *Legacy API Keys* la **anon public** | `sb_publishable_…` o `eyJ…` |

> **Nunca uses la clave secreta** (*Secret key* o `service_role`): salta todas las protecciones de la base de datos. La app la detecta y la rechaza.

### Paso 5 · Conectar la app

Elige **una** de las dos opciones.

#### Opción A · Con el instalador (recomendada)

1. Descarga el instalador de la última versión en [**Releases**](https://github.com/xJp-P/Habbo-inventario/releases/latest):

   | Sistema | Archivo |
   |---|---|
   | Windows 10/11 | `Habbo-Inventario-Windows-x.y.z.exe` |
   | Mac con Apple Silicon (M1 o posterior) | `Habbo-Inventario-Mac-x.y.z-arm64.dmg` |
   | Mac con Intel | `Habbo-Inventario-Mac-x.y.z-x64.dmg` |

2. Instálala:
   - **Windows:** si aparece *«Windows protegió tu PC»*, pulsa **Más información → Ejecutar de todas formas** (la app no está firmada con un certificado de pago).
   - **macOS:** arrastra la app a **Aplicaciones**. La app no está notarizada por Apple: si al abrirla dice que *«está dañada»* o que no se puede verificar, abre la Terminal y ejecuta una vez:

     ```bash
     xattr -cr "/Applications/Habbo Inventario.app"
     ```

3. Ábrela. La primera vez te muestra **«Conectar con tu Supabase»**: pega la **Project URL** y la **clave pública** del paso 4 y pulsa **Guardar conexión**.
4. Entra con el email y la contraseña del paso 3.

No hace falta editar ningún archivo: la app guarda la conexión en su carpeta de datos y tu sesión cifrada con la llave de tu sistema operativo. Desde ahí se **actualiza sola**: al abrirse busca una versión nueva en GitHub y la instala.

#### Opción B · Desde el código fuente (con `.env`)

Requisitos: [Node.js](https://nodejs.org) **22.12 o superior** y [Git](https://git-scm.com).

1. Descarga el proyecto e instala sus dependencias:

   ```bash
   git clone https://github.com/xJp-P/Habbo-inventario.git
   cd Habbo-inventario
   npm install
   ```

2. Crea tu `.env` a partir de la plantilla [`.env.example`](.env.example):

   | Sistema | Comando |
   |---|---|
   | Windows (CMD o PowerShell) | `copy .env.example .env` |
   | macOS / Linux | `cp .env.example .env` |

3. Abre `.env` con cualquier editor de texto y reemplaza los valores de ejemplo:

   | Variable | ¿Obligatoria? | Qué poner |
   |---|---|---|
   | `SUPABASE_URL` | Sí | La **Project URL** del paso 4 |
   | `SUPABASE_ANON_KEY` | Sí | La **clave pública** del paso 4 (`sb_publishable_…` o `eyJ…`) |
   | `SUPABASE_EMAIL` | No | Tu email del paso 3. Solo para `npm run migrar` y `npm run supabase:probar` si aún no entraste a la app |
   | `SUPABASE_PASSWORD` | No | Tu contraseña del paso 3, en el mismo caso |

   Deja las variables opcionales comentadas (con `#` delante) si no las necesitas. El `.env` está en `.gitignore`: **nunca lo subas a GitHub**.

4. Comprueba la conexión (opcional, no escribe nada en tu base):

   ```bash
   npm run supabase:probar
   ```

   Revisa que el proyecto responda, que las migraciones estén instaladas y que la clave pública no pueda leer tus datos.

5. Abre la app y entra con tu usuario del paso 3:

   ```bash
   npm start
   ```

Si no creas el `.env`, la app te pide la URL y la clave al abrirse, igual que en la opción A, y las guarda en `data/.env`. Si ambos existen, se usan primero las variables de entorno del sistema, luego el `.env` de la raíz y por último `data/.env`.

### Paso 6 · Conectar SniperMercadillo (opcional)

1. En la app: **Ajustes → Conexión con SniperMercadillo → Crear token**, uno por cada VPS. Cópialo: se muestra una sola vez.
2. En la configuración del sniper de ese VPS: la Project URL, la clave pública y ese token.

El bot envía tres tipos de evento a una sola función de Supabase (`registrar_eventos_sniper`):

| Evento | Qué pasa en el Inventario |
|---|---|
| **compra** | Entra como lote **«Por revisar»**: cuenta en tu stock y, al confirmarlo, pasa a en mano |
| **publicar** | Las unidades pasan a **Publicado** con su precio de lista (FIFO; si es una parte del lote, el lote se divide) |
| **recuperar** | Las unidades publicadas vuelven a **Comprado** (FIFO) |

Los reintentos del bot con el mismo `id_externo` se ignoran. El contrato completo (campos, respuesta y errores) está en [`docs/INTEGRACION-SNIPER.md`](docs/INTEGRACION-SNIPER.md).

## Problemas comunes

| Mensaje o síntoma | Causa | Solución |
|---|---|---|
| *«Falta ejecutar antes …sql»* en el SQL Editor | Te saltaste una migración | Ejecuta la que indica y continúa en orden |
| *«Esa es la clave secreta (service_role)»* | Pegaste la clave secreta | Usa la *Publishable key* o la **anon public** |
| *«La Anon Key no parece válida»* | Clave incompleta o de otro lugar | Cópiala de nuevo desde Project Settings → API Keys |
| *«Invalid login credentials»* | Email o contraseña incorrectos, o usuario sin confirmar | Revisa el usuario en Authentication → Users (debe estar confirmado) |
| La app no carga tus datos y el proyecto no responde | Supabase pausó el proyecto por inactividad | Reactívalo desde el panel de Supabase |
| *«Windows protegió tu PC»* | La app no tiene certificado de pago | **Más información → Ejecutar de todas formas** |
| macOS dice que la app *«está dañada»* | La app no está notarizada | `xattr -cr "/Applications/Habbo Inventario.app"` |

## Seguridad

| Capa | Qué protege |
|---|---|
| Seguridad por filas (RLS) | Cada fila tiene dueño; solo tu usuario ve y cambia lo suyo |
| Clave pública sin permisos | Con la clave pública sola no se lee ni una tabla; solo se puede llamar a la función del sniper, que exige un token |
| Tokens de sniper | Uno por VPS y revocables uno por uno. En la base solo queda su huella SHA-256 |
| Solo Habbo.es | La función del sniper rechaza cualquier otro hotel |
| Sesión cifrada | Se guarda cifrada con la llave del sistema operativo (DPAPI en Windows, Llavero en macOS) |
| Servidor local de la app | Escucha solo en `127.0.0.1` y bloquea peticiones de páginas web |

## Comisión del mercadillo

La ganancia esperada existe solo para lo **publicado** y descuenta la comisión que cobra el mercadillo de Habbo.es al vender a un precio *p* en créditos:

```
comisión = ⌈(p² + 16000·p) / 800000⌉      (2 → 1 · 150 → 4 · 2.500 → 58 · 99.999 → 14.500)
```

- Se calcula con aritmética entera, igual en la interfaz (`public/js/core/comision.js`) y en la base (`comision_mercadillo`); `npm run verificar` comprueba que coinciden de 0 a 200.000 créditos.
- Al publicar puedes escribir el precio de lista o, marcando **«Ingresar precio neto»**, lo que quieres recibir: la app calcula el precio de lista mínimo que lo deja.
- Al registrar una venta de lo publicado se guarda lo que **entró a tu monedero** (precio menos comisión) y la comisión aparte. Así la ganancia realizada sale de los créditos reales.
- Los precios en lingos (intercambios directos) no pagan comisión.

## Importar desde Excel

Si llevabas tu inventario en una planilla con las hojas *Inventario*, *Mercadillo* y *Resumen*: **Ajustes → Importar desde Excel**. Los nombres se corrigen al oficial de Habbo.es y todo entra en una sola transacción (o entra todo, o nada).

Ojo: la hoja *Inventario* del Excel corresponde a la vista **Mercadillo** de la app, y la hoja *Mercadillo* a la vista **Inventario**.

Desde el código fuente también se puede, con una comparación de totales contra el Excel:

```bash
npm run migrar -- "ruta/al/archivo.xlsx"
```

| Opción | Efecto |
|---|---|
| `--reemplazar` | Borra tus furnis y lotes antes de importar |
| `--mantener-nombres` | No corrige los nombres al oficial de Habbo.es |
| `--demo` | Importa a la base local del modo demo |

## Datos en tu equipo

La base de datos está en Supabase; en tu PC solo queda la carpeta de datos de la app:

| Sistema | App instalada | Desde el código (`npm start`) |
|---|---|---|
| Windows | `%APPDATA%\Habbo Inventario\` | `data/` del proyecto |
| macOS | `~/Library/Application Support/Habbo Inventario/` | `data/` del proyecto |

| Archivo | Contenido |
|---|---|
| `.env` | URL y clave pública de Supabase (si las configuraste desde la app) |
| `sesion-supabase.json` | Tu sesión, cifrada con la llave del sistema operativo |
| `furnidata-es.json`, `iconos/` | Catálogo e iconos de Habbo.es (se pueden borrar; se vuelven a bajar) |

## Desarrollo

| Comando | Qué hace |
|---|---|
| `npm start` | Abre la app de escritorio |
| `npm run demo` | La app en el navegador (`http://127.0.0.1:3435`) **sin Supabase**: Postgres local (PGlite) con el mismo esquema. Empieza vacía; en Ajustes puedes simular compras, publicaciones y recuperaciones del Sniper |
| `npm run web` | La app en el navegador contra tu Supabase |
| `npm run verificar` | Pruebas de la lógica, la seguridad (RLS, clave pública, tokens) y la API sobre Postgres local |
| `npm run supabase:probar` | Revisa tu proyecto real: conexión, esquema instalado, que la clave pública no vea datos y tu sesión |
| `npm run prueba-arranque` | Abre Electron, comprueba que la interfaz cargó y se cierra |
| `npm run simular-actualizacion` | Recorre el flujo de actualización con una versión ficticia, sin descargar nada |
| `npm run build:win` / `build:mac` | Genera el instalador en `dist/` (el de Mac, solo desde una Mac) |
| `npm run build:dir` | Genera la app sin instalador, para probarla rápido |

### Publicar una versión

Los instaladores oficiales los genera GitHub Actions ([`.github/workflows/build.yml`](.github/workflows/build.yml)) en Windows y macOS.

1. Sube la versión en `package.json` y anota los cambios en [`CHANGELOG.md`](CHANGELOG.md), incluida cualquier migración nueva.
2. Si la versión trae una migración, ejecútala en Supabase **antes** de publicar: las apps instaladas se actualizan solas.
3. Sube una etiqueta con esa versión (por ejemplo `v1.1.0`). GitHub Actions compila y deja un **Release en borrador** con los instaladores y los archivos que leen las apps para actualizarse.
4. Revisa el borrador y pulsa **Publish release**. Desde ese momento, las apps instaladas lo descargan al abrirse.

Las actualizaciones automáticas necesitan que el repositorio sea **público**.

### Estructura

```
electron/            proceso principal, puente seguro (preload), pantalla de inicio y actualizaciones
backend/
  server.js          arma el servidor local: conexión Supabase + catálogo + API
  db/                cliente de Supabase, errores y cliente local (PGlite) para pruebas y demo
  services/          conexión y sesión, reglas del negocio, catálogo Habbo.es, importador de Excel, demo
  routes/api.js      API local que usa la interfaz
  core/              utilidades, cálculos del Resumen y seguridad de la API local
supabase/migrations/ esquema de la base de datos (tablas, vistas, RLS y funciones)
public/              interfaz (HTML/CSS/JS con React 18, sin compilación)
recursos/            iconos del instalador
scripts/             importación de Excel, pruebas, prueba de Supabase y modo navegador/demo
docs/                integración con SniperMercadillo
```

### Base de datos

| Tabla / vista | Vista de la app | Contenido |
|---|---|---|
| `config` | — | Ajustes por usuario (tasa del Lingo) |
| `furnis` | Mercadillo | Nombre oficial único, classname, revisión del icono y sprite |
| `compras` | Inventario | Lotes: estado (`comprado`, `publicado`, `vendido`), cantidad, precio de compra, precio de lista, `publicado_por` (`sniper` o `manual`), precio real al vender (neto si fue en el mercadillo), `comision_venta`, `numero_ltd`, `origen_id` (lote dividido), `id_externo` y `pendiente` (por revisar) |
| `tokens_sniper` | Ajustes | Nombre, prefijo y huella de cada token |
| `eventos_sniper` | — | Bitácora de cada evento del bot, con `id_externo` único |
| `v_compras`, `v_furnis` | — | Costo, ganancia, margen, stock, costo promedio, comisión y alertas, con RLS |
| `registrar_eventos_sniper` | — | Entrada única de los snipers: compra, publicar y recuperar |
| `vender_lote`, `vender_furni`, `vender_en_mano`, `revertir_venta`, `publicar_lote`, `publicar_furni`, `retirar_lote`, `retirar_furni`, `asignar_ltd`, `activar_pendientes`, `crear_compra`, `importar_excel`, `fusionar_furnis` | — | Operaciones de varias escrituras, cada una en una sola transacción |

Un cambio de esquema es siempre una migración nueva y numerada en `supabase/migrations/`, nunca una edición de las anteriores.

## Licencia

MIT. Ver [LICENSE](LICENSE).
