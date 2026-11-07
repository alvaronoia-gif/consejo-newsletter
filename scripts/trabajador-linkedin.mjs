// Trabajador de ChatGPT para LinkedIn: propone 2 candidatos de post en la voz de Álvaro. Node 24, sin dependencias.
// Escribe buzon/linkedin/latest.json. La guía de estilo llega por secreto (ESTILO_ALVARO) y NUNCA se escribe en la salida.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
const OUT = 'buzon/linkedin'; mkdirSync(OUT, { recursive: true });
const KEY = process.env.OPENAI_API_KEY, ESTILO = process.env.ESTILO_ALVARO;
const MODEL = process.env.OPENAI_MODEL || 'gpt-6.1-sol';
const PRICE_IN = Number(process.env.OPENAI_PRICE_IN_PER_M || 2), PRICE_OUT = Number(process.env.OPENAI_PRICE_OUT_PER_M || 10);
const FORCE = process.env.FORCE === 'true';
if (!KEY) { console.error('Falta OPENAI_API_KEY'); process.exit(1); }
if (!ESTILO || ESTILO.length < 200) { console.error('Falta el secreto ESTILO_ALVARO: no se escribe sin su voz'); process.exit(1); }
const hoy = new Date().toISOString().slice(0, 10);
const destino = `${OUT}/${hoy}.json`;
if (existsSync(destino) && !FORCE) { console.log('Ya existe', destino); process.exit(0); }

const PROMPT = `Eres redactor de LinkedIn de Álvaro Mariño, Director Comercial de Thermochip (paneles sándwich industrializados para toda la envolvente: cubierta inclinada, fachada, forjado y cubierta plana; Galicia y norte de Portugal). Hoy es ${hoy}. Escribe en español, EN SU VOZ, con esta guía:
<guia_de_estilo>
${ESTILO}
</guia_de_estilo>
TAREA: propón DOS candidatos de post para el martes que viene, con formatos distintos. Foco: proyectos originales de construcción industrializada (casos, obras o sistemas poco contados; la arquitectura no queda limitada) o una noticia del sector SOLO de España o Portugal con enfoque propio. Busca lo que casi nadie cuenta. Los posts forman una cadena: serie con capítulos y un gancho final.
REGLAS:
- Usa la búsqueda web. Cada dato (cifra, fecha, nombre, cita, estado de una obra) debe venir de una fuente que hayas abierto. Si no puedes comprobarlo, no lo uses. Nada inventado, sin historias personales inventadas.
- Original, divertido y con un punto disruptivo en el mensaje, sin faltar a nadie ni usar tópicos gastados (falta de mano de obra, "hay que industrializar", plazos, ahorro de costes).
- Texto: 700-1.000 caracteres incluidos hashtags (3-5, uno de la serie), gancho en las dos primeras líneas, párrafos de 1-2 líneas, 1-2 palabras en MAYÚSCULAS, 1-3 emojis, sin enlaces en el texto.
- CIERRE: nunca una pregunta ni una pregunta abierta. Termina con un adelanto afirmativo de la semana siguiente ("La semana que viene: ...").
- Thermochip solo como consecuencia natural, en una frase como mucho: se adapta a cualquier estructura (madera, acero, LSF, 2D, 3D o in situ), industrialización abierta. Sin claims técnicos inventados. Nunca nombres ni propongas competidores ni fabricantes de paneles o sistemas de envolvente.
- Prohibido: Anrobox, 3DModular, Steel Tec, Zero Energetic Housing, BIOMESPACE y MATCOAM.
Responde SOLO con un array JSON de 2 objetos: {formato, tema, texto, caracteres, gancho_siguiente, imagen_prompt_en (prompt en inglés para imagen fotorrealista sin texto ni logos), datos:[{dato, medio, url, fecha, estado_lectura (COMPLETO|EXTRACTO|TITULAR), cita_literal (máx. 20 palabras copiadas del cuerpo, o null)}], por_que_es_original}.`;

const t0 = Date.now(); let intento = 0, j, raw;
while (true) {
  const r = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, input: PROMPT, tools: [{ type: 'web_search' }], tool_choice: 'auto', store: false, max_output_tokens: 20000 }) });
  raw = await r.text(); try { j = JSON.parse(raw); } catch { j = {}; }
  if (r.status === 429 && intento < 4) { await new Promise(s => setTimeout(s, 20000 * ++intento)); continue; }
  if (!r.ok) { console.error('OpenAI HTTP', r.status, raw.slice(0, 300)); process.exit(1); }
  break;
}
const text = (j.output || []).filter(o => o.type === 'message').flatMap(o => o.content || []).map(c => c.text || '').join('\n');
const searches = (j.output || []).filter(o => o.type === 'web_search_call').length;
const u = j.usage || {}; const coste = ((u.input_tokens || 0) * PRICE_IN + (u.output_tokens || 0) * PRICE_OUT) / 1e6;
let c = []; const m = text.match(/\[[\s\S]*\]/); try { c = JSON.parse(m ? m[0] : text); } catch { console.error('Respuesta no es JSON'); process.exit(1); }
const avisos = [];
const candidatos = (Array.isArray(c) ? c : []).filter(x => x && x.texto).slice(0, 2).map(x => {
  const n = [...String(x.texto)].length; const nota = [];
  if (n < 600 || n > 1100) nota.push(`longitud ${n} fuera de 700-1000`);
  if (/\?\s*(#\S+\s*)*$/.test(String(x.texto).trim())) nota.push('termina en pregunta');
  const datos = (x.datos || []).map(d => {
    let est = ['COMPLETO', 'EXTRACTO', 'TITULAR'].includes(d.estado_lectura) ? d.estado_lectura : 'TITULAR';
    if (est === 'COMPLETO' && !d.cita_literal) est = 'EXTRACTO';
    if (!d.url || !/^https?:\/\//.test(d.url)) est = 'TITULAR';
    return { ...d, estado_lectura: est };
  });
  return { ...x, caracteres: n, datos, verificacion: 'V1_reportado_por_IA_sin_contrastar', nota_validador: nota.join('; ') || null };
});
if (!searches) avisos.push('Sin búsquedas web registradas: tratar datos como no leídos');
const res = { schema: 'consejo-newsletter/linkedin-chatgpt/1', generado: new Date().toISOString(), modelo: MODEL, busquedas: searches, coste_total_estimado_usd: Number(coste.toFixed(4)), segundos: (Date.now() - t0) / 1000, avisos, candidatos };
const s = JSON.stringify(res, null, 1);
writeFileSync(destino, s);
if (candidatos.length) writeFileSync(`${OUT}/latest.json`, s);
console.log('OK', candidatos.length, 'candidatos', res.coste_total_estimado_usd, 'USD', searches, 'búsquedas');
