-- =============================================================================
-- Habbo Inventario — Número de serie de los LTD (Limited Edition Rares)
--
-- Requiere 20261005000000_sin_precio_de_referencia (y las anteriores).
-- Cómo aplicarlo: Supabase → SQL Editor → pega este archivo completo → Run.
-- Es una sola transacción del editor y se puede ejecutar más de una vez.
--
-- QUÉ CAMBIA
--   1. compras.numero_ltd (entero > 0, opcional): el número de un LTD (#45). Un LTD es
--      una sola unidad, así que un lote con número tiene cantidad 1.
--   2. crear_compra(..., p_numero_ltd): la compra manual puede traer el número.
--   3. registrar_eventos_sniper: el evento 'compra' acepta "numero_ltd" (45, "45" o
--      "#45"); con número, la cantidad debe ser 1.
--   4. asignar_ltd(p_id, p_numero): pone, cambia o quita el número de un lote. Si el
--      lote tiene varias unidades (p. ej. del Excel) y está en mano, separa una unidad
--      en un lote propio con ese número.
--   5. Un lote con número LTD nunca se fusiona con otro al revertir una venta, retirar
--      o recuperar: así no pierde su número.
--   6. v_compras expone numero_ltd.
-- =============================================================================

-- ─── 0. Comprobación: 20261005000000 ya está aplicada ───────────────────────

do $$
begin
  if to_regprocedure('public.activar_pendientes(bigint, bigint[])') is null then
    raise exception 'Falta ejecutar antes 20261005000000_sin_precio_de_referencia.sql (y las anteriores, en orden).';
  end if;
end;
$$;

-- ─── 1. Columna ──────────────────────────────────────────────────────────────

alter table public.compras add column if not exists numero_ltd integer;
alter table public.compras drop constraint if exists compras_ltd_valido;
alter table public.compras add constraint compras_ltd_valido
  check (numero_ltd is null or (numero_ltd > 0 and cantidad = 1));

-- ─── 2. Vistas (v_compras expone numero_ltd) ─────────────────────────────────

drop view if exists public.v_furnis;
drop view if exists public.v_compras;

-- Igual que en 20261005000000, más numero_ltd.
create view public.v_compras with (security_invoker = true) as
select
  n.*,
  n.precio_compra_cr * n.cantidad                        as costo_total_cr,
  n.precio_compra_cr * n.cantidad / n.tasa               as costo_total_lg,
  n.precio_venta_cr / n.tasa                             as precio_venta_lg,
  case when n.precio_neto_cr is null then null
       else (n.precio_neto_cr - n.precio_compra_cr) * n.cantidad end              as ganancia_cr,
  case when n.precio_neto_cr is null then null
       else (n.precio_neto_cr - n.precio_compra_cr) * n.cantidad / n.tasa end     as ganancia_lg,
  case when n.precio_venta_cr is null then null
       else (n.precio_venta_cr - n.precio_compra_cr) * n.cantidad end             as ganancia_bruta_cr,
  case when n.precio_neto_cr is null or n.precio_compra_cr = 0 then null
       else (n.precio_neto_cr - n.precio_compra_cr) / n.precio_compra_cr end      as margen
from (
  select m.*, m.precio_venta_cr - m.comision_cr as precio_neto_cr
  from (
    select
      b.*,
      case when b.precio_venta_cr is null then null
           when b.estado <> 'vendido' and b.moneda_precio = 'creditos' then public.comision_mercadillo(b.precio_venta_cr)
           else 0 end as comision_cr
    from (
      select
        c.id, c.furni_id, f.nombre, f.classname, f.revision,
        c.estado, c.pendiente, c.fuente, c.id_externo, c.instancia, c.sprite_id, c.numero_ltd,
        c.cantidad, c.moneda_compra, c.precio_compra,
        c.moneda_venta as moneda_venta_real, c.precio_venta as precio_venta_real, c.comision_venta,
        c.moneda_lista, c.precio_lista, c.publicado_en, c.publicado_por,
        c.fecha_compra, c.fecha_venta, c.origen_id, c.notas, c.creado_en,
        t.tasa,
        case c.moneda_compra when 'lingos' then c.precio_compra * t.tasa else c.precio_compra end as precio_compra_cr,
        case c.moneda_lista when 'lingos' then c.precio_lista * t.tasa else c.precio_lista end    as precio_lista_cr,
        case
          when c.estado = 'vendido' then
            case c.moneda_venta when 'lingos' then c.precio_venta * t.tasa else c.precio_venta end
          when c.estado = 'publicado' then
            case c.moneda_lista when 'lingos' then c.precio_lista * t.tasa else c.precio_lista end
        end as precio_venta_cr,
        case
          when c.estado = 'vendido' then c.moneda_venta
          when c.estado = 'publicado' then c.moneda_lista
        end as moneda_precio,
        case when c.estado = 'vendido' and c.comision_venta is not null then
          case c.moneda_venta when 'lingos' then c.comision_venta * t.tasa else c.comision_venta end
        end as comision_pagada_cr
      from public.compras c
      join public.furnis f on f.id = c.furni_id
      cross join public.v_tasa t
    ) b
  ) m
) n;

-- Sin cambios respecto a 20261005000000 (se recrea porque depende de v_compras).
create view public.v_furnis with (security_invoker = true) as
select
  s.*,
  s.stock - s.unidades_pendientes                                          as stock_activo,
  s.costo_promedio_cr / s.tasa                                             as costo_promedio_lg,
  case when s.unidades_publicadas > 0 then s.inversion_publicada_cr / s.unidades_publicadas end as costo_publicado_cr,
  case when s.unidades_publicadas > 0 then s.venta_neta_cr end                                  as venta_esperada_cr,
  case when s.unidades_publicadas > 0 then s.venta_bruta_cr end                                 as venta_esperada_bruta_cr,
  case when s.unidades_publicadas > 0 then s.comision_total_cr end                              as comision_esperada_cr,
  case when s.unidades_publicadas > 0 then s.venta_neta_cr - s.inversion_publicada_cr end       as ganancia_esperada_cr,
  case when s.unidades_publicadas > 0 then (s.venta_neta_cr - s.inversion_publicada_cr) / s.tasa end as ganancia_esperada_lg,
  public.precio_minimo_mercadillo(s.costo_promedio_cr)                     as precio_minimo_cr,
  case when s.unidades_compradas = 0 then 'sin_compras'
       when s.stock = 0 then 'agotado'
       when s.unidades_publicadas = s.stock then 'publicado'
       when s.stock - s.unidades_pendientes - s.unidades_publicadas <= 0 then 'por_revisar'
       else 'en_venta' end                                                 as estado,
  (s.unidades_publicadas > 0 and s.venta_neta_cr < s.inversion_publicada_cr) as en_perdida
from (
  select
    a.*,
    a.unidades_compradas - a.unidades_vendidas                            as stock,
    case when a.unidades_compradas - a.unidades_vendidas > 0
         then a.inversion_cr / (a.unidades_compradas - a.unidades_vendidas) end as costo_promedio_cr
  from (
    select
      f.id, f.nombre, f.classname, f.revision, f.sprite_id, f.tipo, f.notas, f.creado_en, t.tasa,
      coalesce(sum(vc.cantidad), 0)                                                   as unidades_compradas,
      coalesce(sum(vc.cantidad) filter (where vc.estado = 'vendido'), 0)              as unidades_vendidas,
      coalesce(sum(vc.cantidad) filter (where vc.estado = 'publicado'), 0)            as unidades_publicadas,
      coalesce(sum(vc.cantidad) filter (where vc.estado = 'comprado' and vc.pendiente), 0) as unidades_pendientes,
      count(vc.id) filter (where vc.estado = 'comprado' and vc.pendiente)             as lotes_pendientes,
      count(vc.id) filter (where vc.origen_id is null)                                as n_compras,
      coalesce(sum(vc.costo_total_cr) filter (where vc.estado in ('comprado', 'publicado')), 0) as inversion_cr,
      coalesce(sum(vc.costo_total_cr) filter (where vc.estado = 'publicado'), 0)      as inversion_publicada_cr,
      coalesce(sum(vc.precio_venta_cr * vc.cantidad) filter (where vc.estado = 'publicado'), 0) as venta_bruta_cr,
      coalesce(sum(vc.precio_neto_cr * vc.cantidad) filter (where vc.estado = 'publicado'), 0) as venta_neta_cr,
      coalesce(sum(vc.comision_cr * vc.cantidad) filter (where vc.estado = 'publicado'), 0) as comision_total_cr,
      (array_agg(vc.precio_lista order by vc.publicado_en desc nulls last, vc.id desc)
         filter (where vc.estado = 'publicado'))[1]                                   as precio_lista_actual,
      (array_agg(vc.moneda_lista order by vc.publicado_en desc nulls last, vc.id desc)
         filter (where vc.estado = 'publicado'))[1]                                   as moneda_lista_actual,
      min(vc.precio_lista_cr) filter (where vc.estado = 'publicado')                  as lista_min_cr,
      max(vc.precio_lista_cr) filter (where vc.estado = 'publicado')                  as lista_max_cr,
      min(vc.precio_compra_cr)                                                        as compra_min_cr,
      max(vc.precio_compra_cr)                                                        as compra_max_cr,
      coalesce(sum(vc.ganancia_cr) filter (where vc.estado = 'vendido'), 0)           as ganancia_realizada_cr,
      coalesce(sum(vc.comision_pagada_cr * vc.cantidad) filter (where vc.estado = 'vendido'), 0) as comision_pagada_cr,
      max(vc.creado_en) filter (where vc.fuente = 'sniper')                           as ultima_compra_sniper
    from public.furnis f
    cross join public.v_tasa t
    left join public.v_compras vc on vc.furni_id = f.id
    group by f.id, t.tasa
  ) a
) s;

revoke all on public.v_compras, public.v_furnis from anon;
grant select on public.v_compras, public.v_furnis to authenticated;

-- ─── 3. El número LTD en las compras del Sniper ──────────────────────────────

-- Lee "numero_ltd" de un evento: número JSON o texto ("45", "#45"). NULL si no viene.
create or replace function public._ltd_evento(e jsonb)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb := e -> 'numero_ltd';
  s text;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  s := regexp_replace(trim(v #>> '{}'), '^#\s*', '');
  if s = '' then return null; end if;
  if s !~ '^[0-9]{1,9}$' or s::integer < 1 then
    raise exception 'numero_ltd no valido: % (usa un numero, p. ej. 45 o "#45").', v::text;
  end if;
  return s::integer;
end;
$$;

create or replace function public._sniper_compra(t public.tokens_sniper, e jsonb, p_id_externo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_precio numeric;
  v_cantidad integer := coalesce(nullif(e->>'cantidad', '')::integer, 1);
  v_moneda text := lower(coalesce(nullif(e->>'moneda', ''), 'creditos'));
  v_fecha date;
  v_furni bigint;
  v_compra bigint;
  v_ltd integer := public._ltd_evento(e);
begin
  v_precio := public._numero_evento(e, 'precio');
  if v_precio is null or v_precio < 0 then
    raise exception 'Falta precio (numero mayor o igual a 0).';
  end if;
  if v_cantidad < 1 then raise exception 'La cantidad debe ser mayor o igual a 1.'; end if;
  if v_moneda not in ('creditos', 'lingos') then raise exception 'Moneda no valida: usa creditos o lingos.'; end if;
  if v_ltd is not null and v_cantidad <> 1 then
    raise exception 'Un LTD es una sola unidad: con numero_ltd la cantidad debe ser 1.';
  end if;
  v_fecha := case
    when (e->>'fecha') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then left(e->>'fecha', 10)::date
    when (e->>'fecha') ~ '^[0-9]{10,}$' then (to_timestamp((e->>'fecha')::numeric / 1000) at time zone 'UTC')::date
    else current_date end;

  v_furni := public._sniper_furni(t.propietario, e, true);

  insert into public.compras (propietario, furni_id, cantidad, moneda_compra, precio_compra, fecha_compra,
                              fuente, id_externo, pendiente, instancia, sprite_id, notas, numero_ltd)
  values (t.propietario, v_furni, v_cantidad, v_moneda, v_precio, v_fecha,
          'sniper', p_id_externo, true,
          coalesce(nullif(trim(coalesce(e->>'instancia', '')), ''), t.nombre),
          nullif(e->>'sprite_id', '')::integer,
          nullif(left(trim(coalesce(e->>'notas', '')), 500), ''), v_ltd)
  on conflict (propietario, fuente, id_externo) where id_externo is not null do nothing
  returning id into v_compra;

  if v_compra is null then
    return jsonb_build_object('duplicado', true);
  end if;
  return jsonb_build_object('compra_id', v_compra, 'furni_id', v_furni, 'cantidad', v_cantidad, 'pendiente', true,
                            'numero_ltd', v_ltd);
end;
$$;

-- ─── 4. Compra manual con número LTD ─────────────────────────────────────────

drop function if exists public.crear_compra(bigint, text, text, integer, integer, text, numeric, date, text);

create or replace function public.crear_compra(
  p_furni_id bigint default null, p_nombre text default null, p_classname text default null,
  p_revision integer default null, p_cantidad integer default 1, p_moneda text default 'creditos',
  p_precio numeric default null, p_fecha date default null, p_notas text default null,
  p_numero_ltd integer default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_furni bigint;
  v_creado boolean := false;
  v_id bigint;
begin
  if p_precio is null then raise exception using errcode = 'PT400', message = 'Falta el precio de compra.'; end if;
  if p_numero_ltd is not null then
    if p_numero_ltd < 1 then raise exception using errcode = 'PT400', message = 'El numero LTD debe ser mayor que 0.'; end if;
    if coalesce(p_cantidad, 1) <> 1 then
      raise exception using errcode = 'PT400', message = 'Un LTD es una sola unidad: registra cada numero como una compra de 1.';
    end if;
  end if;
  if p_furni_id is not null then
    select id into v_furni from public.furnis where id = p_furni_id;
    if not found then raise exception using errcode = 'PT404', message = 'Ese furni no existe.'; end if;
  else
    if p_classname is not null then
      select id into v_furni from public.furnis where classname = p_classname order by id limit 1;
    end if;
    if v_furni is null and p_nombre is not null then
      select id into v_furni from public.furnis where lower(nombre) = lower(trim(p_nombre)) limit 1;
    end if;
    if v_furni is null then
      if coalesce(trim(p_nombre), '') = '' then
        raise exception using errcode = 'PT400', message = 'Falta el nombre del furni.';
      end if;
      insert into public.furnis (nombre, classname, revision) values (trim(p_nombre), p_classname, p_revision)
      returning id into v_furni;
      v_creado := true;
    end if;
  end if;

  insert into public.compras (furni_id, cantidad, moneda_compra, precio_compra, fecha_compra, notas, numero_ltd)
  values (v_furni, coalesce(p_cantidad, 1), coalesce(p_moneda, 'creditos'), p_precio, coalesce(p_fecha, current_date), p_notas, p_numero_ltd)
  returning id into v_id;
  return jsonb_build_object('compra_id', v_id, 'furni_id', v_furni, 'furni_creado', v_creado);
end;
$$;

-- ─── 5. Poner o quitar el número LTD de un lote ──────────────────────────────

-- Con p_numero NULL lo quita. Un lote de 1 unidad recibe el número directamente; uno de
-- varias unidades EN MANO separa una unidad en un lote propio con ese número (sin
-- origen, para que nunca se vuelva a fusionar).
create or replace function public.asignar_ltd(p_id bigint, p_numero integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c public.compras%rowtype;
  v_nuevo bigint;
begin
  select * into c from public.compras where id = p_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'Ese lote no existe.'; end if;
  if p_numero is not null and p_numero < 1 then
    raise exception using errcode = 'PT400', message = 'El numero LTD debe ser mayor que 0.';
  end if;

  if p_numero is null or c.cantidad = 1 then
    update public.compras set numero_ltd = p_numero where id = c.id;
    return jsonb_build_object('lote_id', c.id, 'separado', false);
  end if;

  if c.estado <> 'comprado' then
    raise exception using errcode = 'PT400',
      message = format('Ese lote tiene %s unidades y no esta en mano: un LTD es una sola unidad.', c.cantidad);
  end if;
  update public.compras set cantidad = cantidad - 1 where id = c.id;
  insert into public.compras (propietario, furni_id, estado, cantidad, moneda_compra, precio_compra,
                              fecha_compra, fuente, pendiente, instancia, sprite_id, notas, numero_ltd)
  values (c.propietario, c.furni_id, 'comprado', 1, c.moneda_compra, c.precio_compra,
          c.fecha_compra, c.fuente, c.pendiente, c.instancia, c.sprite_id, c.notas, p_numero)
  returning id into v_nuevo;
  return jsonb_build_object('lote_id', v_nuevo, 'separado', true, 'original_id', c.id);
end;
$$;

-- ─── 6. Un lote con número LTD nunca se fusiona con otro ─────────────────────

create or replace function public.revertir_venta(p_id bigint)
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
  if c.estado <> 'vendido' then raise exception using errcode = 'PT400', message = 'Ese lote no esta vendido.'; end if;

  if c.origen_id is not null then
    select * into o from public.compras where id = c.origen_id for update;
    if found and o.estado in ('comprado', 'publicado') and o.furni_id = c.furni_id
       and o.moneda_compra = c.moneda_compra and o.precio_compra = c.precio_compra
       and o.numero_ltd is null and c.numero_ltd is null then
      update public.compras set cantidad = cantidad + c.cantidad where id = o.id;
      delete from public.compras where id = c.id;
      return jsonb_build_object('fusionada', true, 'compra_id', o.id);
    end if;
  end if;

  update public.compras
     set estado = case when c.precio_lista is not null then 'publicado' else 'comprado' end,
         moneda_venta = null, precio_venta = null, comision_venta = null, fecha_venta = null
   where id = c.id;
  return jsonb_build_object('fusionada', false, 'compra_id', c.id);
end;
$$;

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
  if coalesce(c.publicado_por, 'sniper') <> 'manual' then
    raise exception using errcode = 'PT409',
      message = 'Ese lote lo publico el Sniper: se retira desde el juego y el Sniper avisa (evento recuperar).';
  end if;

  if c.origen_id is not null then
    select * into o from public.compras where id = c.origen_id for update;
    if found and o.estado = 'comprado' and o.furni_id = c.furni_id
       and o.moneda_compra = c.moneda_compra and o.precio_compra = c.precio_compra
       and o.numero_ltd is null and c.numero_ltd is null then
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
  p_furni_id bigint, p_cantidad integer default null, p_precio_lista numeric default null)
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
begin
  select * into f from public.furnis where id = p_furni_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'Ese furni no existe.'; end if;

  select coalesce(sum(cantidad), 0) into v_total
    from public.compras
   where furni_id = p_furni_id and estado = 'publicado' and publicado_por = 'manual'
     and (p_precio_lista is null or precio_lista = p_precio_lista);
  if v_total = 0 then
    raise exception using errcode = 'PT400',
      message = 'No hay unidades de ese furni que hayas publicado tú. Lo que publicó el Sniper se retira desde el juego (el Sniper avisa).';
  end if;

  v_cant := coalesce(p_cantidad, v_total);
  if v_cant < 1 then raise exception using errcode = 'PT400', message = 'La cantidad a retirar debe ser mayor o igual a 1.'; end if;
  if v_cant > v_total then
    raise exception using errcode = 'PT400', message = format('Solo hay %s unidad(es) que hayas publicado tú.', v_total);
  end if;

  v_resta := v_cant;
  for l in
    select * from public.compras
     where furni_id = p_furni_id and estado = 'publicado' and publicado_por = 'manual'
       and (p_precio_lista is null or precio_lista = p_precio_lista)
     order by publicado_en asc nulls first, id asc
     for update
  loop
    exit when v_resta = 0;
    v_toma := least(l.cantidad, v_resta);
    v_destino := null;
    if l.origen_id is not null then
      select * into o from public.compras where id = l.origen_id for update;
      if found and o.estado = 'comprado' and not o.pendiente and o.furni_id = l.furni_id
         and o.moneda_compra = l.moneda_compra and o.precio_compra = l.precio_compra
         and o.numero_ltd is null and l.numero_ltd is null then
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
                                  fecha_compra, origen_id, fuente, pendiente, instancia, sprite_id, notas)
      values (l.propietario, l.furni_id, 'comprado', v_toma, l.moneda_compra, l.precio_compra,
              l.fecha_compra, l.id, l.fuente, false, l.instancia, l.sprite_id, l.notas)
      returning id into v_destino;
    end if;
    v_lotes := v_lotes || jsonb_build_object('desde_lote', l.id, 'hacia_lote', v_destino, 'cantidad', v_toma);
    v_resta := v_resta - v_toma;
  end loop;

  return jsonb_build_object('furni_id', p_furni_id, 'cantidad', v_cant, 'lotes', v_lotes);
end;
$$;

create or replace function public._sniper_recuperar(t public.tokens_sniper, e jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cantidad integer := coalesce(nullif(e->>'cantidad', '')::integer, 1);
  v_furni bigint;
  v_resta integer;
  v_toma integer;
  v_destino bigint;
  v_lotes jsonb := '[]'::jsonb;
  l public.compras%rowtype;
  o public.compras%rowtype;
begin
  if v_cantidad < 1 then raise exception 'La cantidad debe ser mayor o igual a 1.'; end if;
  v_furni := public._sniper_furni(t.propietario, e, false);
  if v_furni is null then
    raise exception 'No hay unidades publicadas del sprite % para recuperar.', coalesce(e->>'sprite_id', '?');
  end if;

  v_resta := v_cantidad;
  for l in
    select * from public.compras
     where propietario = t.propietario and furni_id = v_furni and estado = 'publicado'
     order by case when publicado_por = 'manual' then 1 else 0 end, publicado_en asc nulls first, id asc
     for update
  loop
    exit when v_resta = 0;
    v_toma := least(l.cantidad, v_resta);
    v_destino := null;
    if l.origen_id is not null then
      select * into o from public.compras where id = l.origen_id for update;
      if found and o.estado = 'comprado' and o.furni_id = l.furni_id
         and o.moneda_compra = l.moneda_compra and o.precio_compra = l.precio_compra
         and o.numero_ltd is null and l.numero_ltd is null then
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
                                  fecha_compra, origen_id, fuente, pendiente, instancia, sprite_id, notas)
      values (l.propietario, l.furni_id, 'comprado', v_toma, l.moneda_compra, l.precio_compra,
              l.fecha_compra, l.id, l.fuente, false, l.instancia, l.sprite_id, l.notas)
      returning id into v_destino;
    end if;
    v_lotes := v_lotes || jsonb_build_object('desde_lote', l.id, 'hacia_lote', v_destino, 'cantidad', v_toma);
    v_resta := v_resta - v_toma;
  end loop;

  if v_resta = v_cantidad then
    raise exception 'No hay unidades publicadas del sprite % para recuperar.', coalesce(e->>'sprite_id', '?');
  end if;
  return jsonb_build_object('furni_id', v_furni, 'cantidad', v_cantidad - v_resta, 'faltante', v_resta, 'lotes', v_lotes);
end;
$$;

-- ─── 7. Permisos ─────────────────────────────────────────────────────────────

revoke execute on function public._ltd_evento(jsonb) from public, anon, authenticated;
revoke execute on function public.crear_compra(bigint, text, text, integer, integer, text, numeric, date, text, integer) from public, anon;
revoke execute on function public.asignar_ltd(bigint, integer) from public, anon;
grant execute on function public.crear_compra(bigint, text, text, integer, integer, text, numeric, date, text, integer) to authenticated;
grant execute on function public.asignar_ltd(bigint, integer) to authenticated;
