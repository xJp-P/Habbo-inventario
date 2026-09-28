-- =============================================================================
-- Habbo Inventario — Fase 2.2: las ventas del mercadillo guardan el NETO
--
-- Requiere las migraciones anteriores (hasta 20260929000000_precio_lista_y_comision).
-- Cómo aplicarlo: Supabase → SQL Editor → pega este archivo completo → Run.
-- Es una sola transacción del editor: si algo falla, no queda nada a medias.
-- Se puede ejecutar más de una vez sin efectos dobles.
--
-- QUÉ CAMBIA
--   Al registrar la venta de un lote 'publicado' (Publicado → Vendido) con precio en
--   créditos, el precio que se congela es lo que ENTRÓ A TU MONEDERO:
--       precio del mercadillo − comisión    (150 → 146, 2.500 → 2.442)
--   La comisión cobrada queda aparte, en la columna nueva compras.comision_venta, así
--   que el precio pagado por el comprador se puede reconstruir (neto + comisión).
--   Con eso, la ganancia realizada y el ROI salen de los créditos reales.
--   - El precio que recibe vender_lote para un lote publicado es el del mercadillo (el
--     que pagó el comprador; sin precio, el de lista). La función descuenta la comisión.
--   - En lingos no hay comisión (es un intercambio directo): se guarda tal cual.
--   - Vender un lote 'comprado' no cambia: se guarda el precio que anotes.
--   - Revertir la venta borra también la comisión.
--
-- VENTAS YA REGISTRADAS
--   Las ventas hechas desde 'Publicado' antes de esta migración (se reconocen porque la
--   fila vendida conserva su precio_lista) guardaban el precio bruto. Se pasan a neto
--   una sola vez: comision_venta = comisión, precio_venta = precio − comisión. Las
--   ventas importadas del Excel y las de lotes 'comprado' no se tocan.
-- =============================================================================

-- ─── 1. Comisión cobrada en cada venta ───────────────────────────────────────

alter table public.compras add column if not exists comision_venta numeric;
alter table public.compras drop constraint if exists compras_comision_venta_valida;
alter table public.compras add constraint compras_comision_venta_valida
  check (comision_venta is null or (comision_venta >= 0 and estado = 'vendido'));

-- ─── 2. Ventas ya registradas desde 'Publicado': a neto (una sola vez) ────────

update public.compras
   set comision_venta = public.comision_mercadillo(precio_venta),
       precio_venta = precio_venta - public.comision_mercadillo(precio_venta)
 where estado = 'vendido'
   and precio_lista is not null
   and moneda_venta = 'creditos'
   and precio_venta is not null
   and comision_venta is null;

-- ─── 3. Vistas (v_compras expone la comisión pagada) ─────────────────────────

drop view if exists public.v_furnis;
drop view if exists public.v_compras;

-- Lotes. *_cr = Créditos, *_lg = Lingos. Lo publicado se valora a su precio de lista;
-- lo vendido, al precio real congelado (neto: lo que entró al monedero); lo comprado,
-- al precio actual del furni. comision_cr es por unidad y es la que FALTA descontar
-- (la del mercadillo si el lote sigue en stock y su precio está en créditos; 0 en lo
-- vendido). comision_pagada_cr es por unidad y es la que ya se cobró al vender.
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
        c.moneda_lista, c.precio_lista, c.publicado_en,
        c.fecha_compra, c.fecha_venta, c.origen_id, c.notas, c.creado_en,
        t.tasa,
        case c.moneda_compra when 'lingos' then c.precio_compra * t.tasa else c.precio_compra end as precio_compra_cr,
        case c.moneda_lista when 'lingos' then c.precio_lista * t.tasa else c.precio_lista end    as precio_lista_cr,
        case
          when c.estado = 'vendido' then
            case c.moneda_venta when 'lingos' then c.precio_venta * t.tasa else c.precio_venta end
          when c.estado = 'publicado' then
            case c.moneda_lista when 'lingos' then c.precio_lista * t.tasa else c.precio_lista end
          else
            case f.moneda_venta when 'lingos' then f.precio_venta * t.tasa else f.precio_venta end
        end as precio_venta_cr,
        case
          when c.estado = 'vendido' then c.moneda_venta
          when c.estado = 'publicado' then c.moneda_lista
          else f.moneda_venta
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

