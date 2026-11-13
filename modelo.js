// ============================================================
// modelo.js — MOTOR ACTUARIAL DE ACTUARIO TYCOON
// Todos los periodos son AÑOS (el juego dura 20 años)
// BLOQUE 1: tasa de interés, descuento y mortalidad
// ============================================================

// ---------- 1. TASA DE INTERÉS ----------
// Tasa técnica anual (se usa para calcular las primas)
const I_ANUAL = 0.10;

// v^k = (1 + i)^(-k)  (fórmula 1 de tus apuntes, con k en años)
function v(k) {
  return Math.pow(1 + I_ANUAL, -k);
}

// ---------- 2. MORTALIDAD ----------
// q_x de la tabla (la fila x de la tabla corresponde a la edad x).
// Si la edad no existe, se asume muerte segura.
function qAnual(x) {
  const fila = TABLA_MORTALIDAD[x];
  return fila && fila.x === x ? fila.qx : 1;
}

// Probabilidad de morir en el año k de la póliza (k = 0, 1, 2, ...)
//  - xInicial: edad del asegurado al contratar
//  - k: años transcurridos desde que contrató
//  - factorRiesgo: multiplicador por fumador, enfermedad, etc. (1 = sin recargo)
// Cada año el asegurado cumple un año y pasa al q_x siguiente,
// por eso la edad sí afecta el cálculo.
function qAnualPoliza(xInicial, k, factorRiesgo = 1) {
  const x = Math.min(xInicial + k, EDAD_MAX);
  return Math.min(1, qAnual(x) * factorRiesgo);
}

// ============================================================
// BLOQUE 2: supervivencia, seguro temporal, anualidad y primas
// (fórmulas 3 a 8 de tus apuntes, con periodos en AÑOS)
// ============================================================

// ---------- Gastos y utilidad (fórmula 8) ----------
const GASTOS_ADMIN = 0.08;   // administración
const GASTOS_ADQ   = 0.10;   // adquisición
const UTILIDAD     = 0.15;   // utilidad

// Prima de tarifa = Prima neta / (1 - 0.08 - 0.10 - 0.15) = Prima neta / 0.67
const FACTOR_TARIFA = 1 - GASTOS_ADMIN - GASTOS_ADQ - UTILIDAD;

// ---------- Fórmula 3: kp_x ----------
// Probabilidad de seguir vivo después de k años: producto de (1 - q) de cada año.
// Con factorRiesgo = 1 es exactamente  kp_x = l_(x+k) / l_x  de la tabla.
function supervivencia(xInicial, k, factorRiesgo = 1) {
  let p = 1;
  for (let j = 0; j < k; j++) {
    p *= 1 - qAnualPoliza(xInicial, j, factorRiesgo);
  }
  return p;
}

// ---------- Fórmula 4: k|q_x ----------
// Probabilidad de sobrevivir k años y morir justo en el año k+1:
// k|q_x = kp_x · q_(x+k)   (con factor 1 es d_(x+k) / l_x)
function probDiferida(xInicial, k, factorRiesgo = 1) {
  return supervivencia(xInicial, k, factorRiesgo) * qAnualPoliza(xInicial, k, factorRiesgo);
}

// ---------- Fórmula 5: A¹ (seguro temporal a n años, S = 1) ----------
// A¹ = Σ [k=0 hasta n-1] v^(k+1) · k|q_x
function seguroTemporal(xInicial, n, factorRiesgo = 1) {
  let A = 0;
  for (let k = 0; k < n; k++) {
    A += v(k + 1) * probDiferida(xInicial, k, factorRiesgo);
  }
  return A;
}

// ---------- Fórmula 6: ä (anualidad temporal anticipada a n años) ----------
// ä = Σ [k=0 hasta n-1] v^k · kp_x
function anualidadTemporal(xInicial, n, factorRiesgo = 1) {
  let a = 0;
  for (let k = 0; k < n; k++) {
    a += v(k) * supervivencia(xInicial, k, factorRiesgo);
  }
  return a;
}

