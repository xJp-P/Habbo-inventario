-- =============================================================================
-- Habbo Inventario — Fase 2.1: precio de lista visible y comisión del mercadillo
--
-- Requiere las dos migraciones anteriores (20260927000000 y 20260928000000).
-- Cómo aplicarlo: Supabase → SQL Editor → pega este archivo completo → Run.
-- Es una sola transacción del editor: si algo falla, no queda nada a medias.
-- No borra ni cambia datos: solo recrea las dos vistas y cuatro funciones.
--
-- 1. PRECIO DE LISTA ("sin precio" en la app)
--    El precio_lista que manda el bot SÍ quedaba guardado en cada lote publicado (la
--    restricción compras_publicacion_completa no deja existir un lote 'publicado' sin
--    él). El fallo estaba en la vista del Mercadillo: la columna Precio leía solo el
--    precio de venta del furni, que en un furni nuevo del Sniper está vacío. Ahora
--    v_furnis expone el precio de lista de la publicación más reciente
--    (precio_lista_actual, moneda_lista_actual) y el rango (lista_min_cr, lista_max_cr).
--    Además, registrar_eventos_sniper lee los precios con más tolerancia: número JSON
--    o texto ("3", "3.5", "3,5"), y la respuesta de cada 'publicar' devuelve el
--    precio_lista guardado (queda también en eventos_sniper.resultado).
--
-- 2. COMISIÓN DEL MERCADILLO DE HABBO.ES
--    Vender a un precio p en el mercadillo cobra una comisión de
--        ⌈(p² + 16000·p) / 800000⌉   =   floor((p·(p + 16000) + 799999) / 800000)
--    (2 → 1, 150 → 4, 2500 → 58, 99999 → 14500 créditos). La ganancia esperada de lo
--    que está en stock (comprado o publicado) pasa a ser NETA: precio − comisión − costo.
--    También el precio mínimo para no perder y la alerta de pérdida.
--    Solo aplica a precios en créditos (el mercadillo cobra en créditos); los precios
--    en lingos son intercambios directos y no pagan comisión. Las ventas ya
--    registradas no cambian: su ganancia usa el precio real congelado al venderlas.
--    Las cifras sin comisión siguen disponibles (ganancia_bruta_cr en v_compras;
--    venta_esperada_bruta_cr y ganancia_esperada_bruta_cr en v_furnis).
-- =============================================================================

-- ─── 1. Comisión del mercadillo (misma fórmula entera que la app) ────────────

create or replace function public.comision_mercadillo(p numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select floor((p * (p + 16000) + 799999) / 800000);
$$;

create or replace function public.neto_mercadillo(p numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select p - public.comision_mercadillo(p);
$$;

-- Menor precio entero en créditos cuyo neto (precio − comisión) cubre el costo.
-- Parte de la raíz de p − (p² + 16000p)/800000 = costo y sube hasta el primer entero
-- que alcanza. NULL si ningún precio cubre ese costo (el neto máximo es ~192.080).
create or replace function public.precio_minimo_mercadillo(p_costo numeric)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_disc double precision;
  v_p numeric;
begin
  if p_costo is null then return null; end if;
  if p_costo <= 0 then return 0; end if;
  v_disc := 784000::double precision * 784000 - 3200000 * p_costo::double precision;
  if v_disc < 0 then return null; end if;
  v_p := greatest(0, floor((784000 - sqrt(v_disc)) / 2) - 1);
  while v_p - public.comision_mercadillo(v_p) < p_costo loop
    v_p := v_p + 1;
    if v_p > 392000 then return null; end if;
  end loop;
  return v_p;
end;
$$;

-- ─── 2. Vistas: ganancia neta y precio de lista por furni ────────────────────

drop view if exists public.v_furnis;
drop view if exists public.v_compras;

-- Lotes. *_cr = Créditos, *_lg = Lingos. Lo publicado se valora a su precio de lista;
-- lo vendido, al precio real congelado; lo comprado, al precio actual del furni.
-- comision_cr es por unidad: la del mercadillo si el lote sigue en stock y su precio
-- está en créditos; 0 en lo vendido y en precios en lingos.
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
        c.moneda_venta as moneda_venta_real, c.precio_venta as precio_venta_real,
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
        end as moneda_precio
      from public.compras c
      join public.furnis f on f.id = c.furni_id
      cross join public.v_tasa t
    ) b
  ) m
) n;

-- Furnis con agregados de sus lotes. El stock incluye huérfanos y publicados (son
-- tuyos hasta venderse); stock_activo excluye solo los huérfanos. La venta y la
-- ganancia esperadas son netas de la comisión del mercadillo.
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
      max(vc.creado_en) filter (where vc.fuente = 'sniper')                           as ultima_compra_sniper
    from public.furnis f
    cross join public.v_tasa t
    left join public.v_compras vc on vc.furni_id = f.id
    group by f.id, t.tasa
  ) a
) s;

revoke all on public.v_compras, public.v_furnis from anon;
grant select on public.v_compras, public.v_furnis to authenticated;

-- ─── 3. Lectura tolerante de números en los eventos del Sniper ──────────────

