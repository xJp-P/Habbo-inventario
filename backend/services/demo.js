// backend/services/demo.js — modo demo: la app completa SIN Supabase en la nube.
//
//   npm run demo   -> http://127.0.0.1:3435  (usuario demo@habbo.local / demo1234)
//
// Levanta el Postgres local (PGlite) con el MISMO esquema de supabase/migrations
// (empieza vacio; `npm run demo` importa el unico .xlsx de la raiz, si hay) y permite
// simular eventos de un SniperMercadillo (compra, publicar, recuperar y el envio del
// inventario de su keko para la auditoria) desde Ajustes. Los eventos pasan por
// la funcion SQL real registrar_eventos_sniper, con la clave "anon", un token de sniper
// y SOLO el sprite_id del furni, igual que los envia el bot desde el VPS.
//
// La base demo se guarda en data/demo-db/ (bórrala para empezar de cero).

const fs = require('fs');
const path = require('path');
const { crearClienteLocal } = require('../db/clienteLocal');

const USUARIO = { email: 'demo@habbo.local', password: 'demo1234' };

async function crearDemo({ dirDatos }) {
  const dir = path.join(dirDatos, 'demo-db');
  const cliente = await crearClienteLocal({ dir });
  await cliente.crearUsuario(USUARIO.email, USUARIO.password);
  await cliente.auth.signInWithPassword(USUARIO);
  const anon = cliente.comoAnon();
  const rutaToken = path.join(dirDatos, 'demo-token.txt');
  let token = fs.existsSync(rutaToken) ? fs.readFileSync(rutaToken, 'utf8').trim() : null;
  let negocio = null;
  let furnidata = null;
  let contador = 0;

  // Furnis que "compra" el sniper simulado: algunos ya estan en el Mercadillo (suman
  // stock) y otros son nuevos (aparecen sin precio).
  // Decoracion para la foto simulada: un furni que la app NO tenga registrado sale como
  // «no registrado». Lista propia (los CANDIDATOS los compra el Sniper simulado y con el uso
  // acaban todos registrados).
  const DECORACION = ['val15_sakura', 'plant_big_cactus', 'hc_lmp', 'party_floor', 'plant_pineapple', 'rare_fountain', 'plant_yukka', 'edice', 'exe_plant', 'bed_polyfon'];

  const CANDIDATOS = [
    'seaside_ltd26_sanddragon', 'statue_dragon', 'clothing_r26_spider', 'clothing_r26_glitterwings',
    'spyro', 'dragonlamp_shinobi', 'dng_throne', 'fireworks_13',
  ];

  async function preparar(servicios) {
    negocio = servicios.negocio;
    furnidata = servicios.furnidata;
    const tokens = await negocio.listarTokens();
    if (!token || !tokens.some((t) => token.startsWith(t.prefijo) && !t.revocado)) {
      token = (await negocio.crearToken('VPS demo')).token;
      fs.writeFileSync(rutaToken, token);
    }
  }

  const azar = (lista) => lista[Math.floor(Math.random() * lista.length)];

  // Arma un evento con lo que mandaria el bot: tipo, id unico, sprite_id y hotel.
  async function armarEvento(tipo) {
    contador++;
    const id = `${tipo === 'compra' ? 'cmp' : tipo === 'publicar' ? 'pub' : 'rec'}_${Date.now()}_${contador}`;
    if (tipo === 'compra') {
      const f = azar(CANDIDATOS.map((c) => furnidata.porClase(c)).filter(Boolean));
      if (!f) throw new Error('El catalogo de Habbo.es no esta disponible para simular.');
      return {
        tipo_evento: 'compra', id_externo: id, sprite_id: f.sprite_id, tipo: f.tipo,
        cantidad: 1 + Math.floor(Math.random() * 3), precio: azar([2, 5, 45, 90, 120, 300]),
        moneda: 'creditos', hotel: 'es', notas: Math.random() < 0.3 ? 'Costo extra: 10 diamantes' : undefined,
      };
    }
    const furnis = (await negocio.listarFurnis()).filter((f) => f.sprite_id !== null && (tipo === 'publicar'
      ? f.stock - f.unidades_publicadas > 0
      : f.unidades_publicadas > 0));
    if (!furnis.length) throw new Error(tipo === 'publicar' ? 'No hay stock con sprite_id para publicar.' : 'No hay nada publicado para recuperar.');
    const f = azar(furnis);
    if (tipo === 'publicar') {
      const disponible = f.stock - f.unidades_publicadas;
      const base = f.lista_max_cr || Math.ceil((f.costo_promedio_cr || 10) * 1.3);
      return {
        tipo_evento: 'publicar', id_externo: id, sprite_id: f.sprite_id, tipo: f.tipo,
        cantidad: Math.min(disponible, 1 + Math.floor(Math.random() * 2)), precio_lista: Math.round(base), moneda: 'creditos', hotel: 'es',
      };
    }
    return { tipo_evento: 'recuperar', id_externo: id, sprite_id: f.sprite_id, tipo: f.tipo, cantidad: 1, hotel: 'es' };
  }

  // Inventario del keko "KekoDemo" como lo enviaria el bot al iniciar sesion: lo que
  // esta en mano en la app, con diferencias de ejemplo (2 unidades de mas que llegaron
  // por un tradeo, 1 de menos que se vendio a mano) y un furni de decoracion que la
  // app no tiene registrado.
  // La mano de KekoDemo tal como la enviaria el Sniper: lo de ese keko y lo sin keko (lo
  // de los kekos manuales esta en otra cuenta), con dos diferencias y un furni de
  // decoracion. Como el Sniper real (migracion 20261009000000), manda lo que costo cada
  // furni segun su cartera: el promedio de los lotes, y "medio" si tenian precios
  // distintos. Del sobrante de 2 solo conoce el costo de 1, y de la decoracion, el de 5 de
  // 12 (un promedio), para ver las dos reglas del formulario de entrada.
  async function simularInventario() {
    const [furnis, compras] = await Promise.all([negocio.listarFurnis(), negocio.listarCompras()]);
    const porId = new Map(furnis.filter((f) => f.sprite_id !== null).map((f) => [f.id, f]));
    const grupos = new Map();
    for (const c of compras) {
      const f = porId.get(c.furni_id);
      if (c.estado !== 'comprado' || !f || (c.keko && c.keko !== 'KekoDemo')) continue;
      const clave = f.tipo + ':' + f.sprite_id;
      const g = grupos.get(clave) || { sprite_id: f.sprite_id, tipo: f.tipo, cantidad: 0, ltds: [], costo: 0, precios: new Set() };
      g.cantidad += c.cantidad;
      g.costo += Number(c.precio_compra_cr || 0) * c.cantidad;
      g.precios.add(Number(c.precio_compra_cr || 0));
      if (c.numero_ltd) g.ltds.push(c.numero_ltd);
      grupos.set(clave, g);
    }
    const lista = [...grupos.values()].map((g) => ({
      sprite_id: g.sprite_id, tipo: g.tipo, cantidad: g.cantidad, ltds: g.ltds,
      costo_unidad: Math.round((g.costo / g.cantidad) * 100) / 100, unidades_con_costo: g.cantidad, costo_medio: g.precios.size > 1,
    }));
    if (lista[0]) { lista[0].cantidad += 2; lista[0].unidades_con_costo += 1; }
    if (lista[1]) { lista[1].cantidad -= 1; lista[1].unidades_con_costo = Math.max(1, lista[1].unidades_con_costo - 1); }
    const registrados = new Set(furnis.filter((f) => f.sprite_id !== null).map((f) => f.tipo + ':' + f.sprite_id));
    const deco = DECORACION.map((c) => furnidata.porClase(c)).find((f) => f && !registrados.has(f.tipo + ':' + f.sprite_id));
    if (deco) lista.push({ sprite_id: deco.sprite_id, tipo: deco.tipo, cantidad: 12, costo_unidad: 3.4, unidades_con_costo: 5, costo_medio: true });
    const r = await anon.rpc('auditar_inventario', { token_sniper: token, keko: 'KekoDemo', hotel: 'es', inventario: lista.filter((g) => g.cantidad > 0) });
    if (r.error) throw new Error(r.error.message);
    return r.data;
  }

  async function simularEvento(tipo) {
    if (tipo === 'inventario') return simularInventario();
    if (!['compra', 'publicar', 'recuperar'].includes(tipo)) throw new Error('Tipo de evento no valido.');
    const evento = await armarEvento(tipo);
    const r = await anon.rpc('registrar_eventos_sniper', { token_sniper: token, eventos: [evento] });
    if (r.error) throw new Error(r.error.message);
    return r.data;
  }

  return { cliente, preparar, simularEvento, usuario: USUARIO };
}

module.exports = { crearDemo, USUARIO_DEMO: USUARIO };
