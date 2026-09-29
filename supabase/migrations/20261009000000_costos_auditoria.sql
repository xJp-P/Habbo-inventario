-- =============================================================================
-- Habbo Inventario — Costos del Sniper en la auditoria (v1.3.0)
-- Requiere 20261008000000_kekos_manuales (y las anteriores).
--
-- El Sniper sabe lo que pago por lo que tiene en la mano (su cartera de lotes, FIFO) y lo
-- envia en la foto del inventario, por furni y solo cuando lo conoce:
--   costo_unidad        costo por unidad, en creditos (si hay varios lotes, el promedio)
--   unidades_con_costo  a cuantas unidades de esa cantidad corresponde ese costo
--   costo_medio         true si costo_unidad es un promedio de lotes a precios distintos
-- Un furni regalado o tradeado por fuera llega sin esas claves.
--
--   1. _costo_auditoria(elemento, cantidad): lee y valida el costo de un elemento. Un
--      costo mal formado se ignora (el elemento entra igual, sin costo): nunca se pierde
--      el inventario por un dato de costo.
--   2. auditar_inventario guarda el costo en la foto (inventario_habbo.furnis) y cuenta
--      cuantos furnis lo traen (con_costo).
--   3. _comparar_inventario lo devuelve en cada fila, para que la bandeja proponga el
--      costo al registrar la entrada de un sobrante o de un furni no registrado.
-- La foto guardada antes de esta migracion no trae costos: el siguiente envio del
-- Sniper los agrega.
-- =============================================================================

-- ─── 0. Comprobación: 20261008000000 ya está aplicada ───────────────────────

do $$
begin
  if to_regprocedure('public.listar_kekos()') is null then
    raise exception 'Falta ejecutar antes 20261008000000_kekos_manuales.sql (y las anteriores, en orden).';
  end if;
end;
$$;

-- ─── 1. El costo de un elemento ──────────────────────────────────────────────
-- { costo, unidades, medio } o null si no vino o no es valido. costo_unidad: numero o
-- texto ("25", "25.5", "25,5"), >= 0. unidades_con_costo: entero >= 1 (sin el, toda la
-- cantidad), nunca mas que la cantidad del elemento. costo_medio: booleano (por defecto
-- false).

create or replace function public._costo_auditoria(o jsonb, p_cantidad integer)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_texto text;
  v_costo numeric;
  v_unidades integer;
  v_medio boolean;
begin
  if o is null or jsonb_typeof(o) <> 'object' or not (o ? 'costo_unidad') or coalesce(p_cantidad, 0) < 1 then
    return null;
  end if;
  v_texto := replace(trim(coalesce(o->>'costo_unidad', '')), ',', '.');
  if v_texto !~ '^[0-9]{1,9}(\.[0-9]{1,6})?$' then return null; end if;
  v_costo := v_texto::numeric;

  if o ? 'unidades_con_costo' then
    if coalesce(o->>'unidades_con_costo', '') !~ '^\s*[0-9]{1,6}\s*$' then return null; end if;
    v_unidades := trim(o->>'unidades_con_costo')::integer;
  else
    v_unidades := p_cantidad;
  end if;
  v_unidades := least(v_unidades, p_cantidad);
  if v_unidades < 1 then return null; end if;

  v_medio := case
    when jsonb_typeof(o->'costo_medio') = 'boolean' then (o->>'costo_medio')::boolean
    else lower(coalesce(o->>'costo_medio', '')) in ('true', '1', 'si', 'sí') end;
  return jsonb_build_object('costo', v_costo, 'unidades', v_unidades, 'medio', v_medio);
end;
$$;

-- ─── 2. Recibir el inventario, ahora con costos ──────────────────────────────
-- Igual que en 20261007000000, mas el costo de cada furni.

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
  grupos as (
    select v.sprite_id, v.tipo, sum(v.cantidad)::integer as cantidad,
           coalesce((select jsonb_agg(distinct n.numero) from numeros n
                      where n.sprite_id = v.sprite_id and n.tipo = v.tipo), '[]'::jsonb) as ltds,
           -- Costo que conoce el Sniper (su cartera, FIFO). Varios elementos del mismo furni
           -- (uno por unidad): se suman sus unidades con costo y el costo es su promedio
           -- ponderado, marcado como medio si alguno lo era o si los costos no coinciden.
           coalesce(sum((v.costo->>'unidades')::integer), 0)::integer as unidades_con_costo,
           sum((v.costo->>'costo')::numeric * (v.costo->>'unidades')::integer) as costo_total,
           coalesce(bool_or((v.costo->>'medio')::boolean), false)
             or count(distinct (v.costo->>'costo')::numeric) > 1 as costo_medio
      from validos v group by v.sprite_id, v.tipo
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object('sprite_id', sprite_id, 'tipo', tipo, 'cantidad', cantidad, 'ltds', ltds)
                               || case when unidades_con_costo > 0 then jsonb_build_object(
                                    'costo_unidad', round(costo_total / unidades_con_costo, 2),
                                    'unidades_con_costo', least(unidades_con_costo, cantidad),
                                    'costo_medio', costo_medio) else '{}'::jsonb end
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

-- ─── 3. Comparar la foto con la app, con el costo en cada fila ───────────────
-- Igual que en 20261007000000, mas costo_unidad, unidades_con_costo y costo_medio.

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
           (x->>'costo_medio')::boolean as costo_medio
      from jsonb_array_elements(v_inv.furnis) x
  ),
  lotes as (
    select f.sprite_id, f.tipo, c.id, c.keko, c.cantidad, c.numero_ltd
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
           h.costo_unidad, h.unidades_con_costo, h.costo_medio
      from habbo h full join app a on a.sprite_id = h.sprite_id and a.tipo = h.tipo
  ),
  cruce as (
    select b.*, k.furni_id, k.nombre, coalesce(o.kekos, '[]'::jsonb) as otros,
           coalesce(la.lotes, '[]'::jsonb) as lotes_ltd, coalesce(la.numeros, '{}'::integer[]) as ltds_app,
           case when e.id is not null and e.habbo = b.habbo and e.app = b.app then least(e.unidades, b.habbo) else 0 end as excluidas,
           (e.id is not null and not (e.habbo = b.habbo and e.app = b.app)) as exclusion_vencida
      from base b
      left join conocidos k on k.sprite_id = b.sprite_id and k.tipo = b.tipo
      left join otros o on o.sprite_id = b.sprite_id and o.tipo = b.tipo
      left join ltd_app la on la.sprite_id = b.sprite_id and la.tipo = b.tipo
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
        'costo_unidad', costo_unidad, 'unidades_con_costo', unidades_con_costo, 'costo_medio', costo_medio)
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

revoke execute on function public._costo_auditoria(jsonb, integer) from public, anon, authenticated;
revoke execute on function public._comparar_inventario(uuid, text) from public, anon, authenticated;
revoke execute on function public.auditar_inventario(text, text, text, jsonb) from public;
grant execute on function public.auditar_inventario(text, text, text, jsonb) to anon, authenticated;
