// ============================================================
// juego.js — INTERFAZ Y FLUJO DE ACTUARIO TYCOON
// Conecta el modelo (modelo.js) con la pantalla (index.html)
// ============================================================

// ---------- Estado de la interfaz ----------
let partida = null;            // la partida en curso (la crea nuevoJuego())
let seleccion = new Set();     // índices de los candidatos elegidos este año
let reaseguroMes = false;      // ¿activó el reaseguro este año?
let casillaPendiente = 0;      // resultado de la ruleta que se está mostrando

// ---------- Utilidades ----------
const $ = (id) => document.getElementById(id);

// Formato de dinero: 1234567 -> $1,234,567
function dinero(n) {
  return (n < 0 ? "-" : "") + "$" + Math.abs(Math.round(n)).toLocaleString("es-MX");
}

function mostrarPantalla(id) {
  document.querySelectorAll(".pantalla").forEach(p => p.classList.add("oculta"));
  $(id).classList.remove("oculta");
  window.scrollTo(0, 0);
}

function avatar(c) {
  if (c.edad >= 65) return c.mujer ? "👵" : "👴";
  return c.mujer ? "👩" : "👨";
}

// ============================================================
// DIBUJO DE GRÁFICAS (directo en <canvas>, sin librerías)
// ============================================================

// Gráfica de línea. valores = lista de números (uno por año).
function dibujarLinea(canvas, valores, referencia) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const m = { izq: 62, der: 14, arr: 14, abajo: 26 };
  ctx.clearRect(0, 0, W, H);

  let min = Math.min(...valores, referencia);
  let max = Math.max(...valores, referencia);
  if (min === max) { min -= 1; max += 1; }
  const margen = (max - min) * 0.1;
  min -= margen; max += margen;

  const x = (i) => m.izq + (i / Math.max(1, valores.length - 1)) * (W - m.izq - m.der);
  const y = (val) => m.arr + (1 - (val - min) / (max - min)) * (H - m.arr - m.abajo);

  // Cuadrícula y etiquetas del eje Y
  ctx.font = "11px Segoe UI, Arial";
  ctx.textAlign = "right";
  ctx.fillStyle = "#8fa2c9";
  ctx.strokeStyle = "rgba(143,162,201,0.15)";
  ctx.lineWidth = 1;
  for (let k = 0; k <= 4; k++) {
    const val = min + ((max - min) * k) / 4;
    ctx.beginPath(); ctx.moveTo(m.izq, y(val)); ctx.lineTo(W - m.der, y(val)); ctx.stroke();
    ctx.fillText((val / 1e6).toFixed(2) + "M", m.izq - 6, y(val) + 4);
  }

  // Línea de referencia (capital inicial)
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = "rgba(246,191,74,0.7)";
  ctx.beginPath(); ctx.moveTo(m.izq, y(referencia)); ctx.lineTo(W - m.der, y(referencia)); ctx.stroke();
  ctx.setLineDash([]);

  // Línea en cero si el capital llega a ser negativo
  if (min < 0 && max > 0) {
    ctx.strokeStyle = "rgba(255,95,109,0.8)";
    ctx.beginPath(); ctx.moveTo(m.izq, y(0)); ctx.lineTo(W - m.der, y(0)); ctx.stroke();
  }

  // Área bajo la curva
  ctx.beginPath();
  valores.forEach((val, i) => (i === 0 ? ctx.moveTo(x(i), y(val)) : ctx.lineTo(x(i), y(val))));
  ctx.lineTo(x(valores.length - 1), H - m.abajo);
  ctx.lineTo(x(0), H - m.abajo);
  ctx.closePath();
  ctx.fillStyle = "rgba(91,141,255,0.14)";
  ctx.fill();

  // La línea
  const ultimo = valores[valores.length - 1];
  ctx.strokeStyle = ultimo >= referencia ? "#31d49a" : "#ff5f6d";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  valores.forEach((val, i) => (i === 0 ? ctx.moveTo(x(i), y(val)) : ctx.lineTo(x(i), y(val))));
  ctx.stroke();

  // Punto final
  ctx.fillStyle = ctx.strokeStyle;
  ctx.beginPath(); ctx.arc(x(valores.length - 1), y(ultimo), 4.5, 0, Math.PI * 2); ctx.fill();

  // Eje X: año inicial y final
  ctx.fillStyle = "#8fa2c9";
  ctx.textAlign = "left";  ctx.fillText("Año 0", m.izq, H - 8);
  ctx.textAlign = "right"; ctx.fillText("Año " + (valores.length - 1), W - m.der, H - 8);
}

