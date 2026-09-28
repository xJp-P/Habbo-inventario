// backend/services/importarExcel.js — importa una planilla de Excel (hojas "Inventario",
// "Mercadillo" y "Resumen") a la base de Supabase del usuario.
//
// OJO CON LOS NOMBRES: en el Excel la hoja "Inventario" son los furnis con precio (en la
// app: vista Mercadillo, tabla `furnis`) y la hoja "Mercadillo" son las compras (en la
// app: vista Inventario, tabla `compras`). Aca se leen las hojas por su nombre del Excel.
//
// Lo usan el script `npm run migrar` y el boton "Importar desde Excel" de Ajustes, para
// que cualquier usuario pueda traer su propio archivo.
//
// LECTURA TOLERANTE: las columnas se ubican por el TEXTO del encabezado, no por la letra,
// asi que funciona aunque alguien haya movido columnas. Las celdas con formula se leen
// por su resultado guardado.
//
// NOMBRES: cada furni se resuelve contra el catalogo oficial de Habbo.es. Coincidencias
// exactas (salvo tildes/mayusculas) y errores de tipeo claros se corrigen al nombre
// oficial y se reportan; lo que no tenga candidato seguro se importa tal cual, "sin
// vincular", para revisarlo despues en la app.

const ExcelJS = require('exceljs');
const { ClientError, normalizar, monedaDesdeTexto } = require('../core/util');

// Valor "visible" de una celda. Ojo: exceljs omite el resultado guardado de una formula
// cuando ese resultado es 0, asi que una formula sin `result` se devuelve como null.
function valorCelda(celda) {
  const v = celda && celda.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if (v instanceof Date) return v;
    if ('result' in v) return v.result === undefined ? null : v.result;
    if ('formula' in v || 'sharedFormula' in v) return null;
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;
    if ('error' in v) return null;
  }
  return v;
}

function hoja(libro, nombre) {
  const h = libro.worksheets.find((w) => normalizar(w.name) === normalizar(nombre));
  if (!h) throw new ClientError(`El Excel no tiene la hoja "${nombre}".`);
  return h;
}

// Ubica la fila de encabezados (la primera que tenga todas las columnas pedidas) y
// devuelve { fila, columnas: { clave: numeroDeColumna } }.
function ubicarEncabezados(h, requeridas) {
  for (let r = 1; r <= Math.min(h.rowCount, 30); r++) {
    const fila = h.getRow(r);
    const textos = {};
    fila.eachCell((celda, col) => { textos[col] = normalizar(valorCelda(celda)); });
    const columnas = {};
    for (const [clave, prueba] of Object.entries(requeridas)) {
      const col = Object.keys(textos).find((c) => prueba(textos[c]));
      if (col) columnas[clave] = Number(col);
    }
    if (Object.keys(columnas).length === Object.keys(requeridas).length) return { fila: r, columnas };
  }
  throw new ClientError(`No encontre los encabezados esperados en la hoja "${h.name}".`);
}

