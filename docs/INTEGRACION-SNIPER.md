# Integración SniperMercadillo → Habbo Inventario (Supabase)

Contrato del endpoint único que usan los SniperMercadillo (extensión de G-Earth en C#, corriendo en VPS) para enviar a **Habbo Inventario** sus compras, publicaciones en el mercadillo, recuperaciones y ventas. Implementado en `supabase/migrations/20260928000000_eventos_sniper.sql` (las ventas, en `20261015000000_ventas_sniper.sql`, sección 6) y cubierto por `npm run verificar`.

> Regla del proyecto: **solo Habbo.es**. Cualquier evento de otro hotel (incluido Habbo Origins) se rechaza.

---

## 1. Endpoint

```
POST {SUPABASE_URL}/rest/v1/rpc/registrar_eventos_sniper
apikey: {SUPABASE_ANON_KEY}
Authorization: Bearer {SUPABASE_ANON_KEY}      ← solo si la clave empieza por "eyJ" (formato JWT clásico)
Content-Type: application/json
```

```json
{
  "token_sniper": "hbi_…",
  "eventos": [
    { "tipo_evento": "compra",    "id_externo": "123456789", "sprite_id": 4623, "cantidad": 1, "precio": 100, "moneda": "creditos", "hotel": "es", "notas": "Costo extra: 10 diamantes", "numero_ltd": 45 },
    { "tipo_evento": "publicar",  "id_externo": "pub_1790571239704_4623_8841", "sprite_id": 4623, "cantidad": 1, "precio_lista": 125, "moneda": "creditos", "hotel": "es", "fecha": 1790571239704 },
    { "tipo_evento": "recuperar", "id_externo": "rec_1790571239962_4623_1203", "sprite_id": 4623, "cantidad": 1, "hotel": "es" },
    { "tipo_evento": "venta",     "id_externo": "ven_174670943", "oferta_id": null, "keko": "Ux_Data", "sprite_id": 4623, "tipo": "suelo", "precio": 125, "numero_ltd": null, "fecha": 1790792395000, "hotel": "es" }
  ]
}
```

- Máximo **200 eventos** por envío. Se procesan en el orden de la lista.
- `token_sniper`: uno por VPS, creado en la app (Ajustes → Conexión con SniperMercadillo). Revocable individualmente.

### Campos de cada evento

| Campo | compra | publicar | recuperar | venta | Detalle |
|---|---|---|---|---|---|
| `tipo_evento` | ✔ | ✔ | ✔ | ✔ | `compra`, `publicar`, `recuperar` o `venta` (la venta, con la migración 19: sección 6) |
| `id_externo` | ✔ | ✔ | ✔ | ✔ | Único por usuario. Un reintento con el mismo id se ignora en silencio (cuenta en `duplicados`). En `venta`: `ven_{id de venta del hotel}` |
| `sprite_id` | ✔ | ✔ | ✔ | ✔ | Id numérico del furni en el furnidata de Habbo.es |
| `tipo` | opc. | opc. | opc. | opc. | `suelo` (por defecto) o `pared`: sus sprite_id son numeraciones distintas. En `venta` puede ir `null` (un LTD de espacio desconocido) |
| `hotel` | ✔ | ✔ | ✔ | ✔ | `es` (también `habbo.es`, `www.habbo.es`, `game-es.habbo.com`) |
| `cantidad` | opc. (1) | opc. (1) | opc. (1) | — | Unidades. Una `venta` es siempre una unidad: no se envía |
| `precio` | ✔ | | | ✔ | `compra`: precio unitario pagado. `venta`: el precio de lista en créditos (entero), lo que pagó el comprador. Número JSON o texto (`"3"`, `"3.5"`, `"3,5"`) |
| `precio_lista` | | ✔ | | | Precio unitario al que se publicó. Número JSON o texto, como `precio` |
| `moneda` | opc. | opc. | | | `creditos` (por defecto) o `lingos` |
| `notas` | opc. | | | | Texto libre; ahí van los costos en diamantes o puntos de un LTD |
| `numero_ltd` | opc. | | | opc. | Número de serie de un LTD: `45`, `"45"` o `"#45"`. Un LTD es una sola unidad: con número, `cantidad` debe ser 1 (si no, el evento va a `errores`) |
| `fecha` | opc. | opc. | | ✔ | `compra`: el día (ISO o milisegundos), por defecto hoy. `publicar` (migración 19): la hora en que Habbo confirmó la publicación (`MarketplaceMakeOfferResult`), en milisegundos o ISO; sin ella, la de llegada. `venta`: la hora de la venta. **Nunca en segundos**: un número se lee como milisegundos |
| `keko` | | | | ✔ | La cuenta de Habbo de la venta |
| `oferta_id` | | | | opc. | Informativo: la base no lo usa |
| `instancia` | opc. | | | | Si falta, se usa el nombre del token |
| `classname`, `nombre`, `revision` | opc. | | | | Si el bot los tiene, el furni nuevo nace con su nombre oficial |

---

## 2. Qué hace cada evento

| Evento | Efecto en el Inventario |
|---|---|
| **compra** | Crea un lote `comprado` y **huérfano** ("Por revisar"): cuenta en el stock, pero no está en venta hasta que el usuario le confirma un precio en la app. Si el sprite no existía, crea un furni provisional que la app nombra con el catálogo oficial |
| **publicar** | Toma unidades de los lotes `comprado` (también los "por revisar") en orden **FIFO**: del más antiguo al más nuevo (los importados del Excel, sin fecha, primero). Un lote que entra entero pasa a `publicado`; si entra una parte, se divide y nace un lote `publicado` con ese pedazo. Guarda `precio_lista` y, con la migración 19, la `fecha` como hora de publicación |
| **recuperar** | Toma unidades de los lotes `publicado` en orden FIFO (lo publicado hace más tiempo primero) y las devuelve a `comprado`, limpiando el precio de lista. Primero lo que publicó el Sniper; solo después lo que el usuario publicó a mano en la app. Con la migración 19, si el token ya conoce su keko, solo de ese keko y de lo sin keko (nunca de otro keko). Si su lote de origen sigue `comprado` al mismo costo, se reúnen con él |
| **venta** | (Migración 19.) Pasa **una** unidad de un lote `publicado` de ese furni en su keko (o sin keko) a `vendido`, con el neto y la comisión. Lo que no casa queda «por asignar». Ver la sección 6 |

- Si no alcanza el stock, se aplica lo que haya y la respuesta trae `faltante`.
- Si no hay **nada** que aplicar (p. ej. publicar un sprite sin stock), el evento va a `errores` y **no queda registrado**: el bot puede reintentarlo más tarde con el mismo `id_externo`. Una `venta` no: queda «por asignar» (sección 6).
- Los lotes `publicado` llevan candado en la app: el usuario no los edita ni los borra. Su venta la envía el Sniper (evento `venta`) o la registra el usuario (a su precio de lista por defecto). La venta guarda el neto que entró al monedero (precio − comisión del mercadillo).

---

## 3. Respuesta

HTTP 200:

```json
{
  "recibidos": 3, "procesados": 3, "duplicados": 0, "errores": [], "por_asignar": 0,
  "eventos": [
    { "indice": 0, "id_externo": "123456789", "tipo_evento": "compra", "compra_id": 57, "furni_id": 12, "cantidad": 1, "pendiente": true },
    { "indice": 1, "id_externo": "pub_…", "tipo_evento": "publicar", "cantidad": 1, "faltante": 0, "precio_lista": 125, "moneda": "creditos", "lotes": [ { "lote_id": 58, "origen_id": 57, "cantidad": 1, "dividido": true } ] },
    { "indice": 2, "id_externo": "rec_…", "tipo_evento": "recuperar", "cantidad": 1, "faltante": 0, "lotes": [ { "desde_lote": 58, "hacia_lote": 57, "cantidad": 1 } ] }
  ]
}
```

| HTTP | Significado | Qué debe hacer el bot |
|---|---|---|
| 200 | Envío procesado | Quitar de su cola lo `procesado` y lo `duplicado`. Los `errores` traen `indice`, `id_externo` y el motivo. Cada `publicar` devuelve el `precio_lista` que quedó guardado (sirve para el log del bot) y, con la migración 19, `publicado_en` y `ventas_asignadas` (ventas por asignar que ese publicar resolvió). `por_asignar`: cuántas ventas quedaron por asignar (cuentan como procesadas) |
| 401 | Token inválido o revocado | Dejar de enviar y avisar (reintentar no sirve) |
| 400 | Envío mal formado (lista vacía o más de 200) | Error de programación: log |
| 404 (`PGRST202`) | La función no existe | Falta ejecutar la migración en **ese** proyecto de Supabase. Si la app no muestra el aviso ámbar de migraciones, el bot apunta a **otro** proyecto: su URL debe ser la misma que la de la app (Ajustes → Cuenta y apariencia → Supabase) y su token, uno creado en esta app |
| 5xx / sin red / timeout | Supabase no disponible | Reintentar con espera creciente: la idempotencia lo hace seguro |

### Prueba de conexión

```
POST {SUPABASE_URL}/rest/v1/rpc/estado_sniper
{ "p_token": "hbi_…" }
```

Responde `{ "ok": true, "hotel": "es", "token": "<nombre del token>", "pendientes": 3 }` o 401.

---

## 4. Requisito del lado de la app

Tras aplicar la migración hay que **abrir la app de escritorio una vez**: al iniciar sesión completa el `sprite_id` de los furnis que ya existían (los importados del Excel) a partir de su `classname`. Sin eso, un `publicar` de un furni antiguo no encontraría su stock. A partir de ahí la app mantiene todo sincronizado sola cada vez que recibe eventos.

---

## 5. Auditoría del inventario (requiere `20261007000000_auditoria_inventario.sql`)

Cuando el bot termina de cargar el inventario completo del keko (último fragmento de `In.FurniList`, al iniciar sesión o al recargarlo), lo envía a la app para conciliarlo con el libro mayor. La app compara **en vivo** esa foto con lo que tiene **en mano** en ese keko (comprado y por revisar; lo publicado no cuenta) y le muestra al usuario solo las diferencias.

```
POST {SUPABASE_URL}/rest/v1/rpc/auditar_inventario
apikey: <SUPABASE_ANON_KEY>
Authorization: Bearer <SUPABASE_ANON_KEY>
Content-Type: application/json

{
  "token_sniper": "hbi_…",
  "keko": "NombreDelKeko",
  "hotel": "es",
  "inventario": [
    { "sprite_id": 4623, "tipo": "suelo", "cantidad": 17 },
    { "sprite_id": 4001, "tipo": "pared", "cantidad": 2 },
    { "sprite_id": 8120, "tipo": "suelo", "cantidad": 2, "ltds": [45, 46] }
  ]
}
```

| Campo | Obligatorio | Qué es |
|---|---|---|
| `token_sniper` | Sí | El mismo token del sniper de ese VPS |
| `keko` | Sí | Nombre del keko de Habbo cuyo inventario es (hasta 60 caracteres). El token **aprende** su keko: desde ese envío, las compras de ese sniper quedan en ese keko, publica primero lo que está en él y lo recuperado vuelve a él |
| `hotel` | Sí | `es` (solo Habbo.es; otro hotel se rechaza) |
| `inventario` | Sí | Lista (puede estar vacía, hasta 50.000 elementos). Un elemento por furni con su `cantidad`, o uno por unidad (sin `cantidad` vale 1): la base los agrupa |
| `sprite_id` + `tipo` | Sí (o `nombre`) | La identidad del furni, igual que en los eventos (`tipo`: `suelo`/`pared`, también `floor`/`wall`). Sin `sprite_id` se acepta `nombre` si la app tiene un furni con ese nombre |
| `ltds` / `numero_ltd` | Opcional | Números de serie de los LTD de ese furni (`[45, 46]`, o `"#45"` en un elemento por unidad). Con ellos la app detecta un LTD con otro número |
| `costo_unidad` | Opcional (requiere `20261009000000_costos_auditoria.sql`) | Lo que costó cada unidad de ese elemento según la cartera del bot, en créditos (número o texto: `25`, `"25.5"`, `"25,5"`; ≥ 0) |
| `unidades_con_costo` | Opcional | A cuántas unidades de `cantidad` corresponde ese costo (entero ≥ 1; sin él, a todas; nunca más que `cantidad`) |
| `costo_medio` | Opcional | `true` si `costo_unidad` es un promedio de lotes a precios distintos (por defecto `false`) |

**Costos:** el bot solo envía las tres claves de costo cuando lo conoce; un furni regalado o tradeado por fuera va sin ellas (nunca con `0` o `null` para decir «no sé»). Un costo mal formado se ignora sin rechazar el elemento: el furni entra igual, sin costo. Sin la migración, las claves de costo se ignoran.

**Un elemento por precio de compra (requiere `20261010000000_costos_por_tramo.sql`):** si el mismo furni se compró a precios distintos, el bot **no los promedia**: envía un elemento por cada lote de su cartera, con el mismo `sprite_id` y `tipo`, su propia `cantidad` y su `costo_unidad` exacto (`costo_medio: false`), **del lote más antiguo al más nuevo** (el mismo orden FIFO de la cartera). Las unidades que el bot no sabe cuánto costaron van en otro elemento sin claves de costo.

| Caso | Cómo lo envía el bot | Qué hace la app |
|---|---|---|
| **Lote fundido** (el bot guarda hasta 8 precios por furni; al pasarse, junta sus dos lotes más antiguos) | Ese elemento lleva el costo promedio de ambos y `costo_medio: true`; los demás, `false` | Una línea por tramo: el aviso «El precio es un promedio calculado (FIFO)» sale **solo** en la línea del fundido. Registrado con el costo que propone la caja (al céntimo), se descuenta de ese tramo |
| **LTD repartidos en varios precios** | Todos los números en el `ltds` del **primer** elemento; los demás, sin `ltds` | La base une los números de todos los elementos del furni. Como el bot no dice qué número es de qué lote, cada línea de tramo ofrece los números que faltan y el usuario elige cuál registra a ese precio |

```json
[
  { "sprite_id": 4623, "tipo": "suelo", "cantidad": 2, "costo_unidad": 1500, "unidades_con_costo": 2, "costo_medio": false },
  { "sprite_id": 4623, "tipo": "suelo", "cantidad": 3, "costo_unidad": 1800, "unidades_con_costo": 3, "costo_medio": false },
  { "sprite_id": 4623, "tipo": "suelo", "cantidad": 1 }
]
```

La base suma la cantidad del furni (6) para la comparación y guarda cada costo distinto como un **tramo** (dos elementos con el mismo costo son un solo tramo). En la bandeja, cada tramo es una línea con su propia entrada a su costo exacto; cada lote que la app ya tiene en ese keko se descuenta del tramo con su mismo costo, y lo demás, de los tramos más antiguos. También guarda el resumen de la 1.3.0 (unidades con costo sumadas, promedio ponderado y `costo_medio` si los costos no coinciden). Una base sin esta migración guarda solo ese resumen: los elementos separados entran igual, pero la bandeja propone su promedio.

**En vivo (requiere `20261011000000_inventario_en_vivo.sql`):** cada foto llega a la app al instante por Supabase Realtime; la app compara ese keko, pone al día su Auditoría y avisa solo de diferencias **nuevas**. Para el bot no cambia nada: la misma llamada, en los mismos momentos.

**Cuándo enviarlo:** por la **misma cola** que los eventos y **después** de los que estén pendientes. Así una compra que aún no llegó a la app no aparece como sobrante falso. Cada envío **reemplaza** la foto anterior de ese keko (idempotente: reenviar no duplica nada).

| Momento | Por qué |
|---|---|
| Al completar cada carga del inventario (último fragmento de `In.FurniList`) | Es la foto completa del keko |
| **Tras cambios sueltos del inventario** (un tradeo, un regalo: `FurniListAddOrUpdate` / `FurniListRemove`), con **30 s de calma** (cada cambio reinicia la espera) y **como máximo una foto cada 2 min** por keko | Sin esto, un tradeo en el juego no llegaba a la app hasta la siguiente carga completa. La espera junta varios cambios seguidos (un tradeo de varios furnis, colocar furnis en una sala) en un solo envío. SniperMercadillo lo hace desde el parche posterior a la 1.5.1 |
| **Tras cada tanda de eventos aceptada** (recomendado) | La app compara **en vivo** contra la **última** foto. Si solo se envía al cargar el inventario, cada compra, publicación o recuperación registrada después aparece como diferencia (faltante o sobrante) hasta la carga siguiente. Reenviarla, sacada del inventario que el bot mantiene al día, lo evita |

Nunca envíes una foto a medias (una carga de varios fragmentos sin terminar, o lo que quedó en memoria de otra cuenta tras reconectar): la app leería lo que no viene como furnis que faltan. SniperMercadillo lo hace así desde su Fase 27.66.

**Respuesta (200):**

```json
{ "keko": "NombreDelKeko", "recibidos": 3, "furnis": 3, "unidades": 21, "con_costo": 2, "errores": [],
  "resumen": { "coinciden": 2, "sobrantes": 1, "faltantes": 0, "ltd": 0, "no_registrados": 0, "sin_keko": 0, "excluidos": 0 } }
```

Los elementos inválidos (sin `sprite_id` ni `nombre` conocido, cantidad no válida) van a `errores` con su `indice` sin frenar el resto. El `resumen` sirve para el log del bot (p. ej. «3 diferencias»). Errores: 401 token inválido o revocado; 400 falta `keko`, hotel no admitido o `inventario` no es una lista; 404 (`PGRST202`) falta ejecutar la migración **en el proyecto al que apunta el bot** (si la app no avisa en ámbar, el bot usa otro proyecto: ver la tabla de la sección 3).

---

## 6. Ventas (requiere `20261015000000_ventas_sniper.sql`)

El Sniper lee la pestaña «vendido» de «Mis ventas» (`GetMarketplaceOwnOffers {i:2}`): un registro por unidad vendida. Envía cada venta como un evento `venta` dentro de `eventos`, en el mismo `registrar_eventos_sniper`, por la misma cola que los demás y **detrás** de los que estén pendientes (así una venta nunca llega antes que su `publicar`).

```json
{
  "tipo_evento": "venta",
  "id_externo": "ven_174670943",
  "oferta_id": null,
  "hotel": "es",
  "keko": "Ux_Data",
  "sprite_id": 4623,
  "tipo": "suelo",
  "precio": 128,
  "numero_ltd": null,
  "fecha": 1790792395000
}
```

| Campo | Obligatorio | Qué es |
|---|---|---|
| `id_externo` | Sí | `ven_{id de venta}`: el primer entero del registro, sin el signo. Es estable entre lecturas, cobros y sesiones, así que la misma venta da siempre el mismo id y un reenvío vuelve en `duplicados` |
| `keko` | Sí | La cuenta de Habbo de la venta (hasta 60 caracteres). Si no coincide con el keko que conoce el token, manda este |
| `sprite_id` | Sí | El furni |
| `tipo` | No | `suelo` o `pared` (también `floor`/`wall`), según el `itemType`: 1 y 4 son suelo, 2 es pared. Un LTD (3) no lo dice: el bot lo saca del furnidata y, si no puede, manda `null`. Con `null`, la base usa el único furni con ese sprite o, si hay dos, el único con algo publicado en ese keko |
| `precio` | Sí | El precio de lista en créditos (entero mayor que 0): lo que pagó el comprador. **No el neto**: la base resta la comisión (128 → 125 netos + 3; 210 → 205 + 5) |
| `fecha` | Sí | Cuándo se vendió: milisegundos Unix UTC (13 cifras, tal como llega en el registro) o texto ISO 8601. **Nunca segundos**: un número se lee como milisegundos y una fecha anterior a 2020 se rechaza. Una fecha en el futuro se toma como «ahora» |
| `numero_ltd` | Solo en un LTD | El número de serie (el registro tipo 3 trae `{i:número}{i:tirada}`) |
| `oferta_id` | No | Informativo: la base no lo usa |
| `cantidad` | No se envía | Una venta es una sola unidad (otro valor va a `errores`) |

### Con qué lote se casa

| Regla | Detalle |
|---|---|
| Dónde | Lotes `publicado` de ese furni en **ese keko** (sin distinguir mayúsculas) o **sin keko**. Nunca de otro keko |
| Cuándo | Solo lotes publicados **antes de la venta**, con 2 min de margen por la diferencia de relojes. Lo publicado sin fecha (lo del Excel) también cuenta. Por eso `publicar` lleva su `fecha` (la confirmación de Habbo): sin ella, la hora de publicación sería la de llegada del evento, y una cola atrasada dejaría la venta «antes» de su propia publicación |
| Orden | 1) el mismo `numero_ltd`; 2) el keko antes que lo sin keko; 3) un lote sin número antes que uno con número (si la venta trae número, un lote con **otro** número nunca se toca); 4) el mismo precio de lista; 5) lo publicado hace más tiempo |
| Qué hace | Una unidad pasa a `vendido` (si el lote tiene más, se divide) con el neto, la comisión, el día de la venta (UTC) y la marca de que la registró el Sniper. La unidad vendida se queda con el `numero_ltd` de la venta y, si el lote no tenía keko, con el de la venta |

