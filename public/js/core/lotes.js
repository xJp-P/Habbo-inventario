// public/js/core/lotes.js — como reparten las funciones de la base las unidades entre
// los lotes, para que los modales muestren lo mismo que va a pasar.
//
// Lo publicado se toma del publicado hace mas tiempo al mas reciente (FIFO), como hacen
// vender_furni, retirar_furni y el evento recuperar del Sniper. Tambien lo cargan las
// pruebas en Node (public/js/package.json lo marca como modulo ES).

// Lotes publicados en orden FIFO: publicado_en ascendente (sin fecha primero) y luego id.
export function ordenFifoPublicados(lotes) {
  return lotes.slice().sort(function (a, b) {
    if (a.publicado_en !== b.publicado_en) {
      if (!a.publicado_en) return -1;
      if (!b.publicado_en) return 1;
      return a.publicado_en < b.publicado_en ? -1 : 1;
    }
    return a.id - b.id;
  });
}

// Agrupa lotes publicados por precio de lista (del mas barato al mas caro). Cada grupo:
// { precio_lista, moneda_lista, precio_lista_cr, unidades, lotes (FIFO) }.
export function gruposPorPrecioLista(lotes) {
  var porClave = {};
  var grupos = [];
  lotes.forEach(function (l) {
    var clave = l.moneda_lista + ':' + Number(l.precio_lista);
    if (!porClave[clave]) {
      porClave[clave] = { precio_lista: Number(l.precio_lista), moneda_lista: l.moneda_lista, precio_lista_cr: Number(l.precio_lista_cr), unidades: 0, lotes: [] };
      grupos.push(porClave[clave]);
    }
    porClave[clave].unidades += l.cantidad;
    porClave[clave].lotes.push(l);
  });
  grupos.forEach(function (g) { g.lotes = ordenFifoPublicados(g.lotes); });
  return grupos.sort(function (a, b) { return a.precio_lista_cr - b.precio_lista_cr; });
}

// "Nº 12" o "Nº 12 (#45)" si el lote es un LTD con numero.
export function etiquetaLote(l) {
  return 'Nº ' + l.id + (l.numero_ltd ? ' (#' + l.numero_ltd + ')' : '');
}

// Reparte `q` unidades entre los lotes, en el orden dado: [{ lote, toma }].
export function repartirFifo(lotes, q) {
  var resta = q; var out = [];
  lotes.forEach(function (l) {
    if (resta <= 0) return;
    var toma = Math.min(l.cantidad, resta);
    out.push({ lote: l, toma: toma });
    resta -= toma;
  });
  return out;
}
