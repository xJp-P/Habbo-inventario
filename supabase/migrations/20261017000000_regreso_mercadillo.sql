-- =============================================================================
-- Habbo Inventario — Los furnis que vuelven del Mercadillo (v1.10.0)
-- Requiere 20261016000000_hora_ventas_manuales (y las anteriores).
-- Cómo aplicarlo: Supabase → SQL Editor → pega este archivo completo → Run.
-- Es una sola transacción del editor y se puede ejecutar más de una vez.
--
-- Una oferta del Mercadillo de Habbo.es dura 168 horas (7 dias). Si no se vende, el furni
-- vuelve al inventario del keko, pero el Sniper solo avisa (evento recuperar) cuando ve que
-- alguien pulsa «Retirar». Una oferta que vence sola no deja rastro: el lote seguia en
-- Publicado para siempre (un fantasma) y la foto del inventario lo mostraba como sobrante
-- en la Auditoria. Resolverlo alli con una entrada lo duplicaba. Desde aqui:
--
--   1. caducidad_mercadillo() = 168 horas: el unico lugar con el dato del juego (la app
--      tiene el mismo numero y una prueba de que coinciden). oferta_caducada(publicado_en).
--   2. Cada foto del inventario (auditar_inventario) devuelve a Comprado, antes de comparar,
--      lo que ese keko tiene publicado hace 168 h o mas si la foto lo trae en la mano (un
--      sobrante de ese furni). Queda en la bitacora como un recuperar automatico y la
--      respuesta al Sniper trae `regresos`.
--   3. _comparar_inventario: cada fila trae `publicadas` (lo publicado de ese furni en el
--      keko o sin keko). Con un sobrante, la bandeja ofrece «Volvió del Mercadillo», que
--      llama a devolver_del_mercadillo: como maximo el sobrante de la ultima foto.
--   4. retirar_lote y retirar_furni aceptan lo que publico el Sniper si su oferta caduco.
--
-- Solo lo caducado del MISMO keko vuelve solo: algo publicado hace menos (otra unidad igual
-- pudo entrar por un tradeo con la oferta abierta) o sin keko queda como sugerencia.
-- =============================================================================

-- ─── 0. Comprobación: 20261016000000 ya está aplicada ───────────────────────

do $$
begin
  if to_regprocedure('public.vender_lote(bigint, integer, text, numeric, date, timestamptz)') is null then
    raise exception 'Falta ejecutar antes 20261016000000_hora_ventas_manuales.sql (y las anteriores, en orden).';
  end if;
end;
$$;

-- ─── 1. Las 168 horas del Mercadillo ────────────────────────────────────────
-- Un dato del juego (antes eran 48): si Habbo lo vuelve a cambiar, se cambia aqui y en
-- CADUCIDAD_MERCADILLO_H de public/js/core/lotes.js.

create or replace function public.caducidad_mercadillo()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '168 hours';
$$;