### Ventas «por asignar»

Si no hay un lote con el que casar, la venta **no se rechaza**: el bot la marca como vista y Habbo la borra, así que rechazarla la perdería. Queda guardada «por asignar»: la app la muestra en una bandeja para aplicarla a un lote o descartarla, y se aplica sola si después llega el `publicar` que faltaba (con una hora anterior a la venta).

| `causa` | Cuándo |
|---|---|
| `sin_furni` | La app no tiene ese furni |
| `sin_lote` | No hay unidades publicadas de ese furni en ese keko ni sin keko |
| `despues` | Lo publicado de ese furni es posterior a la venta |
| `ltd` | Solo hay LTD publicados con otro número |
| `espacio` | Sin `tipo`, y hay dos furnis (suelo y pared) con ese sprite y algo publicado |

### Respuesta

Cada venta casada, en `eventos`:

```json
{ "indice": 0, "id_externo": "ven_174670943", "tipo_evento": "venta", "por_asignar": false,
  "furni_id": 12, "nombre": "Corona Estrella", "keko": "Ux_Data",
  "lote_id": 58, "lote_vendido_id": 91, "dividida": true,
  "precio": 128, "comision": 3, "neto": 125, "precio_lista": 128, "mismo_precio": true,
  "numero_ltd": null, "ganancia_cr": 10 }
```

- `ganancia_cr`: el neto menos el costo de la unidad en créditos (`null` si el lote no tiene costo). Sirve para el log o para Discord.
- `mismo_precio: false`: se vendió a un precio distinto al de lista del lote. Se vende igual, al precio real.

Una venta por asignar cuenta como **procesada** (se quita de la cola), y el total del envío trae `por_asignar` con cuántas hubo:

```json
{ "indice": 1, "id_externo": "ven_174670944", "tipo_evento": "venta", "por_asignar": true,
  "causa": "despues", "motivo": "Lo publicado de Corona Estrella en Ux_Data se publicó después de la venta.",
  "venta_por_asignar_id": 7, "furni_id": 12, "keko": "Ux_Data",
  "precio": 128, "comision": 3, "neto": 125, "numero_ltd": null }
```

A `errores`, sin registrarse, solo va lo mal formado: sin `keko`, `sprite_id`, `precio` o `fecha`; una fecha en segundos o ilegible; un `tipo` desconocido; `cantidad` distinta de 1; otro hotel.

**Cuándo empezar a enviarlas:** cuando el dueño confirme que corrió esta migración en su Supabase. Antes, la base las rechaza (`tipo_evento no valido`) y no quedan registradas.
