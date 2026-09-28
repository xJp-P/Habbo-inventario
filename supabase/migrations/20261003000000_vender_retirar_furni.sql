-- =============================================================================
-- Habbo Inventario — Vender y retirar lo publicado de un furni (desde el Mercadillo)
--
-- Requiere 20261002000000_publicar_furni (y las anteriores).
-- Cómo aplicarlo: Supabase → SQL Editor → pega este archivo completo → Run.
-- Es una sola transacción del editor y se puede ejecutar más de una vez.
--
-- QUÉ CAMBIA
--   1. vender_furni(p_furni_id, p_cantidad, p_precio, p_fecha, p_precio_lista):
--      registra la venta de N unidades publicadas de un furni, tomándolas de sus lotes
--      publicados del publicado hace más tiempo al más reciente (FIFO). Con
--      p_precio_lista, solo de los lotes publicados a ese precio. Cada lote se vende con
--      vender_lote: se guarda el NETO (precio − comisión) y la comisión aparte. Sin
--      p_precio, cada lote se vende a su precio de lista.
--   2. retirar_furni(p_furni_id, p_cantidad, p_precio_lista): devuelve a 'comprado' N
--      unidades que publicaste TÚ (lo del Sniper lo mueve el Sniper), en orden FIFO y
--      opcionalmente solo las de un precio de lista. Sin cantidad, todas. Si una parte
--      de un lote sale, el lote se divide; las unidades vuelven a su lote de origen si
--      sigue en mano al mismo costo.
-- =============================================================================

-- ─── 0. Comprobación: 20261002000000 ya está aplicada ───────────────────────

do $$
begin
  if to_regprocedure('public.publicar_furni(bigint, integer, numeric)') is null then
    raise exception 'Falta ejecutar antes 20261002000000_publicar_furni.sql (y las anteriores, en orden).';
  end if;
end;
$$;

-- ─── 1. Vender lo publicado de un furni ──────────────────────────────────────

create or replace function public.vender_furni(
  p_furni_id bigint, p_cantidad integer, p_precio numeric default null,
  p_fecha date default null, p_precio_lista numeric default null)
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
begin
  select * into f from public.furnis where id = p_furni_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'Ese furni no existe.'; end if;
  if p_cantidad is null or p_cantidad < 1 then
    raise exception using errcode = 'PT400', message = 'La cantidad vendida debe ser mayor o igual a 1.';
  end if;

  select coalesce(sum(cantidad), 0) into v_total
    from public.compras
   where furni_id = p_furni_id and estado = 'publicado'
     and (p_precio_lista is null or precio_lista = p_precio_lista);
  if v_total = 0 then
    raise exception using errcode = 'PT400', message = 'No hay unidades publicadas de ese furni'
      || case when p_precio_lista is null then '.' else format(' a %s de lista.', p_precio_lista) end;
  end if;
  if p_cantidad > v_total then
    raise exception using errcode = 'PT400', message = format('Solo hay %s unidad(es) publicadas', v_total)
      || case when p_precio_lista is null then '.' else format(' a %s de lista.', p_precio_lista) end;
  end if;

  v_resta := p_cantidad;
  for l in
    select * from public.compras
     where furni_id = p_furni_id and estado = 'publicado'
       and (p_precio_lista is null or precio_lista = p_precio_lista)
     order by publicado_en asc nulls first, id asc
     for update
  loop
    exit when v_resta = 0;
    v_toma := least(l.cantidad, v_resta);
    v_r := public.vender_lote(l.id, v_toma, null, p_precio, p_fecha);
    v_ventas := v_ventas || (v_r || jsonb_build_object('lote_id', l.id, 'cantidad', v_toma));
    v_resta := v_resta - v_toma;
  end loop;

  return jsonb_build_object('furni_id', p_furni_id, 'cantidad', p_cantidad, 'ventas', v_ventas);
end;
$$;

-- ─── 2. Retirar lo que publicaste tú de un furni ─────────────────────────────

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
         and o.moneda_compra = l.moneda_compra and o.precio_compra = l.precio_compra then
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
         set estado = 'comprado', pendiente = f.precio_venta is null, precio_lista = null, moneda_lista = null,
             publicado_en = null, publicado_por = null
       where id = l.id;
      v_destino := l.id;
    else
      update public.compras set cantidad = cantidad - v_toma where id = l.id;
      insert into public.compras (propietario, furni_id, estado, cantidad, moneda_compra, precio_compra,
                                  fecha_compra, origen_id, fuente, pendiente, instancia, sprite_id, notas)
      values (l.propietario, l.furni_id, 'comprado', v_toma, l.moneda_compra, l.precio_compra,
              l.fecha_compra, l.id, l.fuente, f.precio_venta is null, l.instancia, l.sprite_id, l.notas)
      returning id into v_destino;
    end if;
    v_lotes := v_lotes || jsonb_build_object('desde_lote', l.id, 'hacia_lote', v_destino, 'cantidad', v_toma);
    v_resta := v_resta - v_toma;
  end loop;

  return jsonb_build_object('furni_id', p_furni_id, 'cantidad', v_cant, 'lotes', v_lotes);
end;
$$;

-- ─── 3. Permisos ─────────────────────────────────────────────────────────────

revoke execute on function public.vender_furni(bigint, integer, numeric, date, numeric) from public, anon;
revoke execute on function public.retirar_furni(bigint, integer, numeric) from public, anon;
grant execute on function public.vender_furni(bigint, integer, numeric, date, numeric) to authenticated;
grant execute on function public.retirar_furni(bigint, integer, numeric) to authenticated;