// ---------- Fórmula 7: prima neta nivelada ANUAL ----------
// P = S · A¹ / ä
function primaNeta(S, xInicial, n, factorRiesgo = 1) {
  return S * seguroTemporal(xInicial, n, factorRiesgo) /
             anualidadTemporal(xInicial, n, factorRiesgo);
}

// ---------- Fórmula 8: prima de tarifa ANUAL (la que paga el cliente) ----------
function primaTarifa(S, xInicial, n, factorRiesgo = 1) {
  return primaNeta(S, xInicial, n, factorRiesgo) / FACTOR_TARIFA;
}

// Misma prima, pero con memoria: como la prima es proporcional a S, se calcula
// una vez por combinación (edad, años, factor) y se reutiliza. Resultado idéntico.
const _cachePrima = new Map();
function primaTarifaRapida(S, xInicial, n, factorRiesgo = 1) {
  const clave = xInicial + "_" + n + "_" + factorRiesgo;
  let unitaria = _cachePrima.get(clave);
  if (unitaria === undefined) {
    unitaria = primaTarifa(1, xInicial, n, factorRiesgo);
    _cachePrima.set(clave, unitaria);
  }
  return S * unitaria;
}

// Comprobación: con factor 1, kp_x calculada con q_x debe coincidir con l_(x+k)/l_x
function verificarSupervivencia(x = 40, k = 20) {
  const conFormula = supervivencia(x, k, 1);
  const conTabla = TABLA_MORTALIDAD[x + k].lx / TABLA_MORTALIDAD[x].lx;
  console.log("kp_x con (1 - q_x):", conFormula, "| l_(x+k)/l_x de la tabla:", conTabla);
  return { conFormula, conTabla };
}

// ============================================================
// BLOQUE 3: PARTE ESTOCÁSTICA
// números aleatorios, muertes, cancelaciones, rendimiento
// y generación de candidatos
// ============================================================

const DURACION_JUEGO = 20;    // años
const MULT_ESCENARIO = 1.2;   // antiselección: quien compra seguro suele ser más riesgoso

// ---------- 1. Generadores de números aleatorios ----------
// Normal(mu, sigma) con el método de Box-Muller
function normal(mu = 0, sigma = 1) {
  let u = 0;
  while (u === 0) u = Math.random();
  const w = Math.random();
  return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
}

// Lognormal: e^Normal (siempre positiva, con cola larga a la derecha)
function lognormal(mu, sigma) {
  return Math.exp(normal(mu, sigma));
}

// Entero aleatorio entre a y b (incluidos)
function entre(a, b) {
  return a + Math.floor(Math.random() * (b - a + 1));
}

// Elemento aleatorio de una lista
function elegir(lista) {
  return lista[Math.floor(Math.random() * lista.length)];
}

// ---------- 2. Muerte y cancelación ----------
// Probabilidad real de morir en el año k de la póliza:
// q_x · factor de riesgo · antiselección · efecto de la ruleta (tope: 1)
function qEfectiva(xInicial, k, factorReal, multEvento = 1) {
  const x = Math.min(xInicial + k, EDAD_MAX);
  return Math.min(1, qAnual(x) * factorReal * MULT_ESCENARIO * multEvento);
}

// Un asegurado muere en el año k si U < q (U ~ Uniforme(0,1))
function simularMuerte(xInicial, k, factorReal, multEvento = 1) {
  return Math.random() < qEfectiva(xInicial, k, factorReal, multEvento);
}

// Probabilidad anual de que el cliente cancele su póliza
const LAPSE_ANUAL = 0.05;
function simularCancelacion(multLapse = 1) {
  return Math.random() < LAPSE_ANUAL * multLapse;
}

// ---------- 3. Rendimiento aleatorio de las inversiones ----------
// Rendimiento del año ~ Normal(media, desviación).
const RENDIMIENTO_MEDIA = 0.04;   // rendimiento real esperado de tus inversiones
const RENDIMIENTO_SD = 0.05;
function rendimientoAnual(media = RENDIMIENTO_MEDIA) {
  return normal(media, RENDIMIENTO_SD);
}

