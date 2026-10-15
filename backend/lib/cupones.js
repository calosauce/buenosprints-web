// Cupones de FIDELIDAD: uno único por pedido entregado, de un solo uso,
// válido hasta el mismo día del mes siguiente a la entrega (inclusive).
//
// Los cupones generales (BIENVENIDA10, etc.) siguen viviendo en CONFIG.CUPONES
// del front-end. Estos, en cambio, se validan aquí porque son personales y
// vencen: el front-end pregunta a GET /api/cupones/:codigo, y al crear el
// pedido el servidor lo vuelve a validar y lo marca como usado.
//
// Las fechas se guardan como texto "AAAA-MM-DD" en hora de Santo Domingo
// (UTC-4 todo el año, sin horario de verano) para no depender de la zona
// horaria del servidor MySQL ni del driver.

const crypto = require("crypto");
const { pool, asegurarTablas } = require("./db");

const PORCENTAJE = 10;
const PREFIJO = "VUELVE-";
// Sin 0/O ni 1/I/L para que no se confundan al escribirlo.
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

let tablaLista = null;
function asegurarTablaCupones() {
  if (!tablaLista) {
    tablaLista = (async () => {
      await asegurarTablas();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS cupones (
          codigo VARCHAR(32) PRIMARY KEY,
          porcentaje INT NOT NULL,
          pedido_origen VARCHAR(32) NOT NULL UNIQUE,
          expira VARCHAR(10) NOT NULL,
          creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          usado_en DATETIME NULL,
          usado_pedido VARCHAR(32) NULL,
          recordatorio_en DATETIME NULL
        ) ENGINE=InnoDB;
      `);
      // Por si la tabla ya existía sin la columna del recordatorio.
      try {
        await pool.query("ALTER TABLE cupones ADD COLUMN recordatorio_en DATETIME NULL");
      } catch (err) {
        if (err.code !== "ER_DUP_FIELDNAME") throw err;
      }
    })().catch((err) => { tablaLista = null; throw err; });
  }
  return tablaLista;
}

function hoyRD() {
  return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);
}

// Mismo día del mes siguiente; si ese día no existe (31 → noviembre), el
// último día de ese mes.
function unMesDespues(fechaISO) {
  const [a, m, d] = fechaISO.split("-").map(Number);
  const anio = m === 12 ? a + 1 : a;
  const mes = m === 12 ? 1 : m + 1;
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const dia = Math.min(d, ultimoDia);
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function generarCodigo() {
  const bytes = crypto.randomBytes(5);
  let s = "";
  for (const b of bytes) s += ALFABETO[b % ALFABETO.length];
  return PREFIJO + s;
}

function normalizar(codigo) {
  return String(codigo || "").trim().toUpperCase();
}

function esCuponDeFidelidad(codigo) {
  return normalizar(codigo).startsWith(PREFIJO);
}

// Devuelve el cupón del pedido; si no existe, lo crea. Idempotente: si el
// taller marca "Entregado" dos veces, el cliente recibe el MISMO código.
async function cuponParaPedido(numeroPedido, fechaEntregaISO = hoyRD()) {
  await asegurarTablaCupones();
  const [existentes] = await pool.query("SELECT * FROM cupones WHERE pedido_origen = ?", [numeroPedido]);
  if (existentes[0]) return existentes[0];

  const expira = unMesDespues(fechaEntregaISO);
  for (let intento = 0; intento < 5; intento++) {
    const codigo = generarCodigo();
    try {
      await pool.query(
        "INSERT INTO cupones (codigo, porcentaje, pedido_origen, expira) VALUES (?, ?, ?, ?)",
        [codigo, PORCENTAJE, numeroPedido, expira]
      );
      const [filas] = await pool.query("SELECT * FROM cupones WHERE codigo = ?", [codigo]);
      return filas[0];
    } catch (err) {
      if (err.code !== "ER_DUP_ENTRY") throw err;
      // Choque de código (muy raro) → otro intento. Si el choque fue por
      // pedido_origen (dos llamadas a la vez), devolvemos el que ganó.
      const [ya] = await pool.query("SELECT * FROM cupones WHERE pedido_origen = ?", [numeroPedido]);
      if (ya[0]) return ya[0];
    }
  }
  throw new Error("No se pudo generar un código de cupón único.");
}

// Estado público de un código (para el carrito). Nunca dice de qué pedido es.
async function consultarCupon(codigo) {
  await asegurarTablaCupones();
  const [filas] = await pool.query("SELECT * FROM cupones WHERE codigo = ?", [normalizar(codigo)]);
  const c = filas[0];
  if (!c) return { valido: false, motivo: "no_existe" };
  if (c.usado_en) return { valido: false, motivo: "usado" };
  if (hoyRD() > c.expira) return { valido: false, motivo: "vencido", expira: c.expira };
  return { valido: true, porcentaje: c.porcentaje, expira: c.expira };
}

// Marca el cupón como usado por `numeroPedido`, solo si sigue válido.
// Atómico: si dos pedidos lo intentan a la vez, solo uno lo consigue.
async function usarCupon(codigo, numeroPedido) {
  await asegurarTablaCupones();
  const [r] = await pool.query(
    "UPDATE cupones SET usado_en = NOW(), usado_pedido = ? WHERE codigo = ? AND usado_en IS NULL AND expira >= ?",
    [numeroPedido, normalizar(codigo), hoyRD()]
  );
  return r.affectedRows === 1;
}

// "AAAA-MM-DD" + n días.
function sumarDias(fechaISO, n) {
  const [a, m, d] = fechaISO.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

// Cupones sin usar que vencen dentro de `dias` días (incluye hoy) y que
// todavía no recibieron recordatorio, junto con los datos del pedido.
async function cuponesPorRecordar(dias = 5) {
  await asegurarTablaCupones();
  const hoy = hoyRD();
  const [filas] = await pool.query(
    `SELECT c.codigo, c.porcentaje, c.expira, p.*
       FROM cupones c JOIN pedidos p ON p.numero = c.pedido_origen
      WHERE c.usado_en IS NULL AND c.recordatorio_en IS NULL
        AND c.expira >= ? AND c.expira <= ?
        AND p.cliente_email IS NOT NULL AND p.cliente_email <> ''`,
    [hoy, sumarDias(hoy, dias)]
  );
  return filas.map((f) => ({
    cupon: { codigo: f.codigo, porcentaje: f.porcentaje, expira: f.expira },
    pedido: f,
  }));
}

// "Reserva" el recordatorio antes de enviarlo (atómico): si dos procesos
// corren a la vez, solo uno lo envía. Si el envío falla, se libera para
// reintentar en la próxima revisión.
async function reservarRecordatorio(codigo) {
  const [r] = await pool.query("UPDATE cupones SET recordatorio_en = NOW() WHERE codigo = ? AND recordatorio_en IS NULL", [codigo]);
  return r.affectedRows === 1;
}
async function liberarRecordatorio(codigo) {
  await pool.query("UPDATE cupones SET recordatorio_en = NULL WHERE codigo = ?", [codigo]);
}

function diasEntre(desdeISO, hastaISO) {
  const f = (iso) => { const [a, m, d] = iso.split("-").map(Number); return Date.UTC(a, m - 1, d); };
  return Math.round((f(hastaISO) - f(desdeISO)) / 86400000);
}

module.exports = {
  cuponesPorRecordar,
  reservarRecordatorio,
  liberarRecordatorio,
  diasEntre,
  sumarDias,
  PORCENTAJE,
  cuponParaPedido,
  consultarCupon,
  usarCupon,
  esCuponDeFidelidad,
  unMesDespues,
  hoyRD,
};
