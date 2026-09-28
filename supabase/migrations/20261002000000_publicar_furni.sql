-- =============================================================================
-- Habbo Inventario — Publicar un furni completo a mano (todas sus unidades en mano)
--
-- Requiere 20261001000000_publicacion_manual (columna publicado_por y publicar_lote).
-- Cómo aplicarlo: Supabase → SQL Editor → pega este archivo completo → Run.
-- Es una sola transacción del editor y se puede ejecutar más de una vez.
--
-- QUÉ CAMBIA
--   publicar_furni(p_furni_id, p_cantidad, p_precio_lista): publica a mano unidades de
--   un furni tomándolas de TODOS sus lotes en mano ('comprado' y no "por revisar"), del
--   más antiguo al más nuevo (FIFO, como el Sniper). Sin cantidad, publica todas: el
--   furni sale por completo de Comprado. Si una parte de un lote entra, ese lote se
--   divide. Lo "por revisar" (recién comprado por el Sniper) no se toca: lo publica el
--   Sniper. El precio de lista es en créditos; sin precio, el del furni.
-- =============================================================================

-- ─── 0. Comprobación: 20261001000000 ya está aplicada ───────────────────────

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'compras' and column_name = 'publicado_por') then
    raise exception 'Falta ejecutar antes 20261001000000_publicacion_manual.sql (y las anteriores, en orden).';
  end if;
end;
$$;

-- ─── 1. Publicar un furni completo ───────────────────────────────────────────

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

  v_lista := coalesce(p_precio_lista, case when f.moneda_venta = 'creditos' then f.precio_venta end);
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

-- ─── 2. Permisos ─────────────────────────────────────────────────────────────

revoke execute on function public.publicar_furni(bigint, integer, numeric) from public, anon;
grant execute on function public.publicar_furni(bigint, integer, numeric) to authenticated;
