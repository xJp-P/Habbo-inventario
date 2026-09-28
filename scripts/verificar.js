#!/usr/bin/env node
// scripts/verificar.js — pruebas de la logica, la seguridad y la API, SIN nube.
//
//   npm run verificar
//
// Levanta Postgres local (PGlite) con el MISMO esquema de supabase/migrations y corre
// la app completa contra el: dos usuarios (para probar que RLS los aisla), la clave
// anon (lo unico que ve un sniper), el registro de compras del Sniper con token, los
// eventos unificados del Sniper (compra, publicar, recuperar con FIFO), los lotes
// huerfanos, la venta parcial, la comision del mercadillo (la funcion JS de la interfaz
// contra la de la base), el Excel real (si esta en la raiz), el aviso en tiempo real y
// las barreras de la API local. No toca tu Supabase ni tus datos.

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');
const { EventEmitter } = require('events');
const { crearApp } = require('../backend/server');
const { crearClienteLocal } = require('../backend/db/clienteLocal');
const { crearServicioConexion } = require('../backend/services/conexion');
const { crearServicioNegocio } = require('../backend/services/negocio');
const { leerExcel, importarDatos } = require('../backend/services/importarExcel');
const { normalizar } = require('../backend/core/util');
const { DIR_DATOS_DEV, buscarExcel } = require('./comun');

let pasos = 0;
function ok(msg) { pasos++; console.log('  ok  ' + msg); }
const cerca = (a, b) => Math.abs(a - b) < 1e-9;
async function rechaza(promesa, patron) {
  await assert.rejects(promesa, (e) => { assert.match(e.message, patron); return true; });
}

// Peticion HTTP cruda (permite forzar Host, Origin y Content-Type para las pruebas).
function pedir(puerto, metodo, ruta, { cuerpo, crudo, tipo, host, origin } = {}) {
  return new Promise((resolve, reject) => {
    const datos = crudo !== undefined ? crudo : cuerpo !== undefined ? JSON.stringify(cuerpo) : null;
    const headers = { Host: host || `127.0.0.1:${puerto}` };
    if (datos !== null) {
      headers['Content-Type'] = tipo || 'application/json';
      headers['Content-Length'] = Buffer.byteLength(datos);
    }
    if (origin) headers.Origin = origin;
    const req = http.request({ host: '127.0.0.1', port: puerto, method: metodo, path: ruta, headers }, (res) => {
      const partes = [];
      res.on('data', (c) => partes.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(partes);
        let json = null;
        try { json = JSON.parse(buf.toString()); } catch (_) { /* no es JSON */ }
        resolve({ status: res.statusCode, json, bytes: buf.length });
      });
    });
    req.on('error', reject);
    if (datos !== null) req.write(datos);
    req.end();
  });
}