// ---------- 4. Candidatos a asegurar ----------
const FACTOR_FUMADOR = 1.8;
const FACTOR_ENFERMEDAD = 2.5;
const FACTOR_PROFESION = 1.5;
const PROB_MENTIRA = 0.12;
const NOMBRES_H = ["Don Roberto", "Luis", "Miguel", "Javier", "Pedro", "Hugo", "Raúl", "Tomás", "Andrés", "Ernesto"];
const NOMBRES_M = ["Ana", "Carmen", "Sofía", "Lupita", "Valeria", "Mariana", "Elena", "Diana", "Rocío", "Paty"];

function crearCandidato(anioActual) {
  const n = DURACION_JUEGO - anioActual;   // años que durará su póliza

  const mujer = Math.random() < 0.5;
  const nombre = elegir(mujer ? NOMBRES_M : NOMBRES_H);

  // Edad ~ Normal(48, 13), limitada entre 25 y 75
  const edad = Math.round(Math.min(75, Math.max(25, normal(48, 13))));

  // Factores de riesgo que SÍ declara
  const fuma = Math.random() < 0.25;
  const enfermo = Math.random() < 0.12;
  const riesgoso = Math.random() < 0.10;
  let factorDeclarado = 1;
  if (fuma) factorDeclarado *= FACTOR_FUMADOR;
  if (enfermo) factorDeclarado *= FACTOR_ENFERMEDAD;
  if (riesgoso) factorDeclarado *= FACTOR_PROFESION;

  // Mentira: oculta una condición que sí tiene (el jugador no la ve)
  let factorReal = factorDeclarado;
  let oculta = null;
  if (Math.random() < PROB_MENTIRA) {
    const opciones = [];
    if (!fuma) opciones.push("fumador");
    if (!enfermo) opciones.push("enfermedad");
    oculta = elegir(opciones);
    factorReal *= oculta === "fumador" ? FACTOR_FUMADOR : FACTOR_ENFERMEDAD;
  }

  // Suma asegurada ~ Lognormal, redondeada a 50,000, entre 200,000 y 2,000,000
  let S = Math.round(lognormal(Math.log(800000), 0.5) / 50000) * 50000;
  S = Math.min(2100000, Math.max(200000, S));

  // Prima justa (con tus fórmulas, usando lo que el cliente declara)
  const primaJusta = primaTarifaRapida(S, edad, n, factorDeclarado);
  // Prima que el mercado ofrece = prima justa × razón aleatoria (lognormal, mediana 1).
  // Razón < 1: oferta barata (mal negocio). Razón > 1: buen negocio. Tope: entre 0.5 y 3.
  const razonPrima = Math.min(3, Math.max(0.5, lognormal(-0.15, 0.75)));
  const primaOfrecida = primaJusta * razonPrima;

  return { nombre, mujer, edad, fuma, enfermo, riesgoso,
           factorDeclarado, factorReal, oculta,
           sumaAsegurada: S, aniosRestantes: n, primaJusta, primaOfrecida };
}

// ============================================================
// BLOQUE 4: ESTADO DEL JUEGO, RULETA Y SIMULACIÓN DE UN AÑO
// ============================================================

// ---------- Parámetros del juego ----------
const CAPITAL_INICIAL = 3000000;   // capital con el que arranca la aseguradora
const GASTO_FIJO_ANIO = 175000;    // nómina, renta, operación (por año)
const N_CANDIDATOS = 8;            // candidatos que llegan cada año
const PROB_DETECCION = 0.5;        // prob. de descubrir la mentira al morir el asegurado
const REASEGURO_CUOTA = 0.5;       // el reasegurador paga 50% de los siniestros del año
const REASEGURO_COSTO = 0.2;       // cuesta 20% de las primas cobradas ese año
const META_ELITE = 1.75;              // capital final >= 2 veces el inicial = "Élite"
const PROB_ACCIDENTE = 0.02;       // prob. de que CADA asegurado muera en un accidente colectivo

