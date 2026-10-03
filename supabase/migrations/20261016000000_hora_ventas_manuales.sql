-- =============================================================================
-- Habbo Inventario — La hora y el origen de las ventas manuales (v1.9.0)
-- Requiere 20261015000000_ventas_sniper (y las anteriores).
-- Cómo aplicarlo: Supabase → SQL Editor → pega este archivo completo → Run.
-- Es una sola transacción del editor y se puede ejecutar más de una vez.
--
-- El Historial de ventas ordena todas las ventas de la cuenta por su hora. Hasta la 1.8.0
-- solo el Sniper guardaba la hora exacta (vendido_en, migracion 19); las ventas que
-- registra el usuario guardaban solo el dia y vendido_por quedaba vacio. Desde aqui:
--
--   1. vender_lote, vender_furni y vender_en_mano (las ventas a mano: «Vendido» de un
--      lote, «Vendido» del Mercadillo y la venta manual) aceptan p_vendido_en, la hora de
--      la venta. La app la manda solo cuando la venta es del dia de hoy: es el momento en
--      que se registra. Una venta de otro dia no inventa una hora. Una hora en el futuro
--      (el reloj del equipo adelantado) queda en la hora de la base.
--   2. Toda venta a mano guarda vendido_por = 'manual'. El Sniper sigue igual: su venta
--      pasa por vender_lote y _vender_lote_sniper la marca 'sniper' con la hora de Habbo.
--   3. Lo ya vendido no se toca: sin hora y con vendido_por vacio (la app lo muestra como
--      venta manual, o del Excel si vino de ahi).
--
-- Las tres funciones cambian de firma (un parametro nuevo con valor por defecto): se
-- borran las viejas para que ninguna llamada quede ambigua. revertir_venta ya limpia
-- vendido_por y vendido_en (migracion 19).
-- =============================================================================

-- ─── 0. Comprobación: 20261015000000 ya está aplicada ───────────────────────

do $$
begin
  if to_regprocedure('public.aplicar_venta_por_asignar(bigint, bigint)') is null then
    raise exception 'Falta ejecutar antes 20261015000000_ventas_sniper.sql (y las anteriores, en orden).';
  end if;
end;
$$;

-- ─── 1. Las firmas viejas ────────────────────────────────────────────────────

drop function if exists public.vender_lote(bigint, integer, text, numeric, date);
drop function if exists public.vender_furni(bigint, integer, numeric, date, numeric, text, boolean);
drop function if exists public.vender_en_mano(bigint, integer, numeric, text, boolean, date, bigint, text);

-- ─── 2. Vender un lote (o una parte) ────────────────────────────────────────
-- Igual que en 20261014000000, más vendido_por = 'manual' y la hora de la venta.

