-- =============================================================================
-- Habbo Inventario — Ventas del Sniper (v1.7.0)
-- Requiere 20261014000000_inventario_por_keko (y las anteriores).
--
-- El Sniper lee la pestaña «vendido» de «Mis ventas» y envia cada venta del mercadillo
-- como un evento nuevo, `venta`, por el mismo registrar_eventos_sniper de siempre. Como
-- despues las marca como vistas y Habbo las borra, aqui ninguna venta se puede perder:
--
--   1. eventos_sniper acepta el tipo 'venta'.
--   2. compras.vendido_por: 'sniper' en las ventas que registro el Sniper (las demas, null).
--      v_compras lo expone (se recrea junto con v_furnis, que depende de ella).
--   3. ventas_por_asignar: la venta que no se puede casar con un lote queda guardada aqui
--      (pendiente / aplicada / descartada). Cada usuario ve solo las suyas; se escribe
--      solo con las funciones de esta migracion.
--   4. _sniper_venta casa la venta con UNA unidad publicada:
--        - donde: los lotes publicados de ese furni en ESE keko (sin distinguir
--          mayusculas) o sin keko; nunca de otro keko;
--        - cuando: publicados antes de la venta (2 min de margen por los relojes); lo
--          publicado sin fecha, como lo del Excel, tambien cuenta;
--        - orden: el mismo numero LTD; el keko antes que lo sin keko; un lote sin numero
--          antes que uno con numero (si la venta trae numero, uno con OTRO numero nunca se
--          toca); el mismo precio de lista; lo publicado hace mas tiempo.
--      Vende con vender_lote (divide el lote si hace falta; la parte vendida conserva su
--      keko), guarda el neto y la comision, el dia de la venta y vendido_por = 'sniper'.
--      La unidad vendida se queda con el numero LTD de la venta y con el keko de la venta
--      si no tenia. Si no casa, queda «por asignar» y responde por_asignar: true.
--   5. publicar acepta `fecha` (la confirmacion de Habbo): es la hora de publicacion del
--      lote. Sin fecha, ilegible o en el futuro: la hora de llegada, como antes. Tras cada
--      publicar se reintentan las ventas por asignar de ese furni.
--   6. aplicar_venta_por_asignar (con las reglas otra vez, o a un lote que elige el
--      usuario, sin la regla de la hora) y descartar_venta_por_asignar.
--   7. recuperar ya no cruza kekos: un sniper con keko toma de su keko y luego de lo sin
--      keko, nunca de otro.
--   8. revertir_venta limpia vendido_por; la limpieza profunda de tokens borra tambien las
--      ventas por asignar de ese keko.
-- =============================================================================

-- ─── 0. Comprobación: 20261014000000 ya está aplicada ───────────────────────

do $$
begin
  if to_regprocedure('public.publicar_furni(bigint, integer, numeric, text, boolean)') is null then
    raise exception 'Falta ejecutar antes 20261014000000_inventario_por_keko.sql (y las anteriores, en orden).';
  end if;
end;
$$;

-- ─── 1. El registro de eventos acepta «venta» ───────────────────────────────

do $$
declare
  r record;
begin
  for r in select conname from pg_constraint
            where conrelid = 'public.eventos_sniper'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%tipo_evento%'
  loop
    execute format('alter table public.eventos_sniper drop constraint %I', r.conname);
  end loop;
end;
$$;
alter table public.eventos_sniper add constraint eventos_sniper_tipo_evento_check
  check (tipo_evento in ('compra', 'publicar', 'recuperar', 'venta'));

-- ─── 2. Quién registró cada venta ───────────────────────────────────────────

alter table public.compras add column if not exists vendido_por text;
alter table public.compras drop constraint if exists compras_vendido_por_valido;
alter table public.compras add constraint compras_vendido_por_valido
  check (vendido_por is null or vendido_por in ('sniper', 'manual'));

-- ─── 3. Vistas (v_compras expone vendido_por) ───────────────────────────────

drop view if exists public.v_furnis;
drop view if exists public.v_compras;