// Histograma. barras = [{desde, hasta, frecuencia}, ...]
function dibujarBarras(canvas, barras) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const m = { izq: 36, der: 10, arr: 14, abajo: 38 };
  ctx.clearRect(0, 0, W, H);

  const maxF = Math.max(...barras.map(b => b.frecuencia), 1);
  const ancho = (W - m.izq - m.der) / barras.length;

  ctx.font = "10px Segoe UI, Arial";
  barras.forEach((b, i) => {
    const alto = (b.frecuencia / maxF) * (H - m.arr - m.abajo);
    const px = m.izq + i * ancho;
    const py = H - m.abajo - alto;
    const centro = (b.desde + b.hasta) / 2;
    // Rojo = quiebra, dorado = élite, azul = el resto
    ctx.fillStyle = centro < 0 ? "#ff5f6d"
                  : centro >= META_ELITE * CAPITAL_INICIAL ? "#f6bf4a" : "#5b8dff";
    ctx.fillRect(px + 2, py, ancho - 4, alto);
    ctx.fillStyle = "#e9efff";
    ctx.textAlign = "center";
    if (b.frecuencia > 0) ctx.fillText(b.frecuencia, px + ancho / 2, py - 3);
    // Etiqueta del eje X (solo algunas para que no se encimen)
    if (i % 2 === 0) {
      ctx.fillStyle = "#8fa2c9";
      ctx.fillText((b.desde / 1e6).toFixed(1) + "M", px + ancho / 2, H - m.abajo + 14);
    }
  });
  ctx.fillStyle = "#8fa2c9";
  ctx.textAlign = "center";
  ctx.fillText("Capital final (millones)", W / 2, H - 6);
}

// Dibuja la ruleta girada "rot" radianes. Arriba está la flecha fija.
function dibujarRuleta(canvas, rot) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2, r = W / 2 - 22;
  const seg = (Math.PI * 2) / CASILLAS.length;
  ctx.clearRect(0, 0, W, H);

  CASILLAS.forEach((c, i) => {
    const a0 = -Math.PI / 2 + rot + i * seg;
    const a1 = a0 + seg;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a1);
    ctx.closePath();
    ctx.fillStyle = c.color;
    ctx.fill();
    ctx.strokeStyle = "#0a1020";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Icono de la casilla, orientado hacia afuera
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a0 + seg / 2);
    ctx.translate(r * 0.68, 0);
    ctx.rotate(Math.PI / 2);
    ctx.font = "30px Segoe UI Emoji, Apple Color Emoji, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(c.icono, 0, 0);
    ctx.restore();
  });

  // Aro exterior y centro
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "#f6bf4a"; ctx.lineWidth = 6; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 26, 0, Math.PI * 2);
  ctx.fillStyle = "#121c34"; ctx.fill();
  ctx.strokeStyle = "#f6bf4a"; ctx.lineWidth = 4; ctx.stroke();

  // Flecha fija arriba
  ctx.beginPath();
  ctx.moveTo(cx - 14, 2); ctx.lineTo(cx + 14, 2); ctx.lineTo(cx, 34);
  ctx.closePath();
  ctx.fillStyle = "#ffffff"; ctx.fill();
  ctx.strokeStyle = "#0a1020"; ctx.lineWidth = 2; ctx.stroke();
}

// Anima el giro y se detiene en la casilla idx (el resultado ya fue sorteado)
function animarRuleta(idx, alTerminar) {
  const canvas = $("ruleta-canvas");
  const seg = (Math.PI * 2) / CASILLAS.length;
  const jitter = (Math.random() - 0.5) * seg * 0.6;          // se detiene en un punto cualquiera de la casilla
  const final = Math.PI * 2 * 5 - (idx + 0.5) * seg + jitter; // 5 vueltas y media
  const inicio = performance.now();
  const duracion = 4200;
  function paso(ahora) {
    const t = Math.min(1, (ahora - inicio) / duracion);
    const suave = 1 - Math.pow(1 - t, 3);                      // frena poco a poco
    dibujarRuleta(canvas, final * suave);
    if (t < 1) requestAnimationFrame(paso); else alTerminar();
  }
  requestAnimationFrame(paso);
}

