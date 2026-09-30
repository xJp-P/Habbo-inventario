-- =============================================================================
-- Habbo Inventario — Inventario y Mercadillo por keko (v1.6.0)
-- Requiere 20261013000000_origen_con_evidencia (y las anteriores).
--
-- El Inventario y el Mercadillo se dividen en un bloque por keko. Para que cada bloque
-- diga la verdad:
--
--   1. Las partes de un lote conservan su keko. Desde la 1.1.0, al publicar, vender o
--      retirar una PARTE de un lote, o al separar una unidad LTD, la fila nueva nacia sin
--      keko (vender_lote, publicar_lote, publicar_furni, retirar_furni, asignar_ltd).
--      Ahora copian el keko, y al volver a Comprado solo se fusionan con su lote de
--      origen si sigue en el MISMO keko (revertir_venta, retirar_lote, retirar_furni).
--   2. Lo publicado y lo vendido que perdio su keko al dividirse lo recupera del lote del
--      que salio (origen_id). Lo que esta en mano sin keko no se toca: se sigue
--      asignando en la Auditoria, como hasta ahora.
--   3. publicar_furni, vender_furni y retirar_furni aceptan p_keko (solo los lotes de ese
--      keko, sin distinguir mayusculas) o p_sin_keko (solo los que no tienen keko). Sin
--      ninguno de los dos, igual que antes: todos los lotes del furni. Asi «Publicar»,
--      «Vendido» y «Retirar» de un bloque solo tocan las unidades de ese keko. Cambian
--      de firma: se borran las viejas.
--   4. listar_kekos devuelve `desde` (el primer token que aprendio el keko, o su alta
--      como keko manual): el orden de los bloques.
-- =============================================================================

-- ─── 0. Comprobación: 20261013000000 ya está aplicada ───────────────────────

do $$
begin
  if to_regprocedure('public._unidades_en_fotos(uuid, text)') is null then
    raise exception 'Falta ejecutar antes 20261013000000_origen_con_evidencia.sql (y las anteriores, en orden).';
  end if;
end;
$$;

-- ─── 1. Las partes de un lote conservan su keko ─────────────────────────────

create or replace function public.vender_lote(
  p_id bigint, p_cantidad integer default null, p_moneda text default null,
  p_precio numeric default null, p_fecha date default null)
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
           comision_venta = v_comision, fecha_venta = v_fecha
     where id = p_id;
    return jsonb_build_object('dividida', false, 'original_id', null, 'venta_id', p_id,
                              'precio_venta', v_precio, 'comision', v_comision);
  end if;

  update public.compras set cantidad = cantidad - v_cant where id = p_id;
  insert into public.compras (propietario, furni_id, estado, cantidad, moneda_compra, precio_compra,
                              moneda_venta, precio_venta, comision_venta, fecha_compra, fecha_venta, origen_id, notas,
                              fuente, pendiente, instancia, sprite_id, precio_lista, moneda_lista, publicado_en, publicado_por, keko)
  values (c.propietario, c.furni_id, 'vendido', v_cant, c.moneda_compra, c.precio_compra,
          v_moneda, v_precio, v_comision, c.fecha_compra, v_fecha, c.id, c.notas,
          c.fuente, false, c.instancia, c.sprite_id, c.precio_lista, c.moneda_lista, c.publicado_en, c.publicado_por, c.keko)
  returning id into v_nuevo;
  return jsonb_build_object('dividida', true, 'original_id', p_id, 'venta_id', v_nuevo,
                            'precio_venta', v_precio, 'comision', v_comision);
end;
$$;

create or replace function public.publicar_lote(
  p_id bigint, p_cantidad integer default null, p_precio_lista numeric default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c public.compras%rowtype;
  v_cant integer;
  v_lista numeric;
  v_nuevo bigint;
begin
  select * into c from public.compras where id = p_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'Ese lote no existe.'; end if;
  if c.estado <> 'comprado' then
    raise exception using errcode = 'PT400', message = format('Solo se publica un lote comprado (este esta %s).', c.estado);
  end if;

  v_cant := coalesce(p_cantidad, c.cantidad);
  if v_cant < 1 then raise exception using errcode = 'PT400', message = 'La cantidad a publicar debe ser mayor o igual a 1.'; end if;
  if v_cant > c.cantidad then
    raise exception using errcode = 'PT400', message = format('Solo hay %s unidad(es) en ese lote.', c.cantidad);
  end if;

  v_lista := p_precio_lista;
  if v_lista is null then raise exception using errcode = 'PT400', message = 'Falta el precio de lista (en creditos).'; end if;
  if v_lista < 0 then raise exception using errcode = 'PT400', message = 'El precio de lista no puede ser negativo.'; end if;

  if v_cant = c.cantidad then
    update public.compras
       set estado = 'publicado', pendiente = false, precio_lista = v_lista, moneda_lista = 'creditos',
           publicado_en = now(), publicado_por = 'manual'
     where id = p_id;
    return jsonb_build_object('dividida', false, 'lote_id', p_id, 'original_id', null);
  end if;

  update public.compras set cantidad = cantidad - v_cant where id = p_id;
  insert into public.compras (propietario, furni_id, estado, cantidad, moneda_compra, precio_compra,
                              fecha_compra, origen_id, fuente, pendiente, instancia, sprite_id, notas,
                              precio_lista, moneda_lista, publicado_en, publicado_por, keko)
  values (c.propietario, c.furni_id, 'publicado', v_cant, c.moneda_compra, c.precio_compra,
          c.fecha_compra, c.id, c.fuente, false, c.instancia, c.sprite_id, c.notas,
          v_lista, 'creditos', now(), 'manual', c.keko)
  returning id into v_nuevo;
  return jsonb_build_object('dividida', true, 'lote_id', v_nuevo, 'original_id', p_id);
end;
$$;

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
                              fecha_compra, fuente, pendiente, instancia, sprite_id, notas, numero_ltd, keko)
  values (c.propietario, c.furni_id, 'comprado', 1, c.moneda_compra, c.precio_compra,
          c.fecha_compra, c.fuente, c.pendiente, c.instancia, c.sprite_id, c.notas, p_numero, c.keko)
  returning id into v_nuevo;
  return jsonb_build_object('lote_id', v_nuevo, 'separado', true, 'original_id', c.id);
