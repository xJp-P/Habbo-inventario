-- =============================================================================
-- Habbo Inventario — Fase 2: eventos unificados del Sniper y ciclo del Mercadillo
--
-- Requiere el esquema inicial (20260927000000_esquema_inicial.sql) ya instalado.
-- Cómo aplicarlo: Supabase → SQL Editor → pega este archivo completo → Run.
-- Es una sola transacción del editor: si algo falla, no queda nada a medias.
--
-- QUÉ CAMBIA
--   1. Un único punto de entrada para los SniperMercadillo:
--        registrar_eventos_sniper(token_sniper text, eventos jsonb)
--      con tres tipos de evento: 'compra', 'publicar' y 'recuperar'.
--      La función anterior registrar_compras_sniper se ELIMINA.
--   2. Nuevo estado de lote 'publicado' (en el mercadillo de Habbo) con su precio de
--      lista. Ciclo: comprado → publicado → (vendido | recuperado a comprado).
--   3. Tabla eventos_sniper: bitácora de cada evento con id_externo ÚNICO por
--      usuario. Un reintento del bot con el mismo id_externo se ignora en silencio.
--   4. Los furnis guardan sprite_id + tipo (suelo/pared): el bot identifica los furnis
--      por sprite_id. Un sprite nuevo crea un furni provisional ("Sprite 4623 (suelo)")
--      que la app renombra con el nombre oficial del catálogo de Habbo.es al abrirse.
--
-- REGLAS FIFO
--   publicar:  toma unidades de los lotes 'comprado' (también los "por revisar") del
--              más antiguo al más nuevo (fecha de compra; los importados del Excel, sin
--              fecha, cuentan como los más antiguos). Si un lote entra entero, pasa a
--              'publicado'; si entra una parte, se divide: el lote baja su cantidad y
--              nace un lote 'publicado' con esa parte (origen_id = lote original).
--   recuperar: toma unidades de los lotes 'publicado' del publicado hace más tiempo al
--              más reciente y las devuelve a 'comprado', limpiando el precio de lista.
--              Si su lote de origen sigue 'comprado' al mismo costo, se reúnen con él.
--   Si no alcanza el stock, se aplica lo que haya y la respuesta informa el faltante.
--   Si no hay nada que aplicar, el evento falla (va a "errores") y NO queda registrado,
--   así un reintento posterior puede funcionar.
--
-- DESPUÉS DE EJECUTARLO: abre la app de escritorio una vez. Al iniciar sesión completa el
-- sprite_id de tus furnis existentes (los del Excel) a partir de su classname, que es lo
-- que el bot usa para publicarlos y recuperarlos, y pone nombre oficial a los provisionales.
--
-- NOTA sobre `notas`: la tabla compras (vista Inventario) ya tenía la columna `notas`
-- desde el esquema inicial; el ALTER de abajo es idempotente (IF NOT EXISTS). Ahí se
-- guarda tal cual el campo `notas` del evento de compra (p. ej. costos en diamantes o
-- puntos de un LTD).
-- =============================================================================

-- ─── 1. Columnas nuevas ──────────────────────────────────────────────────────

alter table public.compras add column if not exists notas text;
alter table public.compras add column if not exists precio_lista numeric;
alter table public.compras add column if not exists moneda_lista text;
alter table public.compras add column if not exists publicado_en timestamptz;

alter table public.furnis add column if not exists sprite_id integer;
alter table public.furnis add column if not exists tipo text not null default 'suelo';

-- ─── 2. Restricciones de estado (se agrega 'publicado') ─────────────────────

-- Las vistas dependen de compras.estado: se quitan antes y se recrean al final.
drop view if exists public.v_furnis;
drop view if exists public.v_compras;

do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'public.compras'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%estado%'
  loop
    execute format('alter table public.compras drop constraint %I', r.conname);
  end loop;
end;
$$;

alter table public.compras add constraint compras_estado_valido
  check (estado in ('comprado', 'publicado', 'vendido'));
alter table public.compras add constraint compras_venta_completa
  check (estado <> 'vendido' or (precio_venta is not null and moneda_venta is not null));
alter table public.compras drop constraint if exists compras_lista_valida;
alter table public.compras add constraint compras_lista_valida
  check ((precio_lista is null or precio_lista >= 0)
     and (moneda_lista is null or moneda_lista in ('creditos', 'lingos')));
alter table public.compras add constraint compras_publicacion_completa
  check (estado <> 'publicado' or (precio_lista is not null and moneda_lista is not null));

