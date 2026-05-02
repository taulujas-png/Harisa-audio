const play = require('play-dl');

// Расширенный список проверенных серверов (Fallback)
const HARDCODED_PIPED = [
  'https://api.piped.private.coffee',
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.tokhmi.xyz',
  'https://pipedapi.syncpundit.io',
  'https://pipedapi.smnz.de',
  'https://api.piped.privacydev.net',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.astartes.nl'
];

const HARDCODED_INVIDIOUS = [
  'https://invidious.projectsegfau.lt',
  'https://vid.puffyan.us',
  'https://inv.tux.pizza',
  'https://invidious.nerdvpn.de',
  'https://invidious.flokinet.to',
  'https://iv.melmac.space',
  'https://yt.artemislena.eu'
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { videoId } = req.query;
  if (!videoId) return res.status(400).json({ error: 'Missing videoId' });

  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  console.log(`[START] v2.5 Request: ${videoId}`);

  // 1. Пытаемся получить динамический список
  let pipedApis = [...HARDCODED_PIPED];
  try {
    const listRes = await fetch('https://piped-instances.kavin.rocks/', { signal: AbortSignal.timeout(2500) });
    if (listRes.ok) {
      const list = await listRes.json();
      const fresh = list.filter(i => i.api_url).map(i => i.api_url.replace(/\/$/, ''));
      pipedApis = [...new Set([...fresh, ...pipedApis])];
      console.log(`[PIPED] Discovery success. Total: ${pipedApis.length}`);
    }
  } catch (e) {
    console.log(`[PIPED] Discovery failed, using hardcoded`);
  }

  async function tryPiped(baseUrl) {
    const name = new URL(baseUrl).hostname;
    try {
      const r = await fetch(`${baseUrl}/streams/${videoId}`, { signal: AbortSignal.timeout(6500) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const best = d.audioStreams?.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      if (!best) throw new Error('No audio');
      return {
        url: best.url,
        title: d.title,
        uploader: d.uploader,
        thumbnailUrl: d.thumbnailUrl,
        mimeType: best.mimeType,
        provider: `piped (${name})`
      };
    } catch (e) {
      console.log(`[FAIL] Piped (${name}): ${e.message}`);
      throw e;
    }
  }

  async function tryInvidious(baseUrl) {
    const name = new URL(baseUrl).hostname;
    try {
      const r = await fetch(`${baseUrl}/api/v1/videos/${videoId}`, { signal: AbortSignal.timeout(6500) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const audio = d.adaptiveFormats?.filter(f => f.type?.startsWith('audio'))[0];
      if (!audio) throw new Error('No audio');
      return {
        url: audio.url,
        title: d.title,
        uploader: d.author,
        thumbnailUrl: d.videoThumbnails?.find(t => t.quality === 'maxresdefault')?.url || d.videoThumbnails?.[0]?.url,
        mimeType: audio.type,
        provider: `invidious (${name})`
      };
    } catch (e) {
      console.log(`[FAIL] Invidious (${name}): ${e.message}`);
      throw e;
    }
  }

  const promises = [];

  // Ограничиваем количество серверов для гонки, чтобы не перегружать Vercel (берем топ 12)
  pipedApis.slice(0, 10).forEach(url => promises.push(tryPiped(url)));
  HARDCODED_INVIDIOUS.slice(0, 5).forEach(url => promises.push(tryInvidious(url)));

  // play-dl (Direct)
  promises.push((async () => {
    try {
      const info = await play.video_info(youtubeUrl, { 
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      });
      // Ищем itag 18 или любой аудио-формат с готовым URL
      const best = info.format.find(f => f.url && (f.itag === 18 || (f.mimeType?.startsWith('audio/'))));
      if (!best || !best.url) throw new Error('No direct URL');
      return {
        url: best.url,
        title: info.video_details.title,
        uploader: info.video_details.channel?.name || 'Unknown',
        thumbnailUrl: info.video_details.thumbnails[0]?.url,
        mimeType: best.mimeType,
        provider: 'internal (play-dl)'
      };
    } catch (e) {
      console.log(`[FAIL] play-dl: ${e.message}`);
      throw e;
    }
  })());

  try {
    const result = await Promise.any(promises);
    console.log(`[WINNER] ${result.provider}`);
    return res.status(200).json(result);
  } catch (error) {
    console.error('[FATAL] All 15+ methods failed or timed out.');
    return res.status(500).json({ error: 'All extraction methods failed' });
  }
}