// ============================================================
// LA RULETA: 10 casillas, cada una con probabilidad 1/10
// ============================================================
// duracion = años que dura el efecto (0 = efecto único, solo ese año)
const CASILLAS = [
  { id: "pandemia", icono: "🦠", nombre: "Pandemia", color: "#ff5f6d", bueno: false, duracion: 1,
    texto: "La mortalidad del año se dispara: ×2.5 en mayores de 60, ×1.8 entre 40 y 59, ×1.4 en menores.",
    multMortalidad: (edad) => (edad >= 60 ? 2.5 : edad >= 40 ? 1.8 : 1.4) },
  { id: "tranquilo", icono: "😌", nombre: "Año tranquilo", color: "#31d49a", bueno: true, duracion: 1,
    texto: "Ocurren la mitad de los siniestros: la mortalidad se reduce a la mitad.",
    multMortalidad: () => 0.5 },
  { id: "accidente", icono: "🚗", nombre: "Accidente colectivo", color: "#ff8a4c", bueno: false, duracion: 0,
    texto: "Cada asegurado activo tiene " + (PROB_ACCIDENTE * 100) + "% de morir, sin importar su edad. Entre más grande tu cartera, más riesgo." },
  { id: "crisis", icono: "📉", nombre: "Crisis bursátil", color: "#c0415b", bueno: false, duracion: 1,
    texto: "Tus inversiones se desploman: el rendimiento del año tiene media de -10%.",
    mediaRend: -0.10 },
  { id: "rally", icono: "📈", nombre: "Rally bursátil", color: "#2fa8c9", bueno: true, duracion: 1,
    texto: "Tus inversiones se disparan: el rendimiento del año tiene media de +20%.",
    mediaRend: 0.20 },
  { id: "inflacion", icono: "🔥", nombre: "Inflación de costos", color: "#e0742a", bueno: false, duracion: 2,
    texto: "Tus gastos fijos suben 50% durante 2 años.",
    multGastos: 1.5 },
  { id: "eficiencia", icono: "💡", nombre: "Eficiencia operativa", color: "#7dbb3a", bueno: true, duracion: 2,
    texto: "Tus gastos fijos bajan 30% durante 2 años.",
    multGastos: 0.7 },
  { id: "multa", icono: "⚖️", nombre: "Multa o demanda", color: "#a87bff", bueno: false, duracion: 0,
    texto: "Pagas una multa única de entre $100,000 y $300,000.",
    gastoUnico: [100000, 300000] },
  { id: "contrato", icono: "🤝", nombre: "Contrato corporativo", color: "#f6bf4a", bueno: true, duracion: 0,
    texto: "Cierras un contrato y recibes un ingreso único de entre $100,000 y $250,000.",
    ingresoUnico: [100000, 250000] },
  { id: "auditoria", icono: "🔍", nombre: "Auditoría", color: "#5b8dff", bueno: true, duracion: 0,
    texto: "La autoridad revisa tu cartera: se anulan los contratos de quienes mintieron." }
];

// Gira la ruleta: número entero uniforme de 0 a 9 (cada casilla con prob. 1/10)
function girarRuleta() {
  return Math.floor(Math.random() * CASILLAS.length);
}

// Monto aleatorio uniforme dentro de un rango, redondeado a miles
function montoAleatorio(rango) {
  return Math.round((rango[0] + Math.random() * (rango[1] - rango[0])) / 1000) * 1000;
}

// Multiplicador de mortalidad de todos los efectos vigentes (se multiplican entre sí)
function multMortalidadVigente(juego, edad) {
  let m = 1;
  for (const e of juego.efectos) if (e.casilla.multMortalidad) m *= e.casilla.multMortalidad(edad);
  return m;
}

// Multiplicador de gastos fijos de todos los efectos vigentes
function multGastosVigente(juego) {
  let m = 1;
  for (const e of juego.efectos) if (e.casilla.multGastos) m *= e.casilla.multGastos;
  return m;
}

