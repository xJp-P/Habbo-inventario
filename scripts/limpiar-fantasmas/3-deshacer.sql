-- scripts/limpiar-fantasmas/3-deshacer.sql — SOLO SI HACE FALTA: devuelve los lotes que borro la
-- ultima ejecucion de 2-limpiar.sql, tal cual estaban (mismo numero de lote, cantidad, costo, precio
-- de lista y fecha de publicacion), desde la copia en respaldo.fantasmas.
--
-- Uso: copia TODO este archivo en el SQL Editor de Supabase y pulsa Run. Restaura la ejecucion mas
-- reciente que aun no se haya restaurado; correrlo otra vez restaura la anterior, si la hay. Un lote
-- que apuntaba a un lote de origen que ya no existe vuelve sin ese vinculo (solo sirve para fusionar).

with ultima as (
  select max(r.borrado_en) as en from respaldo.fantasmas r where r.restaurado_en is null
),
filas as (
  select r.* from respaldo.fantasmas r join ultima u on r.borrado_en = u.en where r.restaurado_en is null
),
restaurados as (
  insert into public.compras overriding system value
  select (jsonb_populate_record(null::public.compras,
            fi.lote || case when (fi.lote->>'origen_id') is not null
                             and not exists (select 1 from public.compras o where o.id = (fi.lote->>'origen_id')::bigint)
                             and not exists (select 1 from filas f2 where (f2.lote->>'id') = (fi.lote->>'origen_id'))
                            then '{"origen_id": null}'::jsonb else '{}'::jsonb end)).*
    from filas fi
   order by (fi.lote->>'id')::bigint
  returning id
),
marcadas as (
  update respaldo.fantasmas r set restaurado_en = now()
   where r.id in (select fi.id from filas fi)
  returning r.id
)
select 'RESTAURADO' as accion, fi.lote->>'keko' as keko,
       coalesce(f.nombre, 'furni ' || (fi.lote->>'furni_id')) || coalesce(' #' || (fi.lote->>'numero_ltd'), '') as furni,
       (fi.lote->>'cantidad')::integer as unidades, (fi.lote->>'id')::bigint as lote,
       (select count(*) from restaurados) as total_restaurados
  from filas fi
  left join public.furnis f on f.id = (fi.lote->>'furni_id')::bigint
 order by keko, furni, lote;
