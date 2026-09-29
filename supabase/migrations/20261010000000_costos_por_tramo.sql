-- =============================================================================
-- Habbo Inventario — Costos por tramo en la auditoria (v1.4.0)
-- Requiere 20261009000000_costos_auditoria (y las anteriores).
--
-- Hasta la 20261009000000, si el Sniper tenia el mismo furni comprado a precios distintos,
-- la foto guardaba un solo costo: el promedio. Ahora el Sniper manda un elemento por cada
-- lote de su cartera (mismo sprite_id, cada uno con su cantidad y su costo) y la base
-- guarda cada costo como un TRAMO aparte, para registrar cada entrada con su costo exacto:
--   1. _tramos_foto(elemento): los tramos de un furni de la foto. Una foto guardada antes
--      de esta migracion trae solo el resumen: vale como un unico tramo.
--   2. auditar_inventario guarda, ademas del resumen de la 20261009000000 (que sigue
--      leyendo la app 1.3.0), la lista `costos` de cada furni: [{ costo_unidad, unidades,
--      costo_medio }], en el orden en que llegaron (del lote mas antiguo al mas nuevo).
--   3. _comparar_inventario devuelve en cada fila esos tramos (`costos`) y lo que costo lo
--      que la app ya tiene en ese keko (`costos_app`) y sin keko (`costos_sin_keko`): la
--      bandeja descuenta cada lote de la app del tramo con su mismo costo y propone el
--      resto, una linea por tramo.
-- =============================================================================

-- ─── 0. Comprobación: 20261009000000 ya está aplicada ───────────────────────

do $$
begin
  if to_regprocedure('public._costo_auditoria(jsonb, integer)') is null then
    raise exception 'Falta ejecutar antes 20261009000000_costos_auditoria.sql (y las anteriores, en orden).';
  end if;
end;
$$;

-- ─── 1. Los tramos de costo de un furni de la foto ───────────────────────────
-- [{ costo_unidad, unidades, costo_medio }] o [] si el Sniper no conoce su costo.