// Prueba de bondad de ajuste: ¿la ruleta es uniforme? (chi-cuadrada, 9 grados de libertad)
function verificarRuleta(n = 10000) {
  const obs = new Array(CASILLAS.length).fill(0);
  for (let i = 0; i < n; i++) obs[girarRuleta()]++;
  const esperado = n / CASILLAS.length;
  let chi2 = 0;
  const filas = {};
  CASILLAS.forEach((c, i) => {
    chi2 += (obs[i] - esperado) ** 2 / esperado;
    filas[c.icono + " " + c.nombre] = { observado: obs[i], esperado: esperado,
                                        "frecuencia %": +(obs[i] / n * 100).toFixed(2) };
  });
  console.table(filas);
  console.log("Chi-cuadrada =", chi2.toFixed(2), "| valor crítico (9 g.l., 5%) = 16.92 |",
              chi2 < 16.92 ? "NO se rechaza: la ruleta es uniforme ✅" : "se rechaza uniformidad ❌");
  return chi2;
}

// ============================================================
// ESTADO DE LA PARTIDA
// ============================================================

function nuevoJuego() {
  return {
    anio: 0,                 // año actual (0 a 19)
    capital: CAPITAL_INICIAL,
    polizas: [],             // cartera completa (activas y cerradas)
    efectos: [],             // efectos de la ruleta que siguen vigentes
    candidatos: [],          // los candidatos del año
    historial: [],           // resumen de cada año jugado
    reaseguroUsado: false,
    contadorPolizas: 0,
    terminado: false,
    resultado: null          // "quiebra" | "sobrevive" | "elite"
  };
}

// ---------- Inicio de año: genera los candidatos ----------
function iniciarAnio(juego) {
  juego.candidatos = [];
  for (let i = 0; i < N_CANDIDATOS; i++) {
    juego.candidatos.push(crearCandidato(juego.anio));
  }
  return juego.candidatos;
}