alter table public.furnis drop constraint if exists furnis_tipo_valido;
alter table public.furnis add constraint furnis_tipo_valido check (tipo in ('suelo', 'pared'));

create index if not exists furnis_sprite on public.furnis (propietario, tipo, sprite_id) where sprite_id is not null;
create index if not exists compras_fifo on public.compras (propietario, furni_id, estado, fecha_compra, id);

-- ─── 3. Bitácora de eventos del Sniper ───────────────────────────────────────

create table if not exists public.eventos_sniper (
  id           bigint generated always as identity primary key,
  propietario  uuid not null references auth.users (id) on delete cascade,
  token_id     bigint references public.tokens_sniper (id) on delete set null,
  id_externo   text not null,
  tipo_evento  text not null check (tipo_evento in ('compra', 'publicar', 'recuperar')),
  sprite_id    integer,
  cantidad     integer,
  datos        jsonb not null,
  resultado    jsonb,
  recibido_en  timestamptz not null default now(),
  unique (propietario, id_externo)
);

create index if not exists eventos_sniper_recientes on public.eventos_sniper (propietario, recibido_en desc);

alter table public.eventos_sniper enable row level security;
drop policy if exists "eventos propios" on public.eventos_sniper;
create policy "eventos propios" on public.eventos_sniper for select to authenticated
  using (propietario = auth.uid());
revoke all on public.eventos_sniper from anon, authenticated;
grant select on public.eventos_sniper to authenticated;

-- Las compras que ya llegaron por la función anterior quedan en la bitácora, para que
-- un reintento tardío del bot con el mismo id_externo también se ignore.
insert into public.eventos_sniper (propietario, id_externo, tipo_evento, sprite_id, cantidad, datos, resultado, recibido_en)
select c.propietario, c.id_externo, 'compra', c.sprite_id, c.cantidad,
       jsonb_build_object('migrado', true, 'compra_id', c.id),
       jsonb_build_object('compra_id', c.id), c.creado_en
  from public.compras c
 where c.fuente = 'sniper' and c.id_externo is not null and c.origen_id is null
on conflict (propietario, id_externo) do nothing;

-- ─── 4. Vistas calculadas (con 'publicado') ──────────────────────────────────

-- Lotes. *_cr = Créditos, *_lg = Lingos. Lo publicado se valora a su precio de lista;
-- lo vendido, al precio real congelado; lo comprado, al precio actual del furni.
create view public.v_compras with (security_invoker = true) as
select
  b.*,
  b.precio_compra_cr * b.cantidad                        as costo_total_cr,
  b.precio_compra_cr * b.cantidad / b.tasa               as costo_total_lg,
  b.precio_venta_cr / b.tasa                             as precio_venta_lg,
  case when b.precio_venta_cr is null then null
       else (b.precio_venta_cr - b.precio_compra_cr) * b.cantidad end              as ganancia_cr,
  case when b.precio_venta_cr is null then null
       else (b.precio_venta_cr - b.precio_compra_cr) * b.cantidad / b.tasa end     as ganancia_lg,
  case when b.precio_venta_cr is null or b.precio_compra_cr = 0 then null
       else (b.precio_venta_cr - b.precio_compra_cr) / b.precio_compra_cr end      as margen
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
    end as precio_venta_cr
  from public.compras c
  join public.furnis f on f.id = c.furni_id
  cross join public.v_tasa t
) b;

-- Furnis con agregados de sus lotes. El stock incluye huérfanos y publicados (son
-- tuyos hasta venderse); stock_activo excluye solo los huérfanos.
create view public.v_furnis with (security_invoker = true) as
select
  s.*,
  s.stock - s.unidades_pendientes                                          as stock_activo,
  s.costo_promedio_cr / s.tasa                                             as costo_promedio_lg,
  case when s.stock > 0 and s.lotes_sin_precio = 0 then s.venta_bruta_cr end              as venta_esperada_cr,
  case when s.stock > 0 and s.lotes_sin_precio = 0 then s.venta_bruta_cr - s.inversion_cr end as ganancia_esperada_cr,
  case when s.stock > 0 and s.lotes_sin_precio = 0 then (s.venta_bruta_cr - s.inversion_cr) / s.tasa end as ganancia_esperada_lg,
  ceil(s.costo_promedio_cr)                                                as precio_minimo_cr,
  case when s.unidades_compradas = 0 then 'sin_compras'
       when s.stock = 0 then 'agotado'
       when s.unidades_publicadas = s.stock then 'publicado'
       when s.stock - s.unidades_pendientes - s.unidades_publicadas <= 0 then 'por_revisar'
       else 'en_venta' end                                                 as estado,
  (s.precio_venta_cr is not null and s.costo_promedio_cr is not null
     and s.precio_venta_cr < s.costo_promedio_cr)                          as en_perdida
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
      count(vc.id) filter (where vc.estado in ('comprado', 'publicado') and vc.precio_venta_cr is null) as lotes_sin_precio,
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

