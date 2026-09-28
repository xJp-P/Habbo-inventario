-- =============================================================================
-- Habbo Inventario — Auditoría del inventario de Habbo (conciliación por keko)
--
-- Requiere 20261006000000_numero_ltd (y las anteriores).
-- Cómo aplicarlo: Supabase → SQL Editor → pega este archivo completo → Run.
-- Es una sola transacción del editor y se puede ejecutar más de una vez.
--
-- QUÉ CAMBIA
--   1. compras.keko: el keko de Habbo donde están las unidades (null = sin asignar:
--      lo del Excel, las compras manuales y lo que llegó del Sniper antes de esto).
--      tokens_sniper.keko: el keko de cada sniper, que aprende de su inventario.
--   2. inventario_habbo: la última foto del inventario de cada keko, enviada por su
--      sniper con auditar_inventario(token_sniper, keko, hotel, inventario).
--   3. exclusiones_auditoria: unidades que no son mercancía («Quitar de la
--      auditoría»). Valen mientras las cantidades de ese furni no cambien; si llega
--      o se compra otra unidad, la exclusión se cae y hay que decidir de nuevo.
--   4. auditoria_inventario(p_keko) compara EN VIVO la foto con lo que está en mano
--      (comprado y por revisar) en ese keko: sobrantes, faltantes, LTD con otro número,
--      furnis que la app no tiene registrados y unidades sin keko que sobran. Lo
--      publicado no cuenta: está en el mercadillo, no en el inventario.
--   5. Para resolver: mover_a_keko (sin asignar, de otro keko o hacia otro keko),
--      dar_de_baja (borra unidades faltantes), excluir_de_auditoria, crear_compra con
--      keko/sprite/tipo (entrada con costo) y vender_en_mano con keko.
--   6. El Sniper usa su keko: sus compras quedan en él, publica primero lo que está en
--      él y lo recuperado vuelve a él.
-- =============================================================================

-- ─── 0. Comprobación: 20261006000000 ya está aplicada ───────────────────────

do $$
begin
  if to_regprocedure('public.asignar_ltd(bigint, integer)') is null then
    raise exception 'Falta ejecutar antes 20261006000000_numero_ltd.sql (y las anteriores, en orden).';
  end if;
end;
$$;

-- ─── 1. Columnas ─────────────────────────────────────────────────────────────

alter table public.compras add column if not exists keko text;
alter table public.compras drop constraint if exists compras_keko_valido;
alter table public.compras add constraint compras_keko_valido
  check (keko is null or length(trim(keko)) between 1 and 60);
create index if not exists compras_en_mano_por_keko on public.compras (propietario, keko, furni_id)
  where estado = 'comprado';

alter table public.tokens_sniper add column if not exists keko text;

-- ─── 2. Tablas ───────────────────────────────────────────────────────────────

create table if not exists public.inventario_habbo (
  propietario uuid not null default auth.uid() references auth.users (id) on delete cascade,
  keko        text not null check (length(trim(keko)) between 1 and 60),
  token_id    bigint references public.tokens_sniper (id) on delete set null,
  recibido_en timestamptz not null default now(),
  -- [{ sprite_id, tipo ('suelo'|'pared'), cantidad, ltds: [numeros] }], agrupado por furni.
  furnis      jsonb not null default '[]'::jsonb,
  primary key (propietario, keko)
);

create table if not exists public.exclusiones_auditoria (
  id          bigint generated always as identity primary key,
  propietario uuid not null default auth.uid() references auth.users (id) on delete cascade,
  keko        text not null,
  sprite_id   integer not null,
  tipo        text not null check (tipo in ('suelo', 'pared')),
  unidades    integer not null check (unidades > 0),
  -- Cantidades al excluir: si cambian, la exclusión deja de valer.
  habbo       integer not null,
  app         integer not null,
  creado_en   timestamptz not null default now(),
  unique (propietario, keko, sprite_id, tipo)
);

alter table public.inventario_habbo      enable row level security;
alter table public.exclusiones_auditoria enable row level security;

drop policy if exists "inventario propio" on public.inventario_habbo;
create policy "inventario propio" on public.inventario_habbo for all to authenticated
  using (propietario = auth.uid()) with check (propietario = auth.uid());
drop policy if exists "exclusiones propias" on public.exclusiones_auditoria;
create policy "exclusiones propias" on public.exclusiones_auditoria for all to authenticated
  using (propietario = auth.uid()) with check (propietario = auth.uid());

