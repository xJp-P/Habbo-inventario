-- =============================================================================
-- Habbo Inventario — «Vinieron de otro keko» solo con evidencia (v1.5.2)
-- Requiere 20261012000000_limpieza_tokens (y las anteriores).
--
-- Con un sobrante, la bandeja ofrecia «Volvieron de <keko> (N alla)» por CADA otro keko
-- que tuviera unidades de ese furni en la app, fuera de un Sniper o manual. Era una
-- conjetura escrita como un hecho: un keko manual (una bodega) nunca envia su inventario,
-- asi que la app no tiene ninguna prueba de que esas unidades se hayan movido, y pulsarlo
-- por error descuadraba el stock de ese keko.
--
-- Ahora cada otro keko llega con su evidencia:
--   auditado  ese keko tiene Sniper y una foto de su inventario;
--   faltan    cuantas de las unidades que la app tiene alli NO estan en esa foto: si sobran
--             aqui y faltan alla, lo mas probable es que se movieran.
-- La bandeja solo sugiere «Vinieron de» con esa evidencia; para lo demas (kekos manuales
-- incluidos) hay un formulario donde eliges tu el keko de origen.
--
--   1. _unidades_en_fotos(propietario, excepto): cuantas unidades de cada furni hay en la
--      ultima foto de cada keko (menos el auditado). Uso interno; tambien es la sonda.
--   2. _comparar_inventario: igual que en 20261010000000, con la evidencia en `otros`.
-- =============================================================================

-- ─── 0. Comprobación: 20261012000000 ya está aplicada ───────────────────────

do $$
begin
  if to_regprocedure('public.vista_limpieza_tokens(bigint[])') is null then
    raise exception 'Falta ejecutar antes 20261012000000_limpieza_tokens.sql (y las anteriores, en orden).';
  end if;
end;
$$;

-- ─── 1. Las unidades de cada furni en las fotos de los otros kekos ───────────

create or replace function public._unidades_en_fotos(p_propietario uuid, p_excepto text)
returns table (keko text, sprite_id integer, tipo text, cantidad integer)
language sql
stable
security definer
set search_path = ''
as $$
  select i.keko, (x->>'sprite_id')::integer, x->>'tipo', sum((x->>'cantidad')::integer)::integer
    from public.inventario_habbo i
    cross join lateral jsonb_array_elements(i.furnis) x
   where i.propietario = p_propietario and i.keko <> p_excepto
   group by i.keko, (x->>'sprite_id')::integer, x->>'tipo';
$$;

