// Sección «Estrategias comerciales» (compartida por los trabajadores de ChatGPT y Gemini). Node 24, sin dependencias.
import { readdirSync, readFileSync, existsSync } from 'node:fs';

export function historial(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))) {
    try { const e = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')).estrategia; if (e?.items?.[0]?.titulo) out.push(e.items[0].titulo); } catch {}
  }
  return out;
}

export function promptEstrategia(contexto, previas, quien) {
  return `${contexto}
SECCIÓN estrategia_comercial: actúas como EXPERTO en dirección comercial y marketing del sector de la construcción (tradicional e industrializada) con conocimientos de real estate (promoción, vivienda en venta y alquiler, build-to-rent, suelo, financiación, prescripción técnica, distribución de materiales). Propón UNA estrategia comercial o de marketing, concreta y aplicable por un director comercial de un fabricante de paneles sándwich industrializados para envolvente (cubierta inclinada, fachada, forjado; Galicia y norte de Portugal; ventas a través de distribución, constructoras, promotores, instaladores y prescripción a arquitectos). Ejemplos de familias de estrategia: prescripción a arquitectos y aparejadores, programas de formación en distribuidores, alianzas con promotores y constructoras de vivienda industrializada, licitaciones y contratación pública, marketing de contenidos técnicos, ferias y eventos, precios y modelos de venta (suministro más montaje), gestión de cuentas clave, captación por ciclos de promoción, financiación y garantías, posventa y prescripción cruzada.
Estrategias ya usadas por ti en semanas anteriores (NO repetir ni parafrasear): ${previas.length ? previas.map(t => '«' + t + '»').join('; ') : 'ninguna todavía'}.
REGLAS DE VERACIDAD (innegociables; un auditor independiente comprobará cada afirmación):
- Separa lo que es DATO COMPROBABLE de lo que es TU CRITERIO. Cada afirmación que presentes como hecho (cifra, estudio, caso de empresa, norma, ejemplo de mercado, resultado) va en "afirmaciones" con tipo dato | caso | norma, con fuente real que hayas abierto, url, fecha y cita literal (máx. 20 palabras) copiada del cuerpo. Si no puedes comprobarla con tu herramienta de búsqueda, NO la incluyas: nada inventado, nada recordado de memoria, ningún caso ni estadística sin fuente.
- El juicio propio (por qué crees que funcionará, hipótesis comercial) va como tipo opinion y no necesita fuente, pero no puede disfrazar datos.
- Sin competidores nombrados como ejemplo a imitar. Prohibido: Anrobox, 3DModular, Steel Tec, Zero Energetic Housing, BIOMESPACE y MATCOAM. Sin datos privados de clientes.
- Aplicable en 30-90 días, con 3-5 pasos concretos y 2-3 indicadores a medir. Nada de tópicos genéricos («escuchar al cliente», «mejorar la comunicación»).
Responde SOLO con un array JSON de UN objeto: {titulo, area (construccion_tradicional | industrializada | real_estate | transversal), tesis (2-3 frases), pasos [3-5], indicadores [2-3], afirmaciones [{texto, tipo (dato|caso|norma|opinion), medio, url, fecha, estado_lectura (COMPLETO|EXTRACTO|TITULAR), cita_literal}], por_que_no_repetida}.`;
}

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3);
const jaccard = (a, b) => { const A = new Set(norm(a)), B = new Set(norm(b)); const i = [...A].filter(x => B.has(x)).length; return A.size + B.size - i ? i / (A.size + B.size - i) : 0; };

// Solo baja de nivel; lo no comprobable queda SIN_VERIFICAR y la revista no lo publica como hecho.
export function validarEstrategia(items, previas) {
  const out = [];
  for (const it of Array.isArray(items) ? items.slice(0, 1) : []) {
    if (!it?.titulo || !Array.isArray(it.pasos)) continue;
    const notas = [];
    if (previas.some(t => jaccard(t, it.titulo) >= 0.6)) notas.push('posible repetición de una estrategia anterior');
    const afirmaciones = (Array.isArray(it.afirmaciones) ? it.afirmaciones : []).map(a => {
      if (!a || !a.texto) return null;
      const tipo = ['dato', 'caso', 'norma', 'opinion'].includes(a.tipo) ? a.tipo : 'dato';
      if (tipo === 'opinion') return { ...a, tipo, estado_lectura: null, verificacion: 'OPINION_DEL_AUTOR' };
      let est = ['COMPLETO', 'EXTRACTO', 'TITULAR'].includes(a.estado_lectura) ? a.estado_lectura : 'TITULAR';
      if (est === 'COMPLETO' && !a.cita_literal) est = 'EXTRACTO';
      const sinFuente = !a.url || !/^https?:\/\//.test(a.url);
      if (sinFuente) est = 'TITULAR';
      return { ...a, tipo, estado_lectura: est, verificacion: (est === 'COMPLETO' && !sinFuente) ? 'V1_reportado_por_IA_sin_contrastar' : 'SIN_VERIFICAR' };
    }).filter(Boolean);
    if (!afirmaciones.some(a => a.tipo !== 'opinion' && a.verificacion !== 'SIN_VERIFICAR')) notas.push('ninguna afirmación comprobable con fuente leída');
    out.push({ ...it, afirmaciones, nota_validador: notas.join('; ') || null });
  }
  return out;
}
