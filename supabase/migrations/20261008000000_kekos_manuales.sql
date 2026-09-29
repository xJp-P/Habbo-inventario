-- =============================================================================
-- Habbo Inventario — Kekos manuales (v1.2.0)
-- Requiere 20261007000000_auditoria_inventario (y las anteriores).
--
-- Un "keko manual" es una cuenta de Habbo sin Sniper (una bodega, un keko de tradeos):
-- nunca envia su inventario, asi que nunca se audita. Registrarlo sirve para que las
-- compras y ventas manuales digan en que keko estan y dejen de quedar "sin keko", que es
-- lo que ensuciaba las auditorias de los snipers (fila «Sin keko asignado»).
--
--   1. Tabla kekos: los kekos manuales de cada usuario (nombre unico sin distinguir
--      mayusculas). Los de los snipers NO se guardan aqui: se detectan de
--      tokens_sniper.keko y de inventario_habbo.
--   2. listar_kekos(): todos (de los snipers y manuales) con sus unidades en mano y
--      publicadas, para Ajustes y para los selectores de «+ Compra» y «Venta».
--   3. crear_keko, renombrar_keko (tambien renombra sus lotes), borrar_keko (solo sin
--      unidades en mano ni publicadas: no deja lotes huerfanos).
--   4. asignar_sin_keko(hacia, items): pasa a un keko las unidades en mano sin keko de
--      los furnis elegidos, en una sola transaccion.
--   5. mover_a_keko registra como manual un keko de destino que no se conocia (lo que
--      se escribe en «¿En qué keko están?» de la Auditoría).
--   6. Los kekos que ya tienen lotes (movidos en la Auditoría) y no son de un sniper
--      quedan registrados como manuales.
-- =============================================================================

-- ─── 0. Comprobación: 20261007000000 ya está aplicada ───────────────────────

do $$
begin
  if to_regprocedure('public.auditar_inventario(text, text, text, jsonb)') is null then
    raise exception 'Falta ejecutar antes 20261007000000_auditoria_inventario.sql (y las anteriores, en orden).';
  end if;
end;
$$;

-- ─── 1. Tabla ────────────────────────────────────────────────────────────────

create table if not exists public.kekos (
  id          bigint generated always as identity primary key,
  propietario uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nombre      text not null check (length(nombre) between 1 and 60 and nombre = trim(nombre)),
  creado_en   timestamptz not null default now()
);
create unique index if not exists kekos_nombre_unico on public.kekos (propietario, lower(nombre));

alter table public.kekos enable row level security;
drop policy if exists "kekos propios" on public.kekos;
create policy "kekos propios" on public.kekos for all to authenticated
  using (propietario = auth.uid()) with check (propietario = auth.uid());

revoke all on public.kekos from anon;
grant select, insert, update, delete on public.kekos to authenticated;

-- ─── 2. Los kekos que ya existen en lotes ────────────────────────────────────
-- Nombres usados en la Auditoría («Están en otro keko») que no son de un sniper.

insert into public.kekos (propietario, nombre)
select distinct on (c.propietario, lower(trim(c.keko))) c.propietario, trim(c.keko)
  from public.compras c
 where c.keko is not null
   and not exists (select 1 from public.tokens_sniper t
                    where t.propietario = c.propietario and lower(t.keko) = lower(trim(c.keko)))
   and not exists (select 1 from public.inventario_habbo i
                    where i.propietario = c.propietario and lower(i.keko) = lower(trim(c.keko)))
   and not exists (select 1 from public.kekos k
                    where k.propietario = c.propietario and lower(k.nombre) = lower(trim(c.keko)))
 order by c.propietario, lower(trim(c.keko)), c.id;

-- ─── 3. Listar ───────────────────────────────────────────────────────────────
-- [{ nombre, origen: 'sniper'|'manual', id (del keko manual o null), snipers: [nombres
--    de token], en_mano, publicadas }], primero los de los snipers y luego los manuales.
-- Un nombre que es de un sniper se muestra como de sniper aunque tambien este registrado.

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
           'publicadas', coalesce(u.publicadas, 0))
         order by (d.nombre is null), lower(x.nombre)), '[]'::jsonb)
    from todos x
    left join detectados d on d.nombre = x.nombre
    left join public.kekos m on lower(m.nombre) = lower(x.nombre)
    left join snipers s on s.nombre = x.nombre
    left join unidades u on u.nombre = x.nombre;
$$;

-- ─── 4. Crear, renombrar y borrar ────────────────────────────────────────────