-- Igual que en 20261007000000, más vendido_por.
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
        c.estado, c.pendiente, c.fuente, c.id_externo, c.instancia, c.sprite_id, c.numero_ltd, c.keko, c.vendido_por,
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

-- ─── 4. Ventas por asignar ──────────────────────────────────────────────────
-- Una venta del Sniper que no casa con ningun lote publicado. No se pierde: queda aqui
-- hasta que se reintenta sola (tras un publicar de ese furni) o el usuario la resuelve.

create table if not exists public.ventas_por_asignar (
  id              bigint generated always as identity primary key,
  propietario     uuid not null references auth.users (id) on delete cascade,
  token_id        bigint references public.tokens_sniper (id) on delete set null,
  evento_id       bigint references public.eventos_sniper (id) on delete set null,
  id_externo      text not null,
  keko            text not null,
  sprite_id       integer,
  tipo            text,
  furni_id        bigint references public.furnis (id) on delete set null,
  precio          numeric not null,
  numero_ltd      integer,
  vendido_en      timestamptz not null,
  causa           text not null,
  motivo          text not null,
  estado          text not null default 'pendiente',
  lote_vendido_id bigint references public.compras (id) on delete set null,
  resuelto_en     timestamptz,
  creado_en       timestamptz not null default now(),
  unique (propietario, id_externo),
  constraint ventas_por_asignar_estado check (estado in ('pendiente', 'aplicada', 'descartada')),
  constraint ventas_por_asignar_causa check (causa in ('sin_furni', 'espacio', 'sin_lote', 'despues', 'ltd'))
);

create index if not exists ventas_por_asignar_pendientes on public.ventas_por_asignar (propietario, estado, vendido_en);

alter table public.ventas_por_asignar enable row level security;
drop policy if exists "ventas por asignar propias" on public.ventas_por_asignar;
create policy "ventas por asignar propias" on public.ventas_por_asignar for select to authenticated
  using (propietario = auth.uid());
revoke all on public.ventas_por_asignar from anon, authenticated;
grant select on public.ventas_por_asignar to authenticated;

-- ─── 5. Casar una venta con su lote ─────────────────────────────────────────