function esperarEvento(puerto, tipo, ms = 4000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: puerto, path: '/api/eventos' }, (res) => {
      let buf = '';
      const t = setTimeout(() => { req.destroy(); reject(new Error('No llego el evento ' + tipo)); }, ms);
      res.on('data', (c) => {
        buf += c;
        const m = new RegExp(`event: ${tipo}\\ndata: (.+)\\n\\n`).exec(buf);
        if (m) { clearTimeout(t); req.destroy(); resolve(JSON.parse(m[1])); }
      });
    });
    req.on('error', () => {});
  });
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'habbo-inventario-'));
  const cache = path.join(DIR_DATOS_DEV, 'furnidata-es.json');
  if (fs.existsSync(cache)) fs.copyFileSync(cache, path.join(dir, 'furnidata-es.json'));

  // ── Base: Postgres local con el esquema de Supabase y dos usuarios ──
  const clienteA = await crearClienteLocal();
  await clienteA.crearUsuario('ana@prueba.local', 'clave-ana');
  await clienteA.crearUsuario('beto@prueba.local', 'clave-beto');
  assert.equal((await clienteA.auth.signInWithPassword({ email: 'ana@prueba.local', password: 'clave-mala' })).error.message, 'Invalid login credentials');
  await clienteA.auth.signInWithPassword({ email: 'ana@prueba.local', password: 'clave-ana' });
  const anon = clienteA.comoAnon();
  ok('esquema de supabase/migrations instalado en Postgres local; login con usuario y contraseña');

  // ── Comision del mercadillo: la funcion de la interfaz y la de la base ──
  const comision = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'core', 'comision.js')).href);
  for (const [precio, com, neto] of [[2, 1, 1], [150, 4, 146], [2500, 58, 2442], [99999, 14500, 85499]]) {
    assert.equal(comision.calcularComision(precio), com, `comision de ${precio}`);
    assert.equal(comision.calcularGananciaNeta(precio, 0), neto, `neto de ${precio}`);
  }
  assert.equal(comision.calcularGananciaNeta(150, 100), 46);
  ok('comision exacta (JS): 2 -> 1 (neto 1), 150 -> 4 (neto 146), 2500 -> 58 (neto 2442), 99999 -> 14500 (neto 85499)');
  for (const [neto, lista] of [[1, 2], [146, 150], [2442, 2500], [85499, 99999]]) {
    assert.equal(comision.calcularPrecioLista(neto), lista, `precio de lista para recibir ${neto}`);
  }
  for (let n = 1; n <= 150000; n++) {
    const p = comision.calcularPrecioLista(n);
    if (p - comision.calcularComision(p) !== n || (p - 1) - comision.calcularComision(p - 1) >= n) assert.fail(`neto ${n}: lista ${p} no es la menor que lo deja exacto`);
  }
  ok('al reves (casilla "Ingresar precio neto"): 1 -> 2, 146 -> 150, 2442 -> 2500, 85499 -> 99999; exacto y el menor posible de 1 a 150.000');
  const barrido = (await clienteA.pg.query(
    'select p::int as p, public.comision_mercadillo(p)::int as c from generate_series(0, 200000) p order by p')).rows;
  assert.equal(barrido.length, 200001);
  for (const x of barrido) {
    if (x.c !== comision.calcularComision(x.p)) assert.fail(`SQL y JS difieren en ${x.p}: ${x.c} vs ${comision.calcularComision(x.p)}`);
  }
  const costos = [0, 0.5, 1, 24.84, 99.2, 146, 2442, 85499, 123456.7, 192080, 192081];
  for (let c = 3; c < 150000; c += 997) costos.push(c, c + 0.37);
  const minimos = (await clienteA.pg.query(
    'select c::float8 as c, public.precio_minimo_mercadillo(c)::float8 as p from unnest($1::numeric[]) c', [costos])).rows;
  assert.equal(minimos.length, costos.length);
  for (const x of minimos) {
    const js = comision.precioMinimoSinPerder(x.c);
    assert.equal(x.p, js, `precio minimo para costo ${x.c}`);
    if (js !== null && js > 0) {
      assert.ok(js - comision.calcularComision(js) >= x.c && (js - 1) - comision.calcularComision(js - 1) < x.c, `minimo exacto para ${x.c}`);
    }
  }
  assert.equal(comision.precioMinimoSinPerder(85499), 99999);
  assert.equal(comision.precioMinimoSinPerder(192081), null);
  ok('la base (comision_mercadillo) cobra lo mismo que la interfaz de 0 a 200.000 cr; precio minimo identico y exacto');

  const { app, negocio, furnidata, cerrar } = await crearApp({ dirDatos: dir, clienteFijo: clienteA, log: () => {} });
  assert.ok(furnidata.estado().disponible, 'El catalogo de Habbo.es deberia estar disponible');
  ok(`catalogo Habbo.es cargado (${furnidata.estado().total} furnis)`);

  // ── Seguridad: la clave anon no ve nada ──
  for (const t of ['furnis', 'compras', 'config', 'tokens_sniper', 'v_furnis', 'v_compras']) {
    const r = await anon.from(t).select('*');
    assert.equal(r.error && r.error.code, '42501', `anon no deberia leer ${t}`);
  }
  assert.equal((await anon.rpc('vender_lote', { p_id: 1 })).error.code, '42501');
  ok('la clave anon no puede leer ni una tabla ni usar las funciones de la app');

  // ── Nombres oficiales ──
  await rechaza(negocio.crearFurni({ nombre: 'Alas Brillante' }), /Quisiste decir "Alas Brillantes"/);
  const cara = await negocio.crearFurni({ nombre: 'cara con cicatrices', moneda_venta: 'Créditos', precio_venta: 25 });
  assert.equal(cara.nombre, 'Cara con Cicatrices');
  assert.equal(cara.classname, 'clothing_r26_scarface');
  assert.equal(cara.estado, 'sin_compras');
  await rechaza(negocio.crearFurni({ nombre: 'Cara con Cicatrices' }), /ya esta en el Mercadillo/);
  ok('nombres oficiales de Habbo.es: sugiere, corrige y no deja repetir');

  // ── Lotes y calculos ──
  const lote = await negocio.crearCompra({ furni_id: cara.id, cantidad: 17, moneda_compra: 'creditos', precio_compra: 24 });
  await negocio.crearCompra({ nombre: 'Cara con Cicatrices', cantidad: 2, precio_compra: 32 });
  let f = await negocio.furniPorId(cara.id);
  assert.equal(f.stock, 19);
  assert.equal(f.inversion_cr, 17 * 24 + 2 * 32);
  assert.ok(cerca(f.costo_promedio_cr, 472 / 19));
  assert.equal(f.compra_min_cr, 24);
  assert.equal(f.compra_max_cr, 32);
  assert.equal(f.precio_minimo_cr, 26, 'a 25 la comision (1) deja 24 < 24,84: el minimo es 26');
  assert.equal(f.estado, 'en_venta');
  assert.equal(f.en_perdida, true, 'a 25 cr, tras la comision, no cubre el costo promedio');
  ok('stock 19, costo promedio 24,84, compra mas barata/cara, precio minimo 26 (con comision)');
  await negocio.actualizarFurni(cara.id, { precio_venta: 26 });
  assert.equal((await negocio.furniPorId(cara.id)).en_perdida, false);
  await negocio.actualizarFurni(cara.id, { precio_venta: 24 });
  assert.equal((await negocio.furniPorId(cara.id)).en_perdida, true);
  assert.equal((await negocio.resumen()).datos.perdidas.length, 1);
  ok('precio que no cubre el costo tras la comision: marca perdida y sale en la alerta');
  await negocio.actualizarFurni(cara.id, { precio_venta: 30 });
  f = await negocio.furniPorId(cara.id);
  assert.equal(f.ganancia_esperada_bruta_cr, 19 * 30 - 472);
  assert.equal(f.comision_esperada_cr, 19);
  assert.equal(f.ganancia_esperada_cr, 19 * (30 - 1) - 472);
  assert.equal(comision.gananciaEsperadaFurni(f, await negocio.listarCompras()), f.ganancia_esperada_cr);
  const r0 = await negocio.resumen();
  assert.equal(r0.en_venta.comision_cr, 19);
  assert.equal(r0.en_venta.ganancia_cr, 79);
  assert.equal(r0.sin_comision.ganancia_cr, 98);
  ok('ganancia esperada NETA: 19 und a 30 cr pagan 19 cr de comision -> +79 (sin comision serian +98), igual en la vista, el Resumen y la columna');

  // ── Venta parcial, precio congelado, reversion ──
  const v = await negocio.vender(lote.id, { cantidad: 5 });
  assert.equal(v.dividida, true);
  assert.equal(v.original.cantidad, 12);
  assert.equal(v.venta.cantidad, 5);
  assert.equal(v.venta.origen_id, lote.id);
  assert.equal(v.venta.ganancia_cr, 30);
  assert.equal((await negocio.furniPorId(cara.id)).n_compras, 2);
  ok('venta parcial: el lote de 17 queda en 12 y nace una fila "vendido" de 5');
  await negocio.actualizarFurni(cara.id, { precio_venta: 99 });
  assert.equal((await negocio.compraPorId(v.venta.id)).ganancia_cr, 30);
  ok('cambiar el precio del furni NO altera ventas pasadas');
  const r1 = await negocio.resumen();
  assert.equal(r1.vendido.retorno_cr, 150);
  assert.ok(cerca(r1.vendido.margen, 0.25));
  const rev = await negocio.revertirVenta(v.venta.id);
  assert.equal(rev.fusionada, true);
  assert.equal(rev.compra.cantidad, 17);
  ok('Resumen de ventas (ingresos 150, margen 25 %) y revertir devuelve las unidades');
  for (const c of await negocio.listarCompras()) await negocio.vender(c.id, { precio_venta: 40 });
  assert.equal((await negocio.furniPorId(cara.id)).estado, 'agotado');
  await rechaza(negocio.vender(lote.id), /ya esta vendido/);
  await rechaza(negocio.eliminarFurni(cara.id), /tiene 2 lote/);
  ok('vender todo deja "Agotado"; no deja vender dos veces ni borrar con lotes');

  // ── Lingos y tasa ──
  const corona = await negocio.crearFurni({ nombre: 'Corona de Oro de 24 kt', moneda_venta: 'Lingos', precio_venta: 100 });
  await negocio.crearCompra({ furni_id: corona.id, cantidad: 1, moneda_compra: 'lingos', precio_compra: 70 });
  await negocio.fijarTasa(60);
  f = await negocio.furniPorId(corona.id);
  assert.equal(f.precio_venta_cr, 6000);
  assert.ok(cerca(f.ganancia_esperada_lg, 30));
  await negocio.fijarTasa(50);
  ok('precios en Lingos se convierten con la tasa vigente (50 -> 60)');

  // ── Tokens de sniper y funcion registrar_eventos_sniper (clave anon) ──
  const tk = await negocio.crearToken('VPS Contabo 1');
  assert.match(tk.token, /^hbi_[\w-]{40,}$/);
  const lista = await negocio.listarTokens();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].token, undefined);
  assert.equal(lista[0].hash, undefined);
  ok('token de sniper: se muestra una vez; en la base solo queda su huella');

  const sniper = (eventos, token = tk.token) => anon.rpc('registrar_eventos_sniper', { token_sniper: token, eventos });
  const velo = furnidata.porClase('seaside_ltd26_sanddragon');
  const sakura = furnidata.porClase('val15_sakura');
  const compraVelo = (id, cantidad, precio, extra = {}) => ({ tipo_evento: 'compra', id_externo: id, sprite_id: velo.sprite_id, cantidad, precio, moneda: 'creditos', hotel: 'es', ...extra });
  const publicarVelo = (id, cantidad, lista) => ({ tipo_evento: 'publicar', id_externo: id, sprite_id: velo.sprite_id, cantidad, precio_lista: lista, moneda: 'creditos', hotel: 'es' });
  const recuperarVelo = (id, cantidad) => ({ tipo_evento: 'recuperar', id_externo: id, sprite_id: velo.sprite_id, cantidad, hotel: 'es' });
  const leerLote = (id) => negocio.compraPorId(id);

  let r = await sniper([compraVelo('x', 1, 5)], 'hbi_falso');
  assert.equal(r.error.code, 'PT401');
  r = await sniper([compraVelo('x', 1, 5, { hotel: 'origins' })]);
  assert.equal(r.data.procesados, 0);
  assert.match(r.data.errores[0].error, /Solo se aceptan eventos de Habbo\.es/);
  ok('token falso: 401 · un evento de otro hotel (Origins) se rechaza sin frenar el envio');

  const server = http.createServer(app).listen(0, '127.0.0.1');
  await new Promise((res) => server.once('listening', res));
  const puerto = server.address().port;
  try {
    // ── CICLO COMPLETO: compra -> publicacion parcial del lote -> recuperacion de 1 ──
    let aviso = esperarEvento(puerto, 'eventos-sniper');
    await new Promise((res) => setTimeout(res, 150));
    r = await sniper([compraVelo('cmp_1', 5, 300, { notas: 'Costo extra: 10 diamantes' })]);
    assert.equal(r.data.procesados, 1);
    const idCompra = r.data.eventos[0].compra_id;
    let ev = await aviso;
    assert.equal(ev.compras, 1);
    let l1 = await leerLote(idCompra);
    assert.equal(l1.nombre, 'Dragón Velo de Arena', 'el furni que llego solo con sprite_id recibe su nombre oficial');
    assert.equal(l1.cantidad, 5);
    assert.equal(l1.estado, 'comprado');
    assert.equal(l1.pendiente, true);
    assert.equal(l1.notas, 'Costo extra: 10 diamantes');

    r = await sniper([publicarVelo('pub_1', 3, 360)]);
    assert.equal(r.data.procesados, 1);
    assert.equal(r.data.eventos[0].cantidad, 3);
    assert.equal(r.data.eventos[0].faltante, 0);
    const p1 = await leerLote(r.data.eventos[0].lotes[0].lote_id);
    l1 = await leerLote(idCompra);
    assert.equal(l1.cantidad, 2);
    assert.equal(l1.estado, 'comprado');
    assert.equal(p1.estado, 'publicado');
    assert.equal(p1.cantidad, 3);
    assert.equal(p1.precio_lista, 360);
    assert.equal(p1.origen_id, idCompra);
    assert.equal(p1.pendiente, false);
    assert.equal(r.data.eventos[0].precio_lista, 360, 'la respuesta devuelve el precio de lista guardado');
    assert.equal(p1.comision_cr, 8);
    assert.equal(p1.ganancia_cr, comision.calcularGananciaNeta(360, 300) * 3);
    assert.equal(p1.ganancia_cr, (352 - 300) * 3);

    r = await sniper([recuperarVelo('rec_1', 1)]);
    assert.equal(r.data.procesados, 1);
    assert.equal((await leerLote(idCompra)).cantidad, 3);
    assert.equal((await leerLote(p1.id)).cantidad, 2);

    r = await sniper([compraVelo('cmp_1', 5, 300), publicarVelo('pub_1', 3, 360), recuperarVelo('rec_1', 1)]);
    assert.equal(r.data.duplicados, 3);
    assert.equal(r.data.procesados, 0);
    assert.equal((await leerLote(idCompra)).cantidad, 3);
    assert.equal((await leerLote(p1.id)).cantidad, 2);
    let fv = (await negocio.listarFurnis()).find((f) => f.nombre === 'Dragón Velo de Arena');
    assert.equal(fv.stock, 5);
    assert.equal(fv.unidades_publicadas, 2);
    assert.equal(fv.unidades_pendientes, 3);
    assert.equal(fv.sprite_id, velo.sprite_id);
    assert.equal(fv.precio_venta, null);
    assert.equal(fv.precio_lista_actual, 360, 'el furni sin precio propio expone su precio de lista');
    assert.equal(fv.moneda_lista_actual, 'creditos');
    ok('CICLO: compra de 5 -> publica 3 (el lote se divide: 2 + 3 publicados a 360) -> recupera 1 (vuelve a su lote: 3 + 2); reintentos ignorados');

    // ── FIFO entre lotes, faltante y eventos sin stock ──
    r = await sniper([compraVelo('cmp_2', 2, 280)]);
    const idCompra2 = r.data.eventos[0].compra_id;
    r = await sniper([publicarVelo('pub_2', 4, 350)]);
    const lotes2 = r.data.eventos[0].lotes;
    assert.equal(r.data.eventos[0].cantidad, 4);
    assert.deepEqual(lotes2.map((x) => [x.cantidad, x.dividido]), [[3, false], [1, true]]);
    assert.equal(lotes2[0].lote_id, idCompra, 'FIFO: primero el lote mas antiguo, entero');
    assert.equal(lotes2[1].origen_id, idCompra2, 'luego una parte del siguiente');
    assert.equal((await leerLote(idCompra)).estado, 'publicado');
    assert.equal((await leerLote(idCompra2)).cantidad, 1);
    r = await sniper([publicarVelo('pub_3', 5, '350,0')]);
    assert.equal(r.data.eventos[0].cantidad, 1);
    assert.equal(r.data.eventos[0].precio_lista, 350, 'precio_lista como texto con coma decimal');
    assert.equal(r.data.eventos[0].faltante, 4);
    r = await sniper([publicarVelo('pub_4', 1, 350)]);
    assert.equal(r.data.procesados, 0);
    assert.match(r.data.errores[0].error, /No hay stock disponible/);
    r = await sniper([publicarVelo('pub_x', 1, 'tres')]);
    assert.match(r.data.errores[0].error, /precio_lista no es un numero valido/);
    r = await sniper([{ ...publicarVelo('pub_x', 1, 0), precio_lista: undefined }]);
    assert.match(r.data.errores[0].error, /Falta precio_lista/);
    r = await sniper([compraVelo('cmp_3', 1, 250)]);
    const idCompra3 = r.data.eventos[0].compra_id;
    r = await sniper([publicarVelo('pub_4', 1, 350)]);
    assert.equal(r.data.procesados, 1, 'un evento que fallo no quedo registrado: el reintento funciona');
    assert.equal((await leerLote(idCompra3)).estado, 'publicado');
    fv = (await negocio.listarFurnis()).find((f) => f.nombre === 'Dragón Velo de Arena');
    assert.equal(fv.unidades_publicadas, 8);
    assert.equal(fv.estado, 'publicado');
    assert.equal(fv.lista_min_cr, 350);
    assert.equal(fv.lista_max_cr, 360);
    ok('FIFO entre lotes (el mas antiguo primero), faltante informado, y un evento sin stock falla sin registrarse');

    // ── Lotes publicados en la app: la venta guarda lo que entra al monedero ──
    const venta = await negocio.vender(idCompra, { cantidad: 1 });
    assert.equal(venta.venta.precio_venta_real, 342, 'sin precio explicito: lista 350 - comision 8 = 342 netos');
    assert.equal(venta.venta.comision_venta, 8);
    assert.equal(venta.venta.comision_pagada_cr, 8);
    assert.equal(venta.venta.precio_lista, 350, 'la fila vendida conserva el precio de lista');
    assert.equal(venta.venta.ganancia_cr, comision.calcularGananciaNeta(350, 300));
    assert.equal(venta.venta.ganancia_cr, 42);
    const rv = await negocio.resumen();
    assert.equal(rv.vendido.comision_cr, 8);
    assert.equal((await negocio.furniPorId(venta.venta.furni_id)).comision_pagada_cr, 8);
    assert.equal((await negocio.revertirVenta(venta.venta.id)).compra.estado, 'publicado');
    assert.equal((await leerLote(idCompra)).cantidad, 3);
    for (const [precio, neto] of [[2, 1], [150, 146], [2500, 2442], [99999, 85499]]) {
      const v = await negocio.vender(idCompra, { cantidad: 1, precio_venta: precio });
      assert.equal(v.venta.precio_venta_real, neto, `vendido en el mercadillo a ${precio}: entran ${neto}`);
      assert.equal(v.venta.comision_venta, precio - neto);
      assert.equal(v.venta.ganancia_cr, comision.calcularGananciaNeta(precio, 300));
      await negocio.revertirVenta(v.venta.id);
    }
    const vLingos = await negocio.vender(idCompra, { cantidad: 1, moneda_venta: 'lingos', precio_venta: 8 });
    assert.equal(vLingos.venta.precio_venta_real, 8);
    assert.equal(vLingos.venta.comision_venta, null, 'en lingos no hay comision (intercambio directo)');
    await negocio.revertirVenta(vLingos.venta.id);
    const ventaTotal = await negocio.vender(idCompra3, {});
    assert.equal(ventaTotal.dividida, false);
    assert.equal(ventaTotal.venta.precio_venta_real, 342);
    const deshecha = await negocio.revertirVenta(idCompra3);
    assert.equal(deshecha.compra.estado, 'publicado');
    assert.equal(deshecha.compra.precio_venta_real, null);
    assert.equal(deshecha.compra.comision_venta, null, 'revertir borra la comision');
    ok('venta de lo publicado: guarda el NETO (350 -> 342; 2 -> 1, 150 -> 146, 2500 -> 2442, 99999 -> 85499) y la comision aparte; en lingos sin comision; revertir la limpia');

    // Una venta registrada antes de la migracion (precio bruto, sin comision) pasa a neto
    // al ejecutarla, una sola vez aunque se ejecute de nuevo.
    const vieja = await negocio.vender(idCompra, { cantidad: 1 });
    await clienteA.pg.query('update compras set precio_venta = 350, comision_venta = null where id = $1', [vieja.venta.id]);
    assert.equal((await leerLote(vieja.venta.id)).ganancia_cr, 50);
    const sqlVentaNeta = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260930000000_venta_neta_mercadillo.sql'), 'utf8');
    await clienteA.pg.exec(sqlVentaNeta);
    await clienteA.pg.exec(sqlVentaNeta);
    // Las migraciones posteriores recrean vistas y funciones: se vuelven a aplicar encima.
    const dirMig = path.join(__dirname, '..', 'supabase', 'migrations');
    for (const m of fs.readdirSync(dirMig).filter((x) => x.endsWith('.sql') && x > '20260930000000_venta_neta_mercadillo.sql').sort()) {
      await clienteA.pg.exec(fs.readFileSync(path.join(dirMig, m), 'utf8'));
    }
    const corregida = await leerLote(vieja.venta.id);
    assert.equal(corregida.precio_venta_real, 342);
    assert.equal(corregida.comision_venta, 8);
    assert.equal(corregida.ganancia_cr, 42);
    const excelVendido = (await negocio.listarCompras()).find((c) => c.estado === 'vendido' && c.precio_lista === null);
    assert.equal(excelVendido.comision_venta, null, 'lo vendido desde un lote comprado no se toca');
    await negocio.revertirVenta(vieja.venta.id);
    assert.equal((await leerLote(idCompra)).cantidad, 3);
    ok('ventas antiguas desde Publicado: la migracion las pasa a neto (350 -> 342) una sola vez; las de lotes comprados no se tocan');
    await rechaza(negocio.actualizarCompra(idCompra, { cantidad: 9 }), /publicado en el mercadillo/);
    await rechaza(negocio.eliminarCompra(idCompra), /publicado en el mercadillo/);
    const res = await negocio.resumen();
    assert.equal(res.publicado.unidades, 8);
    assert.ok(res.en_venta.unidades >= 8);
    assert.equal(res.datos.furnis_publicados, 1);
    ok('lote publicado: no se edita ni se borra a mano y cuenta en el Resumen');

    // ── Furni que llega solo con sprite_id y ya existia sin sprite_id: se unen ──
    await negocio.crearCompra({ nombre: 'Árbol Sakura', cantidad: 2, precio_compra: 170 });
    aviso = esperarEvento(puerto, 'eventos-sniper');
    await new Promise((res2) => setTimeout(res2, 150));
    r = await sniper([{ tipo_evento: 'compra', id_externo: 'cmp_4', sprite_id: sakura.sprite_id, cantidad: 1, precio: 150, moneda: 'creditos', hotel: 'es' }]);
    assert.equal(r.data.procesados, 1);
    ev = await aviso;
    const furnis = await negocio.listarFurnis();
    const sak = furnis.filter((f) => f.nombre === 'Árbol Sakura');
    assert.equal(sak.length, 1);
    assert.equal(sak[0].stock, 3);
    assert.equal(sak[0].sprite_id, sakura.sprite_id);
    assert.equal(furnis.some((f) => /^Sprite \d+/.test(f.nombre)), false);
    ok('furni que llega solo con sprite_id: se une al que ya tenias (sin duplicados ni nombres provisionales)');
    await rechaza(negocio.activarPendientes({ furni_id: sak[0].id }), /Ponle un precio de venta/);
    const act = await negocio.activarPendientes({ furni_id: sak[0].id, precio_venta: 180 });
    assert.equal(act.activados, 1);
    ok('activar un huerfano exige precio; con precio pasa a "En venta"');

    // ── Publicar y retirar a mano (lo que ya estaba en el mercadillo, p. ej. del Excel) ──
    const lotesSak = (await negocio.listarCompras()).filter((c) => c.furni_id === sak[0].id && c.estado === 'comprado');
    const loteA = lotesSak.find((c) => c.fuente === 'manual');   // 2 und a 170
    const loteB = lotesSak.find((c) => c.fuente === 'sniper');   // 1 und a 150
    const pm = await negocio.publicarLote(loteA.id, { cantidad: 1, precio_lista: 200 });
    assert.equal(pm.dividida, true);
    assert.equal(pm.original.cantidad, 1);
    assert.equal(pm.publicado.estado, 'publicado');
    assert.equal(pm.publicado.publicado_por, 'manual');
    assert.equal(pm.publicado.precio_lista, 200);
    assert.equal(pm.publicado.moneda_lista, 'creditos');
    assert.equal(pm.publicado.origen_id, loteA.id);
    assert.equal(pm.publicado.ganancia_cr, comision.calcularGananciaNeta(200, 170));
    let rt = await negocio.retirarLote(pm.publicado.id);
    assert.equal(rt.fusionada, true);
    assert.equal((await leerLote(loteA.id)).cantidad, 2, 'retirar devuelve las unidades a su lote');
    const hp = await pedir(puerto, 'POST', `/api/compras/${loteA.id}/publicar`, { cuerpo: {} });
    assert.equal(hp.status, 200);
    assert.equal(hp.json.dividida, false);
    assert.equal(hp.json.publicado.id, loteA.id);
    assert.equal(hp.json.publicado.precio_lista, 180, 'sin precio de lista se usa el del furni');
    await rechaza(negocio.actualizarCompra(loteA.id, { cantidad: 9 }), /Retíralo primero/);
    await rechaza(negocio.eliminarCompra(loteA.id), /Retíralo primero/);
    await rechaza(negocio.publicarLote(loteA.id, { precio_lista: 10 }), /Solo se publica un lote comprado/);
    await rechaza(negocio.publicarLote(loteB.id, { cantidad: 5, precio_lista: 10 }), /Solo hay 1 unidad/);
    await rechaza(negocio.retirarLote(p1.id), /lo publico el Sniper/);
    ok('publicar a mano: una parte (el lote se divide) o todo (al precio del furni); retirar lo devuelve; lo del Sniper no se retira desde la app');

    r = await sniper([{ tipo_evento: 'publicar', id_externo: 'pub_sak', sprite_id: sakura.sprite_id, cantidad: 1, precio_lista: 190, moneda: 'creditos', hotel: 'es' }]);
    assert.equal(r.data.procesados, 1);
    assert.equal((await leerLote(loteB.id)).publicado_por, 'sniper');
    r = await sniper([{ tipo_evento: 'recuperar', id_externo: 'rec_sak', sprite_id: sakura.sprite_id, cantidad: 1, hotel: 'es' }]);
    assert.equal(r.data.eventos[0].lotes[0].desde_lote, loteB.id, 'el Sniper recupera primero lo que publico el, aunque lo manual sea mas antiguo');
    assert.equal((await leerLote(loteA.id)).estado, 'publicado');
    const devueltoB = await leerLote(loteB.id);
    assert.equal(devueltoB.estado, 'comprado');
    assert.equal(devueltoB.publicado_por, null);
    const vm = await negocio.vender(loteA.id, { cantidad: 1 });
    assert.equal(vm.venta.precio_venta_real, 180 - comision.calcularComision(180), 'lo publicado a mano tambien se vende neto');
    assert.equal(vm.venta.publicado_por, 'manual');
    assert.equal((await negocio.revertirVenta(vm.venta.id)).compra.publicado_por, 'manual');
    rt = await negocio.retirarLote(loteA.id);
    assert.equal(rt.fusionada, false);
    assert.equal(rt.compra.estado, 'comprado');
    assert.equal(rt.compra.pendiente, false);
    assert.equal(rt.compra.precio_lista, null);
    ok('el Sniper recupera primero lo suyo; lo publicado a mano se vende neto, revertir lo deja publicado y retirar lo vuelve a Comprado');

    // ── Publicar el furni completo: todas sus unidades en mano, de todos sus lotes (FIFO) ──
    r = await sniper([{ tipo_evento: 'compra', id_externo: 'cmp_sak2', sprite_id: sakura.sprite_id, cantidad: 1, precio: 140, moneda: 'creditos', hotel: 'es' }]);
    assert.equal(r.data.procesados, 1);
    const lotesDeSak = async (estado) => (await negocio.listarCompras()).filter((c) => c.furni_id === sak[0].id && c.estado === estado);
    const pf = await negocio.publicarFurni(sak[0].id, { precio_lista: 210 });
    assert.equal(pf.cantidad, 3, 'las 3 und en mano; la "por revisar" del Sniper no entra');
    assert.equal(pf.en_mano, 0);
    assert.deepEqual(pf.lotes.map((x) => [x.lote_id, x.cantidad, x.dividido]), [[loteA.id, 2, false], [loteB.id, 1, false]]);
    assert.deepEqual((await lotesDeSak('comprado')).map((c) => c.pendiente), [true], 'en Comprado solo queda lo por revisar');
    const pubSak = await lotesDeSak('publicado');
    assert.ok(pubSak.every((c) => c.publicado_por === 'manual'));
    const rp = comision.resumenPublicado(pubSak);
    assert.equal(rp.unidades, 3);
    assert.equal(rp.manual, 3);
    assert.equal(rp.listaMin, 210);
    assert.equal(rp.ganancia, pubSak.reduce((s, c) => s + c.ganancia_cr, 0), 'el resumen del Mercadillo coincide con la vista de la base');
    assert.equal(rp.ganancia, comision.calcularGananciaNeta(210, 170) * 2 + comision.calcularGananciaNeta(210, 150));
    for (const c of pubSak) await negocio.retirarLote(c.id);
    const pf2 = await negocio.publicarFurni(sak[0].id, { cantidad: 1, precio_lista: 210 });
    assert.equal(pf2.en_mano, 2);
    assert.equal(pf2.lotes[0].origen_id, loteA.id, 'publicar menos divide el lote mas antiguo');
    assert.equal((await leerLote(loteA.id)).cantidad, 1);
    await negocio.retirarLote(pf2.lotes[0].lote_id);
    assert.equal((await leerLote(loteA.id)).cantidad, 2);
    await rechaza(negocio.publicarFurni(sak[0].id, { cantidad: 9, precio_lista: 5 }), /Solo tienes 3 unidad/);
    const hf = await pedir(puerto, 'POST', `/api/furnis/${sak[0].id}/publicar`, { cuerpo: { precio_lista: 205 } });
    assert.equal(hf.status, 200);
    assert.equal(hf.json.cantidad, 3);
    for (const c of await lotesDeSak('publicado')) await negocio.retirarLote(c.id);
    await negocio.activarPendientes({ furni_id: sak[0].id });
    assert.equal((await lotesDeSak('comprado')).reduce((s, c) => s + c.cantidad, 0), 4);
    ok('publicar el furni completo: toma sus unidades en mano de todos sus lotes (FIFO) y sale de Comprado; lo "por revisar" no entra; publicar menos divide el lote');

    // ── Desde el Mercadillo: vender y retirar lo publicado de un furni (FIFO, por precio de lista) ──
    const repartoLotes = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'core', 'lotes.js')).href);
    const loteC = (await negocio.listarCompras()).find((c) => c.id_externo === 'cmp_sak2');
    await negocio.publicarFurni(sak[0].id, { cantidad: 3, precio_lista: 210 });   // lotes A (2) y B (1)
    await negocio.publicarFurni(sak[0].id, { cantidad: 1, precio_lista: 250 });   // lote C
    const gruposSak = repartoLotes.gruposPorPrecioLista(await lotesDeSak('publicado'));
    assert.deepEqual(gruposSak.map((g) => [g.precio_lista, g.unidades]), [[210, 3], [250, 1]]);
    const previsto = repartoLotes.repartirFifo(gruposSak[0].lotes, 2).map((t) => [t.lote.id, t.toma]);
    assert.deepEqual(previsto, [[loteA.id, 2]]);
    const vf = await negocio.venderFurni(sak[0].id, { cantidad: 2, precio_lista: 210 });
    assert.deepEqual(vf.ventas.map((v) => [v.lote_id, v.cantidad]), previsto, 'la base toma los mismos lotes que muestra el modal');
    assert.equal(vf.ventas[0].precio_venta, 210 - comision.calcularComision(210), 'se guarda el neto');
    await rechaza(negocio.venderFurni(sak[0].id, { cantidad: 2, precio_lista: 210 }), /Solo hay 1 unidad/);
    const vf2 = await negocio.venderFurni(sak[0].id, { cantidad: 1, precio_venta: 230 });
    assert.equal(vf2.ventas[0].lote_id, loteB.id, 'sin precio de lista: FIFO sobre todo lo publicado');
    assert.equal(vf2.ventas[0].precio_venta, 230 - comision.calcularComision(230));
    const hv = await pedir(puerto, 'POST', `/api/furnis/${sak[0].id}/vender`, { cuerpo: { cantidad: 1, precio_lista: 250 } });
    assert.equal(hv.status, 200);
    assert.equal(hv.json.ventas[0].lote_id, loteC.id);
    for (const v of [...vf.ventas, ...vf2.ventas, ...hv.json.ventas]) await negocio.revertirVenta(v.venta_id);
    assert.equal((await lotesDeSak('publicado')).reduce((s, c) => s + c.cantidad, 0), 4);
    ok('Vendido desde el Mercadillo: elige el precio de lista y vende FIFO (los mismos lotes que muestra el modal), guardando el neto');

    let rf = await negocio.retirarFurni(sak[0].id, { cantidad: 1, precio_lista: 210 });
    assert.deepEqual(rf.lotes.map((x) => [x.desde_lote, x.cantidad]), [[loteA.id, 1]]);
    assert.equal((await leerLote(loteA.id)).cantidad, 1, 'retirar una parte divide el lote');
    assert.equal((await leerLote(rf.lotes[0].hacia_lote)).estado, 'comprado');
    rf = await negocio.retirarFurni(sak[0].id, {});
    assert.equal(rf.cantidad, 3);
    assert.equal((await lotesDeSak('publicado')).length, 0);
    assert.equal((await lotesDeSak('comprado')).reduce((s, c) => s + c.cantidad, 0), 4);
    const hr = await pedir(puerto, 'POST', `/api/furnis/${fv.id}/retirar`, { cuerpo: {} });
    assert.equal(hr.status, 400);
    assert.match(hr.json.error, /publicó el Sniper/);
    ok('Retirar desde el Mercadillo: solo lo publicado por ti, FIFO y por precio de lista; una parte divide el lote; lo del Sniper no');

    const est = await anon.rpc('estado_sniper', { p_token: tk.token });
    assert.equal(est.data.ok, true);
    assert.equal(est.data.pendientes, 0);
    await negocio.revocarToken(tk.id);
    r = await sniper([compraVelo('cmp_9', 1, 1)]);
    assert.equal(r.error.code, 'PT401');
    ok('estado_sniper responde; un token revocado deja de funcionar al instante');

    // ── Aislamiento entre usuarios + Excel real ──
    const clienteB = clienteA.comoAnon();
    await clienteB.auth.signInWithPassword({ email: 'beto@prueba.local', password: 'clave-beto' });
    const conexB = crearServicioConexion({ eventos: new EventEmitter(), clienteFijo: clienteB });
    await conexB.iniciar();
    const negB = crearServicioNegocio({ conexion: conexB, furnidata });
    assert.equal((await negB.listarFurnis()).length, 0);
    ok('RLS: el segundo usuario no ve nada del primero');
    const excel = buscarExcel();
    let netas = [];
    let comisionExcel = 0;
    if (excel) {
      const datosExcel = await leerExcel(excel);
      const inf = await importarDatos(negB, furnidata, datosExcel, {});
      const e = (k) => datosExcel.resumenExcel[normalizar(k)];
      assert.equal(inf.furnis, 30);
      assert.equal(inf.compras, 42);
      assert.equal(inf.resumen.en_venta.unidades, e('Unidades en venta'));
      assert.equal(inf.resumen.en_venta.costo_cr, e('Invertido'));
      // El Excel no descontaba la comision: se compara con las cifras sin ella.
      const sc = inf.resumen.sin_comision;
      assert.equal(sc.retorno_cr, e('Venta esperada'));
      assert.equal(sc.ganancia_cr, e('Ganancia esperada'));
      assert.equal(sc.perdidas.length, e('Furnis que dejan pérdida al precio actual'));
      assert.deepEqual([...sc.perdidas].sort(), ['Cara con Cicatrices', 'Dragón Velo de Arena']);
      assert.ok(Math.abs(sc.mayor_ganancia_cr - e('Mayor ganancia esperada (Créditos)')) < 0.5);
      assert.ok(Math.abs(inf.resumen.en_venta.ganancia_cr - (sc.ganancia_cr - inf.resumen.en_venta.comision_cr)) < 1e-6);
      netas = inf.resumen.datos.perdidas.map((p) => p.nombre);
      assert.ok(sc.perdidas.every((n) => netas.includes(n)), 'lo que perdia sin comision sigue perdiendo con ella');
      const lotesB = await negB.listarCompras();
      for (const fb of await negB.listarFurnis()) {
        const js = comision.gananciaEsperadaFurni(fb, lotesB.filter((l) => l.furni_id === fb.id));
        assert.ok(js === fb.ganancia_esperada_cr || Math.abs(js - fb.ganancia_esperada_cr) < 1e-6, `columna Ganancia esp. de ${fb.nombre}: ${js} vs ${fb.ganancia_esperada_cr}`);
      }
      comisionExcel = inf.resumen.en_venta.comision_cr;
      await rechaza(importarDatos(negB, furnidata, datosExcel, {}), /ya tiene furnis/);
      assert.equal((await negocio.listarFurnis()).some((x) => x.nombre === 'Árbol de Créditos (Vale 500 créditos)'), false);
      ok(`Excel real importado en UNA transaccion: 30 furnis, 42 lotes, totales y perdidas iguales al Excel (sin comision); con comision: ${Math.round(comisionExcel)} cr, ${netas.length} furnis con perdida`);
      ok('columna "Ganancia esp." (JS, lote por lote) = vista de la base en los 30 furnis del Excel');
    } else {
      console.log('  --  no hay Excel en la raiz: se omite la prueba de importacion');
    }

    // ── Base de produccion a la que le falta 20260930000000 (caso real): la migracion
    //    20261001000000 se aplica sola, completa lo que faltaba y pasa a neto la venta vieja ──
    const posteriores = fs.readdirSync(path.join(__dirname, '..', 'supabase', 'migrations')).filter((x) => x >= '20260930000000');
    const sinVentaNeta = await crearClienteLocal({ omitir: posteriores });
    const pgS = sinVentaNeta.pg;
    const uidS = await sinVentaNeta.crearUsuario('sin-venta-neta@prueba.local', 'clave');
    const furniS = (await pgS.query("insert into public.furnis (propietario, nombre, precio_venta) values ($1, 'Furni de prueba', 400) returning id", [uidS])).rows[0].id;
    const loteS = (await pgS.query(
      "insert into public.compras (propietario, furni_id, cantidad, precio_compra, estado, precio_lista, moneda_lista, publicado_en) values ($1, $2, 2, 300, 'publicado', 350, 'creditos', now()) returning id",
      [uidS, furniS])).rows[0].id;
    const ventaS = (await pgS.query('select public.vender_lote($1, 1) as r', [loteS])).rows[0].r;
    assert.equal((await pgS.query('select precio_venta from public.compras where id = $1', [ventaS.venta_id])).rows[0].precio_venta, 350, 'antes: se guardaba el bruto');
    const sqlPublicacion = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261001000000_publicacion_manual.sql'), 'utf8');
    await pgS.exec(sqlPublicacion);
    await pgS.exec(sqlPublicacion);
    const filaS = (await pgS.query('select precio_venta_real, comision_venta, comision_pagada_cr, publicado_por, ganancia_cr from public.v_compras where id = $1', [ventaS.venta_id])).rows[0];
    assert.deepEqual(filaS, { precio_venta_real: 342, comision_venta: 8, comision_pagada_cr: 8, publicado_por: 'sniper', ganancia_cr: 42 });
    assert.equal((await pgS.query('select publicado_por from public.compras where id = $1', [loteS])).rows[0].publicado_por, 'sniper');
    const revS = (await pgS.query('select public.revertir_venta($1) as r', [ventaS.venta_id])).rows[0].r;
    assert.equal(revS.fusionada, true);
    const nuevaS = (await pgS.query('select public.vender_lote($1, 1) as r', [loteS])).rows[0].r;
    assert.equal(nuevaS.precio_venta, 342, 'despues: se guarda el neto');
    assert.ok((await pgS.query("select to_regprocedure('public.publicar_lote(bigint, integer, numeric)') as f")).rows[0].f);
    await sinVentaNeta.cerrar();
    ok('migracion 20261001000000 en una base SIN la 20260930000000: se aplica (dos veces), completa comision_venta y pasa a neto la venta vieja (350 -> 342)');

    // ── API local ──
    let h = await pedir(puerto, 'GET', '/api/cuenta');
    assert.equal(h.json.estado, 'lista');
    h = await pedir(puerto, 'GET', '/api/furnidata/buscar?q=' + encodeURIComponent('dragon velo'));
    assert.equal(h.json[0].nombre, 'Dragón Velo de Arena');
    h = await pedir(puerto, 'POST', '/api/furnis', { cuerpo: { nombre: 'Furni Inventado XYZ' } });
    assert.equal(h.status, 422);
    h = await pedir(puerto, 'GET', '/api/pendientes');
    assert.equal(h.json.length, (await negocio.pendientesPorFurni()).length);
    ok('API local: cuenta, buscador, validacion y pendientes');
    h = await pedir(puerto, 'POST', `/api/compras/${lote.id}/revertir`, { crudo: 'x=1', tipo: 'application/x-www-form-urlencoded' });
    assert.equal(h.status, 415);
    h = await pedir(puerto, 'GET', '/api/resumen', { origin: 'https://sitio-malicioso.com' });
    assert.equal(h.status, 403);
    h = await pedir(puerto, 'GET', '/api/resumen', { host: 'atacante.com' });
    assert.equal(h.status, 403);
    h = await pedir(puerto, 'GET', '/api/resumen', { origin: `http://127.0.0.1:${puerto}` });
    assert.equal(h.status, 200);
    ok('API local blindada: formularios 415, otro sitio 403, DNS rebinding 403; la app entra');
    h = await pedir(puerto, 'POST', '/api/sniper/tokens', { cuerpo: { nombre: 'VPS Contabo 2' } });
    assert.equal(h.status, 201);
    assert.match(h.json.token, /^hbi_/);
    ok('crear token desde la API de la app');

    const sinSesion = await crearApp({ dirDatos: dir, clienteFijo: clienteA.comoAnon(), iniciarCatalogo: false, log: () => {} });
    const s2 = http.createServer(sinSesion.app).listen(0, '127.0.0.1');
    await new Promise((res2) => s2.once('listening', res2));
    h = await pedir(s2.address().port, 'GET', '/api/resumen');
    assert.equal(h.status, 401);
    assert.equal(h.json.codigo, 'SIN_SESION');
    s2.close();
    ok('sin sesion, la API de datos responde 401 SIN_SESION (la app muestra el acceso)');

    h = await pedir(puerto, 'GET', '/api/icono/clothing_r26_scarface');
    if (h.status === 200) ok(`icono PNG servido desde cache (${h.bytes} bytes)`);
    else console.log('  --  icono no descargado (¿sin internet?), se omite');
  } finally {
    server.close();
    await cerrar();
  }

  console.log(`\n${pasos} verificaciones correctas.\n`);
}

main().catch((e) => { console.error('\nFALLO: ' + (e && e.stack || e)); process.exitCode = 1; });