// ---------- Jugar el año ----------
// indicesElegidos: posiciones de los candidatos que el jugador asegura
// usarReaseguro: true para activar la carta de reaseguro (solo una vez por partida)
// idxCasilla: resultado de la ruleta (si no se da, la ruleta gira sola)
function jugarAnio(juego, indicesElegidos = [], usarReaseguro = false, idxCasilla = girarRuleta()) {
  const casilla = CASILLAS[idxCasilla];
  const capitalInicial = juego.capital;

  // 0. Ruleta: si el efecto dura varios años, queda vigente (se renueva si ya estaba)
  if (casilla.duracion > 0) {
    juego.efectos = juego.efectos.filter(e => e.casilla.id !== casilla.id);
    juego.efectos.push({ casilla, aniosRestantes: casilla.duracion });
  }

  // 1. Altas: los elegidos entran a la cartera
  for (const i of indicesElegidos) {
    const c = juego.candidatos[i];
    juego.polizas.push({ ...c, id: ++juego.contadorPolizas,
                         anioAlta: juego.anio, activa: true, estado: "activa", causa: null });
  }

  // 2. Auditoría: se anulan los contratos de quienes mintieron
  const auditadas = [];
  if (casilla.id === "auditoria") {
    for (const p of juego.polizas) {
      if (p.activa && p.oculta) {
        p.activa = false;
        p.estado = "anulada por fraude";
        p.causa = "auditoria";
        auditadas.push(p);
      }
    }
  }
  const activas = juego.polizas.filter(p => p.activa);

  // 3. Cobro de primas (anticipadas, al inicio del año, como en tu fórmula de ä)
  let primas = 0;
  for (const p of activas) primas += p.primaOfrecida;

  // 4. Muertes, accidente y cancelaciones
  const fallecidos = [], fraudes = [], cancelaciones = [];
  let siniestros = 0;

  // Registra un fallecimiento: si mintió y se descubre, no se paga
  function registrarFallecimiento(p, causa) {
    p.activa = false;
    p.causa = causa;
    if (p.oculta && Math.random() < PROB_DETECCION) {
      p.estado = "anulada por fraude";
      fraudes.push(p);
    } else {
      p.estado = "fallecido";
      siniestros += p.sumaAsegurada;
      fallecidos.push(p);
    }
  }

  for (const p of activas) {
    const k = juego.anio - p.anioAlta;               // años desde que contrató
    const edadActual = p.edad + k;
    const mult = multMortalidadVigente(juego, edadActual);

    if (simularMuerte(p.edad, k, p.factorReal, mult)) {
      registrarFallecimiento(p, "natural");
    } else if (casilla.id === "accidente" && Math.random() < PROB_ACCIDENTE) {
      registrarFallecimiento(p, "accidente");
    } else if (simularCancelacion(1)) {
      p.activa = false;
      p.estado = "cancelada";
      cancelaciones.push(p);
    }
  }

  // 5. Reaseguro (opcional, una sola vez en toda la partida)
  let recuperado = 0, costoReaseguro = 0;
  if (usarReaseguro && !juego.reaseguroUsado) {
    juego.reaseguroUsado = true;
    recuperado = siniestros * REASEGURO_CUOTA;
    costoReaseguro = primas * REASEGURO_COSTO;
  }

  // 6. Rendimiento aleatorio: Normal(media, desviación) sobre el capital con el que empezó el año
  const mediaRend = casilla.mediaRend !== undefined ? casilla.mediaRend : RENDIMIENTO_MEDIA;
  const rendimiento = Math.max(0, capitalInicial) * rendimientoAnual(mediaRend);

  // 7. Gastos fijos (afectados por inflación o eficiencia) y montos únicos de la ruleta
  const multGastos = multGastosVigente(juego);
  const gastosFijos = GASTO_FIJO_ANIO * multGastos;
  const gastoExtra = casilla.gastoUnico ? montoAleatorio(casilla.gastoUnico) : 0;
  const ingresoExtra = casilla.ingresoUnico ? montoAleatorio(casilla.ingresoUnico) : 0;

  // 8. Actualizar el capital
  juego.capital = capitalInicial + primas - siniestros + recuperado - costoReaseguro
                  - gastosFijos - gastoExtra + ingresoExtra + rendimiento;

  // 9. Resumen del año
  const resumen = {
    anio: juego.anio + 1,
    casilla: { id: casilla.id, icono: casilla.icono, nombre: casilla.nombre,
               texto: casilla.texto, bueno: casilla.bueno },
    altas: indicesElegidos.length,
    polizasActivas: juego.polizas.filter(p => p.activa).length,
    primas, siniestros, recuperado, costoReaseguro,
    gastos: gastosFijos, multGastos, gastoExtra, ingresoExtra, rendimiento,
    fallecidos, fraudes, cancelaciones, auditadas,
    capitalInicial, capitalFinal: juego.capital
  };
  juego.historial.push(resumen);

  // 10. Avanzar el tiempo: los efectos pierden un año de duración
  juego.efectos.forEach(e => e.aniosRestantes--);
  juego.efectos = juego.efectos.filter(e => e.aniosRestantes > 0);
  juego.anio++;

  // 11. ¿Terminó la partida?
  if (juego.capital < 0) {
    juego.terminado = true;
    juego.resultado = "quiebra";
  } else if (juego.anio >= DURACION_JUEGO) {
    juego.terminado = true;
        juego.resultado = juego.capital >= META_ELITE * CAPITAL_INICIAL ? "elite"
                    : juego.capital >= CAPITAL_INICIAL ? "gana" : "pierde";
  }
  return resumen;
}

// ============================================================
// BLOQUE 5: MONTE CARLO Y ESTRATEGIAS AUTOMÁTICAS
// ============================================================

