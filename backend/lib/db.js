// Persistencia de pedidos + numeración interna secuencial.
// Usa SQLite local en el servidor (archivo en disco). No requiere credenciales
// externas y sobrevive reinicios de la app. Cuando el negocio crezca y se quiera
// mover a MySQL (ya disponible en el hosting), solo hay que reemplazar este
// archivo — el resto del backend solo llama a las funciones de aquí.

const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "pedidos.db");
require("fs").mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS pedidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT UNIQUE NOT NULL,          -- numeración interna, ej. BP-2026-000123
    estado TEXT NOT NULL DEFAULT 'pendiente_pago', -- pendiente_pago | pagado | cancelado
    cliente_nombre TEXT,
    cliente_telefono TEXT,
    cliente_email TEXT,
    detalle_json TEXT NOT NULL,           -- snapshot completo del carrito/orden
    subtotal INTEGER NOT NULL,            -- en centavos de RD$
    total INTEGER NOT NULL,
    ecf_numero TEXT,                      -- se llena solo cuando DGII apruebe el negocio
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    pagado_en TEXT
  );

  CREATE TABLE IF NOT EXISTS contadores (
    clave TEXT PRIMARY KEY,
    valor INTEGER NOT NULL
  );
`);

function siguienteNumero() {
  const year = new Date().getFullYear();
  const clave = `pedido-${year}`;
  const tx = db.transaction(() => {
    const row = db.prepare("SELECT valor FROM contadores WHERE clave = ?").get(clave);
    const siguiente = (row ? row.valor : 0) + 1;
    db.prepare(
      "INSERT INTO contadores (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = ?"
    ).run(clave, siguiente, siguiente);
    return siguiente;
  });
  const n = tx();
  return `BP-${year}-${String(n).padStart(6, "0")}`;
}

function crearPedido({ cliente, detalle, subtotal, total }) {
  const numero = siguienteNumero();
  db.prepare(
    `INSERT INTO pedidos (numero, cliente_nombre, cliente_telefono, cliente_email, detalle_json, subtotal, total)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(numero, cliente.nombre || null, cliente.telefono || null, cliente.email || null, JSON.stringify(detalle), subtotal, total);
  return obtenerPedido(numero);
}

function obtenerPedido(numero) {
  return db.prepare("SELECT * FROM pedidos WHERE numero = ?").get(numero);
}

function marcarPagado(numero) {
  db.prepare("UPDATE pedidos SET estado = 'pagado', pagado_en = datetime('now') WHERE numero = ?").run(numero);
  return obtenerPedido(numero);
}

module.exports = { crearPedido, obtenerPedido, marcarPagado };