create or replace function public._tramos_foto(x jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(x->'costos') = 'array' then x->'costos'
    when x ? 'costo_unidad' and x ? 'unidades_con_costo' then jsonb_build_array(jsonb_build_object(
      'costo_unidad', x->'costo_unidad', 'unidades', x->'unidades_con_costo',
      'costo_medio', coalesce(x->'costo_medio', 'false'::jsonb)))
    else '[]'::jsonb end;
$$;

-- ─── 2. Recibir el inventario, con un tramo por costo ────────────────────────
-- Igual que en 20261009000000, mas la lista `costos` de cada furni.

create or replace function public.auditar_inventario(token_sniper text, keko text, hotel text, inventario jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tokens_sniper%rowtype;
  v_keko text := nullif(trim(coalesce(keko, '')), '');
  v_furnis jsonb;
  v_errores jsonb;
  v_unidades integer;
  v_con_costo integer;
  v_comparacion jsonb;
begin
  t := public._token_sniper_valido(token_sniper);
  if lower(trim(coalesce(hotel, ''))) not in ('es', 'habbo.es', 'www.habbo.es', 'game-es.habbo.com') then
    raise exception using errcode = 'PT400',
      message = format('Hotel "%s" no admitido. Solo se acepta el inventario de Habbo.es (Habbo Origins y otros hoteles quedan fuera).', coalesce(hotel, ''));
  end if;
  if v_keko is null or length(v_keko) > 60 then
    raise exception using errcode = 'PT400', message = 'Falta "keko": el nombre del keko de este inventario (hasta 60 caracteres).';
  end if;
  if inventario is null or jsonb_typeof(inventario) <> 'array' then
    raise exception using errcode = 'PT400', message = '"inventario" debe ser una lista (puede estar vacia).';
  end if;
  if jsonb_array_length(inventario) > 50000 then
    raise exception using errcode = 'PT400', message = 'Maximo 50000 elementos por inventario.';
  end if;

  with elementos as (
    select a.ord - 1 as indice, case when jsonb_typeof(a.x) = 'object' then a.x end as o
      from jsonb_array_elements(inventario) with ordinality as a(x, ord)
  ),
  leidos as (
    select indice, o,
           case when (o->>'sprite_id') ~ '^\s*[0-9]{1,9}\s*$' then trim(o->>'sprite_id')::integer end as sprite_id,
           case when lower(coalesce(o->>'tipo', '')) in ('pared', 'wall', 'i') then 'pared' else 'suelo' end as tipo,
           nullif(trim(coalesce(o->>'nombre', '')), '') as nombre,
           case when coalesce(o->>'cantidad', '') = '' then 1
                when (o->>'cantidad') ~ '^\s*[0-9]{1,6}\s*$' then trim(o->>'cantidad')::integer end as cantidad
      from elementos
  ),
  resueltos as (
    select l.indice, l.o, l.nombre, l.cantidad,
           coalesce(l.sprite_id, f.sprite_id) as sprite_id,
           case when l.sprite_id is null and f.sprite_id is not null then f.tipo else l.tipo end as tipo
      from leidos l
      left join lateral (
        select sprite_id, tipo from public.furnis
         where propietario = t.propietario and l.sprite_id is null and l.nombre is not null
           and lower(nombre) = lower(l.nombre) and sprite_id is not null
         order by id limit 1) f on true
  ),
  validos as (
    select r.*, public._costo_auditoria(r.o, r.cantidad) as costo
      from resueltos r where r.o is not null and r.sprite_id is not null and coalesce(r.cantidad, 0) >= 1
  ),
  numeros as (
    select v.sprite_id, v.tipo, regexp_replace(trim(s.n), '^#', '')::integer as numero
      from validos v
      cross join lateral (
        select jsonb_array_elements_text(case when jsonb_typeof(v.o->'ltds') = 'array' then v.o->'ltds' else '[]'::jsonb end)
        union all
        select v.o->>'numero_ltd' where coalesce(v.o->>'numero_ltd', '') <> ''
      ) as s(n)
     where case when trim(s.n) ~ '^#?[0-9]{1,9}$' then regexp_replace(trim(s.n), '^#', '')::integer > 0 else false end
  ),
  -- Un tramo por cada costo distinto del mismo furni (el Sniper manda un elemento por
  -- lote de su cartera), en el orden en que llegaron: del lote mas antiguo al mas nuevo.
  -- Dos elementos con el mismo costo son un solo tramo.
  tramos as (
    select v.sprite_id, v.tipo, (v.costo->>'costo')::numeric as costo,
           sum((v.costo->>'unidades')::integer)::integer as unidades,
           bool_or((v.costo->>'medio')::boolean) as medio,
           min(v.indice) as orden
      from validos v where v.costo is not null
     group by v.sprite_id, v.tipo, (v.costo->>'costo')::numeric
  ),
  grupos as (
    select v.sprite_id, v.tipo, sum(v.cantidad)::integer as cantidad,
           coalesce((select jsonb_agg(distinct n.numero) from numeros n
                      where n.sprite_id = v.sprite_id and n.tipo = v.tipo), '[]'::jsonb) as ltds,
           -- Costo que conoce el Sniper (su cartera, FIFO). Resumen de todos sus tramos, para
           -- la app 1.3.0: se suman sus unidades con costo y el costo es su promedio
           -- ponderado, marcado como medio si alguno lo era o si los costos no coinciden.
           coalesce(sum((v.costo->>'unidades')::integer), 0)::integer as unidades_con_costo,
           sum((v.costo->>'costo')::numeric * (v.costo->>'unidades')::integer) as costo_total,
           coalesce(bool_or((v.costo->>'medio')::boolean), false)
             or count(distinct (v.costo->>'costo')::numeric) > 1 as costo_medio,
           -- Y cada tramo por separado, para registrar cada uno con su costo exacto.
           coalesce((select jsonb_agg(jsonb_build_object('costo_unidad', tr.costo, 'unidades', tr.unidades, 'costo_medio', tr.medio)
                                      order by tr.orden)
                       from tramos tr where tr.sprite_id = v.sprite_id and tr.tipo = v.tipo), '[]'::jsonb) as costos
      from validos v group by v.sprite_id, v.tipo
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object('sprite_id', sprite_id, 'tipo', tipo, 'cantidad', cantidad, 'ltds', ltds)
                               || case when unidades_con_costo > 0 then jsonb_build_object(
                                    'costo_unidad', round(costo_total / unidades_con_costo, 2),
                                    'unidades_con_costo', least(unidades_con_costo, cantidad),
                                    'costo_medio', costo_medio, 'costos', costos) else '{}'::jsonb end
                               order by tipo, sprite_id), '[]'::jsonb) from grupos),
    (select coalesce(sum(cantidad), 0)::integer from grupos),
    (select coalesce(jsonb_agg(jsonb_build_object('indice', indice, 'error',
              case when o is null then 'Cada elemento debe ser un objeto.'
                   when coalesce(cantidad, 0) < 1 then 'La cantidad debe ser un entero mayor o igual a 1.'
                   when nombre is not null then format('No hay un furni "%s" con sprite_id en la app: envia sprite_id.', nombre)
                   else 'Falta sprite_id (o el nombre de un furni de la app).' end) order by indice), '[]'::jsonb)
       from resueltos where not (o is not null and sprite_id is not null and coalesce(cantidad, 0) >= 1))
  into v_furnis, v_unidades, v_errores;
  select count(*) into v_con_costo from jsonb_array_elements(v_furnis) x where x ? 'costo_unidad';

  insert into public.inventario_habbo (propietario, keko, token_id, recibido_en, furnis)
  values (t.propietario, v_keko, t.id, now(), v_furnis)
  on conflict on constraint inventario_habbo_pkey do update
    set token_id = excluded.token_id, recibido_en = excluded.recibido_en, furnis = excluded.furnis;
  update public.tokens_sniper set ultimo_uso = now(), keko = v_keko where id = t.id;

  v_comparacion := public._comparar_inventario(t.propietario, v_keko);
  return jsonb_build_object(
    'keko', v_keko,
    'recibidos', jsonb_array_length(inventario),
    'furnis', jsonb_array_length(v_furnis),
    'unidades', v_unidades,
    'con_costo', v_con_costo,
    'errores', v_errores,
    'resumen', v_comparacion->'resumen');