-- Un nombre de keko valido o PT400. Uso interno.
create or replace function public._nombre_keko(p_nombre text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(trim(coalesce(p_nombre, '')), '');
begin
  if v is null or length(v) > 60 then
    raise exception using errcode = 'PT400', message = 'El nombre del keko debe tener entre 1 y 60 caracteres.';
  end if;
  return v;
end;
$$;

-- ¿Es el keko de uno de tus snipers? (su token lo aprendio o envio su inventario)
create or replace function public._es_keko_sniper(p_nombre text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (select 1 from public.tokens_sniper where lower(keko) = lower(p_nombre))
      or exists (select 1 from public.inventario_habbo where lower(keko) = lower(p_nombre));
$$;

create or replace function public.crear_keko(p_nombre text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v text := public._nombre_keko(p_nombre);
  v_existe text;
  r public.kekos%rowtype;
begin
  if public._es_keko_sniper(v) then
    raise exception using errcode = 'PT409', message = format('«%s» ya es el keko de uno de tus snipers: no hace falta crearlo.', v);
  end if;
  select nombre into v_existe from public.kekos where lower(nombre) = lower(v);
  if found then
    raise exception using errcode = 'PT409', message = format('Ya tienes un keko llamado «%s».', v_existe);
  end if;
  insert into public.kekos (nombre) values (v) returning * into r;
  return jsonb_build_object('id', r.id, 'nombre', r.nombre);
end;
$$;

-- Cambia el nombre y el de todos sus lotes (en mano, publicados y vendidos).
create or replace function public.renombrar_keko(p_id bigint, p_nombre text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v text := public._nombre_keko(p_nombre);
  v_existe text;
  r public.kekos%rowtype;
  v_lotes integer;
begin
  select * into r from public.kekos where id = p_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'Ese keko no existe.'; end if;
  if lower(v) <> lower(r.nombre) then
    if public._es_keko_sniper(v) then
      raise exception using errcode = 'PT409', message = format('«%s» es el keko de uno de tus snipers: usa otro nombre.', v);
    end if;
    select nombre into v_existe from public.kekos where lower(nombre) = lower(v) and id <> p_id;
    if found then
      raise exception using errcode = 'PT409', message = format('Ya tienes un keko llamado «%s».', v_existe);
    end if;
  end if;
  update public.kekos set nombre = v where id = p_id;
  update public.compras set keko = v where keko = r.nombre;
  get diagnostics v_lotes = row_count;
  return jsonb_build_object('id', p_id, 'nombre', v, 'antes', r.nombre, 'lotes', v_lotes);
end;
$$;

-- Solo sin unidades en mano ni publicadas. Los lotes vendidos conservan el nombre.
create or replace function public.borrar_keko(p_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.kekos%rowtype;
  v_unidades integer;
begin
  select * into r from public.kekos where id = p_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'Ese keko no existe.'; end if;
  select coalesce(sum(cantidad), 0) into v_unidades from public.compras
   where keko = r.nombre and estado in ('comprado', 'publicado');
  if v_unidades > 0 then
    raise exception using errcode = 'PT409',
      message = format('«%s» todavía tiene %s unidad(es) en mano o publicadas. Muévelas a otro keko antes de borrarlo.', r.nombre, v_unidades);
  end if;
  delete from public.kekos where id = p_id;
  return jsonb_build_object('id', p_id, 'nombre', r.nombre);
end;
$$;

-- ─── 5. mover_a_keko registra el keko de destino si no se conocia ───────────
-- Igual que en 20261007000000, mas el registro del destino como keko manual.

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

  -- Un destino que no es de un sniper ni esta registrado queda como keko manual: asi
  -- aparece en Ajustes y en los selectores de «+ Compra» y «Venta».
  if v_hacia is not null and not public._es_keko_sniper(v_hacia)
     and not exists (select 1 from public.kekos where lower(nombre) = lower(v_hacia)) then
    insert into public.kekos (nombre) values (v_hacia);
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

-- ─── 6. Asignar lo que está sin keko ─────────────────────────────────────────
-- p_items: [{ furni_id, cantidad }]. Toma las unidades en mano sin keko de cada furni
-- (de lo mas antiguo a lo mas nuevo, como mover_a_keko) y las pasa a p_hacia. Todo o
-- nada: si un furni no tiene tantas unidades sin keko, no se mueve ninguno.

create or replace function public.asignar_sin_keko(p_hacia text, p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_hacia text := public._nombre_keko(p_hacia);
  x jsonb;
  v_movs jsonb := '[]'::jsonb;
  v_unidades integer := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = 'PT400', message = 'Marca al menos un furni para asignar.';
  end if;
  for x in select * from jsonb_array_elements(p_items) loop
    v_movs := v_movs || public.mover_a_keko((x->>'furni_id')::bigint, (x->>'cantidad')::integer, null, v_hacia, null);
    v_unidades := v_unidades + (x->>'cantidad')::integer;
  end loop;
  return jsonb_build_object('hacia', v_hacia, 'furnis', jsonb_array_length(p_items), 'unidades', v_unidades, 'movimientos', v_movs);
end;
$$;

-- ─── 7. Permisos ─────────────────────────────────────────────────────────────

revoke execute on function public.listar_kekos() from public, anon;
revoke execute on function public._nombre_keko(text) from public, anon;
revoke execute on function public._es_keko_sniper(text) from public, anon;
revoke execute on function public.crear_keko(text) from public, anon;
revoke execute on function public.renombrar_keko(bigint, text) from public, anon;
revoke execute on function public.borrar_keko(bigint) from public, anon;
revoke execute on function public.mover_a_keko(bigint, integer, text, text, bigint[]) from public, anon;
revoke execute on function public.asignar_sin_keko(text, jsonb) from public, anon;

grant execute on function public.listar_kekos() to authenticated;
grant execute on function public._nombre_keko(text) to authenticated;
grant execute on function public._es_keko_sniper(text) to authenticated;
grant execute on function public.crear_keko(text) to authenticated;
grant execute on function public.renombrar_keko(bigint, text) to authenticated;
grant execute on function public.borrar_keko(bigint) to authenticated;
grant execute on function public.mover_a_keko(bigint, integer, text, text, bigint[]) to authenticated;
grant execute on function public.asignar_sin_keko(text, jsonb) to authenticated;
