-- =============================================================================
-- Habbo Inventario — Eliminar tokens con limpieza profunda de su keko (v1.5.0)
-- Requiere 20261011000000_inventario_en_vivo (y las anteriores).
--
-- Hasta ahora, eliminar un token revocado siempre conservaba lo que envio su Sniper. Ahora
-- se puede elegir:
--   - Borrado simple: solo el token (lo de siempre; la app lo hace sin esta migracion).
--   - Limpieza profunda: el token Y todos los datos de su keko: los lotes de ese keko (en
--     mano, por revisar, publicados en el mercadillo y vendidos), la foto de su inventario,
--     sus exclusiones de la auditoria, su registro como keko manual si lo hubiera y el
--     historial de eventos de los tokens eliminados. Los otros tokens revocados que
--     aprendieron ese keko lo olvidan, para que el keko desaparezca de la app. Los furnis
--     no se tocan (son de todos tus kekos).
--
-- Un keko es una cuenta de Habbo: su nombre no distingue mayusculas («KekoX» = «kekox»),
-- asi que todo se compara con lower(), tanto lo que se borra como la regla de seguridad.
--
-- REGLA DE SEGURIDAD: la limpieza profunda se niega (PT409) si el keko tiene algun token
-- ACTIVO: su Sniper sigue gestionando ese inventario. Se comprueba dentro de la misma
-- transaccion que borra, con los tokens del keko bloqueados, asi que nada puede
-- reactivarse entre la comprobacion y el borrado.
--
--   1. _limpieza_tokens(uid, ids): lo que borraria (uso interno).
--   2. vista_limpieza_tokens(ids): esa vista previa, para el modal de la app.
--   3. eliminar_tokens_sniper(ids, limpieza): elimina los tokens (todos revocados) y, con
--      limpieza, los datos de sus kekos. Todo o nada.
-- Son security definer (la app no puede borrar eventos del Sniper por su cuenta) y cada
-- consulta se limita a las filas de auth.uid().
-- =============================================================================

-- ─── 0. Comprobación: 20261011000000 ya está aplicada ───────────────────────

do $$
begin
  if to_regprocedure('public.auditoria_en_vivo()') is null then
    raise exception 'Falta ejecutar antes 20261011000000_inventario_en_vivo.sql (y las anteriores, en orden).';
  end if;
end;
$$;

-- ─── 1. Lo que borraria la limpieza profunda ─────────────────────────────────
-- { tokens: [{ id, nombre, keko }], eventos, bloqueada, kekos: [{ keko, lotes_en_mano,
--   en_mano, lotes_publicados, publicadas, ventas, vendidas, foto, exclusiones,
--   activos: [nombres de tokens activos de ese keko] }] }

create or replace function public._limpieza_tokens(p_uid uuid, p_ids bigint[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with tk as (
    select t.id, t.nombre, t.keko from public.tokens_sniper t
     where t.propietario = p_uid and t.id = any(p_ids)
  ),
  kk as (
    select distinct on (lower(keko)) keko from tk where keko is not null order by lower(keko), keko
  ),
  detalle as (
    select k.keko,
           (select count(*) from public.compras c where c.propietario = p_uid and lower(c.keko) = lower(k.keko) and c.estado = 'comprado')::integer as lotes_en_mano,
           (select coalesce(sum(c.cantidad), 0) from public.compras c where c.propietario = p_uid and lower(c.keko) = lower(k.keko) and c.estado = 'comprado')::integer as en_mano,
           (select count(*) from public.compras c where c.propietario = p_uid and lower(c.keko) = lower(k.keko) and c.estado = 'publicado')::integer as lotes_publicados,
           (select coalesce(sum(c.cantidad), 0) from public.compras c where c.propietario = p_uid and lower(c.keko) = lower(k.keko) and c.estado = 'publicado')::integer as publicadas,
           (select count(*) from public.compras c where c.propietario = p_uid and lower(c.keko) = lower(k.keko) and c.estado = 'vendido')::integer as ventas,
           (select coalesce(sum(c.cantidad), 0) from public.compras c where c.propietario = p_uid and lower(c.keko) = lower(k.keko) and c.estado = 'vendido')::integer as vendidas,
           (select max(i.recibido_en) from public.inventario_habbo i where i.propietario = p_uid and lower(i.keko) = lower(k.keko)) as foto,
           (select count(*) from public.exclusiones_auditoria e where e.propietario = p_uid and lower(e.keko) = lower(k.keko))::integer as exclusiones,
           coalesce((select jsonb_agg(t.nombre order by t.nombre) from public.tokens_sniper t
                      where t.propietario = p_uid and lower(t.keko) = lower(k.keko) and not t.revocado), '[]'::jsonb) as activos
      from kk k
  )
  select jsonb_build_object(
    'tokens', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'keko', keko) order by id) from tk), '[]'::jsonb),
    'eventos', (select count(*) from public.eventos_sniper e where e.propietario = p_uid and e.token_id = any(p_ids)),
    'bloqueada', exists (select 1 from detalle where jsonb_array_length(activos) > 0),
    'kekos', coalesce((select jsonb_agg(to_jsonb(d) order by d.keko) from detalle d), '[]'::jsonb));
$$;

-- Los ids pedidos, sin repetir, todos del usuario y revocados; si no, PT4xx.
create or replace function public._tokens_revocados(p_uid uuid, p_ids bigint[])
returns bigint[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids bigint[] := array(select distinct x from unnest(coalesce(p_ids, '{}'::bigint[])) x where x is not null);
begin
  if p_uid is null then
    raise exception using errcode = 'PT401', message = 'Inicia sesion para eliminar tokens.';
  end if;
  if cardinality(v_ids) = 0 then
    raise exception using errcode = 'PT400', message = 'Indica al menos un token.';
  end if;
  if (select count(*) from public.tokens_sniper where propietario = p_uid and id = any(v_ids)) <> cardinality(v_ids) then
    raise exception using errcode = 'PT404', message = 'Ese token no existe.';
  end if;
  if exists (select 1 from public.tokens_sniper where propietario = p_uid and id = any(v_ids) and not revocado) then
    raise exception using errcode = 'PT409', message = 'Solo se eliminan los tokens revocados: revócalo primero.';
  end if;
  return v_ids;
end;
$$;

-- ─── 2. Vista previa para el modal ───────────────────────────────────────────

create or replace function public.vista_limpieza_tokens(p_ids bigint[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return public._limpieza_tokens(auth.uid(), public._tokens_revocados(auth.uid(), p_ids));
end;
$$;

-- ─── 3. Eliminar, con o sin limpieza profunda ────────────────────────────────

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

-- ─── 4. Permisos ─────────────────────────────────────────────────────────────

revoke execute on function public._limpieza_tokens(uuid, bigint[]) from public, anon, authenticated;
revoke execute on function public._tokens_revocados(uuid, bigint[]) from public, anon, authenticated;
revoke execute on function public.vista_limpieza_tokens(bigint[]) from public, anon;
revoke execute on function public.eliminar_tokens_sniper(bigint[], boolean) from public, anon;
grant execute on function public.vista_limpieza_tokens(bigint[]) to authenticated;
grant execute on function public.eliminar_tokens_sniper(bigint[], boolean) to authenticated;