// ============================================================
// PANTALLA DE JUEGO
// ============================================================

function nuevaPartida() {
  partida = nuevoJuego();
  mostrarPantalla("pantalla-juego");
  comenzarAnio();
}

function comenzarAnio() {
  iniciarAnio(partida);       // crea los candidatos del año (modelo.js)
  seleccion.clear();
  reaseguroMes = false;
  $("btn-jugar").disabled = false;
  pintarHUD();
  pintarBanner();
  pintarCandidatos();
  pintarCartera($("lista-cartera"), false);
  pintarResumenSeleccion();
  dibujarLinea($("grafica-capital"), serieCapital(), CAPITAL_INICIAL);
}

function serieCapital() {
  return [CAPITAL_INICIAL].concat(partida.historial.map(r => r.capitalFinal));
}

// ---------- Barra superior ----------
function pintarHUD() {
  $("hud-anio").textContent = Math.min(partida.anio + 1, DURACION_JUEGO);
  $("hud-total").textContent = DURACION_JUEGO;
  $("hud-barra").style.width = (partida.anio / DURACION_JUEGO) * 100 + "%";
  $("hud-capital").textContent = dinero(partida.capital);
  $("hud-polizas").textContent = partida.polizas.filter(p => p.activa).length;
  $("hud-reaseguro").textContent = partida.reaseguroUsado ? "✖ Ya usado" : "🛟 Disponible";

  const delta = $("hud-delta");
  const ultimo = partida.historial[partida.historial.length - 1];
  if (ultimo) {
    const d = ultimo.capitalFinal - ultimo.capitalInicial;
    delta.textContent = (d >= 0 ? "▲ +" : "▼ ") + dinero(d) + " el año pasado";
    delta.className = "hud-delta " + (d >= 0 ? "sube" : "baja");
  } else {
    delta.textContent = "";
    delta.className = "hud-delta";
  }

  const btn = $("btn-reaseguro");
  btn.disabled = partida.reaseguroUsado;
  btn.classList.remove("activo");
  btn.textContent = partida.reaseguroUsado ? "🛟 Reaseguro ya usado" : "🛟 Usar reaseguro este año";
}

// ---------- Banner con los efectos de la ruleta que siguen vigentes ----------
function pintarBanner() {
  const b = $("banner-evento");
  const efectos = partida.efectos;
  if (!efectos || efectos.length === 0) { b.classList.add("oculta"); return; }
  const todosBuenos = efectos.every(e => e.casilla.bueno);
  b.className = "banner-evento" + (todosBuenos ? " bueno" : "");
  b.innerHTML = '<div class="efectos-lista">' + efectos.map(e =>
    `<div class="efecto"><span class="icono">${e.casilla.icono}</span>
      <div><b>${e.casilla.nombre} sigue vigente</b>
      <small>${e.casilla.texto} (queda${e.aniosRestantes === 1 ? "" : "n"} ${e.aniosRestantes} año${e.aniosRestantes === 1 ? "" : "s"})</small></div></div>`
  ).join("") + "</div>";
}