-- ─── 2. Comparar la foto con la app, con la evidencia de los otros kekos ─────
-- Igual que en 20261010000000, mas `auditado` y `faltan` en cada keko de `otros`.

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
                       from jsonb_array_elements_text(coalesce(x->'ltds', '[]'::jsonb)) v), '{}'::integer[]) as ltds,
           (x->>'costo_unidad')::numeric as costo_unidad,
           (x->>'unidades_con_costo')::integer as unidades_con_costo,
           (x->>'costo_medio')::boolean as costo_medio,
           public._tramos_foto(x) as costos
      from jsonb_array_elements(v_inv.furnis) x
  ),
  lotes as (
    select f.sprite_id, f.tipo, c.id, c.keko, c.cantidad, c.numero_ltd, c.precio_compra, c.moneda_compra
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
  -- Lo que costo lo que la app ya tiene en este keko y lo que tiene sin keko (en creditos,
  -- por costo): la bandeja descuenta cada lote del tramo del Sniper con su mismo costo, que
  -- son esas unidades (las sin keko, las que ofrece «Son de este keko»).
  app_costos as (
    select sprite_id, tipo,
           jsonb_agg(jsonb_build_object('costo_unidad', precio, 'unidades', unidades) order by precio) filter (where en_keko) as costos,
           jsonb_agg(jsonb_build_object('costo_unidad', precio, 'unidades', unidades) order by precio) filter (where not en_keko) as sin_keko
      from (select sprite_id, tipo, keko is not null as en_keko, precio_compra as precio, sum(cantidad)::integer as unidades
              from lotes where (keko = p_keko or keko is null) and moneda_compra = 'creditos'
             group by sprite_id, tipo, keko is not null, precio_compra) x
     group by sprite_id, tipo
  ),
  ltd_app as (
    select sprite_id, tipo,
           jsonb_agg(jsonb_build_object('lote_id', id, 'numero_ltd', numero_ltd) order by numero_ltd) as lotes,
           array_agg(numero_ltd order by numero_ltd) as numeros
      from lotes where keko = p_keko and numero_ltd is not null group by sprite_id, tipo
  ),
  -- Los otros kekos que tienen unidades de ese furni en la app, con la EVIDENCIA de que
  -- esas unidades se movieron: `auditado` (ese keko tiene Sniper y foto; un keko manual
  -- nunca la tiene) y `faltan` (cuantas de las que la app tiene alli NO estan en su foto).
  -- La bandeja solo sugiere «vinieron de» con faltan > 0; lo demas lo eliges tu.
  otros as (
    select k.sprite_id, k.tipo,
           jsonb_agg(jsonb_build_object(
             'keko', k.keko, 'unidades', k.unidades,
             'auditado', a.keko is not null,
             'faltan', case when a.keko is null then 0 else greatest(k.unidades - coalesce(fo.cantidad, 0), 0) end)
             order by k.keko) as kekos
      from (select sprite_id, tipo, keko, sum(cantidad)::integer as unidades
              from lotes where keko is not null and keko <> p_keko group by sprite_id, tipo, keko) k
      left join public.inventario_habbo a on a.propietario = p_propietario and a.keko = k.keko
      left join public._unidades_en_fotos(p_propietario, p_keko) fo
        on fo.keko = k.keko and fo.sprite_id = k.sprite_id and fo.tipo = k.tipo
     group by k.sprite_id, k.tipo
  ),
  conocidos as (
    select distinct on (sprite_id, tipo) sprite_id, tipo, id as furni_id, nombre
      from public.furnis where propietario = p_propietario and sprite_id is not null
     order by sprite_id, tipo, id
  ),
  base as (
    select coalesce(h.sprite_id, a.sprite_id) as sprite_id, coalesce(h.tipo, a.tipo) as tipo,
           coalesce(h.cantidad, 0) as habbo, coalesce(h.ltds, '{}'::integer[]) as ltds_habbo,
           coalesce(a.en_keko, 0) as app, coalesce(a.sin_asignar, 0) as sin_asignar,
           h.costo_unidad, h.unidades_con_costo, h.costo_medio, coalesce(h.costos, '[]'::jsonb) as costos
      from habbo h full join app a on a.sprite_id = h.sprite_id and a.tipo = h.tipo
  ),
  cruce as (
    select b.*, k.furni_id, k.nombre, coalesce(o.kekos, '[]'::jsonb) as otros,
           coalesce(la.lotes, '[]'::jsonb) as lotes_ltd, coalesce(la.numeros, '{}'::integer[]) as ltds_app,
           coalesce(ac.costos, '[]'::jsonb) as costos_app, coalesce(ac.sin_keko, '[]'::jsonb) as costos_sin_keko,
           case when e.id is not null and e.habbo = b.habbo and e.app = b.app then least(e.unidades, b.habbo) else 0 end as excluidas,
           (e.id is not null and not (e.habbo = b.habbo and e.app = b.app)) as exclusion_vencida
      from base b
      left join conocidos k on k.sprite_id = b.sprite_id and k.tipo = b.tipo
      left join otros o on o.sprite_id = b.sprite_id and o.tipo = b.tipo
      left join ltd_app la on la.sprite_id = b.sprite_id and la.tipo = b.tipo
      left join app_costos ac on ac.sprite_id = b.sprite_id and ac.tipo = b.tipo
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
                                 where (el->>'numero_ltd')::integer = any(ltds_faltantes)),
        'costo_unidad', costo_unidad, 'unidades_con_costo', unidades_con_costo, 'costo_medio', costo_medio,
        'costos', costos, 'costos_app', costos_app, 'costos_sin_keko', costos_sin_keko)
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

-- ─── 3. Permisos ─────────────────────────────────────────────────────────────

revoke execute on function public._unidades_en_fotos(uuid, text) from public, anon, authenticated;
revoke execute on function public._comparar_inventario(uuid, text) from public, anon, authenticated;
