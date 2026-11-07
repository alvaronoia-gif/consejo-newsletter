// Trabajador de GEMINI para la revista NEWSLETTER (API con búsqueda de Google y lectura de URLs). Node 24, sin dependencias.
// Una edición = hasta 2 llamadas a la API de OpenAI (prensa general + productos en cartera). Escribe en buzon/chatgpt/.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { historial, promptEstrategia, validarEstrategia } from './estrategia.mjs';

const OUT = 'buzon/gemini'; mkdirSync(OUT, { recursive: true });
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const PRICE_IN = Number(process.env.GEMINI_PRICE_IN_PER_M || 1.5), PRICE_OUT = Number(process.env.GEMINI_PRICE_OUT_PER_M || 7.5);
const MAX_USD = Number(process.env.MAX_USD_POR_EDICION || 2.5);
const FORCE = process.env.FORCE === 'true';
const PRODUCTOS_URL = 'https://raw.githubusercontent.com/alvaronoia-gif/invlab-productos-publico/main/productos_comprados.json';
if (!KEY) { console.error('Falta GEMINI_API_KEY'); process.exit(1); }

const hoy = new Date().toISOString().slice(0, 10);
const destino = `${OUT}/${hoy}.json`;
if (existsSync(destino) && !FORCE) { console.log('Ya existe', destino, '- nada que hacer'); process.exit(0); }

const ESTADOS = ['COMPLETO', 'EXTRACTO', 'TITULAR', 'BLOQUEADO', 'NO_ENCONTRADO'];
const GESTORAS = ['Azvalor','Magallanes','Cobas','Bestinver','Berkshire Hathaway','BlackRock','Vanguard','Fidelity Investments','State Street Investment Management','JPMorgan Asset Management','Goldman Sachs Asset Management','UBS','Capital Group','Allianz Global Investors','Amundi','BNY Investments','Invesco','Northern Trust Asset Management','T. Rowe Price','Morgan Stanley Investment Management','Franklin Templeton','Geode','PGIM','BNP Paribas Asset Management','Legal & General Asset Management','Norges Bank Investment Management'];
const COMPETIDORES = ['Caliplac (web oficial: https://caliplac.es/)','Teznocuber (web oficial: https://teznocuber.com/)','Onduline','López Panel','Tabihaus','Multipanel','BMI (cubiertas)','Kingspan','Isopan','Panelestudio','Panel Sandwich Group','Tejas Borja','Enerblock (web oficial: https://enerblock.net/)'];
const REGLAS = `Reglas de integridad (innegociables):
- Usa SOLO tu herramienta de búsqueda web. No inventes noticias, URLs, cifras, citas ni fechas. Si no encuentras algo, no lo incluyas.
- Cada elemento: medio, titular (tal cual), url (la real que abriste), fecha (AAAA-MM-DD), estado_lectura, cita_literal, resumen, tema, relevancia, y los campos extra que pida la sección.
- estado_lectura SOLO: COMPLETO (abriste y leíste el cuerpo), EXTRACTO (solo entradilla o fragmento), TITULAR (solo titular o resultado del buscador), BLOQUEADO (no se puede abrir; no resumas más allá del titular visible).
- cita_literal: frase copiada literalmente del cuerpo (máx. 20 palabras) como prueba de lectura; null si no leíste el cuerpo. Si es null, el estado NO puede ser COMPLETO.
- resumen: 2-3 frases con tus palabras, SOLO con datos que aparezcan en lo que leíste; null si el estado es TITULAR o BLOQUEADO.
- tema: construccion | vivienda | industria | industrializacion | competencia | economia | inversion | energia | portugal | otros.
- relevancia: una frase sobre por qué importa a un director comercial de paneles sándwich industrializados para envolvente (Thermochip, Galicia y norte de Portugal).
- Solo hechos de los últimos 7 días (salvo que la sección diga otra cosa). Sin duplicados. Prioriza fuentes originales (webs oficiales, comunicados, reguladores, registros) sobre prensa que las copia.
- Prohibido incluir, aunque salgan en tu búsqueda: Anrobox, 3DModular, Steel Tec, Zero Energetic Housing, BIOMESPACE y MATCOAM. Prohibido buscar o incluir datos privados de clientes, contactos o condiciones comerciales de nadie: solo información pública.
Responde SOLO con un array JSON.`;