revoke all on public.inventario_habbo, public.exclusiones_auditoria from anon;
grant select, delete on public.inventario_habbo to authenticated;
grant select, insert, update, delete on public.exclusiones_auditoria to authenticated;

-- ─── 3. Vistas (v_compras expone keko) ───────────────────────────────────────

drop view if exists public.v_furnis;
drop view if exists public.v_compras;

-- Igual que en 20261006000000, más keko.
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
        c.estado, c.pendiente, c.fuente, c.id_externo, c.instancia, c.sprite_id, c.numero_ltd, c.keko,
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

-- Sin cambios (se recrea porque depende de v_compras).
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

-- ─── 4. El Sniper usa su keko ────────────────────────────────────────────────

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
                              fuente, id_externo, pendiente, instancia, sprite_id, notas, numero_ltd, keko)
  values (t.propietario, v_furni, v_cantidad, v_moneda, v_precio, v_fecha,
          'sniper', p_id_externo, true,
          coalesce(nullif(trim(coalesce(e->>'instancia', '')), ''), t.nombre),
          nullif(e->>'sprite_id', '')::integer,
          nullif(left(trim(coalesce(e->>'notas', '')), 500), ''), v_ltd, t.keko)
  on conflict (propietario, fuente, id_externo) where id_externo is not null do nothing
  returning id into v_compra;

  if v_compra is null then
    return jsonb_build_object('duplicado', true);
  end if;
  return jsonb_build_object('compra_id', v_compra, 'furni_id', v_furni, 'cantidad', v_cantidad, 'pendiente', true,
                            'numero_ltd', v_ltd);
end;
$$;

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
     order by case when keko is not distinct from t.keko then 0 when keko is null then 1 else 2 end,
              fecha_compra asc nulls first, id asc
     for update
  loop
    exit when v_resta = 0;
    v_toma := least(l.cantidad, v_resta);
    if v_toma = l.cantidad then
      update public.compras
         set estado = 'publicado', pendiente = false, precio_lista = v_lista, moneda_lista = v_moneda,
             publicado_en = now(), publicado_por = 'sniper', keko = coalesce(t.keko, keko)
       where id = l.id;
      v_lotes := v_lotes || jsonb_build_object('lote_id', l.id, 'cantidad', v_toma, 'dividido', false);
    else
      update public.compras set cantidad = cantidad - v_toma where id = l.id;
      insert into public.compras (propietario, furni_id, estado, cantidad, moneda_compra, precio_compra,
                                  fecha_compra, origen_id, fuente, pendiente, instancia, sprite_id, notas,
                                  precio_lista, moneda_lista, publicado_en, publicado_por, keko)
      values (l.propietario, l.furni_id, 'publicado', v_toma, l.moneda_compra, l.precio_compra,
              l.fecha_compra, l.id, l.fuente, false, l.instancia, l.sprite_id, l.notas,
              v_lista, v_moneda, now(), 'sniper', coalesce(t.keko, l.keko))
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
         and o.numero_ltd is null and l.numero_ltd is null
         and o.keko is not distinct from coalesce(t.keko, l.keko) then
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
             publicado_en = null, publicado_por = null, keko = coalesce(t.keko, keko)
       where id = l.id;
      v_destino := l.id;
    else
      update public.compras set cantidad = cantidad - v_toma where id = l.id;
      insert into public.compras (propietario, furni_id, estado, cantidad, moneda_compra, precio_compra,
                                  fecha_compra, origen_id, fuente, pendiente, instancia, sprite_id, notas, keko)
      values (l.propietario, l.furni_id, 'comprado', v_toma, l.moneda_compra, l.precio_compra,
              l.fecha_compra, l.id, l.fuente, false, l.instancia, l.sprite_id, l.notas, coalesce(t.keko, l.keko))
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

-- ─── 5. Entrada con costo: crear_compra con keko, sprite y tipo ──────────────

drop function if exists public.crear_compra(bigint, text, text, integer, integer, text, numeric, date, text, integer);

