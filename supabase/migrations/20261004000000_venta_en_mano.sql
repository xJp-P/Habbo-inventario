-- =============================================================================
-- Habbo Inventario — Ventas manuales de lo que tienes en mano (tradeos y otros kekos)
--
-- Requiere 20261003000000_vender_retirar_furni (y las anteriores).
-- Cómo aplicarlo: Supabase → SQL Editor → pega este archivo completo → Run.
-- Es una sola transacción del editor y se puede ejecutar más de una vez.
--
-- QUÉ CAMBIA
--   vender_en_mano(p_furni_id, p_cantidad, p_precio, p_moneda, p_mercadillo, p_fecha,
--                  p_lote_id)
--   registra una venta hecha fuera del Sniper (un tradeo, o una venta desde un keko que
--   no tiene el Sniper) de unidades EN MANO ('comprado'):
--   - Con p_lote_id, de ese lote; sin él, de los lotes en mano del furni, del más
--     antiguo al más nuevo (FIFO; lo "por revisar" del Sniper, al final).
--   - p_mercadillo = true: se vendió en el mercadillo de Habbo (solo créditos). p_precio
--     es lo que pagó el comprador; se guarda el NETO y la comisión en comision_venta.
--   - p_mercadillo = false: tradeo o venta directa, sin comisión; p_precio es lo que
--     recibiste, en créditos o en lingos.
--   Lo publicado no se vende por aquí: eso se registra con «Vendido» en el Mercadillo.
-- =============================================================================

-- ─── 0. Comprobación: 20261003000000 ya está aplicada ───────────────────────

do $$
begin
  if to_regprocedure('public.vender_furni(bigint, integer, numeric, date, numeric)') is null then
    raise exception 'Falta ejecutar antes 20261003000000_vender_retirar_furni.sql (y las anteriores, en orden).';
  end if;
end;
$$;

-- ─── 1. Venta manual de lo que está en mano ──────────────────────────────────

create or replace function public.vender_en_mano(
  p_furni_id bigint, p_cantidad integer, p_precio numeric, p_moneda text default 'creditos',
  p_mercadillo boolean default false, p_fecha date default null, p_lote_id bigint default null)
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
      from public.compras where furni_id = p_furni_id and estado = 'comprado';
  end if;
  if v_total = 0 then
    raise exception using errcode = 'PT400',
      message = 'No tienes unidades en mano de ese furni. Si esta publicado, registra la venta con «Vendido» en el Mercadillo.';
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
     order by pendiente asc, fecha_compra asc nulls first, id asc
     for update
  loop
    exit when v_resta = 0;
    v_toma := least(l.cantidad, v_resta);
    v_r := public.vender_lote(l.id, v_toma, v_moneda, v_neto, p_fecha);
    v_venta := (v_r->>'venta_id')::bigint;
    update public.compras set comision_venta = v_comision where id = v_venta;
    v_ventas := v_ventas || jsonb_build_object('lote_id', l.id, 'venta_id', v_venta, 'cantidad', v_toma);
    v_resta := v_resta - v_toma;
  end loop;

  return jsonb_build_object('furni_id', p_furni_id, 'cantidad', p_cantidad, 'precio_neto', v_neto,
                            'comision', v_comision, 'moneda', v_moneda, 'ventas', v_ventas);
end;
$$;

-- ─── 2. Permisos ─────────────────────────────────────────────────────────────

revoke execute on function public.vender_en_mano(bigint, integer, numeric, text, boolean, date, bigint) from public, anon;
grant execute on function public.vender_en_mano(bigint, integer, numeric, text, boolean, date, bigint) to authenticated;
