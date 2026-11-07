// Trabajador de ChatGPT para la revista NEWSLETTER. Node 24, sin dependencias.
// Una edición = hasta 2 llamadas a la API de OpenAI (prensa general + productos en cartera). Escribe en buzon/chatgpt/.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const OUT = 'buzon/chatgpt'; mkdirSync(OUT, { recursive: true });
const KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-6.1-sol';
const PRICE_IN = Number(process.env.OPENAI_PRICE_IN_PER_M || 2), PRICE_OUT = Number(process.env.OPENAI_PRICE_OUT_PER_M || 10);
const MAX_USD = Number(process.env.MAX_USD_POR_EDICION || 2);
const FORCE = process.env.FORCE === 'true';
const PRODUCTOS_URL = 'https://raw.githubusercontent.com/alvaronoia-gif/invlab-productos-publico/main/productos_comprados.json';
if (!KEY) { console.error('Falta OPENAI_API_KEY'); process.exit(1); }

const hoy = new Date().toISOString().slice(0, 10);
const destino = `${OUT}/${hoy}.json`;
if (existsSync(destino) && !FORCE) { console.log('Ya existe', destino, '- nada que hacer'); process.exit(0); }

const ESTADOS = ['COMPLETO', 'EXTRACTO', 'TITULAR', 'BLOQUEADO', 'NO_ENCONTRADO'];
const REGLAS = `Reglas de integridad (innegociables):
- Usa SOLO tu herramienta de búsqueda web. No inventes noticias, URLs, cifras, citas ni fechas. Si no encuentras algo, no lo incluyas o márcalo con el estado que corresponda.
- Cada elemento: medio, titular (tal cual), url (la real que abriste), fecha (AAAA-MM-DD), estado_lectura, cita_literal, resumen, tema, relevancia.
- estado_lectura SOLO: COMPLETO (abriste y leíste el cuerpo), EXTRACTO (solo entradilla o fragmento), TITULAR (solo titular o resultado del buscador), BLOQUEADO (no se puede abrir; en ese caso NO resumas más allá del titular visible).
- cita_literal: frase copiada literalmente del cuerpo (máx. 20 palabras) como prueba de lectura; null si no leíste el cuerpo. Si es null, el estado NO puede ser COMPLETO.
- resumen: 2-3 frases con tus palabras, SOLO con datos que aparezcan en lo que leíste. Si el estado es TITULAR o BLOQUEADO, resumen = null.
- tema: construccion | vivienda | industria | economia | inversion | energia | portugal | otros.
- relevancia: una frase sobre por qué importa a un director comercial de paneles sándwich industrializados para envolvente (Thermochip, Galicia y norte de Portugal).
- Solo noticias de los últimos 5 días. Sin duplicados.
Responde SOLO con un array JSON.`;

const PROMPT_GENERAL = `Hoy es ${hoy}. Eres analista de prensa para una revista bisemanal sobre construcción industrializada, vivienda, industria, economía e inversión en España y el norte de Portugal.
Cubre prensa generalista y económica: El País, Cinco Días, Expansión, elEconomista, Europa Press, El Confidencial, La Voz de Galicia, Faro de Vigo y, si puedes, prensa económica portuguesa (Eco, Jornal de Negócios, Público). Aporta entre 12 y 20 noticias, las más relevantes y con la mejor lectura posible (prioriza las que puedas leer COMPLETO). Incluye al menos 3 de Galicia o norte de Portugal si las hay.
${REGLAS}`;

async function productos() {
  try {
    const r = await fetch(PRODUCTOS_URL); if (!r.ok) return { status: 'UNAVAILABLE', products: [] };
    const j = await r.json(); return { status: j.status, products: Array.isArray(j.products) ? j.products : [] };
  } catch { return { status: 'UNAVAILABLE', products: [] }; }
}
const promptProductos = (lista) => `Hoy es ${hoy}. Busca noticias recientes (últimos 7 días) sobre estos productos de inversión, SOLO noticias, tendencias y competidores (nada de recomendaciones de compra ni datos de cartera):
${lista.map(p => `- ${p.name} (${p.isin})`).join('\n')}
Aporta hasta 2 noticias por producto (si es un fondo/ETF, noticias del índice o la categoría y de su gestora). Añade a cada elemento el campo "producto" con el nombre exacto de la lista.
${REGLAS}`;

async function llamar(prompt) {
  const t0 = Date.now();
  const r = await fetch('https://api.openai.com/v1/responses', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, input: prompt, tools: [{ type: 'web_search' }], tool_choice: 'auto', store: false, max_output_tokens: 20000 }) });
  const raw = await r.text(); let j = {}; try { j = JSON.parse(raw); } catch {}
  if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}: ${raw.slice(0, 300)}`);
  const text = (j.output || []).filter(o => o.type === 'message').flatMap(o => o.content || []).map(c => c.text || '').join('\n');
  const searches = (j.output || []).filter(o => o.type === 'web_search_call').length;
  const u = j.usage || {}; const coste = ((u.input_tokens || 0) * PRICE_IN + (u.output_tokens || 0) * PRICE_OUT) / 1e6;
  let items = []; const m = text.match(/\[[\s\S]*\]/);
  try { items = JSON.parse(m ? m[0] : text); } catch { throw new Error('Respuesta no es JSON válido'); }
  return { items, searches, usage: u, coste_estimado_usd: Number(coste.toFixed(4)), segundos: (Date.now() - t0) / 1000 };
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

const res = { schema: 'consejo-newsletter/chatgpt/1', generado: new Date().toISOString(), edicion_fecha: hoy, modelo: MODEL, rol: 'prensa general y economia (lector 2)', general: null, productos: null, coste_total_estimado_usd: 0, avisos: [] };
const g = await llamar(PROMPT_GENERAL);
res.general = { ...g, items: validar(g.items) }; res.coste_total_estimado_usd += g.coste_estimado_usd;
if (res.coste_total_estimado_usd > MAX_USD) res.avisos.push('Coste por encima del tope: se omite la parte de productos');
else {
  const p = await productos();
  if (p.status === 'OK' && p.products.length) {
    try { const q = await llamar(promptProductos(p.products)); res.productos = { status: 'OK', ...q, items: validar(q.items) }; res.coste_total_estimado_usd += q.coste_estimado_usd; }
    catch (e) { res.productos = { status: 'ERROR' }; res.avisos.push('Productos: ' + e.message); }
  } else res.productos = { status: p.status, items: [] };
}
res.coste_total_estimado_usd = Number(res.coste_total_estimado_usd.toFixed(4));
const cuenta = (a) => a.reduce((m, i) => (m[i.estado_lectura] = (m[i.estado_lectura] || 0) + 1, m), {});
res.resumen_estados = cuenta([...res.general.items, ...(res.productos?.items || [])]);
const txt = JSON.stringify(res, null, 1);
writeFileSync(destino, txt); writeFileSync(`${OUT}/latest.json`, txt);
console.log('OK', destino, JSON.stringify(res.resumen_estados), 'coste', res.coste_total_estimado_usd);
