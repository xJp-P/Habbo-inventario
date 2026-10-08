-- scripts/limpiar-fantasmas/2-limpiar.sql — PASO 2: borra los lotes fantasma que 1-revisar.sql marca BORRAR.
--
-- Hace exactamente lo que mostro el paso 1 (el bloque PLAN es el mismo), en una sola transaccion:
-- o se borra todo lo marcado, o nada. Borra los lotes publicados y caducados que son fantasma, sin
-- registrar venta ni perdida (como «Borrar» en la Auditoria): la ganancia realizada y el Historial no
-- cambian; lo publicado y la ganancia esperada bajan a lo real.
--
-- Copia de seguridad: antes de borrar, guarda cada lote tal cual en respaldo.fantasmas (un esquema
-- aparte que la app y la clave publica no ven). 3-deshacer.sql los devuelve si hiciera falta.
--
-- Uso: corre ANTES 1-revisar.sql y revisa su lista. Luego copia TODO este archivo en el SQL Editor de
-- Supabase y pulsa Run (Supabase avisa que es una operacion destructiva: confirma). Muestra lo que
-- borro. Correrlo otra vez no borra nada mas si no hay fantasmas nuevos.

-- >>> PLAN (este bloque es identico en 1-revisar.sql y 2-limpiar.sql: npm run verificar lo comprueba)
create or replace temporary view fantasmas_plan as
with reglas as (
  select interval '60 minutes' as inventario_max, interval '15 minutes' as margen
),
fotos as (
  select i.propietario, i.keko, i.recibido_en, i.furnis, i.recibido_en >= now() - r.inventario_max as reciente
    from public.inventario_habbo i
   cross join reglas r
),
habbo as (
  select fo.propietario, fo.keko, (x->>'sprite_id')::integer as sprite_id, x->>'tipo' as tipo,
         coalesce((x->>'cantidad')::integer, 0) as cantidad,
         coalesce((select array_agg(v::integer) from jsonb_array_elements_text(coalesce(x->'ltds', '[]'::jsonb)) v),
                  '{}'::integer[]) as ltds
    from fotos fo
   cross join lateral jsonb_array_elements(fo.furnis) x
),
mano as (
  select c.propietario, c.keko, f.sprite_id, f.tipo,
         coalesce(sum(c.cantidad) filter (where c.numero_ltd is null), 0)::integer as sin_numero,
         coalesce(array_agg(c.numero_ltd) filter (where c.numero_ltd is not null), '{}'::integer[]) as ltds
    from public.compras c
    join public.furnis f on f.id = c.furni_id and f.propietario = c.propietario
   where c.estado = 'comprado' and c.keko is not null and f.sprite_id is not null
   group by c.propietario, c.keko, f.sprite_id, f.tipo
),
caducadas as (
  select c.id, c.propietario, c.keko, c.furni_id, c.cantidad, c.numero_ltd, f.sprite_id, f.tipo, f.nombre,
         fo.recibido_en, coalesce(fo.reciente, false) as reciente, fo.keko is not null as con_inventario,
         fo.keko is not null
           and (c.publicado_en is null
                or c.publicado_en + public.caducidad_mercadillo() <= fo.recibido_en - r.margen) as antes_del_inventario
    from public.compras c
    join public.furnis f on f.id = c.furni_id and f.propietario = c.propietario
   cross join reglas r
    left join fotos fo on fo.propietario = c.propietario and fo.keko = c.keko
   where c.estado = 'publicado' and public.oferta_caducada(c.publicado_en)
),
grupos as (
  select k.propietario, k.keko, k.sprite_id, k.tipo, null::integer as numero_ltd, min(k.nombre) as nombre,
         bool_or(k.con_inventario) as con_inventario, bool_or(k.reciente) as reciente, max(k.recibido_en) as recibido_en,
         sum(k.cantidad)::integer as caducadas,
         coalesce(sum(k.cantidad) filter (where k.antes_del_inventario), 0)::integer as comprobables,
         coalesce(array_agg(k.id order by k.id) filter (where k.antes_del_inventario), '{}'::bigint[]) as lotes,
         false as repetido
    from caducadas k
   where k.numero_ltd is null
   group by k.propietario, k.keko, k.sprite_id, k.tipo, case when k.sprite_id is null then k.furni_id end
  union all
  select k.propietario, k.keko, k.sprite_id, k.tipo, k.numero_ltd, k.nombre,
         k.con_inventario, k.reciente, k.recibido_en, k.cantidad,
         case when k.antes_del_inventario then k.cantidad else 0 end,
         case when k.antes_del_inventario then array[k.id] else '{}'::bigint[] end,
         exists (select 1
                   from public.compras o
                   join public.furnis f2 on f2.id = o.furni_id and f2.propietario = o.propietario
                  where o.propietario = k.propietario and o.id <> k.id and o.numero_ltd = k.numero_ltd
                    and (o.furni_id = k.furni_id or (k.sprite_id is not null and f2.sprite_id = k.sprite_id and f2.tipo = k.tipo))
                    and not (o.estado = 'publicado' and public.oferta_caducada(o.publicado_en)))
    from caducadas k
   where k.numero_ltd is not null
),
cuentas as (
  select g.*,
         greatest(coalesce(h.cantidad - cardinality(h.ltds), 0), 0) as habbo_sin_numero,
         coalesce(m.sin_numero, 0) as app_sin_numero,
         coalesce(g.numero_ltd = any(h.ltds), false) as ltd_en_habbo,
         coalesce(g.numero_ltd = any(m.ltds), false) as ltd_en_app
    from grupos g
    left join habbo h on h.propietario = g.propietario and h.keko = g.keko and h.sprite_id = g.sprite_id and h.tipo = g.tipo
    left join mano m on m.propietario = g.propietario and m.keko = g.keko and m.sprite_id = g.sprite_id and m.tipo = g.tipo
),
decision as (
  select c.*,
         case
           when c.keko is null then
             'Sin keko: no hay un inventario de Habbo con qué comprobarlo.'
           when not c.con_inventario then
             'Este keko no envía su inventario (keko manual o sin Sniper): no se puede comprobar.'
           when c.sprite_id is null then
             'Este furni no tiene sprite: no se puede buscar en el inventario de Habbo.'
           when not c.reciente then
             format('El inventario de este keko es de hace %s min. Mueve un furni en Habbo (o reconecta el Sniper) para que envíe uno nuevo y vuelve a revisar.',
                    floor(extract(epoch from now() - c.recibido_en) / 60)::integer)
           when c.comprobables = 0 then
             'Caducó después del último inventario: puede seguir en «Expirado». Recógelo, espera el inventario nuevo y vuelve a revisar.'
           when c.numero_ltd is null and c.habbo_sin_numero > c.app_sin_numero then
             format('En Habbo tienes %s más en la mano que en la app: el próximo inventario lo devuelve solo a Comprado.',
                    c.habbo_sin_numero - c.app_sin_numero)
           when c.numero_ltd is not null and c.ltd_en_habbo and not c.ltd_en_app then
             'Este LTD está en tu mano en Habbo: el próximo inventario lo devuelve solo a Comprado.'
           when c.numero_ltd is not null and not c.repetido then
             'No hay otra copia de este LTD en la app: revísalo a mano.'
         end as no_se_toca
    from cuentas c
)
select d.propietario, d.keko, d.recibido_en, d.numero_ltd,
       case when d.no_se_toca is null then 'BORRAR' else 'NO SE TOCA' end as accion,
       d.nombre || coalesce(' #' || d.numero_ltd, '') as furni,
       d.caducadas,
       case when d.no_se_toca is null then d.comprobables else 0 end as borrar,
       coalesce(d.no_se_toca,
                case when d.numero_ltd is null
                     then format('Fantasma: Habbo tiene %s en la mano y la app ya cuenta %s; esta oferta caducada no está en ningún lado.',
                                 d.habbo_sin_numero, d.app_sin_numero)
                     else format('Fantasma: el LTD #%s está repetido y la otra copia es la buena.', d.numero_ltd)
                end
                || case when d.caducadas > d.comprobables
                        then format(' Otras %s caducaron después del inventario: no se tocan.', d.caducadas - d.comprobables)
                        else '' end) as motivo,
       case when d.no_se_toca is null then d.lotes else '{}'::bigint[] end as lotes
  from decision d;