-- ─── 5. Operaciones de la app actualizadas ───────────────────────────────────

-- Vender: ahora también desde un lote 'publicado' (lo normal: se vendió en el
-- mercadillo). Sin precio explícito, un lote publicado se vende a su precio de lista.
-- La fila vendida conserva el precio de lista, para que revertir sepa volver a 'publicado'.
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

  if v_cant = c.cantidad then
    update public.compras
       set estado = 'vendido', pendiente = false, moneda_venta = v_moneda, precio_venta = v_precio, fecha_venta = v_fecha
     where id = p_id;
    return jsonb_build_object('dividida', false, 'original_id', null, 'venta_id', p_id);
  end if;

  update public.compras set cantidad = cantidad - v_cant where id = p_id;
  insert into public.compras (propietario, furni_id, estado, cantidad, moneda_compra, precio_compra,
                              moneda_venta, precio_venta, fecha_compra, fecha_venta, origen_id, notas,
                              fuente, pendiente, instancia, sprite_id, precio_lista, moneda_lista, publicado_en)
  values (c.propietario, c.furni_id, 'vendido', v_cant, c.moneda_compra, c.precio_compra,
          v_moneda, v_precio, c.fecha_compra, v_fecha, c.id, c.notas,
          c.fuente, false, c.instancia, c.sprite_id, c.precio_lista, c.moneda_lista, c.publicado_en)
  returning id into v_nuevo;
  return jsonb_build_object('dividida', true, 'original_id', p_id, 'venta_id', v_nuevo);
end;
$$;

-- Revertir: la venta vuelve a su lote de origen si sigue 'comprado' o 'publicado' al
-- mismo costo; si no, la fila vuelve a 'publicado' (si tenía precio de lista) o a 'comprado'.
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
         moneda_venta = null, precio_venta = null, fecha_venta = null
   where id = c.id;
  return jsonb_build_object('fusionada', false, 'compra_id', c.id);
end;
$$;

-- Une un furni provisional (creado por un sprite_id aún sin nombre) con el furni real:
-- sus lotes pasan al destino y el provisional se borra. Lo usa la app al sincronizar
-- con el catálogo de Habbo.es.
create or replace function public.fusionar_furnis(p_origen bigint, p_destino bigint)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  o public.furnis%rowtype;
  d public.furnis%rowtype;
  v_n integer;
begin
  if p_origen = p_destino then raise exception using errcode = 'PT400', message = 'No se puede unir un furni consigo mismo.'; end if;
  select * into o from public.furnis where id = p_origen for update;
  if not found then raise exception using errcode = 'PT404', message = 'El furni de origen no existe.'; end if;
  select * into d from public.furnis where id = p_destino for update;
  if not found then raise exception using errcode = 'PT404', message = 'El furni de destino no existe.'; end if;

  update public.compras set furni_id = p_destino where furni_id = p_origen;
  get diagnostics v_n = row_count;
  delete from public.furnis where id = p_origen;
  update public.furnis
     set sprite_id = coalesce(sprite_id, o.sprite_id),
         tipo = case when sprite_id is null then o.tipo else tipo end
   where id = p_destino;
  return jsonb_build_object('lotes_movidos', v_n, 'furni_id', p_destino);
end;
$$;

-- ─── 6. Entrada unificada de los SniperMercadillo ────────────────────────────

-- Busca el furni del evento: por sprite_id (+ tipo), luego classname, luego nombre.
-- Con p_crear, si no existe lo crea (provisional si solo llegó el sprite_id).
create or replace function public._sniper_furni(p_propietario uuid, e jsonb, p_crear boolean)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sprite integer := nullif(e->>'sprite_id', '')::integer;
  v_tipo text := case when lower(coalesce(e->>'tipo', '')) in ('pared', 'wall') then 'pared' else 'suelo' end;
  v_classname text := nullif(trim(coalesce(e->>'classname', '')), '');
  v_nombre text := nullif(trim(coalesce(e->>'nombre', '')), '');
  v_id bigint;
