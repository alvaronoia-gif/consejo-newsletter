// Prueba de acceso a prensa por API con búsqueda web. Sin dependencias. Node 24.
import { writeFileSync, mkdirSync } from 'node:fs';
const OUT = 'results'; mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const que = (process.env.QUE || 'ambas').toLowerCase();

const PROMPT = `Eres un analista de prensa económica y de construcción en España y el norte de Portugal. Hoy es ${new Date().toISOString().slice(0,10)}.
Para CADA uno de estos medios busca con tu herramienta de búsqueda web UNA noticia publicada en los últimos 4 días sobre construcción, vivienda, industria o economía en España: El País, Expansión, Cinco Días, elEconomista, Europa Press, El Confidencial, La Voz de Galicia, Faro de Vigo, Alimarket, Construible.
Para cada medio devuelve una línea JSON con: medio, titular, url, fecha, estado_lectura y cita_literal.
estado_lectura SOLO puede ser: COMPLETO (abriste y leíste el cuerpo), EXTRACTO (solo entradilla o fragmento), TITULAR (solo titular/snippet del buscador), BLOQUEADO (no se puede abrir), NO_ENCONTRADO.
cita_literal: una frase COPIADA literalmente del cuerpo de la noticia (máx. 20 palabras) como prueba de que la leíste; si no pudiste leer el cuerpo, pon null. NO inventes citas ni noticias: si no puedes, dilo con el estado que corresponda.
Responde solo con un array JSON.`;

async function openai() {
  const model = process.env.OPENAI_MODEL || 'gpt-6.1-sol';
  const t0 = Date.now();
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model, input: PROMPT, tools: [{ type: 'web_search' }], tool_choice: 'auto', store: false, max_output_tokens: 16000 }),
  });
  const raw = await r.text();
  writeFileSync(`${OUT}/${stamp}-openai-raw.json`, raw);
  let j = {}; try { j = JSON.parse(raw); } catch {}
  const text = (j.output || []).filter(o => o.type === 'message').flatMap(o => o.content || []).map(c => c.text || '').join('\n');
  const searches = (j.output || []).filter(o => o.type === 'web_search_call').length;
  writeFileSync(`${OUT}/${stamp}-openai.md`, `# OpenAI · ${model}\nHTTP ${r.status} · ${(Date.now()-t0)/1000}s · búsquedas: ${searches} · uso: ${JSON.stringify(j.usage || null)}\n\n${text || raw.slice(0, 2000)}\n`);
  console.log('openai', r.status, 'búsquedas', searches);
}

async function gemini() {
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const t0 = Date.now();
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: PROMPT }] }], tools: [{ google_search: {} }] }),
  });
  const raw = await r.text();
  writeFileSync(`${OUT}/${stamp}-gemini-raw.json`, raw);
  let j = {}; try { j = JSON.parse(raw); } catch {}
  const c = j.candidates?.[0];
  const text = (c?.content?.parts || []).map(p => p.text || '').join('\n');
  const queries = c?.groundingMetadata?.webSearchQueries || [];
  const sources = (c?.groundingMetadata?.groundingChunks || []).map(g => g.web?.uri).filter(Boolean);
  writeFileSync(`${OUT}/${stamp}-gemini.md`, `# Gemini · ${model}\nHTTP ${r.status} · ${(Date.now()-t0)/1000}s · búsquedas: ${queries.length} · uso: ${JSON.stringify(j.usageMetadata || null)}\n\nConsultas: ${JSON.stringify(queries)}\nFuentes: ${JSON.stringify(sources)}\n\n${text || raw.slice(0, 2000)}\n`);
  console.log('gemini', r.status, 'búsquedas', queries.length);
}

const jobs = [];
if (que !== 'gemini') jobs.push(openai().catch(e => { writeFileSync(`${OUT}/${stamp}-openai-error.txt`, String(e)); console.error(e); }));
if (que !== 'openai') jobs.push(gemini().catch(e => { writeFileSync(`${OUT}/${stamp}-gemini-error.txt`, String(e)); console.error(e); }));
await Promise.all(jobs);
