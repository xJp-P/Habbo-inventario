// public/js/core/ui.js — utilidades transversales de interfaz.
//
// Heredado de Proyecto_Cartera (public/js/core/ui.js): la guarda anti doble clic, que
// evita que un doble clic registre dos veces la misma compra o venta (los endpoints de
// escritura NO son idempotentes), y los helpers de texto y fecha.

// Ejecuta `fn` solo si no hay otra operacion en vuelo y libera SIEMPRE la bandera.
// La liberacion va en el .then: los helpers de API resuelven null en vez de rechazar.
export function _submitGuard(sending,setSending,fn){
  if(sending) return;
  setSending(true);
  var p;
  try{ p=fn(); }catch(e){ setSending(false); throw e; }
  if(p&&typeof p.then==='function') p.then(function(){setSending(false);},function(){setSending(false);});
  else setSending(false);
}

export function properCase(s){ return String(s||'').trim().split(/\s+/).map(function(w){return w?w.charAt(0).toUpperCase()+w.slice(1).toLowerCase():w;}).join(' '); }

export function nowStr(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

// Minusculas sin tildes, para filtrar tablas ("dragon" encuentra "Dragón").
export function normalizar(s){ return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim(); }

// URL del icono servido (y cacheado en disco) por el backend.
export function iconoUrl(classname, revision){ return classname ? '/api/icono/'+encodeURIComponent(classname)+(revision?'?r='+revision:'') : null; }