const CONTEXTO = `Eres analista de prensa y vigilancia de mercado para una revista bisemanal de un director comercial de Thermochip (paneles sándwich industrializados para envolvente: cubierta, fachada y forjado; Galicia y norte de Portugal). Hoy es ${hoy}. DEBES usar la búsqueda de Google y abrir las páginas con la herramienta de lectura de URLs; no respondas de memoria: si no buscas, no puedes incluir nada.`;

const SECCIONES = {
  prensa: { max: 20000, prompt: `${CONTEXTO}
SECCIÓN prensa_general: noticias de construcción, vivienda, industria, economía y mercados en España y el norte de Portugal. Cubre prensa que otros no pueden abrir: El País, Cinco Días, Expansión, elEconomista, Europa Press, El Confidencial, La Voz de Galicia, Faro de Vigo y prensa económica portuguesa (ECO, Jornal de Negócios, Público). Aporta entre 12 y 18 noticias relevantes, prioriza las que puedas leer COMPLETO, incluye al menos 3 de Galicia o norte de Portugal. Incluye también economía: tipos, inflación, BCE, empleo y actividad, si son relevantes.
${REGLAS}` },
  industrializacion: { max: 20000, prompt: `${CONTEXTO}
SECCIÓN industrializacion: noticias y novedades de construcción industrializada y construcción off-site en España y Portugal: proyectos originales y llamativos (sin limitarlos a un tipo de arquitectura), fábricas y ampliaciones, licitaciones y obras de vivienda industrializada (madera, CLT, LSF, acero, hormigón, módulos 2D y 3D), NUEVOS PLAYERS y startups del sector, normativa, estudios de mercado e informes (asociaciones, consultoras, administraciones). Aporta entre 8 y 14 elementos con campo extra "tipo": noticia | proyecto | nuevo_player | estudio | normativa.
${REGLAS}` },
  competidores: { max: 20000, prompt: `${CONTEXTO}
SECCIÓN competidores: qué están haciendo estas empresas en sus webs oficiales y en prensa sectorial: ${COMPETIDORES.join('; ')}. Busca en sus propias webs (novedades, noticias, blog, proyectos, productos, catálogos, ferias, certificaciones, prensa) y en prensa del sector. Solo hechos públicos recientes (últimos 30 días; marca la fecha real). Por empresa, hasta 2 hechos; si no hay nada reciente, di en un elemento con estado NO_ENCONTRADO. Campo extra "competidor" con el nombre exacto de la lista (o el que hayas encontrado) y "tipo": producto | proyecto | feria | certificacion | comercial | otro.
${REGLAS}` },
  gestoras: { max: 20000, prompt: `${CONTEXTO}
SECCIÓN gestoras: SOLO noticias y movimientos de inversión de estas 26 gestoras: ${GESTORAS.join('; ')}. Movimiento = compra o venta de posiciones, cambios de peso o cartera comunicados, presentación o cambios de 13F/13D/13G, lanzamientos o cierres de fondos y ETF, operaciones corporativas, cambios de asignación comunicados oficialmente. NO uses ni resumas cartas trimestrales o semestrales a partícipes ni informes de perspectivas. Prioriza fuentes oficiales (SEC EDGAR, CNMV, webs de las gestoras) y después prensa especializada. Últimos 10 días. Hasta 15 elementos, solo los más relevantes, con campo extra "entidad" (nombre exacto de la lista) y "tipo": movimiento | noticia | lanzamiento. Si un dato es de agregadores o prensa y no lo confirma una fuente oficial, dilo en "resumen" como no confirmado oficialmente.
${REGLAS}` },
};