begin
  if v_sprite is null and v_classname is null and v_nombre is null then
    raise exception 'Falta sprite_id para identificar el furni.';
  end if;
  if v_sprite is not null then
    select id into v_id from public.furnis
     where propietario = p_propietario and sprite_id = v_sprite and tipo = v_tipo order by id limit 1;
  end if;
  if v_id is null and v_classname is not null then
    select id into v_id from public.furnis
     where propietario = p_propietario and classname = v_classname order by id limit 1;
  end if;
  if v_id is null and v_nombre is not null then
    select id into v_id from public.furnis
     where propietario = p_propietario and lower(nombre) = lower(v_nombre) order by id limit 1;
  end if;
  if v_id is not null then
    if v_sprite is not null then
      update public.furnis set sprite_id = v_sprite, tipo = v_tipo where id = v_id and sprite_id is null;
    end if;
    return v_id;
  end if;
  if not p_crear then return null; end if;

  insert into public.furnis (propietario, nombre, classname, revision, sprite_id, tipo)
  values (p_propietario,
          coalesce(v_nombre, format('Sprite %s (%s)', v_sprite, v_tipo)),
          v_classname, nullif(e->>'revision', '')::integer, v_sprite, v_tipo)
  returning id into v_id;
  return v_id;
end;
$$;

-- compra: registra el lote como huérfano ("Por revisar") hasta que el usuario le ponga precio.
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
  if (e->>'precio') is null or (e->>'precio') !~ '^[0-9]+(\.[0-9]+)?$' then
    raise exception 'Falta precio (numero mayor o igual a 0).';
  end if;
  v_precio := (e->>'precio')::numeric;
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

-- publicar: mueve unidades 'comprado' a 'publicado' en orden FIFO, dividiendo lotes.
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
  if (e->>'precio_lista') is null or (e->>'precio_lista') !~ '^[0-9]+(\.[0-9]+)?$' then
    raise exception 'Falta precio_lista (numero mayor o igual a 0).';
  end if;
  v_lista := (e->>'precio_lista')::numeric;
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
  return jsonb_build_object('furni_id', v_furni, 'cantidad', v_cantidad - v_resta, 'faltante', v_resta, 'lotes', v_lotes);
end;
$$;