end;
$$;

-- ─── 3. Comparar la foto con la app, con los tramos en cada fila ─────────────
-- Igual que en 20261009000000, mas `costos` (tramos del Sniper), `costos_app` y
-- `costos_sin_keko`.

create or replace function public._comparar_inventario(p_propietario uuid, p_keko text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.inventario_habbo%rowtype;
  v_res jsonb;
begin
  select * into v_inv from public.inventario_habbo i where i.propietario = p_propietario and i.keko = p_keko;
  if not found then return null; end if;

  with habbo as (
    select (x->>'sprite_id')::integer as sprite_id, x->>'tipo' as tipo, (x->>'cantidad')::integer as cantidad,
           coalesce((select array_agg(v::integer order by v::integer)
                       from jsonb_array_elements_text(coalesce(x->'ltds', '[]'::jsonb)) v), '{}'::integer[]) as ltds,
           (x->>'costo_unidad')::numeric as costo_unidad,
           (x->>'unidades_con_costo')::integer as unidades_con_costo,
           (x->>'costo_medio')::boolean as costo_medio,
           public._tramos_foto(x) as costos
      from jsonb_array_elements(v_inv.furnis) x
  ),
  lotes as (
    select f.sprite_id, f.tipo, c.id, c.keko, c.cantidad, c.numero_ltd, c.precio_compra, c.moneda_compra
      from public.compras c
      join public.furnis f on f.id = c.furni_id and f.propietario = c.propietario
     where c.propietario = p_propietario and c.estado = 'comprado' and f.sprite_id is not null
  ),
  app as (
    select sprite_id, tipo,
           coalesce(sum(cantidad) filter (where keko = p_keko), 0)::integer as en_keko,
           coalesce(sum(cantidad) filter (where keko is null), 0)::integer as sin_asignar
      from lotes group by sprite_id, tipo
  ),
  -- Lo que costo lo que la app ya tiene en este keko y lo que tiene sin keko (en creditos,
  -- por costo): la bandeja descuenta cada lote del tramo del Sniper con su mismo costo, que
  -- son esas unidades (las sin keko, las que ofrece «Son de este keko»).
  app_costos as (
    select sprite_id, tipo,
           jsonb_agg(jsonb_build_object('costo_unidad', precio, 'unidades', unidades) order by precio) filter (where en_keko) as costos,
           jsonb_agg(jsonb_build_object('costo_unidad', precio, 'unidades', unidades) order by precio) filter (where not en_keko) as sin_keko
      from (select sprite_id, tipo, keko is not null as en_keko, precio_compra as precio, sum(cantidad)::integer as unidades
              from lotes where (keko = p_keko or keko is null) and moneda_compra = 'creditos'
             group by sprite_id, tipo, keko is not null, precio_compra) x
     group by sprite_id, tipo
  ),
  ltd_app as (
    select sprite_id, tipo,
           jsonb_agg(jsonb_build_object('lote_id', id, 'numero_ltd', numero_ltd) order by numero_ltd) as lotes,
           array_agg(numero_ltd order by numero_ltd) as numeros
      from lotes where keko = p_keko and numero_ltd is not null group by sprite_id, tipo
  ),
  otros as (
    select sprite_id, tipo, jsonb_agg(jsonb_build_object('keko', keko, 'unidades', unidades) order by keko) as kekos
      from (select sprite_id, tipo, keko, sum(cantidad)::integer as unidades
              from lotes where keko is not null and keko <> p_keko group by sprite_id, tipo, keko) k
     group by sprite_id, tipo
  ),
  conocidos as (
    select distinct on (sprite_id, tipo) sprite_id, tipo, id as furni_id, nombre
      from public.furnis where propietario = p_propietario and sprite_id is not null
     order by sprite_id, tipo, id
  ),
  base as (
    select coalesce(h.sprite_id, a.sprite_id) as sprite_id, coalesce(h.tipo, a.tipo) as tipo,
           coalesce(h.cantidad, 0) as habbo, coalesce(h.ltds, '{}'::integer[]) as ltds_habbo,
           coalesce(a.en_keko, 0) as app, coalesce(a.sin_asignar, 0) as sin_asignar,
           h.costo_unidad, h.unidades_con_costo, h.costo_medio, coalesce(h.costos, '[]'::jsonb) as costos
      from habbo h full join app a on a.sprite_id = h.sprite_id and a.tipo = h.tipo
  ),
  cruce as (
    select b.*, k.furni_id, k.nombre, coalesce(o.kekos, '[]'::jsonb) as otros,
           coalesce(la.lotes, '[]'::jsonb) as lotes_ltd, coalesce(la.numeros, '{}'::integer[]) as ltds_app,
           coalesce(ac.costos, '[]'::jsonb) as costos_app, coalesce(ac.sin_keko, '[]'::jsonb) as costos_sin_keko,
           case when e.id is not null and e.habbo = b.habbo and e.app = b.app then least(e.unidades, b.habbo) else 0 end as excluidas,
           (e.id is not null and not (e.habbo = b.habbo and e.app = b.app)) as exclusion_vencida
      from base b
      left join conocidos k on k.sprite_id = b.sprite_id and k.tipo = b.tipo
      left join otros o on o.sprite_id = b.sprite_id and o.tipo = b.tipo
      left join ltd_app la on la.sprite_id = b.sprite_id and la.tipo = b.tipo
      left join app_costos ac on ac.sprite_id = b.sprite_id and ac.tipo = b.tipo
      left join public.exclusiones_auditoria e
        on e.propietario = p_propietario and e.keko = p_keko and e.sprite_id = b.sprite_id and e.tipo = b.tipo
  ),
  numeros as (
    select c.*, c.habbo - c.excluidas - c.app as diferencia,
           -- Numeros de la app que no estan en Habbo (solo si el sniper mando numeros, o si
           -- en Habbo no hay ninguna unidad) y numeros de Habbo que la app no tiene.
           case when cardinality(c.ltds_habbo) > 0 or c.habbo = 0 then
             coalesce(array(select n from unnest(c.ltds_app) n except select m from unnest(c.ltds_habbo) m order by 1), '{}'::integer[])
           else '{}'::integer[] end as ltds_faltantes,
           coalesce(array(select m from unnest(c.ltds_habbo) m except select n from unnest(c.ltds_app) n order by 1), '{}'::integer[]) as ltds_nuevos
      from cruce c
  ),
  resultado as (
    select n.*,
           case when n.diferencia > 0 and n.furni_id is null then 'no_registrado'
                when n.diferencia > 0 then 'sobrante'
                when n.diferencia < 0 then 'faltante'
                when cardinality(n.ltds_faltantes) > 0 and cardinality(n.ltds_nuevos) > 0 then 'ltd'
                -- Cuadra en este keko, pero la app tiene ademas unidades sin keko asignado
                -- que aqui no hacen falta: estan en otro keko o ya no existen.
                when n.sin_asignar > 0 then 'sin_keko'
                else 'coincide' end as categoria
      from numeros n
     where n.habbo > 0 or n.app > 0 or n.sin_asignar > 0
  )
  select jsonb_build_object(
    'filas', coalesce(jsonb_agg(jsonb_build_object(
        'sprite_id', sprite_id, 'tipo', tipo, 'furni_id', furni_id, 'nombre', nombre,
        'habbo', habbo, 'app', app, 'diferencia', diferencia, 'categoria', categoria,
        'sin_asignar', sin_asignar, 'otros', otros,
        'excluidas', excluidas, 'exclusion_vencida', exclusion_vencida,
        'ltds_habbo', to_jsonb(ltds_habbo), 'ltds_faltantes', to_jsonb(ltds_faltantes), 'ltds_nuevos', to_jsonb(ltds_nuevos),
        'lotes_ltd_faltantes', (select coalesce(jsonb_agg(el), '[]'::jsonb) from jsonb_array_elements(lotes_ltd) el
                                 where (el->>'numero_ltd')::integer = any(ltds_faltantes)),
        'costo_unidad', costo_unidad, 'unidades_con_costo', unidades_con_costo, 'costo_medio', costo_medio,
        'costos', costos, 'costos_app', costos_app, 'costos_sin_keko', costos_sin_keko)
      order by categoria, nombre nulls last, tipo, sprite_id) filter (where categoria <> 'coincide'), '[]'::jsonb),
    'excluidos', coalesce(jsonb_agg(jsonb_build_object('sprite_id', sprite_id, 'tipo', tipo, 'furni_id', furni_id,
        'nombre', nombre, 'unidades', excluidas) order by nombre nulls last, sprite_id) filter (where excluidas > 0), '[]'::jsonb),
    'resumen', jsonb_build_object(
      'coinciden', count(*) filter (where categoria = 'coincide' and excluidas = 0),
      'sobrantes', count(*) filter (where categoria = 'sobrante'),
      'faltantes', count(*) filter (where categoria = 'faltante'),
      'ltd', count(*) filter (where categoria = 'ltd'),
      'no_registrados', count(*) filter (where categoria = 'no_registrado'),
      'sin_keko', count(*) filter (where categoria = 'sin_keko'),
      'excluidos', count(*) filter (where excluidas > 0)))
  into v_res
  from resultado;

  return v_res || jsonb_build_object('keko', v_inv.keko, 'recibido_en', v_inv.recibido_en);
end;
$$;

-- ─── 4. Permisos ─────────────────────────────────────────────────────────────

revoke execute on function public._tramos_foto(jsonb) from public, anon, authenticated;
revoke execute on function public._comparar_inventario(uuid, text) from public, anon, authenticated;
revoke execute on function public.auditar_inventario(text, text, text, jsonb) from public;
grant execute on function public.auditar_inventario(text, text, text, jsonb) to anon, authenticated;