-- Furnis con agregados de sus lotes (igual que en 20260929000000, más la comisión ya
-- pagada en sus ventas).
create view public.v_furnis with (security_invoker = true) as
select
  s.*,
  s.stock - s.unidades_pendientes                                          as stock_activo,
  s.costo_promedio_cr / s.tasa                                             as costo_promedio_lg,
  case when s.stock > 0 and s.lotes_sin_precio = 0 then s.venta_neta_cr end                     as venta_esperada_cr,
  case when s.stock > 0 and s.lotes_sin_precio = 0 then s.venta_bruta_cr end                    as venta_esperada_bruta_cr,
  case when s.stock > 0 and s.lotes_sin_precio = 0 then s.comision_total_cr end                 as comision_esperada_cr,
  case when s.stock > 0 and s.lotes_sin_precio = 0 then s.venta_neta_cr - s.inversion_cr end    as ganancia_esperada_cr,
  case when s.stock > 0 and s.lotes_sin_precio = 0 then (s.venta_neta_cr - s.inversion_cr) / s.tasa end as ganancia_esperada_lg,
  case when s.stock > 0 and s.lotes_sin_precio = 0 then s.venta_bruta_cr - s.inversion_cr end   as ganancia_esperada_bruta_cr,
  case when s.costo_promedio_cr is null then null
       when s.moneda_venta = 'lingos' then ceil(s.costo_promedio_cr)
       else public.precio_minimo_mercadillo(s.costo_promedio_cr) end       as precio_minimo_cr,
  case when s.unidades_compradas = 0 then 'sin_compras'
       when s.stock = 0 then 'agotado'
       when s.unidades_publicadas = s.stock then 'publicado'
       when s.stock - s.unidades_pendientes - s.unidades_publicadas <= 0 then 'por_revisar'
       else 'en_venta' end                                                 as estado,
  (s.precio_venta_cr is not null and s.costo_promedio_cr is not null
     and case when s.moneda_venta = 'lingos' then s.precio_venta_cr
              else public.neto_mercadillo(s.precio_venta_cr) end < s.costo_promedio_cr) as en_perdida
from (
  select
    a.*,
    a.unidades_compradas - a.unidades_vendidas                            as stock,
    case when a.unidades_compradas - a.unidades_vendidas > 0
         then a.inversion_cr / (a.unidades_compradas - a.unidades_vendidas) end as costo_promedio_cr
  from (
    select
      f.id, f.nombre, f.classname, f.revision, f.sprite_id, f.tipo, f.moneda_venta, f.precio_venta,
      f.notas, f.creado_en, t.tasa,
      case f.moneda_venta when 'lingos' then f.precio_venta * t.tasa else f.precio_venta end as precio_venta_cr,
      case f.moneda_venta when 'lingos' then f.precio_venta else f.precio_venta / t.tasa end as precio_venta_lg,
      coalesce(sum(vc.cantidad), 0)                                                   as unidades_compradas,
      coalesce(sum(vc.cantidad) filter (where vc.estado = 'vendido'), 0)              as unidades_vendidas,
      coalesce(sum(vc.cantidad) filter (where vc.estado = 'publicado'), 0)            as unidades_publicadas,
      coalesce(sum(vc.cantidad) filter (where vc.estado = 'comprado' and vc.pendiente), 0) as unidades_pendientes,
      count(vc.id) filter (where vc.estado = 'comprado' and vc.pendiente)             as lotes_pendientes,
      count(vc.id) filter (where vc.origen_id is null)                                as n_compras,
      coalesce(sum(vc.costo_total_cr) filter (where vc.estado in ('comprado', 'publicado')), 0) as inversion_cr,
      coalesce(sum(vc.precio_venta_cr * vc.cantidad) filter (where vc.estado in ('comprado', 'publicado')), 0) as venta_bruta_cr,
      coalesce(sum(vc.precio_neto_cr * vc.cantidad) filter (where vc.estado in ('comprado', 'publicado')), 0) as venta_neta_cr,
      coalesce(sum(vc.comision_cr * vc.cantidad) filter (where vc.estado in ('comprado', 'publicado')), 0) as comision_total_cr,
      count(vc.id) filter (where vc.estado in ('comprado', 'publicado') and vc.precio_venta_cr is null) as lotes_sin_precio,
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

-- ─── 4. Vender y revertir ────────────────────────────────────────────────────

-- Vender: desde un lote 'comprado' o 'publicado'. Sin precio explícito, un lote publicado
-- se vende a su precio de lista y uno comprado al precio del furni. Si el lote estaba
-- publicado y el precio es en créditos, la venta fue en el mercadillo: se congela el
-- NETO (precio − comisión) y la comisión queda en comision_venta. La fila vendida
-- conserva el precio de lista, para que revertir sepa volver a 'publicado'.
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
  f public.furnis%rowtype;
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

  select * into f from public.furnis where id = c.furni_id;
  v_moneda := coalesce(p_moneda, case when c.estado = 'publicado' then c.moneda_lista end, f.moneda_venta);
  v_precio := coalesce(p_precio, case when c.estado = 'publicado' then c.precio_lista end, f.precio_venta);
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
                              fuente, pendiente, instancia, sprite_id, precio_lista, moneda_lista, publicado_en)
  values (c.propietario, c.furni_id, 'vendido', v_cant, c.moneda_compra, c.precio_compra,
          v_moneda, v_precio, v_comision, c.fecha_compra, v_fecha, c.id, c.notas,
          c.fuente, false, c.instancia, c.sprite_id, c.precio_lista, c.moneda_lista, c.publicado_en)
  returning id into v_nuevo;
  return jsonb_build_object('dividida', true, 'original_id', p_id, 'venta_id', v_nuevo,
                            'precio_venta', v_precio, 'comision', v_comision);
end;
$$;

-- Revertir: la venta vuelve a su lote de origen si sigue 'comprado' o 'publicado' al
-- mismo costo; si no, la fila vuelve a 'publicado' (si tenía precio de lista) o a
-- 'comprado', sin precio de venta ni comisión.
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
       and o.moneda_compra = c.moneda_compra and o.precio_compra = c.precio_compra then
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