-- <<< PLAN

create schema if not exists respaldo;
revoke all on schema respaldo from public;
create table if not exists respaldo.fantasmas (
  id            bigint generated always as identity primary key,
  propietario   uuid not null,
  borrado_en    timestamptz not null default now(),
  restaurado_en timestamptz,
  lote          jsonb not null
);
revoke all on table respaldo.fantasmas from public;
alter table respaldo.fantasmas enable row level security;

-- Una sola sentencia: el plan se calcula una vez, se borra solo lo marcado BORRAR (y solo si sigue
-- publicado y caducado) y cada lote borrado queda copiado en respaldo.fantasmas.
with marcados as (
  select unnest(p.lotes) as id from fantasmas_plan p where p.accion = 'BORRAR'
),
borrados as (
  delete from public.compras c
   using marcados m
   where c.id = m.id and c.estado = 'publicado' and public.oferta_caducada(c.publicado_en)
  returning c.*
)
insert into respaldo.fantasmas (propietario, lote)
select b.propietario, to_jsonb(b) from borrados b;

select accion, keko, furni, unidades, lote, publicado_por, publicado_en
  from (
    select 0 as orden, 'TOTAL' as accion, null::text as keko,
           format('Se borraron %s unidades fantasma (%s lotes). Copia en respaldo.fantasmas.',
                  coalesce(sum((r.lote->>'cantidad')::integer), 0), count(*)) as furni,
           coalesce(sum((r.lote->>'cantidad')::integer), 0)::integer as unidades,
           null::bigint as lote, null::text as publicado_por, null::text as publicado_en
      from respaldo.fantasmas r
     where r.borrado_en = now()
    union all
    select 1, 'BORRADO', r.lote->>'keko',
           coalesce(f.nombre, 'furni ' || (r.lote->>'furni_id')) || coalesce(' #' || (r.lote->>'numero_ltd'), ''),
           (r.lote->>'cantidad')::integer, (r.lote->>'id')::bigint,
           coalesce(r.lote->>'publicado_por', 'sniper'),
           coalesce(to_char((r.lote->>'publicado_en')::timestamptz, 'YYYY-MM-DD HH24:MI'), 'sin fecha')
      from respaldo.fantasmas r
      left join public.furnis f on f.id = (r.lote->>'furni_id')::bigint
     where r.borrado_en = now()
  ) t
 order by orden, keko, furni, lote;