async function productos() {
  try {
    const r = await fetch(PRODUCTOS_URL); if (!r.ok) return { status: 'UNAVAILABLE', products: [] };
    const j = await r.json(); return { status: j.status, products: Array.isArray(j.products) ? j.products : [] };
  } catch { return { status: 'UNAVAILABLE', products: [] }; }
}
const promptProductos = (lista) => `${CONTEXTO}
SECCIÓN productos: información sobre los productos de inversión de esta lista (empresas y ETF/fondos). SOLO noticias, hechos y tendencias; nada de recomendaciones de compra ni datos de cartera:
${lista.map(p => `- ${p.name} (${p.isin})`).join('\n')}
Para cada EMPRESA: noticias de los últimos 7 días, resultados y comunicados oficiales, hechos relevantes (CNMV u otros reguladores), operaciones corporativas, y novedades de su sector y de sus competidores directos. Para cada ETF o fondo: noticias del índice que replica y de la categoría, cambios de índice o de composición, flujos, comisiones, cambios de la gestora y alternativas comparables (otros ETF equivalentes). Hasta 3 elementos por producto, priorizando fuentes oficiales (emisor, regulador, proveedor del índice) y datos con fecha. Añade a cada elemento el campo "producto" con el nombre exacto de la lista y "tipo": empresa | etf | sector | competidor.
${REGLAS}`;

async function llamar(prompt, intento = 0, soloBusqueda = false) {
  const t0 = Date.now();
  const tools = soloBusqueda ? [{ google_search: {} }] : [{ google_search: {} }, { url_context: {} }];
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools, generationConfig: { maxOutputTokens: 24000, thinkingConfig: { thinkingBudget: 1024 } } }) });
  const raw = await r.text(); let j = {}; try { j = JSON.parse(raw); } catch {}
  if (r.status === 400 && !soloBusqueda) return llamar(prompt, intento, true);       // por si la combinación de herramientas no se admite
  if ((r.status === 429 || r.status === 503) && intento < 4) { await new Promise(res => setTimeout(res, 20000 * (intento + 1))); return llamar(prompt, intento + 1, soloBusqueda); }
  if (!r.ok) throw new Error(`Gemini HTTP ${r.status}: ${raw.slice(0, 300)}`);
  const c = j.candidates?.[0]; const gm = c?.groundingMetadata || {};
  const text = (c?.content?.parts || []).map(p => p.text || '').join('\n');
  const consultas = gm.webSearchQueries || []; const fuentes = (gm.groundingChunks || []).map(g => g.web?.title || g.web?.uri).filter(Boolean);
  const urlsLeidas = (c?.urlContextMetadata?.urlMetadata || []).length;
  const u = j.usageMetadata || {};
  const entrada = (u.promptTokenCount || 0) + (u.toolUsePromptTokenCount || 0), salida = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
  const coste = (entrada * PRICE_IN + salida * PRICE_OUT) / 1e6;
  let items = []; const m = text.match(/\[[\s\S]*\]/);
  try { items = JSON.parse(m ? m[0] : text); } catch { throw new Error('Respuesta no es JSON válido'); }
  const evidencia = consultas.length > 0 || urlsLeidas > 0;
  if (!evidencia) items = (Array.isArray(items) ? items : []).map(i => ({ ...i, estado_lectura: 'TITULAR', cita_literal: null, resumen: null, nota_modelo: 'SIN_EVIDENCIA_DE_BUSQUEDA_EN_LA_RESPUESTA' }));
  return { items, searches: consultas.length, urls_leidas: urlsLeidas, consultas: consultas.slice(0, 30), fuentes: [...new Set(fuentes)].slice(0, 60), evidencia_de_busqueda: evidencia, usage: u, coste_estimado_usd: Number(coste.toFixed(4)), segundos: (Date.now() - t0) / 1000 };
}

// Validación local: lo que no se puede probar se rebaja; nunca se sube de nivel.
function validar(items) {
  const out = []; const vistos = new Set();
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== 'object' || !it.titular || !it.medio) continue;
    if (it.url && vistos.has(it.url)) continue; if (it.url) vistos.add(it.url);
    let est = ESTADOS.includes(it.estado_lectura) ? it.estado_lectura : 'TITULAR';
    const nota = [];
    if (est === 'COMPLETO' && !it.cita_literal) { est = 'EXTRACTO'; nota.push('rebajado: sin cita literal'); }
    if (est === 'COMPLETO' && it.cita_literal && String(it.cita_literal).split(/\s+/).length > 30) { est = 'EXTRACTO'; nota.push('rebajado: cita demasiado larga'); }
    if (!it.url || !/^https?:\/\//.test(it.url)) { est = 'TITULAR'; nota.push('sin URL válida'); }
    if ((est === 'TITULAR' || est === 'BLOQUEADO' || est === 'NO_ENCONTRADO')) it.resumen = null;
    out.push({ ...it, estado_lectura: est, verificacion: 'V1_reportado_por_IA_sin_contrastar', nota_validador: nota.join('; ') || null });
  }
  return out;
}