// ---------- Tarjetas de candidatos ----------
function htmlTarjeta(c, i) {
  const et = [];
  if (c.fuma) et.push('<span class="etiqueta riesgo">🚬 Fumador</span>');
  if (c.enfermo) et.push('<span class="etiqueta riesgo">🩺 Enfermedad previa</span>');
  if (c.riesgoso) et.push('<span class="etiqueta riesgo">⚠️ Profesión de riesgo</span>');
  if (c.edad >= 65) et.push('<span class="etiqueta riesgo">⏳ Edad avanzada</span>');
  if (!et.length) et.push('<span class="etiqueta ok">✅ Sin factores de riesgo</span>');

  // Lo que el jugador SÍ puede calcular: usa lo que el cliente declaró
  const probMuerte = probMuerteEnPlazo(c.edad, c.aniosRestantes, c.factorDeclarado);
  const primaPor100k = (c.primaOfrecida / c.sumaAsegurada) * 100000;
  const costoEsperado = c.sumaAsegurada * probMuerte;          // S × P(morir en el plazo)
  const primasTotales = c.primaOfrecida * c.aniosRestantes;    // lo que pagaría en todo el contrato

  return `<div class="tarjeta" data-i="${i}">
    <div class="check">✓</div>
    <div class="tarjeta-top">
      <div class="avatar">${avatar(c)}</div>
      <div><div class="nombre">${c.nombre}</div><div class="edad">${c.edad} años</div></div>
    </div>
    <div class="etiquetas">${et.join("")}</div>
    <div class="datos">
      <div class="dato"><label>Suma asegurada</label><span class="valor">${dinero(c.sumaAsegurada)}</span></div>
      <div class="dato"><label>Duración</label><span class="valor">${c.aniosRestantes} años</span></div>
      <div class="dato"><label>Prob. de morir en el plazo</label><span class="valor">${(probMuerte * 100).toFixed(2)}%</span></div>
    </div>
    <div class="datos prima-ofrecida">
      <div class="dato"><label>Prima anual</label><span class="valor prima">${dinero(c.primaOfrecida)}</span></div>
      <div class="dato"><label>Por cada $100,000</label><span class="valor">${dinero(primaPor100k)}</span></div>
      <div class="dato"><label>Primas totales</label><span class="valor">${dinero(primasTotales)}</span></div>
      <div class="dato"><label>Costo esperado</label><span class="valor">${dinero(costoEsperado)}</span></div>
    </div>
  </div>`;
}

function pintarCandidatos() {
  $("lista-candidatos").innerHTML = partida.candidatos.map(htmlTarjeta).join("");
}

function alternarSeleccion(i) {
  if (seleccion.has(i)) seleccion.delete(i); else seleccion.add(i);
  document.querySelectorAll("#lista-candidatos .tarjeta").forEach(t => {
    t.classList.toggle("seleccionada", seleccion.has(Number(t.dataset.i)));
  });
  pintarResumenSeleccion();
}

function pintarResumenSeleccion() {
  const el = $("sel-resumen");
  if (seleccion.size === 0) { el.innerHTML = "No aseguras a nadie este año."; return; }
  let prima = 0, suma = 0;
  seleccion.forEach(i => {
    prima += partida.candidatos[i].primaOfrecida;
    suma += partida.candidatos[i].sumaAsegurada;
  });
  el.innerHTML = `Aseguras a <b>${seleccion.size}</b> · Primas: <b>${dinero(prima)}</b>/año · Exposición: <b>${dinero(suma)}</b>`;
}

// ---------- Cartera ----------
const CLASE_ESTADO = { activa: "activa", fallecido: "fallecido", cancelada: "cancelada",
                       "anulada por fraude": "fraude" };

function textoEstado(p) {
  if (p.estado === "fallecido") return p.causa === "accidente" ? "Fallecido (accidente)" : "Fallecido";
  if (p.estado === "anulada por fraude") return p.causa === "auditoria" ? "Anulada: auditoría" : "Anulada: fraude";
  if (p.estado === "cancelada") return "Cancelada";
  return "Activa";
}

// revelar = true muestra las mentiras ocultas (pantalla final)
function pintarCartera(contenedor, revelar) {
  if (partida.polizas.length === 0) {
    contenedor.innerHTML = '<div class="cartera-vacia">Todavía no tienes pólizas.</div>';
    return;
  }
  const orden = { activa: 0, fallecido: 1, "anulada por fraude": 2, cancelada: 3 };
  const lista = partida.polizas.slice().sort((a, b) => orden[a.estado] - orden[b.estado] || a.id - b.id);
  contenedor.innerHTML = lista.map(p => {
    const mintio = revelar && p.oculta;
    const extra = mintio ? `<small>🤥 Ocultó que era: ${p.oculta === "fumador" ? "fumador" : "enfermo"}</small>` : "";
    return `<div class="cartera-item${mintio ? " mintio" : ""}">
      <div>${p.nombre}, ${p.edad} años<small>Suma ${dinero(p.sumaAsegurada)} · Prima ${dinero(p.primaOfrecida)}/año</small>${extra}</div>
      <span class="estado ${CLASE_ESTADO[p.estado]}">${textoEstado(p)}</span>
    </div>`;
  }).join("");
}

