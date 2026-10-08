-- scripts/limpiar-fantasmas/1-revisar.sql — PASO 1: ver que lotes fantasma se borrarian. NO CAMBIA NADA.
--
-- Para que sirve: antes de la 1.10.0, lo que caducaba en el Mercadillo volvia a la mano, la Auditoria
-- lo daba como sobrante y se registraba con «Entrada con costo» (y a veces se volvia a publicar). El
-- lote viejo se quedo en Publicado, caducado: un fantasma que cuenta dos veces el mismo furni.
--
-- Como decide (lo mismo que «Retirar» + «Comparar de nuevo» + «Borrar» a mano, en todos los kekos):
--   - Solo lo publicado hace 168 h o mas, en un keko cuyo Sniper envio su inventario hace menos de
--     60 min, y que caduco al menos 15 min ANTES de ese inventario (lo que caduco despues puede
--     seguir en la pestana «Expirado» de Habbo).
--   - Sin numero LTD: es fantasma si el inventario de Habbo NO tiene en la mano mas unidades de ese
--     furni que la app (si las tuviera, seria lo caducado que volvio, y la app lo devuelve sola).
--   - Con numero LTD: es fantasma si la app ya tiene otra copia con ese numero que no esta caducada.
--   - Nunca toca lo vigente, lo sin keko, los kekos sin inventario (manuales) ni nada en mano o vendido.
--
-- ANTES de correrlo: en Habbo, recoge todo lo de la pestana «Expirado» de cada keko y espera unos
-- 3 minutos con el Sniper conectado (asi su inventario ya incluye lo que recogiste).
--
-- Uso: copia TODO este archivo en el SQL Editor de Supabase y pulsa Run. Muestra una fila por furni
-- y keko: BORRAR (lo que hara el paso 2) o NO SE TOCA (con el motivo). La primera fila es el total.
-- Despues: 2-limpiar.sql (borra lo marcado BORRAR, con copia) y, si hiciera falta, 3-deshacer.sql.

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

select accion, keko, inventario, furni, caducadas, borrar, motivo, lotes
  from (
    select 0 as orden, 'TOTAL' as accion, null::text as keko, null::text as inventario,
           format('Se borrarán %s unidades fantasma (%s lotes)',
                  coalesce(sum(p.borrar), 0), coalesce(sum(cardinality(p.lotes)), 0)) as furni,
           coalesce(sum(p.caducadas), 0)::integer as caducadas, coalesce(sum(p.borrar), 0)::integer as borrar,
           format('%s filas para borrar y %s que no se tocan.',
                  count(*) filter (where p.accion = 'BORRAR'), count(*) filter (where p.accion <> 'BORRAR')) as motivo,
           null::bigint[] as lotes
      from fantasmas_plan p
    union all
    select 1, p.accion, coalesce(p.keko, '(sin keko)'),
           case when p.recibido_en is null then 'sin inventario'
                else format('hace %s min', floor(extract(epoch from now() - p.recibido_en) / 60)::integer) end,
           p.furni, p.caducadas, p.borrar, p.motivo, p.lotes
      from fantasmas_plan p
  ) t
 order by orden, accion, keko, furni;