create or replace function public.vender_lote(
  p_id bigint, p_cantidad integer default null, p_moneda text default null,
  p_precio numeric default null, p_fecha date default null, p_vendido_en timestamptz default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c public.compras%rowtype;
  v_cant integer;
  v_moneda text;
  v_precio numeric;
  v_comision numeric;
  v_fecha date := coalesce(p_fecha, current_date);
  -- least() ignora los null: sin hora, sin hora.
  v_hora timestamptz := case when p_vendido_en is null then null else least(p_vendido_en, now()) end;
  v_nuevo bigint;
begin
  select * into c from public.compras where id = p_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'Ese lote no existe.'; end if;
  if c.estado not in ('comprado', 'publicado') then
    raise exception using errcode = 'PT400', message = 'Ese lote ya esta vendido.';
  end if;

  v_cant := coalesce(p_cantidad, c.cantidad);
  if v_cant < 1 then raise exception using errcode = 'PT400', message = 'La cantidad a vender debe ser mayor o igual a 1.'; end if;
  if v_cant > c.cantidad then
    raise exception using errcode = 'PT400', message = format('Solo hay %s unidad(es) en ese lote.', c.cantidad);
  end if;

  -- Sin precio explicito, solo lo publicado tiene uno: su precio de lista.
  v_moneda := coalesce(p_moneda, case when c.estado = 'publicado' then c.moneda_lista end, 'creditos');
  v_precio := coalesce(p_precio, case when c.estado = 'publicado' then c.precio_lista end);
  if v_precio is null then raise exception using errcode = 'PT400', message = 'Falta el precio de venta.'; end if;
  if v_precio < 0 then raise exception using errcode = 'PT400', message = 'El precio de venta no puede ser negativo.'; end if;

  -- Venta en el mercadillo de Habbo.es: entra al monedero el precio menos la comisión.
  if c.estado = 'publicado' and v_moneda = 'creditos' then
    v_comision := public.comision_mercadillo(v_precio);
    v_precio := v_precio - v_comision;
  end if;

  if v_cant = c.cantidad then
    update public.compras
       set estado = 'vendido', pendiente = false, moneda_venta = v_moneda, precio_venta = v_precio,
           comision_venta = v_comision, fecha_venta = v_fecha, vendido_por = 'manual', vendido_en = v_hora
     where id = p_id;
    return jsonb_build_object('dividida', false, 'original_id', null, 'venta_id', p_id,
                              'precio_venta', v_precio, 'comision', v_comision);
  end if;

  update public.compras set cantidad = cantidad - v_cant where id = p_id;
  insert into public.compras (propietario, furni_id, estado, cantidad, moneda_compra, precio_compra,
                              moneda_venta, precio_venta, comision_venta, fecha_compra, fecha_venta, origen_id, notas,
                              fuente, pendiente, instancia, sprite_id, precio_lista, moneda_lista, publicado_en, publicado_por, keko,
                              vendido_por, vendido_en)
  values (c.propietario, c.furni_id, 'vendido', v_cant, c.moneda_compra, c.precio_compra,
          v_moneda, v_precio, v_comision, c.fecha_compra, v_fecha, c.id, c.notas,
          c.fuente, false, c.instancia, c.sprite_id, c.precio_lista, c.moneda_lista, c.publicado_en, c.publicado_por, c.keko,
          'manual', v_hora)
  returning id into v_nuevo;
  return jsonb_build_object('dividida', true, 'original_id', p_id, 'venta_id', v_nuevo,
                            'precio_venta', v_precio, 'comision', v_comision);
end;
$$;

-- ─── 3. Vender lo publicado de un furni (Mercadillo y Publicado) ────────────
-- Igual que en 20261014000000, más p_vendido_en para cada vender_lote.

create or replace function public.vender_furni(
  p_furni_id bigint, p_cantidad integer, p_precio numeric default null,
  p_fecha date default null, p_precio_lista numeric default null,
  p_keko text default null, p_sin_keko boolean default false, p_vendido_en timestamptz default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  f public.furnis%rowtype;
  l public.compras%rowtype;
  v_total integer;
  v_resta integer;
  v_toma integer;
  v_r jsonb;
  v_ventas jsonb := '[]'::jsonb;
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
  if p_cantidad is null or p_cantidad < 1 then
    raise exception using errcode = 'PT400', message = 'La cantidad vendida debe ser mayor o igual a 1.';
  end if;

  select coalesce(sum(cantidad), 0) into v_total
    from public.compras
   where furni_id = p_furni_id and estado = 'publicado'
     and (p_precio_lista is null or precio_lista = p_precio_lista)
     and (not v_sin or keko is null) and (v_keko is null or lower(keko) = lower(v_keko));
  if v_total = 0 then
    raise exception using errcode = 'PT400', message = 'No hay unidades publicadas de ese furni' || v_donde
      || case when p_precio_lista is null then '.' else format(' a %s de lista.', p_precio_lista) end;
  end if;
  if p_cantidad > v_total then
    raise exception using errcode = 'PT400', message = format('Solo hay %s unidad(es) publicadas', v_total) || v_donde
      || case when p_precio_lista is null then '.' else format(' a %s de lista.', p_precio_lista) end;
  end if;

  v_resta := p_cantidad;
  for l in
    select * from public.compras
     where furni_id = p_furni_id and estado = 'publicado'
       and (p_precio_lista is null or precio_lista = p_precio_lista)
       and (not v_sin or keko is null) and (v_keko is null or lower(keko) = lower(v_keko))
     order by publicado_en asc nulls first, id asc
     for update
  loop
    exit when v_resta = 0;
    v_toma := least(l.cantidad, v_resta);
    v_r := public.vender_lote(l.id, v_toma, null, p_precio, p_fecha, p_vendido_en);
    v_ventas := v_ventas || (v_r || jsonb_build_object('lote_id', l.id, 'cantidad', v_toma));
    v_resta := v_resta - v_toma;
  end loop;

  return jsonb_build_object('furni_id', p_furni_id, 'cantidad', p_cantidad, 'ventas', v_ventas);
end;
$$;

-- ─── 4. Venta manual de lo que está en mano ─────────────────────────────────
-- Igual que en 20261007000000, más p_vendido_en para cada vender_lote.

create or replace function public.vender_en_mano(
  p_furni_id bigint, p_cantidad integer, p_precio numeric, p_moneda text default 'creditos',
  p_mercadillo boolean default false, p_fecha date default null, p_lote_id bigint default null,
  p_keko text default null, p_vendido_en timestamptz default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  f public.furnis%rowtype;
  l public.compras%rowtype;
  v_moneda text := lower(coalesce(nullif(trim(p_moneda), ''), 'creditos'));
  v_total integer;
  v_comision numeric;
  v_neto numeric;
  v_resta integer;
  v_toma integer;
  v_r jsonb;
  v_venta bigint;
  v_ventas jsonb := '[]'::jsonb;
  v_keko text := nullif(trim(coalesce(p_keko, '')), '');
begin
  select * into f from public.furnis where id = p_furni_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'Ese furni no existe.'; end if;
  if p_cantidad is null or p_cantidad < 1 then
    raise exception using errcode = 'PT400', message = 'La cantidad vendida debe ser mayor o igual a 1.';
  end if;
  if p_precio is null or p_precio < 0 then
    raise exception using errcode = 'PT400', message = 'Falta el precio de venta (mayor o igual a 0).';
  end if;
  if v_moneda not in ('creditos', 'lingos') then
    raise exception using errcode = 'PT400', message = 'Moneda no valida: usa creditos o lingos.';
  end if;
  if coalesce(p_mercadillo, false) and v_moneda <> 'creditos' then
    raise exception using errcode = 'PT400', message = 'El mercadillo de Habbo cobra en creditos.';
  end if;

  if p_lote_id is not null then
    select * into l from public.compras where id = p_lote_id for update;
    if not found or l.furni_id <> p_furni_id then
      raise exception using errcode = 'PT404', message = 'Ese lote no es de este furni.';
    end if;
    if l.estado <> 'comprado' then
      raise exception using errcode = 'PT400', message = 'Ese lote no esta en mano: si esta publicado, registra la venta con «Vendido» en el Mercadillo.';
    end if;
    v_total := l.cantidad;
  else
    select coalesce(sum(cantidad), 0) into v_total
      from public.compras where furni_id = p_furni_id and estado = 'comprado'
       and (v_keko is null or keko = v_keko);
  end if;
  if v_total = 0 then
    raise exception using errcode = 'PT400',
      message = case when v_keko is null
        then 'No tienes unidades en mano de ese furni. Si esta publicado, registra la venta con «Vendido» en el Mercadillo.'
        else format('No tienes unidades en mano de ese furni en el keko %s.', v_keko) end;
  end if;
  if p_cantidad > v_total then
    raise exception using errcode = 'PT400', message = format('Solo tienes %s unidad(es) en mano', v_total)
      || case when p_lote_id is null then ' de ese furni.' else ' en ese lote.' end;
  end if;

  -- En el mercadillo entra el precio menos la comisión; en un tradeo, el precio tal cual.
  if coalesce(p_mercadillo, false) then
    v_comision := public.comision_mercadillo(p_precio);
  end if;
  v_neto := p_precio - coalesce(v_comision, 0);

  v_resta := p_cantidad;
  for l in
    select * from public.compras
     where furni_id = p_furni_id and estado = 'comprado'
       and (p_lote_id is null or id = p_lote_id)
       and (p_lote_id is not null or v_keko is null or keko = v_keko)
     order by pendiente asc, fecha_compra asc nulls first, id asc
     for update
  loop
    exit when v_resta = 0;
    v_toma := least(l.cantidad, v_resta);
    v_r := public.vender_lote(l.id, v_toma, v_moneda, v_neto, p_fecha, p_vendido_en);
    v_venta := (v_r->>'venta_id')::bigint;
    update public.compras set comision_venta = v_comision where id = v_venta;
    v_ventas := v_ventas || jsonb_build_object('lote_id', l.id, 'venta_id', v_venta, 'cantidad', v_toma);
    v_resta := v_resta - v_toma;
  end loop;

  return jsonb_build_object('furni_id', p_furni_id, 'cantidad', p_cantidad, 'precio_neto', v_neto,
                            'comision', v_comision, 'moneda', v_moneda, 'ventas', v_ventas);
end;
$$;

-- ─── 5. Permisos ─────────────────────────────────────────────────────────────

revoke execute on function public.vender_lote(bigint, integer, text, numeric, date, timestamptz) from public, anon;
revoke execute on function public.vender_furni(bigint, integer, numeric, date, numeric, text, boolean, timestamptz) from public, anon;
revoke execute on function public.vender_en_mano(bigint, integer, numeric, text, boolean, date, bigint, text, timestamptz) from public, anon;
grant execute on function public.vender_lote(bigint, integer, text, numeric, date, timestamptz) to authenticated;
grant execute on function public.vender_furni(bigint, integer, numeric, date, numeric, text, boolean, timestamptz) to authenticated;
grant execute on function public.vender_en_mano(bigint, integer, numeric, text, boolean, date, bigint, text, timestamptz) to authenticated;