-- recuperar: devuelve unidades 'publicado' a 'comprado' en orden FIFO (lo publicado
-- hace más tiempo primero), limpiando el precio de lista.
create or replace function public._sniper_recuperar(t public.tokens_sniper, e jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cantidad integer := coalesce(nullif(e->>'cantidad', '')::integer, 1);
  v_furni bigint;
  v_sin_precio boolean;
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
  -- Si el furni no tiene precio de venta, lo recuperado vuelve "por revisar".
  select precio_venta is null into v_sin_precio from public.furnis where id = v_furni;

  v_resta := v_cantidad;
  for l in
    select * from public.compras
     where propietario = t.propietario and furni_id = v_furni and estado = 'publicado'
     order by publicado_en asc nulls first, id asc
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
         set estado = 'comprado', pendiente = v_sin_precio, precio_lista = null, moneda_lista = null, publicado_en = null
       where id = l.id;
      v_destino := l.id;
    else
      update public.compras set cantidad = cantidad - v_toma where id = l.id;
      insert into public.compras (propietario, furni_id, estado, cantidad, moneda_compra, precio_compra,
                                  fecha_compra, origen_id, fuente, pendiente, instancia, sprite_id, notas)
      values (l.propietario, l.furni_id, 'comprado', v_toma, l.moneda_compra, l.precio_compra,
              l.fecha_compra, l.id, l.fuente, v_sin_precio, l.instancia, l.sprite_id, l.notas)
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

-- Punto de entrada único.
--   token_sniper  token del VPS (Ajustes → Conexión con SniperMercadillo)
--   eventos       [{ tipo_evento: 'compra'|'publicar'|'recuperar', id_externo, sprite_id,
--                    cantidad, hotel: 'es', ... }]   (máximo 200 por envío)
-- Cada evento es independiente: uno inválido va a "errores" sin frenar a los demás y
-- no queda registrado. Un id_externo ya visto se cuenta en "duplicados" y se ignora.
create or replace function public.registrar_eventos_sniper(token_sniper text, eventos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tokens_sniper%rowtype;
  e jsonb;
  i integer := -1;
  v_id_ext text;
  v_tipo text;
  v_evento bigint;
  v_res jsonb;
  v_procesados integer := 0;
  v_duplicados integer := 0;
  v_errores jsonb := '[]'::jsonb;
  v_detalle jsonb := '[]'::jsonb;
begin
  t := public._token_sniper_valido(token_sniper);
  if eventos is null or jsonb_typeof(eventos) <> 'array' or jsonb_array_length(eventos) = 0 then
    raise exception using errcode = 'PT400', message = 'No llegaron eventos: "eventos" debe ser una lista.';
  end if;
  if jsonb_array_length(eventos) > 200 then
    raise exception using errcode = 'PT400', message = 'Maximo 200 eventos por envio.';
  end if;

  update public.tokens_sniper set ultimo_uso = now() where id = t.id;

  for e in select * from jsonb_array_elements(eventos) loop
    i := i + 1;
    v_id_ext := null;
    v_tipo := null;
    begin
      if jsonb_typeof(e) <> 'object' then raise exception 'Cada evento debe ser un objeto.'; end if;
      v_id_ext := left(nullif(trim(coalesce(e->>'id_externo', '')), ''), 120);
      v_tipo := lower(trim(coalesce(e->>'tipo_evento', '')));
      if v_id_ext is null then raise exception 'Falta id_externo (id unico del evento).'; end if;
      if v_tipo not in ('compra', 'publicar', 'recuperar') then
        raise exception 'tipo_evento no valido: "%". Usa compra, publicar o recuperar.', v_tipo;
      end if;
      if lower(trim(coalesce(e->>'hotel', ''))) not in ('es', 'habbo.es', 'www.habbo.es', 'game-es.habbo.com') then
        raise exception 'Hotel "%" no admitido. Solo se aceptan eventos de Habbo.es (Habbo Origins y otros hoteles quedan fuera).',
          coalesce(e->>'hotel', '');
      end if;

      v_evento := null;
      insert into public.eventos_sniper (propietario, token_id, id_externo, tipo_evento, sprite_id, cantidad, datos)
      values (t.propietario, t.id, v_id_ext, v_tipo, nullif(e->>'sprite_id', '')::integer,
              coalesce(nullif(e->>'cantidad', '')::integer, 1), e)
      on conflict (propietario, id_externo) do nothing
      returning id into v_evento;

      if v_evento is null then
        v_duplicados := v_duplicados + 1;
        v_detalle := v_detalle || jsonb_build_object('indice', i, 'id_externo', v_id_ext, 'tipo_evento', v_tipo, 'duplicado', true);
        continue;
      end if;

      v_res := case v_tipo
        when 'compra' then public._sniper_compra(t, e, v_id_ext)
        when 'publicar' then public._sniper_publicar(t, e)
        else public._sniper_recuperar(t, e)
      end;
      update public.eventos_sniper set resultado = v_res where id = v_evento;

      if coalesce((v_res->>'duplicado')::boolean, false) then
        v_duplicados := v_duplicados + 1;
      else
        v_procesados := v_procesados + 1;
      end if;
      v_detalle := v_detalle || (jsonb_build_object('indice', i, 'id_externo', v_id_ext, 'tipo_evento', v_tipo) || v_res);
    exception when others then
      v_errores := v_errores || jsonb_build_object('indice', i, 'id_externo', v_id_ext, 'tipo_evento', nullif(v_tipo, ''), 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'recibidos', jsonb_array_length(eventos),
    'procesados', v_procesados,
    'duplicados', v_duplicados,
    'errores', v_errores,
    'eventos', v_detalle);
end;
$$;

-- La entrada anterior queda reemplazada por la unificada.
drop function if exists public.registrar_compras_sniper(text, text, jsonb, text);

-- ─── 7. Permisos ─────────────────────────────────────────────────────────────

revoke execute on function public._sniper_furni(uuid, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public._sniper_compra(public.tokens_sniper, jsonb, text) from public, anon, authenticated;
revoke execute on function public._sniper_publicar(public.tokens_sniper, jsonb) from public, anon, authenticated;
revoke execute on function public._sniper_recuperar(public.tokens_sniper, jsonb) from public, anon, authenticated;
revoke execute on function public.fusionar_furnis(bigint, bigint) from public, anon;
revoke execute on function public.registrar_eventos_sniper(text, jsonb) from public;

grant execute on function public.fusionar_furnis(bigint, bigint) to authenticated;
grant execute on function public.registrar_eventos_sniper(text, jsonb) to anon, authenticated;

-- ─── 8. Tiempo real: la app se entera de cada evento del Sniper ──────────────

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'eventos_sniper') then
    alter publication supabase_realtime add table public.eventos_sniper;
  end if;
end;
$$;