create or replace function public.crear_compra(
  p_furni_id bigint default null, p_nombre text default null, p_classname text default null,
  p_revision integer default null, p_cantidad integer default 1, p_moneda text default 'creditos',
  p_precio numeric default null, p_fecha date default null, p_notas text default null,
  p_numero_ltd integer default null, p_keko text default null,
  p_sprite_id integer default null, p_tipo text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_furni bigint;
  v_creado boolean := false;
  v_id bigint;
  v_keko text := nullif(trim(coalesce(p_keko, '')), '');
  v_tipo text := case when lower(coalesce(p_tipo, '')) in ('pared', 'wall', 'i') then 'pared' else 'suelo' end;
begin
  if p_precio is null then raise exception using errcode = 'PT400', message = 'Falta el precio de compra.'; end if;
  if p_numero_ltd is not null then
    if p_numero_ltd < 1 then raise exception using errcode = 'PT400', message = 'El numero LTD debe ser mayor que 0.'; end if;
    if coalesce(p_cantidad, 1) <> 1 then
      raise exception using errcode = 'PT400', message = 'Un LTD es una sola unidad: registra cada numero como una compra de 1.';
    end if;
  end if;
  if v_keko is not null and length(v_keko) > 60 then
    raise exception using errcode = 'PT400', message = 'El nombre del keko admite hasta 60 caracteres.';
  end if;
  if p_furni_id is not null then
    select id into v_furni from public.furnis where id = p_furni_id;
    if not found then raise exception using errcode = 'PT404', message = 'Ese furni no existe.'; end if;
  else
    if p_sprite_id is not null then
      select id into v_furni from public.furnis where sprite_id = p_sprite_id and tipo = v_tipo order by id limit 1;
    end if;
    if v_furni is null and p_classname is not null then
      select id into v_furni from public.furnis where classname = p_classname order by id limit 1;
    end if;
    if v_furni is null and p_nombre is not null then
      select id into v_furni from public.furnis where lower(nombre) = lower(trim(p_nombre)) limit 1;
    end if;
    if v_furni is null then
      if coalesce(trim(p_nombre), '') = '' then
        raise exception using errcode = 'PT400', message = 'Falta el nombre del furni.';
      end if;
      insert into public.furnis (nombre, classname, revision, sprite_id, tipo)
      values (trim(p_nombre), p_classname, p_revision, p_sprite_id, v_tipo)
      returning id into v_furni;
      v_creado := true;
    elsif p_sprite_id is not null then
      -- El furni ya existia sin sprite: se completa para que la auditoria lo reconozca.
      update public.furnis set sprite_id = p_sprite_id, tipo = v_tipo where id = v_furni and sprite_id is null;
    end if;
  end if;

  insert into public.compras (furni_id, cantidad, moneda_compra, precio_compra, fecha_compra, notas, numero_ltd, keko)
  values (v_furni, coalesce(p_cantidad, 1), coalesce(p_moneda, 'creditos'), p_precio, coalesce(p_fecha, current_date),
          p_notas, p_numero_ltd, v_keko)
  returning id into v_id;
  return jsonb_build_object('compra_id', v_id, 'furni_id', v_furni, 'furni_creado', v_creado);
end;
$$;

-- ─── 6. Venta manual desde un keko ───────────────────────────────────────────

drop function if exists public.vender_en_mano(bigint, integer, numeric, text, boolean, date, bigint);

create or replace function public.vender_en_mano(
  p_furni_id bigint, p_cantidad integer, p_precio numeric, p_moneda text default 'creditos',
  p_mercadillo boolean default false, p_fecha date default null, p_lote_id bigint default null,
  p_keko text default null)
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

-- ─── 7. Recibir el inventario (lo llama el Sniper con su token) ──────────────
-- Acepta un elemento por furni o uno por unidad: { sprite_id, tipo, cantidad, ltds }
-- ("tipo": suelo/pared; "ltds": numeros de serie; "numero_ltd": uno solo). Sin
-- sprite_id se busca un furni de la app con ese "nombre". Los elementos invalidos van a
-- "errores" sin frenar el resto. Reemplaza la foto anterior de ese keko.

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
    select * from resueltos where o is not null and sprite_id is not null and coalesce(cantidad, 0) >= 1
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
                      where n.sprite_id = v.sprite_id and n.tipo = v.tipo), '[]'::jsonb) as ltds
      from validos v group by v.sprite_id, v.tipo
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object('sprite_id', sprite_id, 'tipo', tipo, 'cantidad', cantidad, 'ltds', ltds)
                               order by tipo, sprite_id), '[]'::jsonb) from grupos),
    (select coalesce(sum(cantidad), 0)::integer from grupos),
    (select coalesce(jsonb_agg(jsonb_build_object('indice', indice, 'error',
              case when o is null then 'Cada elemento debe ser un objeto.'
                   when coalesce(cantidad, 0) < 1 then 'La cantidad debe ser un entero mayor o igual a 1.'
                   when nombre is not null then format('No hay un furni "%s" con sprite_id en la app: envia sprite_id.', nombre)
                   else 'Falta sprite_id (o el nombre de un furni de la app).' end) order by indice), '[]'::jsonb)
       from resueltos where not (o is not null and sprite_id is not null and coalesce(cantidad, 0) >= 1))
  into v_furnis, v_unidades, v_errores;

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
    'errores', v_errores,
    'resumen', v_comparacion->'resumen');
