-- =============================================================================
-- Habbo Inventario — Sin precio de referencia del furni
--
-- Requiere 20261004000000_venta_en_mano (y las anteriores).
-- Cómo aplicarlo: Supabase → SQL Editor → pega este archivo completo → Run.
-- Es una sola transacción del editor y se puede ejecutar más de una vez.
--
-- REGLA: lo que está EN MANO ('comprado') no tiene precio de venta ni ganancia
-- esperada; solo se sabe lo que costó. El precio se fija ÚNICAMENTE al publicar (precio
-- de lista) o al vender (precio real). La ganancia esperada, la comisión, el margen y
-- la alerta de pérdida salen SOLO de lo publicado.
--
-- QUÉ CAMBIA
--   1. v_compras: un lote 'comprado' ya no se valora (precio, ganancia, margen y
--      comisión quedan vacíos). Lo publicado se valora a su precio de lista y lo vendido
--      al precio real, como antes.
--   2. v_furnis: venta, comisión y ganancia esperadas solo de lo publicado
--      (inversion_publicada_cr, costo_publicado_cr); en_perdida = lo publicado no cubre
--      lo que costó. Ya no expone el precio de venta del furni.
--   3. Sin valores por defecto tomados del furni: vender un lote en mano y publicar a
--      mano exigen su precio.
--   4. activar_pendientes(p_furni_id, p_compra_ids): confirma lo "por revisar" del Sniper
--      sin pedir precio (reemplaza a la versión que fijaba el precio del furni).
--   5. Lo que vuelve a mano (recuperar del Sniper, retirar) ya no queda "por revisar".
--   Las columnas furnis.precio_venta y furnis.moneda_venta quedan en desuso, con su dato
--   (el que venía del Excel); no se borran.
-- =============================================================================

-- ─── 0. Comprobación: 20261004000000 ya está aplicada ───────────────────────

do $$
begin
  if to_regprocedure('public.vender_en_mano(bigint, integer, numeric, text, boolean, date, bigint)') is null then
    raise exception 'Falta ejecutar antes 20261004000000_venta_en_mano.sql (y las anteriores, en orden).';
  end if;
end;
$$;

comment on column public.furnis.precio_venta is 'En desuso desde 20261005000000: el precio se fija al publicar o al vender. Se conserva el dato importado.';
comment on column public.furnis.moneda_venta is 'En desuso desde 20261005000000 (ver precio_venta).';

-- ─── 1. Vistas: solo lo publicado tiene precio esperado ──────────────────────

drop view if exists public.v_furnis;
drop view if exists public.v_compras;

-- Lotes. *_cr = Créditos, *_lg = Lingos. Lo publicado se valora a su precio de lista y
-- lo vendido al precio real congelado (neto si fue en el mercadillo). Lo que está en
-- mano ('comprado') no tiene precio: su ganancia, margen y comisión quedan vacíos.
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
        c.estado, c.pendiente, c.fuente, c.id_externo, c.instancia, c.sprite_id,
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

-- Furnis con agregados de sus lotes. El stock incluye lo en mano, lo por revisar y lo
-- publicado; la venta, la comisión y la ganancia esperadas son SOLO de lo publicado.
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

-- ─── 2. Vender y publicar sin precio por defecto del furni ───────────────────

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
                              fuente, pendiente, instancia, sprite_id, precio_lista, moneda_lista, publicado_en, publicado_por)
  values (c.propietario, c.furni_id, 'vendido', v_cant, c.moneda_compra, c.precio_compra,
          v_moneda, v_precio, v_comision, c.fecha_compra, v_fecha, c.id, c.notas,
          c.fuente, false, c.instancia, c.sprite_id, c.precio_lista, c.moneda_lista, c.publicado_en, c.publicado_por)
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
                              precio_lista, moneda_lista, publicado_en, publicado_por)
  values (c.propietario, c.furni_id, 'publicado', v_cant, c.moneda_compra, c.precio_compra,
          c.fecha_compra, c.id, c.fuente, false, c.instancia, c.sprite_id, c.notas,
          v_lista, 'creditos', now(), 'manual')
  returning id into v_nuevo;
  return jsonb_build_object('dividida', true, 'lote_id', v_nuevo, 'original_id', p_id);
end;
$$;

