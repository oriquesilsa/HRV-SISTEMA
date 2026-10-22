// Calcula distância (km) e pedágios entre dois endereços com a Google Routes API.
// A chave fica na variável de ambiente GOOGLE_MAPS_KEY (nunca no navegador).
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });
  const key = process.env.GOOGLE_MAPS_KEY;
  if (!key) return res.status(500).json({ erro: 'Chave do Google Maps não configurada no servidor.' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { origem, destino } = body || {};
  if (!origem || !destino) return res.status(400).json({ erro: 'Informe origem e destino.' });
  try {
    const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.travelAdvisory.tollInfo',
      },
      body: JSON.stringify({
        origin: { address: origem },
        destination: { address: destino },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
        extraComputations: ['TOLLS'],
        routeModifiers: { vehicleInfo: { emissionType: 'GASOLINE' } },
        languageCode: 'pt-BR',
        regionCode: 'BR',
      }),
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ erro: (j.error && j.error.message) || 'Erro na Routes API.' });
    const rota = j.routes && j.routes[0];
    if (!rota) return res.status(404).json({ erro: 'Nenhuma rota encontrada entre os endereços.' });
    const preco = rota.travelAdvisory && rota.travelAdvisory.tollInfo && rota.travelAdvisory.tollInfo.estimatedPrice;
    const brl = (preco || []).find(p => p.currencyCode === 'BRL') || (preco || [])[0];
    const pedagio = brl ? Number(brl.units || 0) + Number(brl.nanos || 0) / 1e9 : 0;
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ km: rota.distanceMeters / 1000, duracao: rota.duration, pedagio, pedagioInformado: !!brl });
  } catch (e) {
    return res.status(500).json({ erro: 'Falha ao consultar o Google: ' + e.message });
  }
};
