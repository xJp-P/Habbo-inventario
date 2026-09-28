# Integración SniperMercadillo → Habbo Inventario (Supabase)

Contrato del endpoint único que usan los SniperMercadillo (extensión de G-Earth en C#, corriendo en VPS) para enviar a **Habbo Inventario** sus compras, publicaciones en el mercadillo y recuperaciones. Implementado en `supabase/migrations/20260928000000_eventos_sniper.sql` y cubierto por `npm run verificar`.

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
    { "tipo_evento": "publicar",  "id_externo": "pub_1790571239704_4623_8841", "sprite_id": 4623, "cantidad": 1, "precio_lista": 125, "moneda": "creditos", "hotel": "es" },
    { "tipo_evento": "recuperar", "id_externo": "rec_1790571239962_4623_1203", "sprite_id": 4623, "cantidad": 1, "hotel": "es" }
  ]
}
```

- Máximo **200 eventos** por envío. Se procesan en el orden de la lista.
- `token_sniper`: uno por VPS, creado en la app (Ajustes → Conexión con SniperMercadillo). Revocable individualmente.

### Campos de cada evento

| Campo | compra | publicar | recuperar | Detalle |
|---|---|---|---|---|
| `tipo_evento` | ✔ | ✔ | ✔ | `compra`, `publicar` o `recuperar` |
| `id_externo` | ✔ | ✔ | ✔ | Único por usuario. Un reintento con el mismo id se ignora en silencio (cuenta en `duplicados`) |
| `sprite_id` | ✔ | ✔ | ✔ | Id numérico del furni en el furnidata de Habbo.es |
| `tipo` | opc. | opc. | opc. | `suelo` (por defecto) o `pared`: sus sprite_id son numeraciones distintas |
| `hotel` | ✔ | ✔ | ✔ | `es` (también `habbo.es`, `www.habbo.es`, `game-es.habbo.com`) |
| `cantidad` | opc. (1) | opc. (1) | opc. (1) | Unidades |
| `precio` | ✔ | | | Precio unitario pagado. Número JSON o texto (`"3"`, `"3.5"`, `"3,5"`) |
| `precio_lista` | | ✔ | | Precio unitario al que se publicó. Número JSON o texto, como `precio` |
| `moneda` | opc. | opc. | | `creditos` (por defecto) o `lingos` |
| `notas` | opc. | | | Texto libre; ahí van los costos en diamantes o puntos de un LTD |
| `numero_ltd` | opc. | | | Número de serie de un LTD: `45`, `"45"` o `"#45"`. Un LTD es una sola unidad: con número, `cantidad` debe ser 1 (si no, el evento va a `errores`) |
| `fecha` | opc. | | | ISO o milisegundos; por defecto hoy |
| `instancia` | opc. | | | Si falta, se usa el nombre del token |
| `classname`, `nombre`, `revision` | opc. | | | Si el bot los tiene, el furni nuevo nace con su nombre oficial |

---

## 2. Qué hace cada evento

| Evento | Efecto en el Inventario |
|---|---|
| **compra** | Crea un lote `comprado` y **huérfano** ("Por revisar"): cuenta en el stock, pero no está en venta hasta que el usuario le confirma un precio en la app. Si el sprite no existía, crea un furni provisional que la app nombra con el catálogo oficial |
| **publicar** | Toma unidades de los lotes `comprado` (también los "por revisar") en orden **FIFO**: del más antiguo al más nuevo (los importados del Excel, sin fecha, primero). Un lote que entra entero pasa a `publicado`; si entra una parte, se divide y nace un lote `publicado` con ese pedazo. Guarda `precio_lista` |
| **recuperar** | Toma unidades de los lotes `publicado` en orden FIFO (lo publicado hace más tiempo primero) y las devuelve a `comprado`, limpiando el precio de lista. Primero lo que publicó el Sniper; solo después lo que el usuario publicó a mano en la app. Si su lote de origen sigue `comprado` al mismo costo, se reúnen con él |

- Si no alcanza el stock, se aplica lo que haya y la respuesta trae `faltante`.
- Si no hay **nada** que aplicar (p. ej. publicar un sprite sin stock), el evento va a `errores` y **no queda registrado**: el bot puede reintentarlo más tarde con el mismo `id_externo`.
- Los lotes `publicado` llevan candado en la app: el usuario no los edita ni los borra; solo registra su venta cuando se venden (a su precio de lista por defecto). La venta guarda el neto que entró al monedero (precio − comisión del mercadillo).

---

## 3. Respuesta

HTTP 200:

```json
{
  "recibidos": 3, "procesados": 3, "duplicados": 0, "errores": [],
  "eventos": [
    { "indice": 0, "id_externo": "123456789", "tipo_evento": "compra", "compra_id": 57, "furni_id": 12, "cantidad": 1, "pendiente": true },
    { "indice": 1, "id_externo": "pub_…", "tipo_evento": "publicar", "cantidad": 1, "faltante": 0, "precio_lista": 125, "moneda": "creditos", "lotes": [ { "lote_id": 58, "origen_id": 57, "cantidad": 1, "dividido": true } ] },
    { "indice": 2, "id_externo": "rec_…", "tipo_evento": "recuperar", "cantidad": 1, "faltante": 0, "lotes": [ { "desde_lote": 58, "hacia_lote": 57, "cantidad": 1 } ] }
  ]
}
```

| HTTP | Significado | Qué debe hacer el bot |
|---|---|---|
| 200 | Envío procesado | Quitar de su cola lo `procesado` y lo `duplicado`. Los `errores` traen `indice`, `id_externo` y el motivo. Cada `publicar` devuelve el `precio_lista` que quedó guardado (sirve para el log del bot) |
| 401 | Token inválido o revocado | Dejar de enviar y avisar (reintentar no sirve) |
| 400 | Envío mal formado (lista vacía o más de 200) | Error de programación: log |
| 404 (`PGRST202`) | La función no existe | Falta ejecutar la migración en Supabase |
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
