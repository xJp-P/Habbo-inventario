-- =============================================================================
-- Habbo Inventario — La foto del inventario en tiempo real (v1.4.0)
-- Requiere 20261010000000_costos_por_tramo (y las anteriores).
--
-- Hasta ahora la app solo se enteraba al instante de los eventos del Sniper
-- (eventos_sniper). La foto del inventario que envia cada sniper (inventario_habbo)
-- llegaba a la base sin avisar: la Auditoria solo la veia al abrirla o con «Comparar de
-- nuevo». Esta migracion la publica en Supabase Realtime, que respeta RLS (cada usuario
-- recibe solo sus kekos), para que la app actualice la Auditoria sola y avise con una
-- notificacion del sistema cuando aparecen diferencias nuevas.
--
-- Realtime deja fuera del aviso los campos grandes (la lista de furnis): la app solo usa
-- el keko y despues pide la comparacion, asi que no importa.
--
--   1. inventario_habbo entra en la publicacion supabase_realtime.
--   2. auditoria_en_vivo(): si ya esta publicada. La app la consulta antes de escuchar
--      (sin esta migracion no se suscribe) y el asistente la usa como sonda.
-- =============================================================================

-- ─── 0. Comprobación: 20261010000000 ya está aplicada ───────────────────────

do $$
begin
  if to_regprocedure('public._tramos_foto(jsonb)') is null then
    raise exception 'Falta ejecutar antes 20261010000000_costos_por_tramo.sql (y las anteriores, en orden).';
  end if;
end;
$$;

-- ─── 1. Publicar la foto en Realtime ─────────────────────────────────────────

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inventario_habbo') then
    alter publication supabase_realtime add table public.inventario_habbo;
  end if;
end;
$$;

-- ─── 2. ¿La foto llega en vivo? ──────────────────────────────────────────────

create or replace function public.auditoria_en_vivo()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inventario_habbo');
$$;

revoke execute on function public.auditoria_en_vivo() from public, anon;
grant execute on function public.auditoria_en_vivo() to authenticated;