-- Lee un instante de un evento: milisegundos Unix (10 a 15 cifras) o texto ISO 8601.
-- NULL si no viene o no se puede leer.
create or replace function public._instante_evento(e jsonb, clave text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v text := nullif(trim(coalesce(e ->> clave, '')), '');
begin
  if v is null then return null; end if;
  if v ~ '^[0-9]{10,15}$' then return to_timestamp(v::numeric / 1000); end if;
  if v ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then
    begin
      return v::timestamptz;
    exception when others then
      return null;
    end;
  end if;
  return null;
end;
$$;

-- El furni de una venta. Con tipo, el de ese sprite y espacio. Sin tipo (un LTD que el bot
-- no sabe si es de suelo o de pared): el unico furni con ese sprite o, si hay dos, el unico
-- que tenga algo publicado en ese keko o sin keko. Si no, NULL y la causa.
create or replace function public._furni_de_venta(
  p_propietario uuid, p_sprite integer, p_tipo text, p_keko text,
  out furni_id bigint, out causa text)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_ids bigint[];
  v_con bigint[];
begin
  v_ids := array(select f.id from public.furnis f
                  where f.propietario = p_propietario and f.sprite_id = p_sprite
                    and (p_tipo is null or f.tipo = p_tipo)
                  order by f.id);
  if cardinality(v_ids) = 0 then causa := 'sin_furni'; return; end if;
  if cardinality(v_ids) = 1 or p_tipo is not null then furni_id := v_ids[1]; return; end if;
  v_con := array(select distinct l.furni_id from public.compras l
                  where l.propietario = p_propietario and l.furni_id = any(v_ids) and l.estado = 'publicado'
                    and (l.keko is null or lower(l.keko) = lower(p_keko)));
  if cardinality(v_con) = 1 then furni_id := v_con[1]; return; end if;
  causa := case when cardinality(v_con) = 0 then 'sin_lote' else 'espacio' end;
end;
$$;

-- El lote publicado de una venta (ver las reglas en la cabecera), bloqueado. Si no hay,
-- NULL con la causa y el motivo para el usuario.
create or replace function public._lote_de_venta(
  p_propietario uuid, p_furni bigint, p_keko text, p_precio numeric, p_ltd integer, p_vendido_en timestamptz,
  out lote_id bigint, out causa text, out motivo text)
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_limite timestamptz := p_vendido_en + interval '2 minutes';
  v_nombre text;
  v_hay integer;
  v_a_tiempo integer;
begin
  select l.id into lote_id
    from public.compras l
   where l.propietario = p_propietario and l.furni_id = p_furni and l.estado = 'publicado'
     and (l.keko is null or lower(l.keko) = lower(p_keko))
     and (l.publicado_en is null or l.publicado_en <= v_limite)
     and (p_ltd is null or l.numero_ltd is null or l.numero_ltd = p_ltd)
   order by case when p_ltd is not null and l.numero_ltd = p_ltd then 0 else 1 end,
            case when l.keko is null then 1 else 0 end,
            case when l.numero_ltd is null then 0 else 1 end,
            case when coalesce(l.moneda_lista, 'creditos') = 'creditos' and l.precio_lista = p_precio then 0 else 1 end,
            l.publicado_en asc nulls first, l.id asc
   limit 1
   for update;
  if lote_id is not null then return; end if;

  select f.nombre into v_nombre from public.furnis f where f.id = p_furni;
  select count(*), count(*) filter (where l.publicado_en is null or l.publicado_en <= v_limite)
    into v_hay, v_a_tiempo
    from public.compras l
   where l.propietario = p_propietario and l.furni_id = p_furni and l.estado = 'publicado'
     and (l.keko is null or lower(l.keko) = lower(p_keko));
  if v_hay = 0 then
    causa := 'sin_lote';
    motivo := format('No hay unidades publicadas de %s en %s ni sin keko.', v_nombre, p_keko);
  elsif v_a_tiempo > 0 then
    causa := 'ltd';
    motivo := format('Solo hay LTD de %s con otro número publicados en %s; la venta fue del #%s.', v_nombre, p_keko, p_ltd);
  else
    causa := 'despues';
    motivo := format('Lo publicado de %s en %s se publicó después de la venta.', v_nombre, p_keko);
  end if;
end;
$$;

-- Vende UNA unidad del lote como venta del Sniper: neto, comision, dia de la venta (UTC),
-- vendido_por, numero LTD de la venta y su keko si el lote no tenia. Devuelve el detalle
-- (tambien la ganancia frente al costo del lote, para el log y el Discord del bot).
create or replace function public._vender_lote_sniper(
  p_lote bigint, p_precio numeric, p_ltd integer, p_keko text, p_vendido_en timestamptz)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  c public.compras%rowtype;
  r jsonb;
  v_venta bigint;
  v_keko text;
  v_nombre text;
  v_costo numeric;
  v_neto numeric;
begin
  select * into c from public.compras where id = p_lote for update;
  r := public.vender_lote(p_lote, 1, 'creditos', p_precio, (p_vendido_en at time zone 'UTC')::date);
  v_venta := (r ->> 'venta_id')::bigint;
  v_neto := (r ->> 'precio_venta')::numeric;
  update public.compras
     set vendido_por = 'sniper', numero_ltd = coalesce(numero_ltd, p_ltd), keko = coalesce(keko, p_keko)
   where id = v_venta
  returning keko into v_keko;
  select f.nombre into v_nombre from public.furnis f where f.id = c.furni_id;
  v_costo := case when c.precio_compra is null then null
                  when c.moneda_compra = 'lingos' then c.precio_compra * coalesce(
                    (select case when x.valor ~ '^[0-9]+(\.[0-9]+)?$' and x.valor::numeric > 0 then x.valor::numeric end
                       from public.config x where x.clave = 'tasa_lingo' and x.propietario = c.propietario), 50)
                  else c.precio_compra end;
  return jsonb_build_object(
    'furni_id', c.furni_id, 'nombre', v_nombre, 'keko', v_keko,
    'lote_id', p_lote, 'lote_vendido_id', v_venta, 'dividida', (r ->> 'dividida')::boolean,
    'precio', p_precio, 'comision', (r ->> 'comision')::numeric, 'neto', v_neto,
    'precio_lista', c.precio_lista,
    'mismo_precio', coalesce(coalesce(c.moneda_lista, 'creditos') = 'creditos' and c.precio_lista = p_precio, false),
    'numero_ltd', coalesce(c.numero_ltd, p_ltd),
    'ganancia_cr', v_neto - v_costo);
end;
$$;

-- venta: UNA unidad vendida en el mercadillo de Habbo.es (la pestaña «vendido»). Lo mal
-- formado lanza (va a `errores` sin registrarse); lo que no casa queda por asignar.
create or replace function public._sniper_venta(t public.tokens_sniper, e jsonb, p_id_externo text, p_evento bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keko text := nullif(trim(coalesce(e ->> 'keko', '')), '');
  v_sprite integer;
  v_tipo text;
  v_precio numeric;
  v_ltd integer;
  v_vendido timestamptz;
  v_furni bigint;
  v_lote bigint;
  v_causa text;
  v_motivo text;
  v_pendiente bigint;
  v_comision numeric;
begin
  if v_keko is null then raise exception 'Falta keko: la cuenta de Habbo donde se vendio.'; end if;
  if length(v_keko) > 60 then raise exception 'keko demasiado largo (maximo 60 caracteres).'; end if;
  if nullif(trim(coalesce(e ->> 'sprite_id', '')), '') is null then
    raise exception 'Falta sprite_id para identificar el furni.';
  end if;
  if trim(e ->> 'sprite_id') !~ '^[0-9]{1,9}$' then raise exception 'sprite_id no valido: %.', e ->> 'sprite_id'; end if;
  v_sprite := trim(e ->> 'sprite_id')::integer;
  v_tipo := case lower(trim(coalesce(e ->> 'tipo', '')))
              when '' then null when 'suelo' then 'suelo' when 'floor' then 'suelo'
              when 'pared' then 'pared' when 'wall' then 'pared' else '?' end;
  if v_tipo = '?' then raise exception 'tipo no valido: "%". Usa suelo, pared o null.', e ->> 'tipo'; end if;
  v_precio := public._numero_evento(e, 'precio');
  if v_precio is null or v_precio < 1 or v_precio <> trunc(v_precio) then
    raise exception 'Falta precio o no es valido: el precio de lista en creditos (entero mayor que 0).';
  end if;
  if coalesce(nullif(e ->> 'cantidad', '')::integer, 1) <> 1 then
    raise exception 'Cada venta es una sola unidad: no envies cantidad (o envia 1).';
  end if;
  v_ltd := public._ltd_evento(e);
  if nullif(trim(coalesce(e ->> 'fecha', '')), '') is null then
    raise exception 'Falta fecha: milisegundos Unix UTC (13 cifras) o texto ISO 8601.';
  end if;
  v_vendido := public._instante_evento(e, 'fecha');
  if v_vendido is null then
    raise exception 'fecha no valida: % (milisegundos Unix UTC, 13 cifras, o texto ISO 8601).', e ->> 'fecha';
  end if;
  if v_vendido < timestamptz '2020-01-01 00:00:00+00' then
    raise exception 'fecha anterior a 2020 (%): ¿segundos en vez de milisegundos?', e ->> 'fecha';
  end if;
  if v_vendido > now() then v_vendido := now(); end if;

  select x.furni_id, x.causa into v_furni, v_causa
    from public._furni_de_venta(t.propietario, v_sprite, v_tipo, v_keko) x;
  if v_furni is not null then
    select x.lote_id, x.causa, x.motivo into v_lote, v_causa, v_motivo
      from public._lote_de_venta(t.propietario, v_furni, v_keko, v_precio, v_ltd, v_vendido) x;
    if v_lote is not null then
      return public._vender_lote_sniper(v_lote, v_precio, v_ltd, v_keko, v_vendido) || jsonb_build_object('por_asignar', false);
    end if;
  elsif v_causa = 'sin_furni' then
    v_motivo := format('No tienes registrado el furni del sprite %s%s.', v_sprite,
                       case v_tipo when 'suelo' then ' (suelo)' when 'pared' then ' (pared)' else '' end);
  elsif v_causa = 'espacio' then
    v_motivo := format('Hay dos furnis con el sprite %s (suelo y pared) publicados en %s: no se sabe cuál se vendió.', v_sprite, v_keko);
  else
    v_motivo := format('No hay unidades publicadas del sprite %s en %s ni sin keko.', v_sprite, v_keko);
  end if;

  insert into public.ventas_por_asignar (propietario, token_id, evento_id, id_externo, keko, sprite_id, tipo, furni_id,
                                         precio, numero_ltd, vendido_en, causa, motivo)
  values (t.propietario, t.id, p_evento, p_id_externo, v_keko, v_sprite, v_tipo, v_furni,
          v_precio, v_ltd, v_vendido, v_causa, v_motivo)
  returning id into v_pendiente;
  v_comision := public.comision_mercadillo(v_precio);
  return jsonb_build_object('por_asignar', true, 'causa', v_causa, 'motivo', v_motivo, 'venta_por_asignar_id', v_pendiente,
                            'furni_id', v_furni, 'keko', v_keko, 'precio', v_precio, 'comision', v_comision,
                            'neto', v_precio - v_comision, 'numero_ltd', v_ltd);
end;
$$;

-- Reintenta las ventas por asignar de un furni (tras un publicar). La regla de la hora
-- impide que una venta vieja se coma una publicacion nueva. Las de espacio dudoso, no.
create or replace function public._reintentar_ventas(p_propietario uuid, p_furni bigint)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  f public.furnis%rowtype;
  v public.ventas_por_asignar%rowtype;
  v_lote bigint;
  r jsonb;
  n integer := 0;
begin
  select * into f from public.furnis where id = p_furni;
  if not found then return 0; end if;
  for v in
    select * from public.ventas_por_asignar
     where propietario = p_propietario and estado = 'pendiente' and causa <> 'espacio'
       and (furni_id = p_furni
            or (furni_id is null and sprite_id = f.sprite_id and (tipo is null or tipo = f.tipo)))
     order by vendido_en asc, id asc
     for update
  loop
    select x.lote_id into v_lote
      from public._lote_de_venta(p_propietario, p_furni, v.keko, v.precio, v.numero_ltd, v.vendido_en) x;
    continue when v_lote is null;
    r := public._vender_lote_sniper(v_lote, v.precio, v.numero_ltd, v.keko, v.vendido_en);
    update public.ventas_por_asignar
       set estado = 'aplicada', furni_id = p_furni, lote_vendido_id = (r ->> 'lote_vendido_id')::bigint, resuelto_en = now()
     where id = v.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ─── 6. publicar con la fecha de Habbo; recuperar sin cruzar kekos ─────────

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
  v_publicado timestamptz;
  v_asignadas integer;
begin
  v_lista := public._numero_evento(e, 'precio_lista');
  if v_lista is null or v_lista < 0 then
    raise exception 'Falta precio_lista (numero mayor o igual a 0).';
  end if;
  if v_cantidad < 1 then raise exception 'La cantidad debe ser mayor o igual a 1.'; end if;
  if v_moneda not in ('creditos', 'lingos') then raise exception 'Moneda no valida: usa creditos o lingos.'; end if;
  -- La hora en que Habbo confirmo la publicacion; sin ella (o ilegible, o en el futuro),
  -- la de llegada. Las ventas se cruzan con esta hora.
  v_publicado := public._instante_evento(e, 'fecha');
  if v_publicado is null or v_publicado > now() or v_publicado < timestamptz '2020-01-01 00:00:00+00' then
    v_publicado := now();
  end if;

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
             publicado_en = v_publicado, publicado_por = 'sniper', keko = coalesce(t.keko, keko)
       where id = l.id;
      v_lotes := v_lotes || jsonb_build_object('lote_id', l.id, 'cantidad', v_toma, 'dividido', false);
    else
      update public.compras set cantidad = cantidad - v_toma where id = l.id;
      insert into public.compras (propietario, furni_id, estado, cantidad, moneda_compra, precio_compra,
                                  fecha_compra, origen_id, fuente, pendiente, instancia, sprite_id, notas,
                                  precio_lista, moneda_lista, publicado_en, publicado_por, keko)
      values (l.propietario, l.furni_id, 'publicado', v_toma, l.moneda_compra, l.precio_compra,
              l.fecha_compra, l.id, l.fuente, false, l.instancia, l.sprite_id, l.notas,
              v_lista, v_moneda, v_publicado, 'sniper', coalesce(t.keko, l.keko))
      returning id into v_nuevo;
      v_lotes := v_lotes || jsonb_build_object('lote_id', v_nuevo, 'origen_id', l.id, 'cantidad', v_toma, 'dividido', true);
    end if;
    v_resta := v_resta - v_toma;
  end loop;

  if v_resta = v_cantidad then
    raise exception 'No hay stock disponible del sprite % para publicar.', coalesce(e->>'sprite_id', '?');
  end if;
  v_asignadas := public._reintentar_ventas(t.propietario, v_furni);
  return jsonb_build_object('furni_id', v_furni, 'cantidad', v_cantidad - v_resta, 'faltante', v_resta,
                            'precio_lista', v_lista, 'moneda', v_moneda, 'lotes', v_lotes,
                            'publicado_en', v_publicado, 'ventas_asignadas', v_asignadas);
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
       and (t.keko is null or keko is null or lower(keko) = lower(t.keko))
     order by case when t.keko is null or lower(keko) = lower(t.keko) then 0 else 1 end,
              case when publicado_por = 'manual' then 1 else 0 end, publicado_en asc nulls first, id asc
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
    raise exception 'No hay unidades publicadas del sprite % para recuperar.', coalesce(e->>'sprite_id', '?')
      || case when t.keko is not null then format(' en el keko %s ni sin keko', t.keko) else '' end;
  end if;
  return jsonb_build_object('furni_id', v_furni, 'cantidad', v_cantidad - v_resta, 'faltante', v_resta, 'lotes', v_lotes);
end;
$$;

-- ─── 7. La entrada del Sniper acepta «venta»; revertir y limpieza ──────────

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
  v_por_asignar integer := 0;
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
      if v_tipo not in ('compra', 'publicar', 'recuperar', 'venta') then
        raise exception 'tipo_evento no valido: "%". Usa compra, publicar, recuperar o venta.', v_tipo;
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
        when 'recuperar' then public._sniper_recuperar(t, e)
        else public._sniper_venta(t, e, v_id_ext, v_evento)
      end;
      update public.eventos_sniper set resultado = v_res where id = v_evento;

      if coalesce((v_res->>'duplicado')::boolean, false) then
        v_duplicados := v_duplicados + 1;
      else
        v_procesados := v_procesados + 1;
      end if;
      if coalesce((v_res->>'por_asignar')::boolean, false) then
        v_por_asignar := v_por_asignar + 1;
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
    'por_asignar', v_por_asignar,
    'eventos', v_detalle);
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
         moneda_venta = null, precio_venta = null, comision_venta = null, fecha_venta = null, vendido_por = null
   where id = c.id;
  return jsonb_build_object('fusionada', false, 'compra_id', c.id);
end;
$$;

create or replace function public.eliminar_tokens_sniper(p_ids bigint[], p_limpieza boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ids bigint[];
  v_kekos text[] := '{}';
  v_bajos text[] := '{}';
  v_bloqueo record;
  v_vista jsonb := null;
  v_tokens integer;
  v_lotes integer := 0;
  v_eventos integer := 0;
begin
  v_ids := public._tokens_revocados(v_uid, p_ids);
  -- Los tokens a eliminar quedan bloqueados hasta el final.
  perform 1 from public.tokens_sniper where propietario = v_uid and id = any(v_ids) for update;

  if coalesce(p_limpieza, false) then
    v_kekos := array(select distinct on (lower(keko)) keko from public.tokens_sniper
                      where propietario = v_uid and id = any(v_ids) and keko is not null order by lower(keko), keko);
    v_bajos := array(select lower(k) from unnest(v_kekos) k);
    -- REGLA DE SEGURIDAD: con un token activo en alguno de esos kekos, no se borra nada.
    -- Se bloquean tambien los tokens de esos kekos: nadie los reactiva mientras tanto.
    perform 1 from public.tokens_sniper
      where propietario = v_uid and lower(keko) = any(v_bajos) for update;
    select k.keko, string_agg(t.nombre, '», «' order by t.nombre) as activos into v_bloqueo
      from unnest(v_kekos) as k(keko)
      join public.tokens_sniper t on t.propietario = v_uid and lower(t.keko) = lower(k.keko) and not t.revocado
     group by k.keko order by k.keko limit 1;
    if found then
      raise exception using errcode = 'PT409', message = format(
        'No se borran los datos de «%s»: el token activo «%s» lo sigue gestionando. Revócalo primero o usa el borrado simple.',
        v_bloqueo.keko, v_bloqueo.activos);
    end if;

    v_vista := public._limpieza_tokens(v_uid, v_ids);
    delete from public.eventos_sniper where propietario = v_uid and token_id = any(v_ids);
    get diagnostics v_eventos = row_count;
    delete from public.compras where propietario = v_uid and lower(keko) = any(v_bajos);
    get diagnostics v_lotes = row_count;
    delete from public.ventas_por_asignar where propietario = v_uid and lower(keko) = any(v_bajos);
    delete from public.inventario_habbo where propietario = v_uid and lower(keko) = any(v_bajos);
    delete from public.exclusiones_auditoria where propietario = v_uid and lower(keko) = any(v_bajos);
    delete from public.kekos where propietario = v_uid and lower(nombre) = any(v_bajos);
    update public.tokens_sniper set keko = null
     where propietario = v_uid and not (id = any(v_ids)) and lower(keko) = any(v_bajos);
  end if;

  delete from public.tokens_sniper where propietario = v_uid and id = any(v_ids);
  get diagnostics v_tokens = row_count;
  return jsonb_build_object('borrados', v_tokens, 'limpieza', coalesce(p_limpieza, false), 'kekos', to_jsonb(v_kekos),
                            'lotes', v_lotes, 'eventos', v_eventos, 'detalle', v_vista);
end;
$$;

-- ─── 8. La bandeja de la app: aplicar o descartar una venta por asignar ─────
-- security definer (la tabla solo se escribe por aqui), siempre con el usuario de la sesion.

create or replace function public.aplicar_venta_por_asignar(p_id bigint, p_lote_id bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v public.ventas_por_asignar%rowtype;
  l public.compras%rowtype;
  v_furni bigint;
  v_lote bigint;
  v_motivo text;
  r jsonb;
begin
  if v_uid is null then raise exception using errcode = 'PT401', message = 'Inicia sesión para resolver ventas.'; end if;
  select * into v from public.ventas_por_asignar where id = p_id and propietario = v_uid for update;
  if not found then raise exception using errcode = 'PT404', message = 'Esa venta por asignar no existe.'; end if;
  if v.estado <> 'pendiente' then raise exception using errcode = 'PT409', message = 'Esa venta ya se resolvió.'; end if;

  if p_lote_id is null then
    -- Las mismas reglas que al llegar (por si ya se publico lo que faltaba).
    v_furni := v.furni_id;
    if v_furni is null then
      select x.furni_id into v_furni from public._furni_de_venta(v_uid, v.sprite_id, v.tipo, v.keko) x;
    end if;
    if v_furni is null then
      raise exception using errcode = 'PT409', message = v.motivo || ' Elige el lote a mano o descártala.';
    end if;
    select x.lote_id, x.motivo into v_lote, v_motivo
      from public._lote_de_venta(v_uid, v_furni, v.keko, v.precio, v.numero_ltd, v.vendido_en) x;
    if v_lote is null then
      raise exception using errcode = 'PT409', message = v_motivo || ' Elige el lote a mano o descártala.';
    end if;
  else
    -- Un lote que elige el usuario: sin la regla de la hora (el decide), pero del mismo
    -- furni, de ese keko o sin keko, y sin contradecir el numero LTD.
    select * into l from public.compras where id = p_lote_id and propietario = v_uid for update;
    if not found then raise exception using errcode = 'PT404', message = 'Ese lote no existe.'; end if;
    if l.estado <> 'publicado' then raise exception using errcode = 'PT409', message = 'Ese lote no está publicado.'; end if;
    if (v.furni_id is not null and l.furni_id <> v.furni_id)
       or (v.furni_id is null and not exists (select 1 from public.furnis f where f.id = l.furni_id
                                                and f.sprite_id = v.sprite_id and (v.tipo is null or f.tipo = v.tipo))) then
      raise exception using errcode = 'PT409', message = 'Ese lote es de otro furni.';
    end if;
    if l.keko is not null and lower(l.keko) <> lower(v.keko) then
      raise exception using errcode = 'PT409', message = format('Ese lote está en %s y la venta fue en %s.', l.keko, v.keko);
    end if;
    if v.numero_ltd is not null and l.numero_ltd is not null and l.numero_ltd <> v.numero_ltd then
      raise exception using errcode = 'PT409',
        message = format('Ese lote es el LTD #%s y la venta fue del #%s.', l.numero_ltd, v.numero_ltd);
    end if;
    v_lote := l.id;
    v_furni := l.furni_id;
  end if;

  r := public._vender_lote_sniper(v_lote, v.precio, v.numero_ltd, v.keko, v.vendido_en);
  update public.ventas_por_asignar
     set estado = 'aplicada', furni_id = v_furni, lote_vendido_id = (r ->> 'lote_vendido_id')::bigint, resuelto_en = now()
   where id = p_id;
  return r || jsonb_build_object('venta_por_asignar_id', p_id);
end;
$$;

create or replace function public.descartar_venta_por_asignar(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v public.ventas_por_asignar%rowtype;
begin
  if v_uid is null then raise exception using errcode = 'PT401', message = 'Inicia sesión para resolver ventas.'; end if;
  select * into v from public.ventas_por_asignar where id = p_id and propietario = v_uid for update;
  if not found then raise exception using errcode = 'PT404', message = 'Esa venta por asignar no existe.'; end if;
  if v.estado <> 'pendiente' then raise exception using errcode = 'PT409', message = 'Esa venta ya se resolvió.'; end if;
  update public.ventas_por_asignar set estado = 'descartada', resuelto_en = now() where id = p_id;
  return jsonb_build_object('id', p_id, 'estado', 'descartada');
end;
$$;

-- ─── 9. Permisos ─────────────────────────────────────────────────────────────

revoke execute on function public._instante_evento(jsonb, text) from public, anon, authenticated;
revoke execute on function public._furni_de_venta(uuid, integer, text, text) from public, anon, authenticated;
revoke execute on function public._lote_de_venta(uuid, bigint, text, numeric, integer, timestamptz) from public, anon, authenticated;
revoke execute on function public._vender_lote_sniper(bigint, numeric, integer, text, timestamptz) from public, anon, authenticated;
revoke execute on function public._reintentar_ventas(uuid, bigint) from public, anon, authenticated;
revoke execute on function public._sniper_venta(public.tokens_sniper, jsonb, text, bigint) from public, anon, authenticated;
revoke execute on function public._sniper_publicar(public.tokens_sniper, jsonb) from public, anon, authenticated;
revoke execute on function public._sniper_recuperar(public.tokens_sniper, jsonb) from public, anon, authenticated;
revoke execute on function public.aplicar_venta_por_asignar(bigint, bigint) from public, anon;
revoke execute on function public.descartar_venta_por_asignar(bigint) from public, anon;
revoke execute on function public.registrar_eventos_sniper(text, jsonb) from public;
grant execute on function public.aplicar_venta_por_asignar(bigint, bigint) to authenticated;
grant execute on function public.descartar_venta_por_asignar(bigint) to authenticated;
grant execute on function public.registrar_eventos_sniper(text, jsonb) to anon, authenticated;