// ---------- Reaseguro ----------
function alternarReaseguro() {
  if (partida.reaseguroUsado) return;
  reaseguroMes = !reaseguroMes;
  const btn = $("btn-reaseguro");
  btn.classList.toggle("activo", reaseguroMes);
  btn.textContent = reaseguroMes ? "🛟 Reaseguro ACTIVADO (clic para quitar)" : "🛟 Usar reaseguro este año";
}

// ---------- Jugar el año: primero gira la ruleta ----------
function confirmarMes() {
  $("btn-jugar").disabled = true;
  casillaPendiente = girarRuleta();          // el azar decide AHORA (uniforme de 0 a 9)

  // Se abre la ventana de la ruleta y empieza a girar
  $("ruleta-resultado").classList.add("oculta");
  $("btn-ruleta-seguir").classList.add("oculta");
  $("ruleta-titulo").textContent = "🎡 Girando...";
  $("modal-ruleta").classList.remove("oculta");

  animarRuleta(casillaPendiente, () => {
    const c = CASILLAS[casillaPendiente];
    const res = $("ruleta-resultado");
    res.className = "ruleta-resultado " + (c.bueno ? "bueno" : "malo");
    res.innerHTML = `<span class="grande-icono">${c.icono}</span><b>${c.nombre}</b><p>${c.texto}</p>`;
    $("ruleta-titulo").textContent = c.bueno ? "🎡 ¡Buena suerte este año!" : "🎡 ¡Mala suerte este año!";
    $("btn-ruleta-seguir").classList.remove("oculta");
  });
}

// Después de ver la ruleta, se juega el año con ese resultado
function seguirDespuesDeRuleta() {
  $("modal-ruleta").classList.add("oculta");
  const elegidos = Array.from(seleccion).sort((a, b) => a - b);
  const resumen = jugarAnio(partida, elegidos, reaseguroMes, casillaPendiente);   // aquí corre el modelo
  mostrarResumenAnio(resumen);
}

function lineaResumen(texto, valor, clase) {
  return `<div class="linea-resumen"><span>${texto}</span><span class="${clase || ""}">${valor}</span></div>`;
}