// ---------- 1. Estrategias automáticas ----------
// elegir(candidatos, juego) devuelve los índices que se aseguran ese año.
// reaseguro(juego) (opcional) devuelve true si se activa el reaseguro ese año.
const ESTRATEGIAS = {
  ninguno: {
    nombre: "No asegurar a nadie",
    elegir: () => []
  },
    conservadora: {
    nombre: "Conservadora (máx. 2 al año, sanos, menores de 55 y sumas moderadas)",
    elegir: (cands, juego) => cands
      .map((c, i) => [c, i])
      .filter(([c]) => c.factorDeclarado <= 1.5 && c.edad < 55 &&
                       c.primaOfrecida >= c.primaJusta &&
                       c.sumaAsegurada <= 0.3 * juego.capital)
      .slice(0, 2).map(([, i]) => i)
  },
  moderada: {
    nombre: "Moderada (máx. 4 al año, prima decente y menores de 65)",
    elegir: (cands) => cands
      .map((c, i) => [c, i])
      .filter(([c]) => c.primaOfrecida >= c.primaJusta * 0.95 && c.edad < 65)
      .slice(0, 4).map(([, i]) => i)
  },
  inteligente: {
    nombre: "Inteligente (elige por primas totales / costo esperado)",
    elegir: (cands, juego) => cands
      .map((c, i) => {
        // La misma comparación que ves en la tarjeta: primas totales entre costo esperado
        const costo = c.sumaAsegurada * probMuerteEnPlazo(c.edad, c.aniosRestantes, c.factorDeclarado);
        return [c, i, (c.primaOfrecida * c.aniosRestantes) / costo];
      })
      .filter(([c, , razon]) => razon >= 1.2 && c.factorDeclarado <= 1.8 &&
                                c.sumaAsegurada <= 0.6 * juego.capital)
      .sort((a, b) => b[2] - a[2])
      .map(([, i]) => i)
  },
  todos: {
    nombre: "Asegurar a los 8 cada año",
    elegir: (cands) => cands.map((c, i) => i)
  }
};

// ---------- 2. Una partida completa en automático ----------
function simularPartidaAuto(estrategia) {
  const juego = nuevoJuego();
  const trayectoria = [CAPITAL_INICIAL];
  let muertes = 0;
  while (!juego.terminado) {
    const cands = iniciarAnio(juego);
    const elegidos = estrategia.elegir(cands, juego);
    const usarRea = estrategia.reaseguro ? estrategia.reaseguro(juego) : false;
    const res = jugarAnio(juego, elegidos, usarRea);
    muertes += res.fallecidos.length;
    trayectoria.push(juego.capital);
  }
  // Si quebró antes del año 20, se arrastra el último capital hasta el final
  while (trayectoria.length < DURACION_JUEGO + 1) trayectoria.push(juego.capital);
  return { resultado: juego.resultado, capitalFinal: juego.capital, trayectoria, muertes };
}

// ---------- 3. Estadísticas ----------
// Percentil p (0 a 1) de una lista ya ordenada
function percentil(ordenada, p) {
  const pos = Math.min(ordenada.length - 1, Math.floor(p * ordenada.length));
  return ordenada[pos];
}

// ---------- 4. Monte Carlo ----------
// Corre n partidas con la misma estrategia y resume los resultados.
function monteCarlo(n, estrategia, nBarras = 12) {
  const conteo = { quiebra: 0, pierde: 0, gana: 0, elite: 0 };
  const finales = [];
  const suma = new Array(DURACION_JUEGO + 1).fill(0);
  let muertesTotal = 0;

  for (let i = 0; i < n; i++) {
    const p = simularPartidaAuto(estrategia);
    conteo[p.resultado]++;
    finales.push(p.capitalFinal);
    muertesTotal += p.muertes;
    for (let m = 0; m <= DURACION_JUEGO; m++) suma[m] += p.trayectoria[m];
  }

  finales.sort((a, b) => a - b);
  const media = finales.reduce((a, b) => a + b, 0) / n;
  const varianza = finales.reduce((a, x) => a + (x - media) ** 2, 0) / (n - 1);

  // Histograma del capital final
  const minimo = finales[0], maximo = finales[n - 1];
  const ancho = (maximo - minimo) / nBarras || 1;
  const histograma = [];
  for (let b = 0; b < nBarras; b++) {
    histograma.push({ desde: minimo + b * ancho, hasta: minimo + (b + 1) * ancho, frecuencia: 0 });
  }
  for (const x of finales) {
    const b = Math.min(nBarras - 1, Math.floor((x - minimo) / ancho));
    histograma[b].frecuencia++;
  }

  return {
    estrategia: estrategia.nombre,
    n,
    pQuiebra: conteo.quiebra / n,
        pPierde: conteo.pierde / n,
    pGana: conteo.gana / n,
    pElite: conteo.elite / n,
    media,
    desviacion: Math.sqrt(varianza),
    p5: percentil(finales, 0.05),
    mediana: percentil(finales, 0.5),
    p95: percentil(finales, 0.95),
    minimo, maximo,
    muertesPorPartida: muertesTotal / n,
    trayectoriaMedia: suma.map(s => s / n),
    histograma
  };
}