end;
$$;

-- ─── 8. Comparar la foto con la app ──────────────────────────────────────────
-- Interna (solo la llaman auditar_inventario y auditoria_inventario, que fijan el
-- propietario). Una fila por furni con diferencias:
--   categoria: sobrante | faltante | no_registrado | ltd (misma cantidad, otro número)
--              | sin_keko (cuadra, pero sobran unidades sin keko asignado)

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
                       from jsonb_array_elements_text(coalesce(x->'ltds', '[]'::jsonb)) v), '{}'::integer[]) as ltds
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
           coalesce(a.en_keko, 0) as app, coalesce(a.sin_asignar, 0) as sin_asignar
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
                                 where (el->>'numero_ltd')::integer = any(ltds_faltantes)))
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

-- ─── 9. Lo que usa la app ────────────────────────────────────────────────────

-- La auditoria de un keko (el que envio su inventario mas reciente si no se indica),
-- mas la lista de kekos con inventario.
create or replace function public.auditoria_inventario(p_keko text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_keko text := nullif(trim(coalesce(p_keko, '')), '');
  v_kekos jsonb;
  v_res jsonb;
begin
  if v_uid is null then raise exception using errcode = 'PT401', message = 'Inicia sesion para ver la auditoria.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('keko', i.keko, 'recibido_en', i.recibido_en) order by i.recibido_en desc), '[]'::jsonb)
    into v_kekos from public.inventario_habbo i where i.propietario = v_uid;
  if v_keko is null then v_keko := v_kekos->0->>'keko'; end if;
  if v_keko is null then return jsonb_build_object('keko', null, 'kekos', v_kekos); end if;
  v_res := public._comparar_inventario(v_uid, v_keko);
  if v_res is null then
    raise exception using errcode = 'PT404', message = format('No hay inventario del keko %s.', v_keko);
  end if;
  return v_res || jsonb_build_object('kekos', v_kekos);
end;
$$;

-- Diferencias pendientes por keko (el numero junto a «Auditoria» en el menu).
create or replace function public.resumen_auditoria()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inv record;
  v_c jsonb;
  v_lista jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_n integer;
begin
  if v_uid is null then raise exception using errcode = 'PT401', message = 'Inicia sesion para ver la auditoria.'; end if;
  for v_inv in select keko, recibido_en from public.inventario_habbo where propietario = v_uid order by recibido_en desc loop
    v_c := public._comparar_inventario(v_uid, v_inv.keko)->'resumen';
    v_n := coalesce((v_c->>'sobrantes')::integer, 0) + coalesce((v_c->>'faltantes')::integer, 0) + coalesce((v_c->>'ltd')::integer, 0);
    v_total := v_total + v_n;
    v_lista := v_lista || jsonb_build_object('keko', v_inv.keko, 'recibido_en', v_inv.recibido_en, 'pendientes', v_n, 'resumen', v_c);
  end loop;
  return jsonb_build_object('pendientes', v_total, 'kekos', v_lista);
end;
$$;

-- Mueve unidades en mano de un furni entre kekos (null = sin asignar), de lo mas
-- antiguo a lo mas nuevo o de los lotes indicados. Si toma parte de un lote, lo divide
-- (el lote nuevo no hereda el origen: no debe volver a unirse a otro keko).
create or replace function public.mover_a_keko(
  p_furni_id bigint, p_cantidad integer, p_desde text, p_hacia text, p_lote_ids bigint[] default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_desde text := nullif(trim(coalesce(p_desde, '')), '');
  v_hacia text := nullif(trim(coalesce(p_hacia, '')), '');
  v_total integer;
  v_resta integer;
  v_toma integer;
  v_nuevo bigint;
  v_lotes jsonb := '[]'::jsonb;
  l public.compras%rowtype;
begin
  perform 1 from public.furnis where id = p_furni_id;
  if not found then raise exception using errcode = 'PT404', message = 'Ese furni no existe.'; end if;
  if p_cantidad is null or p_cantidad < 1 then
    raise exception using errcode = 'PT400', message = 'La cantidad debe ser mayor o igual a 1.';
  end if;
  if v_hacia is not null and length(v_hacia) > 60 then
    raise exception using errcode = 'PT400', message = 'El nombre del keko admite hasta 60 caracteres.';
  end if;
  if v_desde is not distinct from v_hacia then
    raise exception using errcode = 'PT400', message = 'El keko de origen y el de destino son el mismo.';
  end if;

  select coalesce(sum(cantidad), 0) into v_total from public.compras
   where furni_id = p_furni_id and estado = 'comprado' and keko is not distinct from v_desde
     and (p_lote_ids is null or id = any(p_lote_ids));
  if p_cantidad > v_total then
    raise exception using errcode = 'PT400', message = format('Solo hay %s unidad(es) en mano %s.', v_total,
      case when v_desde is null then 'sin keko asignado' else 'en el keko ' || v_desde end);
  end if;

  v_resta := p_cantidad;
  for l in
    select * from public.compras
     where furni_id = p_furni_id and estado = 'comprado' and keko is not distinct from v_desde
       and (p_lote_ids is null or id = any(p_lote_ids))
     order by pendiente asc, fecha_compra asc nulls first, id asc
     for update
  loop
    exit when v_resta = 0;
    v_toma := least(l.cantidad, v_resta);
    if v_toma = l.cantidad then
      update public.compras set keko = v_hacia where id = l.id;
      v_lotes := v_lotes || jsonb_build_object('lote_id', l.id, 'cantidad', v_toma, 'dividido', false);
    else
      update public.compras set cantidad = cantidad - v_toma where id = l.id;
      insert into public.compras (furni_id, cantidad, moneda_compra, precio_compra, fecha_compra,
                                  fuente, pendiente, instancia, sprite_id, notas, keko)
      values (l.furni_id, v_toma, l.moneda_compra, l.precio_compra, l.fecha_compra,
              l.fuente, l.pendiente, l.instancia, l.sprite_id, l.notas, v_hacia)
      returning id into v_nuevo;
      v_lotes := v_lotes || jsonb_build_object('lote_id', v_nuevo, 'de_lote', l.id, 'cantidad', v_toma, 'dividido', true);
    end if;
    v_resta := v_resta - v_toma;
  end loop;

  return jsonb_build_object('furni_id', p_furni_id, 'cantidad', p_cantidad, 'desde', v_desde, 'hacia', v_hacia, 'lotes', v_lotes);
end;
$$;

-- Borra unidades en mano que ya no existen (regaladas, perdidas, borradas en Habbo):
-- descuenta del lote o lo elimina si eran todas. No registra venta ni perdida.
create or replace function public.dar_de_baja(
  p_furni_id bigint, p_cantidad integer, p_keko text, p_lote_ids bigint[] default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_keko text := nullif(trim(coalesce(p_keko, '')), '');
  v_total integer;
  v_resta integer;
  v_toma integer;
  v_lotes jsonb := '[]'::jsonb;
  l public.compras%rowtype;
begin
  perform 1 from public.furnis where id = p_furni_id;
  if not found then raise exception using errcode = 'PT404', message = 'Ese furni no existe.'; end if;
  if p_cantidad is null or p_cantidad < 1 then
    raise exception using errcode = 'PT400', message = 'La cantidad debe ser mayor o igual a 1.';
  end if;
  select coalesce(sum(cantidad), 0) into v_total from public.compras
   where furni_id = p_furni_id and estado = 'comprado' and keko is not distinct from v_keko
     and (p_lote_ids is null or id = any(p_lote_ids));
  if p_cantidad > v_total then
    raise exception using errcode = 'PT400', message = format('Solo hay %s unidad(es) en mano %s.', v_total,
      case when v_keko is null then 'sin keko asignado' else 'en el keko ' || v_keko end);
  end if;

  v_resta := p_cantidad;
  for l in
    select * from public.compras
     where furni_id = p_furni_id and estado = 'comprado' and keko is not distinct from v_keko
       and (p_lote_ids is null or id = any(p_lote_ids))
     order by pendiente asc, fecha_compra asc nulls first, id asc
     for update
  loop
    exit when v_resta = 0;
    v_toma := least(l.cantidad, v_resta);
    if v_toma = l.cantidad then
      delete from public.compras where id = l.id;
    else
      update public.compras set cantidad = cantidad - v_toma where id = l.id;
    end if;
    v_lotes := v_lotes || jsonb_build_object('lote_id', l.id, 'cantidad', v_toma, 'borrado', v_toma = l.cantidad);
    v_resta := v_resta - v_toma;
  end loop;
  return jsonb_build_object('furni_id', p_furni_id, 'cantidad', p_cantidad, 'keko', v_keko, 'lotes', v_lotes);
end;
$$;

-- «Quitar de la auditoria»: guarda cuantas unidades de un furni no son mercancia en ese
-- keko, junto con las cantidades de ese momento. Con 0 o null, se borra la exclusion.
create or replace function public.excluir_de_auditoria(
  p_keko text, p_sprite_id integer, p_tipo text, p_unidades integer, p_habbo integer, p_app integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_keko text := nullif(trim(coalesce(p_keko, '')), '');
  v_tipo text := case when lower(coalesce(p_tipo, '')) in ('pared', 'wall', 'i') then 'pared' else 'suelo' end;
begin
  if v_keko is null or p_sprite_id is null then
    raise exception using errcode = 'PT400', message = 'Falta el keko o el furni.';
  end if;
  if coalesce(p_unidades, 0) <= 0 then
    delete from public.exclusiones_auditoria where keko = v_keko and sprite_id = p_sprite_id and tipo = v_tipo;
    return jsonb_build_object('keko', v_keko, 'sprite_id', p_sprite_id, 'tipo', v_tipo, 'unidades', 0);
  end if;
  if p_habbo is null or p_app is null or p_unidades > p_habbo then
    raise exception using errcode = 'PT400', message = 'Las unidades a excluir no pueden superar las que hay en Habbo.';
  end if;
  insert into public.exclusiones_auditoria (keko, sprite_id, tipo, unidades, habbo, app)
  values (v_keko, p_sprite_id, v_tipo, p_unidades, p_habbo, p_app)
  on conflict (propietario, keko, sprite_id, tipo) do update
    set unidades = excluded.unidades, habbo = excluded.habbo, app = excluded.app, creado_en = now();
  return jsonb_build_object('keko', v_keko, 'sprite_id', p_sprite_id, 'tipo', v_tipo, 'unidades', p_unidades);
end;
$$;

-- ─── 10. Permisos ────────────────────────────────────────────────────────────

revoke execute on function public._comparar_inventario(uuid, text) from public, anon, authenticated;
revoke execute on function public.auditar_inventario(text, text, text, jsonb) from public;
grant execute on function public.auditar_inventario(text, text, text, jsonb) to anon, authenticated;

revoke execute on function public.auditoria_inventario(text) from public, anon;
revoke execute on function public.resumen_auditoria() from public, anon;
revoke execute on function public.mover_a_keko(bigint, integer, text, text, bigint[]) from public, anon;
revoke execute on function public.dar_de_baja(bigint, integer, text, bigint[]) from public, anon;
revoke execute on function public.excluir_de_auditoria(text, integer, text, integer, integer, integer) from public, anon;
revoke execute on function public.crear_compra(bigint, text, text, integer, integer, text, numeric, date, text, integer, text, integer, text) from public, anon;
revoke execute on function public.vender_en_mano(bigint, integer, numeric, text, boolean, date, bigint, text) from public, anon;

grant execute on function public.auditoria_inventario(text) to authenticated;
grant execute on function public.resumen_auditoria() to authenticated;
grant execute on function public.mover_a_keko(bigint, integer, text, text, bigint[]) to authenticated;
grant execute on function public.dar_de_baja(bigint, integer, text, bigint[]) to authenticated;
grant execute on function public.excluir_de_auditoria(text, integer, text, integer, integer, integer) to authenticated;
grant execute on function public.crear_compra(bigint, text, text, integer, integer, text, numeric, date, text, integer, text, integer, text) to authenticated;
grant execute on function public.vender_en_mano(bigint, integer, numeric, text, boolean, date, bigint, text) to authenticated;
