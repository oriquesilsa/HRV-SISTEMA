// Busca empresas (leads) perto do escritório da HRV com a Google Places API (New).
// Usa a chave GOOGLE_MAPS_KEY do servidor e só atende usuários logados no sistema (Supabase).
const SB_URL = 'https://ntesckxteqhaejzpfauo.supabase.co';
const SB_KEY = 'sb_publishable_lhXTUgR8v6fZTGvsZFzAqg_NNDQT-rQ';
const ESCRITORIO = 'Rua Aurélio Arrobas Martins, 96 - Interlagos, São Paulo - SP';
const CONSULTAS = {
  advocacia: ['escritório de advocacia', 'advogados escritório', 'sociedade de advogados'],
  imobiliaria: ['imobiliária', 'corretora de imóveis'],
  construtora: ['construtora', 'incorporadora imobiliária', 'construtora e incorporadora'],
};
const ALTO = /alto padr|luxo|premium|corporat|empresarial|incorporad|associados|sociedade|holding|engenharia/i;
const CAMPOS = 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.nationalPhoneNumber,places.websiteUri,places.editorialSummary,places.priceLevel,places.businessStatus,places.googleMapsUri,places.primaryTypeDisplayName,nextPageToken';

const dist = (a, b) => { const R = 6371, r = x => x * Math.PI / 180; const dLa = r(b.latitude - a.latitude), dLo = r(b.longitude - a.longitude);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
let origemCache = null;

async function google(key, body, mask) {
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': mask }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || 'Erro na Places API');
  return j;
}
async function emailDoSite(url) {
  if (!url) return null;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3500);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 HRV-Sistema' } });
    const html = (await r.text()).slice(0, 400000);
    const m = html.match(/mailto:([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i) || html.match(/\b[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.(?:com|br|adv|net|org)(?:\.br)?\b/i);
    const e = m ? (m[1] || m[0]).toLowerCase() : null;
    return e && !/\.(png|jpg|jpeg|gif|webp|svg)$/.test(e) && !/example|sentry|wixpress|domain\.com/.test(e) ? e : null;
  } catch { return null; } finally { clearTimeout(t); }
}
function tier(p) {
  let pts = 0; const n = p.userRatingCount || 0; const txt = `${p.displayName && p.displayName.text} ${p.editorialSummary && p.editorialSummary.text || ''}`;
  if (n >= 150) pts += 2; else if (n >= 40) pts += 1;
  if (p.websiteUri) pts += 1;
  if (ALTO.test(txt)) pts += 1;
  if (/EXPENSIVE/.test(p.priceLevel || '')) pts += 2; else if (/MODERATE/.test(p.priceLevel || '')) pts += 1;
  return pts >= 3 ? 'alto' : pts >= 1 ? 'medio' : 'baixo';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });
  const key = process.env.GOOGLE_MAPS_KEY;
  if (!key) return res.status(500).json({ erro: 'Chave do Google não configurada no servidor.' });
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!tok) return res.status(401).json({ erro: 'Entre no sistema para buscar leads.' });
  const u = await fetch(SB_URL + '/auth/v1/user', { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + tok } });
  if (!u.ok) return res.status(401).json({ erro: 'Sessão expirada. Entre de novo.' });

  let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const tipo = CONSULTAS[body.tipo] ? body.tipo : 'advocacia';
  const padrao = ['baixo', 'medio', 'alto'].includes(body.padrao) ? body.padrao : 'medio';
  const estrelas = Math.min(5, Math.max(1, Number(body.estrelas) || 1));
  const raio = Math.min(50, Math.max(1, Number(body.raio) || 10));
  try {
    if (!origemCache) {
      const o = await google(key, { textQuery: ESCRITORIO, languageCode: 'pt-BR', regionCode: 'BR', maxResultCount: 1 }, 'places.location,places.formattedAddress');
      origemCache = (o.places && o.places[0] && o.places[0].location) || { latitude: -23.6838, longitude: -46.6957 };
    }
    const origem = origemCache;
    const vistos = new Map();
    for (const q of CONSULTAS[tipo]) {
      let pageToken; let pag = 0;
      do {
        const j = await google(key, { textQuery: q, languageCode: 'pt-BR', regionCode: 'BR', pageSize: 20, pageToken,
          minRating: Math.max(0, estrelas - 0.5),
          locationBias: { circle: { center: origem, radius: Math.min(50000, raio * 1000) } } }, CAMPOS);
        (j.places || []).forEach(p => { if (!vistos.has(p.id)) vistos.set(p.id, p); });
        pageToken = j.nextPageToken; pag++;
      } while (pageToken && pag < 3 && vistos.size < 160);
      if (vistos.size >= 160) break;
    }
    let lista = [...vistos.values()]
      .filter(p => p.location && p.businessStatus !== 'CLOSED_PERMANENTLY' && (p.rating || 0) >= estrelas - 0.5)
      .map(p => { const d = dist(origem, p.location); const t = tier(p);
        const match = t === padrao ? 1 : (Math.abs(['baixo', 'medio', 'alto'].indexOf(t) - ['baixo', 'medio', 'alto'].indexOf(padrao)) === 1 ? .45 : 0);
        const score = Math.round((p.rating || 0) / 5 * 30 + Math.min(1, Math.log10((p.userRatingCount || 0) + 1) / 3) * 30 + match * 25 + Math.max(0, 1 - d / raio) * 15);
        return { id: p.id, nome: p.displayName && p.displayName.text, endereco: p.formattedAddress, lat: p.location.latitude, lng: p.location.longitude,
          km: Math.round(d * 10) / 10, nota: p.rating || null, avaliacoes: p.userRatingCount || 0, telefone: p.nationalPhoneNumber || null, site: p.websiteUri || null,
          descricao: (p.editorialSummary && p.editorialSummary.text) || (p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) || null, maps: p.googleMapsUri, padrao: t, score };
      })
      .filter(p => p.km <= raio)
      .sort((a, b) => b.score - a.score).slice(0, 50);
    const emails = await Promise.all(lista.map(p => emailDoSite(p.site)));
    lista = lista.map((p, i) => ({ ...p, email: emails[i] }));
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ origem: { lat: origem.latitude, lng: origem.longitude, endereco: ESCRITORIO }, raio, leads: lista });
  } catch (e) {
    return res.status(502).json({ erro: 'Falha na busca do Google: ' + e.message });
  }
};