// Compara todas las estrategias y muestra una tabla en la consola
function compararEstrategias(n = 1000) {
  const filas = {};
  for (const [clave, est] of Object.entries(ESTRATEGIAS)) {
    const r = monteCarlo(n, est);
    filas[clave] = {
      "% quiebra": +(r.pQuiebra * 100).toFixed(1),
      "% pierde": +(r.pPierde * 100).toFixed(1),
      "% gana": +(r.pGana * 100).toFixed(1),
      "% élite": +(r.pElite * 100).toFixed(1),
      "capital medio": Math.round(r.media),
      "desv. est.": Math.round(r.desviacion),
      "percentil 5": Math.round(r.p5),
      "muertes/partida": +r.muertesPorPartida.toFixed(2)
    };
  }
  console.table(filas);
  return filas;
}

// ---------- 5. Verificación contra la teoría (modelo de riesgo individual) ----------
// Probabilidad de que una póliza termine en muerte durante sus n años
// (con los mismos factores que usa la simulación, sin efectos de ruleta)
function probMuerteEnPlazo(edad, n, factorReal) {
  let vive = 1;
  for (let k = 0; k < n; k++) vive *= 1 - qEfectiva(edad, k, factorReal);
  return 1 - vive;
}

// Pérdida agregada teórica:  E[S] = Σ b_j·q_j   y   Var[S] = Σ b_j²·q_j·(1 - q_j)
function perdidaTeorica(polizas) {
  let esperada = 0, varianza = 0;
  for (const p of polizas) {
    const q = probMuerteEnPlazo(p.edad, p.aniosRestantes, p.factorReal);
    esperada += p.sumaAsegurada * q;
    varianza += p.sumaAsegurada ** 2 * q * (1 - q);
  }
  return { esperada, varianza, desviacion: Math.sqrt(varianza) };
}

// Simula muchas veces las muertes de una cartera fija y compara con la teoría
function verificarModelo(nPolizas = 30, nSim = 5000) {
  const polizas = [];
  for (let i = 0; i < nPolizas; i++) polizas.push(crearCandidato(0));
  const teoria = perdidaTeorica(polizas);

  let suma = 0, sumaCuad = 0;
  for (let s = 0; s < nSim; s++) {
    let perdida = 0;
    for (const p of polizas) {
      for (let k = 0; k < p.aniosRestantes; k++) {
        if (simularMuerte(p.edad, k, p.factorReal)) { perdida += p.sumaAsegurada; break; }
      }
    }
    suma += perdida;
    sumaCuad += perdida * perdida;
  }
  const mediaSim = suma / nSim;
  const desvSim = Math.sqrt(sumaCuad / nSim - mediaSim ** 2);
  const resultado = {
    "E[S] teórica": Math.round(teoria.esperada),
    "E[S] simulada": Math.round(mediaSim),
    "Desv. teórica": Math.round(teoria.desviacion),
    "Desv. simulada": Math.round(desvSim)
  };
  console.table(resultado);
  return resultado;
}