function texto(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

function numero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

async function leerExcel(ruta) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.readFile(ruta);

  // Hoja Resumen: la tasa (celda a la derecha de "Creditos por 1 Lingo:") y los valores
  // que el Excel tenia calculados, para comparar despues de importar.
  let tasa = null;
  const resumenExcel = {};
  const resumen = libro.worksheets.find((w) => normalizar(w.name) === 'resumen');
  if (resumen) {
    resumen.eachRow((fila) => {
      const etiqueta = normalizar(valorCelda(fila.getCell(1)));
      const celda = fila.getCell(2);
      const valor = valorCelda(celda);
      if (etiqueta.startsWith('creditos por 1 lingo')) tasa = numero(valor);
      // Formula sin resultado leido = 0 guardado (ver valorCelda).
      else if (etiqueta && valor !== null) resumenExcel[etiqueta] = valor;
      else if (etiqueta && celda.value && typeof celda.value === 'object') resumenExcel[etiqueta] = 0;
    });
  }

  const inv = hoja(libro, 'Inventario');
  const encInv = ubicarEncabezados(inv, {
    nombre: (t) => t === 'furni',
    moneda: (t) => t === 'moneda de venta',
    precio: (t) => t === 'precio venta x und',
  });
  const furnis = [];
  for (let r = encInv.fila + 1; r <= inv.rowCount; r++) {
    const fila = inv.getRow(r);
    const nombre = texto(valorCelda(fila.getCell(encInv.columnas.nombre)));
    if (!nombre) continue;
    furnis.push({
      fila: r,
      nombre,
      moneda: texto(valorCelda(fila.getCell(encInv.columnas.moneda))) || 'Créditos',
      precio: numero(valorCelda(fila.getCell(encInv.columnas.precio))),
    });
  }

  const mer = hoja(libro, 'Mercadillo');
  const encMer = ubicarEncabezados(mer, {
    estado: (t) => t === 'estado',
    nombre: (t) => t.startsWith('furni'),
    cantidad: (t) => t === 'cantidad',
    moneda: (t) => t === 'moneda de compra',
    precio: (t) => t === 'precio compra x und',
  });
  const compras = [];
  for (let r = encMer.fila + 1; r <= mer.rowCount; r++) {
    const fila = mer.getRow(r);
    const nombre = texto(valorCelda(fila.getCell(encMer.columnas.nombre)));
    if (!nombre) continue;
    compras.push({
      fila: r,
      nombre,
      estado: normalizar(valorCelda(fila.getCell(encMer.columnas.estado))) === 'vendido' ? 'vendido' : 'comprado',
      cantidad: numero(valorCelda(fila.getCell(encMer.columnas.cantidad))),
      moneda: texto(valorCelda(fila.getCell(encMer.columnas.moneda))) || 'Créditos',
      precio: numero(valorCelda(fila.getCell(encMer.columnas.precio))),
    });
  }

  return { tasa, furnis, compras, resumenExcel };
}