-- Devuelve el número del campo `clave` del evento: acepta número JSON o texto con
-- punto o coma decimal ("3", "3.5", "3,5"). NULL si el campo no viene.
create or replace function public._numero_evento(e jsonb, clave text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb := e -> clave;
  s text;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) = 'number' then return (v #>> '{}')::numeric; end if;
  if jsonb_typeof(v) = 'string' then
    s := replace(trim(v #>> '{}'), ',', '.');
    if s = '' then return null; end if;
    if s ~ '^[0-9]+(\.[0-9]+)?$' then return s::numeric; end if;
  end if;
  raise exception '% no es un numero valido: %', clave, v::text;
end;
$$;

-- compra: igual que antes, con la lectura tolerante del precio.
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
begin
  v_precio := public._numero_evento(e, 'precio');
  if v_precio is null or v_precio < 0 then
    raise exception 'Falta precio (numero mayor o igual a 0).';
  end if;
  if v_cantidad < 1 then raise exception 'La cantidad debe ser mayor o igual a 1.'; end if;
  if v_moneda not in ('creditos', 'lingos') then raise exception 'Moneda no valida: usa creditos o lingos.'; end if;
  v_fecha := case
    when (e->>'fecha') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then left(e->>'fecha', 10)::date
    when (e->>'fecha') ~ '^[0-9]{10,}$' then (to_timestamp((e->>'fecha')::numeric / 1000) at time zone 'UTC')::date
    else current_date end;

  v_furni := public._sniper_furni(t.propietario, e, true);

  insert into public.compras (propietario, furni_id, cantidad, moneda_compra, precio_compra, fecha_compra,
                              fuente, id_externo, pendiente, instancia, sprite_id, notas)
  values (t.propietario, v_furni, v_cantidad, v_moneda, v_precio, v_fecha,
          'sniper', p_id_externo, true,
          coalesce(nullif(trim(coalesce(e->>'instancia', '')), ''), t.nombre),
          nullif(e->>'sprite_id', '')::integer,
          nullif(left(trim(coalesce(e->>'notas', '')), 500), ''))
  on conflict (propietario, fuente, id_externo) where id_externo is not null do nothing
  returning id into v_compra;

  if v_compra is null then
    return jsonb_build_object('duplicado', true);
  end if;
  return jsonb_build_object('compra_id', v_compra, 'furni_id', v_furni, 'cantidad', v_cantidad, 'pendiente', true);
end;
$$;

-- publicar: mueve unidades 'comprado' a 'publicado' en orden FIFO, dividiendo lotes, y
-- guarda en cada lote el precio_lista del evento. La respuesta lo devuelve.
create or replace function public._sniper_publicar(t public.tokens_sniper, e jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cantidad integer := coalesce(nullif(e->>'cantidad', '')::integer, 1);
  v_moneda text := lower(coalesce(nullif(e->>'moneda', ''), 'creditos'));
  v_lista numeric;
  v_furni bigint;
  v_resta integer;
  v_toma integer;
  v_nuevo bigint;
  v_lotes jsonb := '[]'::jsonb;
  l public.compras%rowtype;
begin
  v_lista := public._numero_evento(e, 'precio_lista');
  if v_lista is null or v_lista < 0 then
    raise exception 'Falta precio_lista (numero mayor o igual a 0).';
  end if;
  if v_cantidad < 1 then raise exception 'La cantidad debe ser mayor o igual a 1.'; end if;
  if v_moneda not in ('creditos', 'lingos') then raise exception 'Moneda no valida: usa creditos o lingos.'; end if;

  v_furni := public._sniper_furni(t.propietario, e, false);
  if v_furni is null then
    raise exception 'No hay stock del sprite % para publicar.', coalesce(e->>'sprite_id', '?');
  end if;

  v_resta := v_cantidad;
  for l in
    select * from public.compras
     where propietario = t.propietario and furni_id = v_furni and estado = 'comprado'
     order by fecha_compra asc nulls first, id asc
     for update
  loop
    exit when v_resta = 0;
    v_toma := least(l.cantidad, v_resta);
    if v_toma = l.cantidad then
      update public.compras
         set estado = 'publicado', pendiente = false, precio_lista = v_lista, moneda_lista = v_moneda, publicado_en = now()
       where id = l.id;
      v_lotes := v_lotes || jsonb_build_object('lote_id', l.id, 'cantidad', v_toma, 'dividido', false);
    else
      update public.compras set cantidad = cantidad - v_toma where id = l.id;
      insert into public.compras (propietario, furni_id, estado, cantidad, moneda_compra, precio_compra,
                                  fecha_compra, origen_id, fuente, pendiente, instancia, sprite_id, notas,
                                  precio_lista, moneda_lista, publicado_en)
      values (l.propietario, l.furni_id, 'publicado', v_toma, l.moneda_compra, l.precio_compra,
              l.fecha_compra, l.id, l.fuente, false, l.instancia, l.sprite_id, l.notas,
              v_lista, v_moneda, now())
      returning id into v_nuevo;
      v_lotes := v_lotes || jsonb_build_object('lote_id', v_nuevo, 'origen_id', l.id, 'cantidad', v_toma, 'dividido', true);
    end if;
    v_resta := v_resta - v_toma;
  end loop;

  if v_resta = v_cantidad then
    raise exception 'No hay stock disponible del sprite % para publicar.', coalesce(e->>'sprite_id', '?');
  end if;
  return jsonb_build_object('furni_id', v_furni, 'cantidad', v_cantidad - v_resta, 'faltante', v_resta,
                            'precio_lista', v_lista, 'moneda', v_moneda, 'lotes', v_lotes);
end;
$$;

-- ─── 4. Permisos ─────────────────────────────────────────────────────────────

revoke execute on function public.comision_mercadillo(numeric) from public, anon;
revoke execute on function public.neto_mercadillo(numeric) from public, anon;
revoke execute on function public.precio_minimo_mercadillo(numeric) from public, anon;
revoke execute on function public._numero_evento(jsonb, text) from public, anon, authenticated;

grant execute on function public.comision_mercadillo(numeric) to authenticated;
grant execute on function public.neto_mercadillo(numeric) to authenticated;
grant execute on function public.precio_minimo_mercadillo(numeric) to authenticated;