function mostrarResumenAnio(r) {
  const neto = r.capitalFinal - r.capitalInicial;
  let html = `<h2>Resumen del año ${r.anio}</h2>
    <p class="subtitulo">${r.polizasActivas} pólizas activas al cierre</p>
    <div class="ruleta-aviso ${r.casilla.bueno ? "bueno" : "malo"}">🎡 Ruleta: ${r.casilla.icono} <b>${r.casilla.nombre}</b>
      <small>${r.casilla.texto}</small></div>`;
  html += lineaResumen("Primas cobradas", "+" + dinero(r.primas), "positivo");
  html += lineaResumen("Siniestros pagados", "-" + dinero(r.siniestros), r.siniestros > 0 ? "negativo" : "");
  if (r.recuperado > 0 || r.costoReaseguro > 0) {
    html += lineaResumen("Recuperado por reaseguro", "+" + dinero(r.recuperado), "positivo");
    html += lineaResumen("Costo del reaseguro", "-" + dinero(r.costoReaseguro), "negativo");
  }
  const notaGastos = r.multGastos !== 1 ? " (×" + +r.multGastos.toFixed(2) + ")" : "";
  html += lineaResumen("Gastos fijos" + notaGastos, "-" + dinero(r.gastos), "negativo");
  if (r.gastoExtra > 0) html += lineaResumen("⚖️ Multa o demanda", "-" + dinero(r.gastoExtra), "negativo");
  if (r.ingresoExtra > 0) html += lineaResumen("🤝 Contrato corporativo", "+" + dinero(r.ingresoExtra), "positivo");
  html += lineaResumen("Rendimiento de inversiones",
                       (r.rendimiento >= 0 ? "+" : "-") + dinero(Math.abs(r.rendimiento)),
                       r.rendimiento >= 0 ? "positivo" : "negativo");
  html += `<div class="linea-resumen total"><span>Cambio del año</span>
           <span class="${neto >= 0 ? "positivo" : "negativo"}">${neto >= 0 ? "+" : "-"}${dinero(Math.abs(neto))}</span></div>`;
  html += `<div class="linea-resumen total"><span>Capital</span><span>${dinero(r.capitalFinal)}</span></div>`;

  r.fallecidos.forEach(p => {
    html += `<div class="aviso-mes malo">💀 <b>${p.nombre}</b> (${p.edad} años) falleció${p.causa === "accidente" ? " en el accidente colectivo" : ""}. Pagaste ${dinero(p.sumaAsegurada)}.</div>`;
  });
  r.fraudes.forEach(p => {
    html += `<div class="aviso-mes fraude">🕵️ <b>${p.nombre}</b> falleció${p.causa === "accidente" ? " en el accidente" : ""}, pero mintió en su solicitud. Contrato anulado: no pagas nada.</div>`;
  });
  if (r.casilla.id === "accidente" && !r.fallecidos.some(p => p.causa === "accidente") && !r.fraudes.some(p => p.causa === "accidente")) {
    html += `<div class="aviso-mes">🚗 Hubo un accidente colectivo, pero ninguno de tus asegurados estaba involucrado.</div>`;
  }
  if (r.casilla.id === "auditoria") {
    html += r.auditadas.length > 0
      ? `<div class="aviso-mes fraude">🔍 La auditoría anuló ${r.auditadas.length} contrato(s) de asegurados que mintieron: ${r.auditadas.map(p => p.nombre).join(", ")}.</div>`
      : `<div class="aviso-mes">🔍 La auditoría no encontró contratos fraudulentos en tu cartera.</div>`;
  }
  if (r.cancelaciones.length > 0) {
    html += `<div class="aviso-mes">📄 ${r.cancelaciones.length} cliente(s) cancelaron su póliza este año.</div>`;
  }
  $("modal-contenido").innerHTML = html;
  $("btn-continuar").textContent = partida.terminado ? "Ver resultado final ▶" : "Siguiente año ▶";
  $("modal-mes").classList.remove("oculta");
}

function continuarDespuesDelAnio() {
  $("modal-mes").classList.add("oculta");
  if (partida.terminado) mostrarFinal(); else comenzarAnio();
}

// ============================================================
// PANTALLA FINAL
// ============================================================

function mostrarFinal() {
  const pantalla = $("pantalla-final");
  pantalla.className = "pantalla res-" + partida.resultado;

  const textos = {
    quiebra:   { icono: "💥", titulo: "¡Tu aseguradora quebró!",
                 sub: "Los siniestros y los gastos se comieron tu capital. A veces el riesgo cobra factura." },
        pierde:    { icono: "📉", titulo: "Sobreviviste, pero perdiste dinero",
                 sub: "Terminaste los " + DURACION_JUEGO + " años sin quebrar, pero con menos capital del que empezaste." },
    gana:      { icono: "✅", titulo: "¡Tu aseguradora ganó!",
                 sub: "Terminaste con más capital del que empezaste. Un buen resultado, aunque todavía no de empresa Élite." },
    elite:     { icono: "🏆", titulo: "¡Aseguradora Élite!",
                 sub: "Elegiste bien a tus asegurados y el azar estuvo de tu lado. Eres un gran actuario." }
  };
  const t = textos[partida.resultado];
  $("final-icono").textContent = t.icono;
  $("final-titulo").textContent = t.titulo;
  $("final-subtitulo").textContent = t.sub;

  // Totales de la partida
  let primas = 0, siniestros = 0, muertes = 0, fraudes = 0;
  partida.historial.forEach(r => {
    primas += r.primas; siniestros += r.siniestros;
    muertes += r.fallecidos.length; fraudes += r.fraudes.length;
  });
  const variacion = ((partida.capital - CAPITAL_INICIAL) / CAPITAL_INICIAL) * 100;
  const stats = [
    ["Capital final", dinero(partida.capital)],
    ["Variación", (variacion >= 0 ? "+" : "") + variacion.toFixed(1) + "%"],
    ["Pólizas contratadas", partida.polizas.length],
    ["Fallecimientos pagados", muertes],
    ["Contratos anulados por fraude", fraudes],
    ["Primas cobradas", dinero(primas)],
    ["Siniestros pagados", dinero(siniestros)]
  ];
  $("final-stats").innerHTML = stats.map(s =>
    `<div class="stat"><div class="stat-etiqueta">${s[0]}</div><div class="stat-valor">${s[1]}</div></div>`).join("");

  mostrarPantalla("pantalla-final");
  dibujarLinea($("grafica-final"), serieCapital(), CAPITAL_INICIAL);
  pintarCartera($("final-revision"), true);
}