// Prepara lo leido y lo escribe en Supabase en UNA transaccion (funcion importar_excel).
// `reemplazar` borra antes tus furnis y lotes. La resolucion de nombres contra el
// catalogo de Habbo.es se hace aca, en la app, porque el catalogo vive en tu equipo.
async function importarDatos(negocio, furnidata, datos, { corregirNombres = true, reemplazar = false } = {}) {
  const catalogo = furnidata && furnidata.estado().disponible;
  const informe = { furnis: 0, compras: 0, tasa: null, correcciones: [], sinVincular: [], avisos: [] };
  const clavePorNombreExcel = new Map(); // nombre del Excel normalizado -> clave del furni
  const furnis = new Map();              // clave (nombre oficial normalizado) -> furni a crear

  function resolver(nombreExcel) {
    if (!catalogo) return { nombre: nombreExcel, classname: null, revision: null, tipo: 'sin_catalogo' };
    const r = furnidata.coincidencia(nombreExcel);
    if (r.furni && (r.tipo === 'exacta' || corregirNombres)) {
      return { nombre: corregirNombres ? r.furni.nombre : nombreExcel, classname: r.furni.classname, revision: r.furni.revision, tipo: r.tipo, variantes: r.variantes };
    }
    return { nombre: nombreExcel, classname: null, revision: null, tipo: 'ninguna', sugerencias: r.sugerencias };
  }

  const precioExcel = new Map();
  function altaFurni(nombreExcel, moneda, precio, filaExcel, hoja) {
    const claveExcel = normalizar(nombreExcel);
    if (clavePorNombreExcel.has(claveExcel)) {
      if (hoja === 'Inventario') informe.avisos.push(`Fila ${filaExcel} de la hoja Inventario: "${nombreExcel}" esta repetido; se uso el primero.`);
      return clavePorNombreExcel.get(claveExcel);
    }
    const res = resolver(nombreExcel);
    const clave = normalizar(res.nombre);
    if (furnis.has(clave)) {
      informe.avisos.push(`"${nombreExcel}" corresponde al mismo furni oficial que otro renglon ("${res.nombre}"); se unieron.`);
      clavePorNombreExcel.set(claveExcel, clave);
      return clave;
    }
    furnis.set(clave, { clave, nombre: res.nombre, classname: res.classname, revision: res.revision });
    // El precio de la hoja Inventario NO se guarda en el furni (lo en mano no tiene
    // precio): solo congela el de las ventas que el Excel ya tenia.
    precioExcel.set(clave, { moneda: monedaDesdeTexto(moneda), precio });
    if (res.nombre !== nombreExcel) {
      informe.correcciones.push({ excel: nombreExcel, oficial: res.nombre, classname: res.classname, tipo: res.tipo });
    }
    if (res.tipo === 'ninguna' || res.tipo === 'sin_catalogo') {
      informe.sinVincular.push({ nombre: nombreExcel, sugerencias: (res.sugerencias || []).map((s) => s.nombre) });
    }
    if (res.variantes > 1) {
      informe.avisos.push(`"${res.nombre}" tiene ${res.variantes} variantes en el catalogo; se tomo ${res.classname}. Puedes cambiarla en el Mercadillo de la app.`);
    }
    clavePorNombreExcel.set(claveExcel, clave);
    return clave;
  }

  for (const f of datos.furnis) altaFurni(f.nombre, f.moneda, f.precio, f.fila, 'Inventario');

  const compras = [];
  for (const c of datos.compras) {
    if (!clavePorNombreExcel.has(normalizar(c.nombre))) {
      informe.avisos.push(`Fila ${c.fila} de la hoja Mercadillo: "${c.nombre}" no estaba en la hoja Inventario; se agrego igual.`);
    }
    const clave = altaFurni(c.nombre, 'Créditos', null, c.fila, 'Mercadillo');
    if (!c.cantidad || c.cantidad < 1 || !Number.isInteger(c.cantidad)) {
      informe.avisos.push(`Fila ${c.fila} de la hoja Mercadillo: cantidad invalida (${c.cantidad}); se omitio.`);
      continue;
    }
    if (c.precio === null || c.precio < 0) {
      informe.avisos.push(`Fila ${c.fila} de la hoja Mercadillo: precio de compra invalido; se omitio.`);
      continue;
    }
    let monedaVenta = null;
    let precioVenta = null;
    if (c.estado === 'vendido') {
      // El Excel no guarda el precio real de venta: se congela el precio actual de la
      // hoja Inventario (lo mismo que mostraba el Excel al momento de importar).
      const furni = precioExcel.get(clave);
      monedaVenta = furni.moneda;
      precioVenta = furni.precio;
      if (precioVenta === null || precioVenta === undefined) {
        monedaVenta = monedaDesdeTexto(c.moneda);
        precioVenta = c.precio;
        informe.avisos.push(`Fila ${c.fila} de la hoja Mercadillo: venta sin precio en la hoja Inventario; se registro a precio de costo (ganancia 0).`);
      }
    }
    compras.push({
      clave_furni: clave, estado: c.estado, cantidad: c.cantidad,
      moneda_compra: monedaDesdeTexto(c.moneda), precio_compra: c.precio,
      moneda_venta: monedaVenta, precio_venta: precioVenta,
      notas: `Importado del Excel (fila ${c.fila})`,
    });
  }

  const r = await negocio.importarExcel({ tasa: datos.tasa, furnis: [...furnis.values()], compras, reemplazar });
  informe.furnis = r.furnis;
  informe.compras = r.compras;
  informe.tasa = datos.tasa && datos.tasa > 0 ? datos.tasa : null;
  informe.resumen = await negocio.resumen();
  return informe;
}

async function importarExcel(negocio, furnidata, ruta, opciones) {
  const datos = await leerExcel(ruta);
  return importarDatos(negocio, furnidata, datos, opciones);
}

module.exports = { leerExcel, importarDatos, importarExcel };