const res = { schema: 'consejo-newsletter/gemini/2', generado: new Date().toISOString(), edicion_fecha: hoy, modelo: MODEL, rol: 'lector 3 (Gemini): prensa, industrializacion, competidores, gestoras y productos', secciones: {}, coste_total_estimado_usd: 0, avisos: [] };
const ACTIVAS = (process.env.SECCIONES || 'prensa,industrializacion,gestoras,productos').split(',').map(x => x.trim());
for (const [k, v] of Object.entries(SECCIONES).filter(([k]) => ACTIVAS.includes(k))) {
  try { const g = await llamar(v.prompt); res.secciones[k] = { status: 'OK', ...g, items: validar(g.items) }; res.coste_total_estimado_usd += g.coste_estimado_usd; }
  catch (e) { res.secciones[k] = { status: 'ERROR', items: [] }; res.avisos.push(`${k}: ${e.message.slice(0, 200)}`); }
  if (res.coste_total_estimado_usd > MAX_USD) { res.avisos.push('Tope de coste alcanzado: se omiten las secciones restantes'); break; }
}
{
  const p = await productos();
  if (!ACTIVAS.includes('productos')) res.secciones.productos = { status: 'NO_ACTIVA', items: [] };
  else if (res.coste_total_estimado_usd > MAX_USD) res.secciones.productos = { status: 'OMITIDA_POR_COSTE', items: [] };
  else if (p.status === 'OK' && p.products.length) {
    try { const q = await llamar(promptProductos(p.products)); res.secciones.productos = { status: 'OK', ...q, items: validar(q.items) }; res.coste_total_estimado_usd += q.coste_estimado_usd; }
    catch (e) { res.secciones.productos = { status: 'ERROR', items: [] }; res.avisos.push('productos: ' + e.message.slice(0, 200)); }
  } else res.secciones.productos = { status: p.status, items: [] };
}
{
  // Estrategia comercial semanal (fuera de secciones: no cuenta para secciones_ok)
  if (res.coste_total_estimado_usd > MAX_USD) res.estrategia = { status: 'OMITIDA_POR_COSTE', items: [] };
  else {
    const previas = historial(OUT);
    try { const g = await llamar(promptEstrategia(CONTEXTO, previas, 'Gemini')); res.estrategia = { status: g.evidencia_de_busqueda ? 'OK' : 'SIN_EVIDENCIA', ...g, items: validarEstrategia(g.items, previas) }; res.coste_total_estimado_usd += g.coste_estimado_usd; }
    catch (e) { res.estrategia = { status: 'ERROR', items: [] }; res.avisos.push('estrategia: ' + e.message.slice(0, 200)); }
  }
}
if (res.coste_total_estimado_usd > MAX_USD) res.avisos.push(`Coste estimado ${res.coste_total_estimado_usd} USD por encima del tope ${MAX_USD}`);
res.coste_total_estimado_usd = Number(res.coste_total_estimado_usd.toFixed(4));
const todos = Object.values(res.secciones).flatMap(s => s.items || []);
res.resumen_estados = todos.reduce((m, i) => (m[i.estado_lectura] = (m[i.estado_lectura] || 0) + 1, m), {});
res.items_por_seccion = Object.fromEntries(Object.entries(res.secciones).map(([k, s]) => [k, (s.items || []).length]));
const txt = JSON.stringify(res, null, 1);
const ok = Object.values(res.secciones).filter(x => x.status === 'OK').length;
res.secciones_ok = ok; res.completa = ok >= 4;
const txt2 = JSON.stringify(res, null, 1);
writeFileSync(destino, txt2);
if (ok >= 3) writeFileSync(`${OUT}/latest.json`, txt2); else console.error('Menos de 3 secciones correctas: latest.json NO se actualiza');
console.log('OK', destino, JSON.stringify(res.resumen_estados), JSON.stringify(res.items_por_seccion), 'coste', res.coste_total_estimado_usd);