// ============================================================
// PANTALLA MONTE CARLO
// ============================================================

function abrirMonteCarlo() {
  const sel = $("mc-estrategia");
  if (!sel.innerHTML.trim()) {
    sel.innerHTML = Object.entries(ESTRATEGIAS)
      .map(([clave, e]) => `<option value="${clave}">${e.nombre}</option>`).join("");
  }
  mostrarPantalla("pantalla-mc");
}

function correrMonteCarlo() {
  const estrategia = ESTRATEGIAS[$("mc-estrategia").value];
  const n = Number($("mc-n").value);
  $("btn-correr-mc").disabled = true;
  $("mc-estado").textContent = "Simulando " + n.toLocaleString("es-MX") + " partidas... (puede tardar unos segundos)";

  // setTimeout deja que el navegador muestre el mensaje antes de calcular
  setTimeout(() => {
    const r = monteCarlo(n, estrategia);
    const pct = (x) => (x * 100).toFixed(1) + "%";
    const stats = [
      ["Prob. de quiebra", pct(r.pQuiebra)],
      ["Prob. de perder dinero", pct(r.pPierde)],
      ["Prob. de ganar", pct(r.pGana)],
      ["Prob. de ser Élite", pct(r.pElite)],
      ["Capital medio", dinero(r.media)],
      ["Desviación estándar", dinero(r.desviacion)],
      ["Percentil 5 (mal escenario)", dinero(r.p5)],
      ["Mediana", dinero(r.mediana)],
      ["Percentil 95 (buen escenario)", dinero(r.p95)],
      ["Muertes por partida", r.muertesPorPartida.toFixed(2)]
    ];
    $("mc-resultados").innerHTML = stats.map(s =>
      `<div class="stat"><div class="stat-etiqueta">${s[0]}</div><div class="stat-valor">${s[1]}</div></div>`).join("");
    dibujarBarras($("grafica-histograma"), r.histograma);
    dibujarLinea($("grafica-trayectoria"), r.trayectoriaMedia, CAPITAL_INICIAL);
    $("mc-estado").textContent = "Listo: " + n.toLocaleString("es-MX") + " partidas con la estrategia «" + r.estrategia + "».";
    $("btn-correr-mc").disabled = false;
  }, 60);
}

// ============================================================
// CONEXIÓN DE BOTONES
// ============================================================

$("btn-nueva").addEventListener("click", nuevaPartida);
$("btn-montecarlo").addEventListener("click", abrirMonteCarlo);
$("btn-reaseguro").addEventListener("click", alternarReaseguro);
$("btn-jugar").addEventListener("click", confirmarMes);
$("btn-continuar").addEventListener("click", continuarDespuesDelAnio);
$("btn-ruleta-seguir").addEventListener("click", seguirDespuesDeRuleta);
$("btn-reiniciar").addEventListener("click", nuevaPartida);
$("btn-ir-mc").addEventListener("click", abrirMonteCarlo);
$("btn-correr-mc").addEventListener("click", correrMonteCarlo);
$("btn-volver-inicio").addEventListener("click", () => mostrarPantalla("pantalla-inicio"));

// Clic en una tarjeta de candidato (un solo "escucha" para todas las tarjetas)
$("lista-candidatos").addEventListener("click", (e) => {
  const tarjeta = e.target.closest(".tarjeta");
  if (tarjeta) alternarSeleccion(Number(tarjeta.dataset.i));
});

// Leyenda con las 10 casillas de la ruleta
$("ruleta-leyenda").innerHTML = CASILLAS.map(c =>
  `<span class="chip" style="border-color:${c.color}">${c.icono} ${c.nombre}</span>`).join("");
dibujarRuleta($("ruleta-canvas"), 0);