end;
$$;

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
       and o.numero_ltd is null and c.numero_ltd is null
       and o.keko is not distinct from c.keko then
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

-- ─── 2. Lo publicado y lo vendido recuperan el keko de su lote de origen ────
-- Repite hasta que no quede nada: una venta que salio de un publicado que salio de un
-- lote en mano recibe el keko en la segunda vuelta.

do $$
declare
  v_filas integer;
begin
  loop
    update public.compras c
       set keko = o.keko
      from public.compras o
     where c.origen_id = o.id and c.propietario = o.propietario
       and c.keko is null and o.keko is not null
       and c.estado in ('publicado', 'vendido');
    get diagnostics v_filas = row_count;
    exit when v_filas = 0;
  end loop;
end;
$$;

-- ─── 3. Publicar, vender y retirar un furni desde un keko ───────────────────

drop function if exists public.publicar_furni(bigint, integer, numeric);
drop function if exists public.vender_furni(bigint, integer, numeric, date, numeric);
drop function if exists public.retirar_furni(bigint, integer, numeric);

create or replace function public.publicar_furni(
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
  v_total integer;
  v_cant integer;
  v_lista numeric;
  v_resta integer;
  v_toma integer;
  v_nuevo bigint;
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
    from public.compras where furni_id = p_furni_id and estado = 'comprado' and not pendiente
     and (not v_sin or keko is null) and (v_keko is null or lower(keko) = lower(v_keko));
  if v_total = 0 then
    raise exception using errcode = 'PT400',
      message = format('No hay unidades en mano de ese furni%s para publicar (lo "por revisar" lo publica el Sniper).', v_donde);
  end if;

  v_cant := coalesce(p_cantidad, v_total);
  if v_cant < 1 then raise exception using errcode = 'PT400', message = 'La cantidad a publicar debe ser mayor o igual a 1.'; end if;
  if v_cant > v_total then
    raise exception using errcode = 'PT400', message = format('Solo tienes %s unidad(es) en mano de ese furni%s.', v_total, v_donde);
  end if;

  v_lista := p_precio_lista;
  if v_lista is null then raise exception using errcode = 'PT400', message = 'Falta el precio de lista (en creditos).'; end if;
  if v_lista < 0 then raise exception using errcode = 'PT400', message = 'El precio de lista no puede ser negativo.'; end if;

  v_resta := v_cant;
  for l in
    select * from public.compras
     where furni_id = p_furni_id and estado = 'comprado' and not pendiente
       and (not v_sin or keko is null) and (v_keko is null or lower(keko) = lower(v_keko))
     order by fecha_compra asc nulls first, id asc
     for update
  loop
    exit when v_resta = 0;
    v_toma := least(l.cantidad, v_resta);
    if v_toma = l.cantidad then
      update public.compras
         set estado = 'publicado', precio_lista = v_lista, moneda_lista = 'creditos',
             publicado_en = now(), publicado_por = 'manual'
       where id = l.id;
      v_lotes := v_lotes || jsonb_build_object('lote_id', l.id, 'cantidad', v_toma, 'dividido', false);
    else
      update public.compras set cantidad = cantidad - v_toma where id = l.id;
      insert into public.compras (propietario, furni_id, estado, cantidad, moneda_compra, precio_compra,
                                  fecha_compra, origen_id, fuente, pendiente, instancia, sprite_id, notas,
                                  precio_lista, moneda_lista, publicado_en, publicado_por, keko)
      values (l.propietario, l.furni_id, 'publicado', v_toma, l.moneda_compra, l.precio_compra,
              l.fecha_compra, l.id, l.fuente, false, l.instancia, l.sprite_id, l.notas,
              v_lista, 'creditos', now(), 'manual', l.keko)
      returning id into v_nuevo;
      v_lotes := v_lotes || jsonb_build_object('lote_id', v_nuevo, 'origen_id', l.id, 'cantidad', v_toma, 'dividido', true);
    end if;
    v_resta := v_resta - v_toma;
  end loop;

  return jsonb_build_object('furni_id', p_furni_id, 'cantidad', v_cant, 'en_mano', v_total - v_cant,
                            'precio_lista', v_lista, 'lotes', v_lotes);
end;
$$;

create or replace function public.vender_furni(
  p_furni_id bigint, p_cantidad integer, p_precio numeric default null,
  p_fecha date default null, p_precio_lista numeric default null,
  p_keko text default null, p_sin_keko boolean default false)
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
    v_r := public.vender_lote(l.id, v_toma, null, p_precio, p_fecha);
    v_ventas := v_ventas || (v_r || jsonb_build_object('lote_id', l.id, 'cantidad', v_toma));
    v_resta := v_resta - v_toma;
  end loop;

  return jsonb_build_object('furni_id', p_furni_id, 'cantidad', p_cantidad, 'ventas', v_ventas);
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
   where furni_id = p_furni_id and estado = 'publicado' and publicado_por = 'manual'
     and (p_precio_lista is null or precio_lista = p_precio_lista)
     and (not v_sin or keko is null) and (v_keko is null or lower(keko) = lower(v_keko));
  if v_total = 0 then
    raise exception using errcode = 'PT400',
      message = format('No hay unidades de ese furni%s que hayas publicado tú. Lo que publicó el Sniper se retira desde el juego (el Sniper avisa).', v_donde);
  end if;

  v_cant := coalesce(p_cantidad, v_total);
  if v_cant < 1 then raise exception using errcode = 'PT400', message = 'La cantidad a retirar debe ser mayor o igual a 1.'; end if;
  if v_cant > v_total then
    raise exception using errcode = 'PT400', message = format('Solo hay %s unidad(es)%s que hayas publicado tú.', v_total, v_donde);
  end if;

  v_resta := v_cant;
  for l in
    select * from public.compras
     where furni_id = p_furni_id and estado = 'publicado' and publicado_por = 'manual'
       and (p_precio_lista is null or precio_lista = p_precio_lista)
       and (not v_sin or keko is null) and (v_keko is null or lower(keko) = lower(v_keko))
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

-- ─── 4. listar_kekos con la fecha de cada keko ──────────────────────────────

create or replace function public.listar_kekos()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with snipers as (
    select t.keko as nombre, jsonb_agg(distinct t.nombre) as tokens
      from public.tokens_sniper t where t.keko is not null group by t.keko
  ),
  detectados as (
    select nombre from snipers
    union
    select keko from public.inventario_habbo
  ),
  todos as (
    select nombre from detectados
    union
    select k.nombre from public.kekos k
     where not exists (select 1 from detectados d where lower(d.nombre) = lower(k.nombre))
  ),
  -- Desde cuando existe cada keko: el primer token que lo aprendio (Sniper) o su alta en
  -- kekos (manual). El Inventario y el Mercadillo ordenan sus bloques con esto.
  alta_sniper as (
    select lower(t.keko) as clave, min(t.creado_en) as desde
      from public.tokens_sniper t where t.keko is not null group by lower(t.keko)
  ),
  unidades as (
    select c.keko as nombre,
           coalesce(sum(c.cantidad) filter (where c.estado = 'comprado'), 0)::integer as en_mano,
           coalesce(sum(c.cantidad) filter (where c.estado = 'publicado'), 0)::integer as publicadas
      from public.compras c where c.keko is not null group by c.keko
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'nombre', x.nombre,
           'origen', case when d.nombre is not null then 'sniper' else 'manual' end,
           'id', m.id,
           'snipers', coalesce(s.tokens, '[]'::jsonb),
           'en_mano', coalesce(u.en_mano, 0),
           'publicadas', coalesce(u.publicadas, 0),
           'desde', case when d.nombre is not null then coalesce(a.desde, m.creado_en) else m.creado_en end)
         order by (d.nombre is null), lower(x.nombre)), '[]'::jsonb)
    from todos x
    left join detectados d on d.nombre = x.nombre
    left join public.kekos m on lower(m.nombre) = lower(x.nombre)
    left join snipers s on s.nombre = x.nombre
    left join unidades u on u.nombre = x.nombre
    left join alta_sniper a on a.clave = lower(x.nombre);
$$;

-- ─── 5. Permisos ─────────────────────────────────────────────────────────────

revoke execute on function public.publicar_furni(bigint, integer, numeric, text, boolean) from public, anon;
revoke execute on function public.vender_furni(bigint, integer, numeric, date, numeric, text, boolean) from public, anon;
revoke execute on function public.retirar_furni(bigint, integer, numeric, text, boolean) from public, anon;
grant execute on function public.publicar_furni(bigint, integer, numeric, text, boolean) to authenticated;
grant execute on function public.vender_furni(bigint, integer, numeric, date, numeric, text, boolean) to authenticated;
grant execute on function public.retirar_furni(bigint, integer, numeric, text, boolean) to authenticated;
