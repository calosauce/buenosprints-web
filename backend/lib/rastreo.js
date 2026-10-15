// Rastreo público de pedidos (página buenosprints.com/rastreo).
//
// Los números de pedido son secuenciales (BP-2026-000001, -000002...), así
// que con solo el número cualquiera podría ir probando y ver pedidos ajenos.
// Por eso el rastreo pide además los ÚLTIMOS 4 DÍGITOS del WhatsApp con el
// que se hizo el pedido, y la respuesta NUNCA incluye nombre, teléfono,
// correo, RNC ni dirección — solo el estado y un resumen de los productos.

const BASE_SITIO = process.env.SITIO_URL || "https://buenosprints.com";

// Pasos del rastreo, en orden. "cancelado" no es un paso: se muestra aparte.
const PASOS = [
  { clave: "recibido", titulo: "Recibido", descripcion: "Recibimos tu pedido. Te escribimos por WhatsApp con los datos de pago.", columna: "creado_en" },
  { clave: "produccion", titulo: "En producción", descripcion: "Pago confirmado. Te enviamos la prueba digital y luego imprimimos.", columna: "pagado_en" },
  { clave: "listo", titulo: "Listo", descripcion: "Tu pedido está listo para entrega o retiro.", columna: "listo_en" },
  { clave: "entregado", titulo: "Entregado", descripcion: "¡Pedido entregado! Esperamos que te encante.", columna: "entregado_en" },
];

// Índice (0-3) del paso actual según el estado guardado en la base.
const INDICE_POR_ESTADO = { cotizado: 0, pagado_produccion: 1, listo_entrega: 2, entregado: 3 };

function ultimos4(telefono) {
  return String(telefono || "").replace(/[^\d]/g, "").slice(-4);
}

// true solo si el pedido tiene teléfono y los últimos 4 dígitos coinciden.
function telefonoCoincide(pedido, tel) {
  const esperado = ultimos4(pedido.cliente_telefono);
  const recibido = ultimos4(tel);
  return esperado.length === 4 && recibido.length === 4 && esperado === recibido;
}

function aISO(fecha) {
  if (!fecha) return null;
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Lo único que ve el público de un pedido.
function vistaPublica(pedido) {
  let detalle = {};
  try { detalle = JSON.parse(pedido.detalle_json || "{}"); } catch (_) { detalle = {}; }
  const items = Array.isArray(detalle.items) ? detalle.items : [];
  const cancelado = pedido.estado === "cancelado";
  const indice = INDICE_POR_ESTADO[pedido.estado] ?? 0;

  return {
    numero: pedido.numero,
    estado: pedido.estado,
    cancelado,
    pasoActual: cancelado ? null : indice,
    pasos: PASOS.map((p, i) => ({
      clave: p.clave,
      titulo: p.titulo,
      descripcion: p.descripcion,
      fecha: aISO(pedido[p.columna]),
      completado: !cancelado && i <= indice,
    })),
    canceladoEn: aISO(pedido.cancelado_en),
    items: items.map((it) => ({
      producto: it.producto || "",
      material: it.material || "",
      forma: it.forma || "",
      w: it.w || null,
      h: it.h || null,
      cantidad: it.cantidad || 0,
    })),
    entrega: detalle.entrega?.tipo || "",
    rush: Boolean(detalle.rush),
    total: pedido.total,
  };
}

// Link directo a la página de rastreo con el pedido ya cargado. Se usa en
// los correos que recibe el propio cliente, así que llevar los 4 dígitos en
// el link es aceptable (es su propio correo) y le ahorra escribirlos.
function urlRastreo(pedido) {
  const params = new URLSearchParams({ pedido: pedido.numero });
  const tel = ultimos4(pedido.cliente_telefono);
  if (tel.length === 4) params.set("tel", tel);
  return `${BASE_SITIO}/rastreo?${params.toString()}`;
}

// Limitador muy simple en memoria: máx. N consultas por IP por ventana.
// Suficiente para frenar a alguien probando números/dígitos a lo loco; se
// reinicia con cada despliegue, lo cual está bien para este propósito.
function crearLimitador({ max = 30, ventanaMs = 10 * 60 * 1000 } = {}) {
  const visitas = new Map();
  return function permitido(ip) {
    const ahora = Date.now();
    const v = visitas.get(ip);
    if (!v || ahora - v.inicio > ventanaMs) {
      visitas.set(ip, { inicio: ahora, n: 1 });
      if (visitas.size > 5000) {
        for (const [k, val] of visitas) if (ahora - val.inicio > ventanaMs) visitas.delete(k);
      }
      return true;
    }
    v.n += 1;
    return v.n <= max;
  };
}

module.exports = { PASOS, INDICE_POR_ESTADO, telefonoCoincide, vistaPublica, urlRastreo, crearLimitador, ultimos4 };