-- Una oferta publicada hace 168 h o mas ya no esta a la venta. Sin fecha (lotes muy
-- antiguos) cuenta como caducada, igual que va primero en todos los ordenes FIFO.
create or replace function public.oferta_caducada(p_publicado_en timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_publicado_en is null or p_publicado_en <= now() - public.caducidad_mercadillo();
$$;

-- ─── 2. Devolver un lote publicado (o una parte) a Comprado ─────────────────
-- Uso interno. Igual que el evento recuperar: si su lote de origen sigue en mano, en el
-- mismo keko, al mismo costo y sin LTD, las unidades se reunen con el; si no, el lote (o
-- la parte, que se divide) vuelve a Comprado. p_keko: el keko donde estan ahora.

create or replace function public._devolver_lote_publicado(p_id bigint, p_cantidad integer, p_keko text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.compras%rowtype;
  o public.compras%rowtype;
  v_keko text;
  v_destino bigint;
begin
  select * into l from public.compras where id = p_id for update;
  if not found or l.estado <> 'publicado' then
    raise exception 'El lote % no está publicado.', p_id;
  end if;
  if p_cantidad is null or p_cantidad < 1 or p_cantidad > l.cantidad then
    raise exception 'Cantidad no válida para el lote %.', p_id;
  end if;
  v_keko := coalesce(p_keko, l.keko);

  if l.origen_id is not null then
    select * into o from public.compras where id = l.origen_id for update;
    if found and o.estado = 'comprado' and not o.pendiente and o.furni_id = l.furni_id
       and o.moneda_compra = l.moneda_compra and o.precio_compra = l.precio_compra
       and o.numero_ltd is null and l.numero_ltd is null
       and o.keko is not distinct from v_keko then
      v_destino := o.id;
    end if;
  end if;

  if v_destino is not null then
    -- Vuelve a su lote de origen.
    update public.compras set cantidad = cantidad + p_cantidad where id = v_destino;
    if p_cantidad = l.cantidad then
      delete from public.compras where id = l.id;
    else
      update public.compras set cantidad = cantidad - p_cantidad where id = l.id;
    end if;
  elsif p_cantidad = l.cantidad then
    update public.compras
       set estado = 'comprado', pendiente = false, precio_lista = null, moneda_lista = null,
           publicado_en = null, publicado_por = null, keko = v_keko
     where id = l.id;
    v_destino := l.id;
  else
    update public.compras set cantidad = cantidad - p_cantidad where id = l.id;
    insert into public.compras (propietario, furni_id, estado, cantidad, moneda_compra, precio_compra,
                                fecha_compra, origen_id, fuente, pendiente, instancia, sprite_id, notas, keko)
    values (l.propietario, l.furni_id, 'comprado', p_cantidad, l.moneda_compra, l.precio_compra,
            l.fecha_compra, l.id, l.fuente, false, l.instancia, l.sprite_id, l.notas, v_keko)
    returning id into v_destino;
  end if;
  return v_destino;
end;
$$;

-- ─── 3. Lo que volvio del Mercadillo, con cada foto del inventario ──────────
-- Uso interno (lo llama auditar_inventario con la foto recien guardada). Por cada furni
-- que en la foto tiene mas unidades que las que la app tiene en mano en ese keko, devuelve
-- a Comprado hasta ese sobrante de lo que el keko tiene publicado hace 168 h o mas: lo del
-- Sniper primero y, dentro, lo publicado hace mas tiempo (el orden del evento recuperar).
-- Un LTD solo si la foto trae su numero. Las exclusiones de la Auditoria no cuentan: un
-- fantasma que se quito de la auditoria tambien vuelve. Lo que queda de sobrante sigue en
-- la Auditoria como siempre. La misma foto dos veces no devuelve dos veces: tras la
-- primera ya no sobra nada.

create or replace function public._regresos_mercadillo(p_propietario uuid, p_keko text, p_token_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.inventario_habbo%rowtype;
  r record;
  l public.compras%rowtype;
  v_resta integer;
  v_toma integer;
  v_destino bigint;
  v_movidas integer;
  v_furni bigint;
  v_nombre text;
  v_lotes jsonb;
  v_res jsonb;
  v_regresos jsonb := '[]'::jsonb;
begin
  select * into v_inv from public.inventario_habbo i where i.propietario = p_propietario and i.keko = p_keko;
  if not found then return v_regresos; end if;

  for r in
    with habbo as (
      select (x->>'sprite_id')::integer as sprite_id, x->>'tipo' as tipo, (x->>'cantidad')::integer as cantidad,
             coalesce((select array_agg(v::integer)
                         from jsonb_array_elements_text(coalesce(x->'ltds', '[]'::jsonb)) v), '{}'::integer[]) as ltds
        from jsonb_array_elements(v_inv.furnis) x
    ),
    mano as (
      select f.sprite_id, f.tipo, sum(c.cantidad)::integer as cantidad,
             coalesce(array_agg(c.numero_ltd) filter (where c.numero_ltd is not null), '{}'::integer[]) as ltds
        from public.compras c
        join public.furnis f on f.id = c.furni_id and f.propietario = c.propietario
       where c.propietario = p_propietario and c.estado = 'comprado' and c.keko = p_keko and f.sprite_id is not null
       group by f.sprite_id, f.tipo
    )
    select h.sprite_id, h.tipo, h.cantidad - coalesce(m.cantidad, 0) as sobra,
           h.ltds as ltds_habbo, coalesce(m.ltds, '{}'::integer[]) as ltds_mano
      from habbo h
      left join mano m on m.sprite_id = h.sprite_id and m.tipo = h.tipo
     where h.cantidad - coalesce(m.cantidad, 0) > 0
       and exists (select 1 from public.compras c
                     join public.furnis f on f.id = c.furni_id and f.propietario = c.propietario
                    where c.propietario = p_propietario and c.estado = 'publicado' and c.keko = p_keko
                      and f.sprite_id = h.sprite_id and f.tipo = h.tipo and public.oferta_caducada(c.publicado_en))
     order by h.tipo, h.sprite_id
  loop
    v_resta := r.sobra;
    v_movidas := 0;
    v_furni := null;
    v_lotes := '[]'::jsonb;
    for l in
      select c.* from public.compras c
        join public.furnis f on f.id = c.furni_id and f.propietario = c.propietario
       where c.propietario = p_propietario and c.estado = 'publicado' and c.keko = p_keko
         and f.sprite_id = r.sprite_id and f.tipo = r.tipo
         and public.oferta_caducada(c.publicado_en)
         and (c.numero_ltd is null or (c.numero_ltd = any(r.ltds_habbo) and not c.numero_ltd = any(r.ltds_mano)))
       order by case when c.publicado_por = 'manual' then 1 else 0 end, c.publicado_en asc nulls first, c.id asc
       for update of c
    loop
      exit when v_resta = 0;
      v_toma := least(l.cantidad, v_resta);
      v_destino := public._devolver_lote_publicado(l.id, v_toma, p_keko);
      v_furni := coalesce(v_furni, l.furni_id);
      v_lotes := v_lotes || jsonb_build_object('desde_lote', l.id, 'hacia_lote', v_destino, 'cantidad', v_toma,
                                               'publicado_en', l.publicado_en, 'publicado_por', l.publicado_por,
                                               'precio_lista', l.precio_lista, 'moneda_lista', l.moneda_lista,
                                               'numero_ltd', l.numero_ltd);
      v_resta := v_resta - v_toma;
      v_movidas := v_movidas + v_toma;
    end loop;
    continue when v_movidas = 0;

    select nombre into v_nombre from public.furnis where id = v_furni;
    v_res := jsonb_build_object('furni_id', v_furni, 'nombre', v_nombre, 'keko', p_keko,
                                'sprite_id', r.sprite_id, 'tipo', r.tipo, 'cantidad', v_movidas, 'faltante', 0,
                                'lotes', v_lotes, 'automatico', true, 'causa', 'caducada');
    -- Queda en la bitacora del Sniper como un recuperar automatico: la app escucha esa tabla
    -- (se recarga sola y avisa) y queda el rastro de que lo hizo la base, no el bot.
    insert into public.eventos_sniper (propietario, token_id, id_externo, tipo_evento, sprite_id, cantidad, datos, resultado)
    values (p_propietario, p_token_id,
            format('reg_%s_%s', v_lotes->0->>'desde_lote', floor(extract(epoch from clock_timestamp()) * 1000)::bigint),
            'recuperar', r.sprite_id, v_movidas,
            jsonb_build_object('tipo_evento', 'recuperar', 'automatico', true, 'causa', 'caducada', 'hotel', 'es',
                               'keko', p_keko, 'sprite_id', r.sprite_id, 'tipo', r.tipo, 'cantidad', v_movidas),
            v_res)
    on conflict (propietario, id_externo) do nothing;
    v_regresos := v_regresos || v_res;
  end loop;
  return v_regresos;
end;
$$;

-- ─── 4. La foto del inventario devuelve lo caducado antes de comparar ───────
-- Igual que en 20261010000000, mas _regresos_mercadillo y `regresos` en la respuesta (el
-- Sniper lee la respuesta como un documento: un campo de mas no le afecta).

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
  v_regresos jsonb;
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

  -- Lo que volvio del Mercadillo: lo caducado de este keko que la foto trae en la mano
  -- pasa a Comprado ANTES de comparar, asi no llega a la Auditoria como sobrante.
  v_regresos := public._regresos_mercadillo(t.propietario, v_keko, t.id);
  v_comparacion := public._comparar_inventario(t.propietario, v_keko);
  return jsonb_build_object(
    'keko', v_keko,
    'recibidos', jsonb_array_length(inventario),
    'furnis', jsonb_array_length(v_furnis),
    'unidades', v_unidades,
    'con_costo', v_con_costo,
    'errores', v_errores,
    'resumen', v_comparacion->'resumen',
    'regresos', v_regresos);
end;
$$;

-- ─── 5. Comparar la foto con la app, con lo publicado de cada furni ──────────
-- Igual que en 20261013000000, mas `publicadas` en cada fila.

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
  -- Lo que la app tiene PUBLICADO de ese furni en este keko o sin keko. Con un sobrante,
  -- puede ser lo que volvio del Mercadillo (la oferta caduco, o se retiro sin que el
  -- Sniper lo viera): la bandeja lo ofrece con «Volvió del Mercadillo». `devolvible`: un
  -- LTD solo si la foto trae su numero y la app no lo tiene ya en mano en este keko.
  pub_lotes as (
    select f.sprite_id, f.tipo, c.id, c.keko, c.cantidad, c.numero_ltd, c.publicado_en, c.publicado_por,
           c.precio_lista, c.moneda_lista, public.oferta_caducada(c.publicado_en) as caducada
      from public.compras c
      join public.furnis f on f.id = c.furni_id and f.propietario = c.propietario
     where c.propietario = p_propietario and c.estado = 'publicado' and f.sprite_id is not null
       and (c.keko = p_keko or c.keko is null)
  ),
  pub as (
    select p.sprite_id, p.tipo,
           sum(p.cantidad)::integer as unidades,
           coalesce(sum(p.cantidad) filter (where p.caducada), 0)::integer as caducadas,
           coalesce(sum(p.cantidad) filter (where p.devolvible), 0)::integer as devolvibles,
           jsonb_agg(jsonb_build_object('lote_id', p.id, 'keko', p.keko, 'cantidad', p.cantidad, 'numero_ltd', p.numero_ltd,
                                        'publicado_en', p.publicado_en, 'publicado_por', p.publicado_por,
                                        'precio_lista', p.precio_lista, 'moneda_lista', p.moneda_lista,
                                        'caducada', p.caducada, 'devolvible', p.devolvible)
                     order by p.keko is null, p.publicado_en asc nulls first, p.id) as lotes
      from (select pl.*,
                   pl.numero_ltd is null
                     or (pl.numero_ltd = any(coalesce(h.ltds, '{}'::integer[]))
                         and not pl.numero_ltd = any(coalesce(la.numeros, '{}'::integer[]))) as devolvible
              from pub_lotes pl
              left join habbo h on h.sprite_id = pl.sprite_id and h.tipo = pl.tipo
              left join ltd_app la on la.sprite_id = pl.sprite_id and la.tipo = pl.tipo) p
     group by p.sprite_id, p.tipo
  ),
  -- Los otros kekos que tienen unidades de ese furni en la app, con la EVIDENCIA de que
  -- esas unidades se movieron: `auditado` (ese keko tiene Sniper y foto; un keko manual
  -- nunca la tiene) y `faltan` (cuantas de las que la app tiene alli NO estan en su foto).
  -- La bandeja solo sugiere «vinieron de» con faltan > 0; lo demas lo eliges tu.
  otros as (
    select k.sprite_id, k.tipo,
           jsonb_agg(jsonb_build_object(
             'keko', k.keko, 'unidades', k.unidades,
             'auditado', a.keko is not null,
             'faltan', case when a.keko is null then 0 else greatest(k.unidades - coalesce(fo.cantidad, 0), 0) end)
             order by k.keko) as kekos
      from (select sprite_id, tipo, keko, sum(cantidad)::integer as unidades
              from lotes where keko is not null and keko <> p_keko group by sprite_id, tipo, keko) k
      left join public.inventario_habbo a on a.propietario = p_propietario and a.keko = k.keko
      left join public._unidades_en_fotos(p_propietario, p_keko) fo
        on fo.keko = k.keko and fo.sprite_id = k.sprite_id and fo.tipo = k.tipo
     group by k.sprite_id, k.tipo
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
           jsonb_build_object('unidades', coalesce(pu.unidades, 0), 'caducadas', coalesce(pu.caducadas, 0),
                              'devolvibles', coalesce(pu.devolvibles, 0), 'lotes', coalesce(pu.lotes, '[]'::jsonb)) as publicadas,
           case when e.id is not null and e.habbo = b.habbo and e.app = b.app then least(e.unidades, b.habbo) else 0 end as excluidas,
           (e.id is not null and not (e.habbo = b.habbo and e.app = b.app)) as exclusion_vencida
      from base b
      left join conocidos k on k.sprite_id = b.sprite_id and k.tipo = b.tipo
      left join otros o on o.sprite_id = b.sprite_id and o.tipo = b.tipo
      left join ltd_app la on la.sprite_id = b.sprite_id and la.tipo = b.tipo
      left join app_costos ac on ac.sprite_id = b.sprite_id and ac.tipo = b.tipo
      left join pub pu on pu.sprite_id = b.sprite_id and pu.tipo = b.tipo
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
        'costos', costos, 'costos_app', costos_app, 'costos_sin_keko', costos_sin_keko,
        'publicadas', publicadas)
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

-- ─── 6. «Volvió del Mercadillo» desde la Auditoria ──────────────────────────
-- Para lo que no vuelve solo (publicado hace menos de 168 h, o sin keko). Como maximo el
-- sobrante de ese furni en la ULTIMA foto del keko: sin esa prueba no se toca nada. Vale
-- tambien para lo que publico el Sniper. Primero lo de ese keko, luego lo sin keko (pasa a
-- ese keko); dentro, lo caducado y lo publicado hace mas tiempo.

create or replace function public.devolver_del_mercadillo(p_keko text, p_furni_id bigint, p_cantidad integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_keko text := nullif(trim(coalesce(p_keko, '')), '');
  f public.furnis%rowtype;
  v_inv public.inventario_habbo%rowtype;
  v_habbo integer;
  v_ltds integer[];
  v_mano integer;
  v_ltds_mano integer[];
  v_sobra integer;
  v_total integer;
  v_cant integer;
  v_resta integer;
  v_toma integer;
  v_destino bigint;
  v_lotes jsonb := '[]'::jsonb;
  l public.compras%rowtype;
begin
  if v_uid is null then raise exception using errcode = 'PT401', message = 'Inicia sesión para resolver la auditoría.'; end if;
  if v_keko is null then raise exception using errcode = 'PT400', message = 'Falta el keko.'; end if;
  select * into f from public.furnis where id = p_furni_id and propietario = v_uid;
  if not found then raise exception using errcode = 'PT404', message = 'Ese furni no existe.'; end if;
  if f.sprite_id is null then
    raise exception using errcode = 'PT409', message = 'Ese furni no tiene sprite: no se puede comparar con la foto del inventario.';
  end if;
  select * into v_inv from public.inventario_habbo i where i.propietario = v_uid and i.keko = v_keko;
  if not found then
    raise exception using errcode = 'PT404',
      message = format('No hay inventario del keko %s: sin su foto no se puede comprobar que volvió.', v_keko);
  end if;

  select coalesce(sum((x->>'cantidad')::integer), 0)::integer into v_habbo
    from jsonb_array_elements(v_inv.furnis) x
   where (x->>'sprite_id')::integer = f.sprite_id and x->>'tipo' = f.tipo;
  select coalesce(array_agg(v::integer), '{}'::integer[]) into v_ltds
    from jsonb_array_elements(v_inv.furnis) x
    cross join lateral jsonb_array_elements_text(coalesce(x->'ltds', '[]'::jsonb)) v
   where (x->>'sprite_id')::integer = f.sprite_id and x->>'tipo' = f.tipo;
  select coalesce(sum(c.cantidad), 0)::integer,
         coalesce(array_agg(c.numero_ltd) filter (where c.numero_ltd is not null), '{}'::integer[])
    into v_mano, v_ltds_mano
    from public.compras c
    join public.furnis g on g.id = c.furni_id and g.propietario = c.propietario
   where c.propietario = v_uid and c.estado = 'comprado' and c.keko = v_keko
     and g.sprite_id = f.sprite_id and g.tipo = f.tipo;
  v_sobra := v_habbo - v_mano;
  if v_sobra <= 0 then
    raise exception using errcode = 'PT409',
      message = format('La última foto de %s no tiene unidades de más de ese furni: no hay prueba de que haya vuelto del Mercadillo.', v_keko);
  end if;

  select coalesce(sum(c.cantidad), 0)::integer into v_total
    from public.compras c
    join public.furnis g on g.id = c.furni_id and g.propietario = c.propietario
   where c.propietario = v_uid and c.estado = 'publicado' and (c.keko = v_keko or c.keko is null)
     and g.sprite_id = f.sprite_id and g.tipo = f.tipo
     and (c.numero_ltd is null or (c.numero_ltd = any(v_ltds) and not c.numero_ltd = any(v_ltds_mano)));
  if v_total = 0 then
    raise exception using errcode = 'PT400', message = format('No hay unidades publicadas de ese furni en %s ni sin keko.', v_keko);
  end if;
  v_cant := coalesce(p_cantidad, least(v_sobra, v_total));
  if v_cant < 1 then raise exception using errcode = 'PT400', message = 'La cantidad debe ser mayor o igual a 1.'; end if;
  if v_cant > v_sobra then
    raise exception using errcode = 'PT409',
      message = format('La última foto de %s solo tiene %s unidad(es) de más de ese furni.', v_keko, v_sobra);
  end if;
  if v_cant > v_total then
    raise exception using errcode = 'PT400',
      message = format('Solo hay %s unidad(es) publicadas de ese furni en %s o sin keko.', v_total, v_keko);
  end if;

  v_resta := v_cant;
  for l in
    select c.* from public.compras c
      join public.furnis g on g.id = c.furni_id and g.propietario = c.propietario
     where c.propietario = v_uid and c.estado = 'publicado' and (c.keko = v_keko or c.keko is null)
       and g.sprite_id = f.sprite_id and g.tipo = f.tipo
       and (c.numero_ltd is null or (c.numero_ltd = any(v_ltds) and not c.numero_ltd = any(v_ltds_mano)))
     order by c.keko is null, not public.oferta_caducada(c.publicado_en), c.publicado_en asc nulls first, c.id asc
     for update of c
  loop
    exit when v_resta = 0;
    v_toma := least(l.cantidad, v_resta);
    v_destino := public._devolver_lote_publicado(l.id, v_toma, v_keko);
    v_lotes := v_lotes || jsonb_build_object('desde_lote', l.id, 'hacia_lote', v_destino, 'cantidad', v_toma);
    v_resta := v_resta - v_toma;
  end loop;

  return jsonb_build_object('furni_id', f.id, 'keko', v_keko, 'cantidad', v_cant, 'lotes', v_lotes);
end;
$$;

-- ─── 7. Retirar lo que publico el Sniper, si su oferta ya caduco ────────────
-- retirar_lote: igual que en 20261014000000, salvo que lo del Sniper se acepta si caduco.
-- retirar_furni: igual, mas lo del Sniper caducado DESPUES de lo tuyo (para lo tuyo, el
-- orden de siempre).

create or replace function public.retirar_lote(p_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c public.compras%rowtype;
  o public.compras%rowtype;
begin
  select * into c from public.compras where id = p_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'Ese lote no existe.'; end if;
  if c.estado <> 'publicado' then raise exception using errcode = 'PT400', message = 'Ese lote no esta publicado.'; end if;
  -- Lo del Sniper se retira en el juego y el Sniper avisa (recuperar). Tambien aqui si su
  -- oferta ya caduco: una oferta vencida ya no puede estar a la venta.
  if coalesce(c.publicado_por, 'sniper') <> 'manual' and not public.oferta_caducada(c.publicado_en) then
    raise exception using errcode = 'PT409',
      message = 'Ese lote lo publicó el Sniper y su oferta sigue vigente: se retira desde el juego y el Sniper avisa. '
             || 'Cuando caduque (7 días después de publicarlo), podrás retirarlo aquí.';
  end if;

  if c.origen_id is not null then
    select * into o from public.compras where id = c.origen_id for update;
    if found and o.estado = 'comprado' and o.furni_id = c.furni_id
       and o.moneda_compra = c.moneda_compra and o.precio_compra = c.precio_compra
       and o.numero_ltd is null and c.numero_ltd is null
       and o.keko is not distinct from c.keko then
      update public.compras set cantidad = cantidad + c.cantidad where id = o.id;
      delete from public.compras where id = c.id;
      return jsonb_build_object('fusionada', true, 'compra_id', o.id);
    end if;
  end if;

  update public.compras
     set estado = 'comprado', pendiente = false, precio_lista = null, moneda_lista = null,
         publicado_en = null, publicado_por = null
   where id = c.id;
  return jsonb_build_object('fusionada', false, 'compra_id', c.id);
end;
$$;

create or replace function public.retirar_furni(
  p_furni_id bigint, p_cantidad integer default null, p_precio_lista numeric default null,
  p_keko text default null, p_sin_keko boolean default false)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  f public.furnis%rowtype;
  l public.compras%rowtype;
  o public.compras%rowtype;
  v_total integer;
  v_cant integer;
  v_resta integer;
  v_toma integer;
  v_destino bigint;
  v_lotes jsonb := '[]'::jsonb;
  v_keko text := nullif(trim(coalesce(p_keko, '')), '');
  v_sin boolean := coalesce(p_sin_keko, false);
  v_donde text;
begin
  if v_sin and v_keko is not null then
    raise exception using errcode = 'PT400', message = 'Elige un keko o «sin keko», no los dos.';
  end if;
  v_donde := case when v_sin then ' sin keko asignado' when v_keko is not null then format(' en el keko %s', v_keko) else '' end;
  select * into f from public.furnis where id = p_furni_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'Ese furni no existe.'; end if;

  select coalesce(sum(cantidad), 0) into v_total
    from public.compras
   where furni_id = p_furni_id and estado = 'publicado'
     and (publicado_por = 'manual' or public.oferta_caducada(publicado_en))
     and (p_precio_lista is null or precio_lista = p_precio_lista)
     and (not v_sin or keko is null) and (v_keko is null or lower(keko) = lower(v_keko));
  if v_total = 0 then
    raise exception using errcode = 'PT400',
      message = format('No hay unidades de ese furni%s que hayas publicado tú ni del Sniper con la oferta caducada. '
                       || 'Lo que publicó el Sniper se retira desde el juego (el Sniper avisa); cuando su oferta caduca, también aquí.', v_donde);
  end if;

  v_cant := coalesce(p_cantidad, v_total);
  if v_cant < 1 then raise exception using errcode = 'PT400', message = 'La cantidad a retirar debe ser mayor o igual a 1.'; end if;
  if v_cant > v_total then
    raise exception using errcode = 'PT400',
      message = format('Solo hay %s unidad(es)%s que puedas retirar aquí (las tuyas y las del Sniper con la oferta caducada).', v_total, v_donde);
  end if;

  v_resta := v_cant;
  for l in
    select * from public.compras
     where furni_id = p_furni_id and estado = 'publicado'
       and (publicado_por = 'manual' or public.oferta_caducada(publicado_en))
       and (p_precio_lista is null or precio_lista = p_precio_lista)
       and (not v_sin or keko is null) and (v_keko is null or lower(keko) = lower(v_keko))
     order by case when publicado_por = 'manual' then 0 else 1 end, publicado_en asc nulls first, id asc
     for update
  loop
    exit when v_resta = 0;
    v_toma := least(l.cantidad, v_resta);
    v_destino := null;
    if l.origen_id is not null then
      select * into o from public.compras where id = l.origen_id for update;
      if found and o.estado = 'comprado' and not o.pendiente and o.furni_id = l.furni_id
         and o.moneda_compra = l.moneda_compra and o.precio_compra = l.precio_compra
         and o.numero_ltd is null and l.numero_ltd is null
         and o.keko is not distinct from l.keko then
        v_destino := o.id;
      end if;
    end if;

    if v_destino is not null then
      -- Vuelve a su lote de origen.
      update public.compras set cantidad = cantidad + v_toma where id = v_destino;
      if v_toma = l.cantidad then
        delete from public.compras where id = l.id;
      else
        update public.compras set cantidad = cantidad - v_toma where id = l.id;
      end if;
    elsif v_toma = l.cantidad then
      update public.compras
         set estado = 'comprado', pendiente = false, precio_lista = null, moneda_lista = null,
             publicado_en = null, publicado_por = null
       where id = l.id;
      v_destino := l.id;
    else
      update public.compras set cantidad = cantidad - v_toma where id = l.id;
      insert into public.compras (propietario, furni_id, estado, cantidad, moneda_compra, precio_compra,
                                  fecha_compra, origen_id, fuente, pendiente, instancia, sprite_id, notas, keko)
      values (l.propietario, l.furni_id, 'comprado', v_toma, l.moneda_compra, l.precio_compra,
              l.fecha_compra, l.id, l.fuente, false, l.instancia, l.sprite_id, l.notas, l.keko)
      returning id into v_destino;
    end if;
    v_lotes := v_lotes || jsonb_build_object('desde_lote', l.id, 'hacia_lote', v_destino, 'cantidad', v_toma);
    v_resta := v_resta - v_toma;
  end loop;

  return jsonb_build_object('furni_id', p_furni_id, 'cantidad', v_cant, 'lotes', v_lotes);
end;
$$;

-- ─── 8. Permisos ─────────────────────────────────────────────────────────────

revoke execute on function public.caducidad_mercadillo() from public, anon;
revoke execute on function public.oferta_caducada(timestamptz) from public, anon;
grant execute on function public.caducidad_mercadillo() to authenticated;
grant execute on function public.oferta_caducada(timestamptz) to authenticated;
revoke execute on function public._devolver_lote_publicado(bigint, integer, text) from public, anon, authenticated;
revoke execute on function public._regresos_mercadillo(uuid, text, bigint) from public, anon, authenticated;
revoke execute on function public._comparar_inventario(uuid, text) from public, anon, authenticated;
revoke execute on function public.devolver_del_mercadillo(text, bigint, integer) from public, anon;
grant execute on function public.devolver_del_mercadillo(text, bigint, integer) to authenticated;
revoke execute on function public.retirar_lote(bigint) from public, anon;
revoke execute on function public.retirar_furni(bigint, integer, numeric, text, boolean) from public, anon;
grant execute on function public.retirar_lote(bigint) to authenticated;
grant execute on function public.retirar_furni(bigint, integer, numeric, text, boolean) to authenticated;
revoke execute on function public.auditar_inventario(text, text, text, jsonb) from public;
grant execute on function public.auditar_inventario(text, text, text, jsonb) to anon, authenticated;