create or replace function public.publicar_furni(
  p_furni_id bigint, p_cantidad integer default null, p_precio_lista numeric default null)
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
begin
  select * into f from public.furnis where id = p_furni_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'Ese furni no existe.'; end if;

  select coalesce(sum(cantidad), 0) into v_total
    from public.compras where furni_id = p_furni_id and estado = 'comprado' and not pendiente;
  if v_total = 0 then
    raise exception using errcode = 'PT400',
      message = 'No hay unidades en mano de ese furni para publicar (lo "por revisar" lo publica el Sniper).';
  end if;

  v_cant := coalesce(p_cantidad, v_total);
  if v_cant < 1 then raise exception using errcode = 'PT400', message = 'La cantidad a publicar debe ser mayor o igual a 1.'; end if;
  if v_cant > v_total then
    raise exception using errcode = 'PT400', message = format('Solo tienes %s unidad(es) en mano de ese furni.', v_total);
  end if;

  v_lista := p_precio_lista;
  if v_lista is null then raise exception using errcode = 'PT400', message = 'Falta el precio de lista (en creditos).'; end if;
  if v_lista < 0 then raise exception using errcode = 'PT400', message = 'El precio de lista no puede ser negativo.'; end if;

  v_resta := v_cant;
  for l in
    select * from public.compras
     where furni_id = p_furni_id and estado = 'comprado' and not pendiente
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
                                  precio_lista, moneda_lista, publicado_en, publicado_por)
      values (l.propietario, l.furni_id, 'publicado', v_toma, l.moneda_compra, l.precio_compra,
              l.fecha_compra, l.id, l.fuente, false, l.instancia, l.sprite_id, l.notas,
              v_lista, 'creditos', now(), 'manual')
      returning id into v_nuevo;
      v_lotes := v_lotes || jsonb_build_object('lote_id', v_nuevo, 'origen_id', l.id, 'cantidad', v_toma, 'dividido', true);
    end if;
    v_resta := v_resta - v_toma;
  end loop;

  return jsonb_build_object('furni_id', p_furni_id, 'cantidad', v_cant, 'en_mano', v_total - v_cant,
                            'precio_lista', v_lista, 'lotes', v_lotes);
end;
$$;

-- ─── 3. Lo que vuelve a mano ya no queda "por revisar" ───────────────────────

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
       and o.moneda_compra = c.moneda_compra and o.precio_compra = c.precio_compra then
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

-- ─── 4. Confirmar lo "por revisar" sin precio ────────────────────────────────

drop function if exists public.activar_pendientes(bigint, bigint[], numeric, text);

-- Pasa a en mano los lotes "por revisar" de un furni (todos, o los indicados). Ya no pide
-- ni guarda precio.
create or replace function public.activar_pendientes(
  p_furni_id bigint default null, p_compra_ids bigint[] default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_furni bigint := p_furni_id;
  v_furnis bigint[];
  v_n integer;
begin
  if v_furni is null then
    if p_compra_ids is null or cardinality(p_compra_ids) = 0 then
      raise exception using errcode = 'PT400', message = 'Indica el furni o los lotes a confirmar.';
    end if;
    select array_agg(distinct furni_id) into v_furnis from public.compras where id = any (p_compra_ids);
    if v_furnis is null or cardinality(v_furnis) <> 1 then
      raise exception using errcode = 'PT400', message = 'Confirma los lotes de un furni a la vez.';
    end if;
    v_furni := v_furnis[1];
  end if;

  perform 1 from public.furnis where id = v_furni for update;
  if not found then raise exception using errcode = 'PT404', message = 'Ese furni no existe.'; end if;

  if p_compra_ids is not null and exists (
       select 1 from public.compras where id = any (p_compra_ids) and furni_id <> v_furni) then
    raise exception using errcode = 'PT400', message = 'Hay lotes de otro furni en la seleccion.';
  end if;

  update public.compras set pendiente = false
   where furni_id = v_furni and estado = 'comprado' and pendiente
     and (p_compra_ids is null or id = any (p_compra_ids));
  get diagnostics v_n = row_count;
  return jsonb_build_object('activados', v_n, 'furni_id', v_furni);
end;
$$;

-- ─── 5. Permisos ─────────────────────────────────────────────────────────────

revoke execute on function public.activar_pendientes(bigint, bigint[]) from public, anon;
grant execute on function public.activar_pendientes(bigint, bigint[]) to authenticated;
