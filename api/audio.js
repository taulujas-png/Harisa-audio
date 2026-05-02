const play = require('play-dl');

// Базовые инстансы, если динамический список не загрузится
let PIPED_APIS = [
  'https://api.piped.private.coffee',
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.tokhmi.xyz'
];

const INVIDIOUS_APIS = [
  'https://invidious.projectsegfau.lt',
  'https://vid.puffyan.us',
  'https://inv.tux.pizza'
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
  console.log(`[START] v2.4 Request for videoId: ${videoId}`);

  // 1. ДИНАМИЧЕСКОЕ ОБНОВЛЕНИЕ ПИПЕДОВ
  try {
    const listRes = await fetch('https://piped-instances.kavin.rocks/', { signal: AbortSignal.timeout(3000) });
    if (listRes.ok) {
      const list = await listRes.json();
      const freshApis = list.filter(i => i.api_url).map(i => i.api_url.replace(/\/$/, ''));
      PIPED_APIS = [...new Set([...freshApis, ...PIPED_APIS])].slice(0, 15); // Берем первые 15
      console.log(`[PIPED] Loaded ${PIPED_APIS.length} dynamic instances`);
    }
  } catch (e) {
    console.log(`[PIPED] Failed to load dynamic list, using fallback`);
  }

  async function tryPiped(baseUrl) {
    const start = Date.now();
    try {
      const r = await fetch(`${baseUrl}/streams/${videoId}`, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) throw new Error(`Status ${r.status}`);
      const d = await r.json();
      const best = d.audioStreams?.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      if (!best) throw new Error('No streams');
      return {
        url: best.url,
        title: d.title,
        uploader: d.uploader,
        thumbnailUrl: d.thumbnailUrl,
        mimeType: best.mimeType,
        provider: `piped (${new URL(baseUrl).hostname})`
      };
    } catch (e) { throw e; }
  }

  async function tryInvidious(baseUrl) {
    try {
      const r = await fetch(`${baseUrl}/api/v1/videos/${videoId}`, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) throw new Error(`Status ${r.status}`);
      const d = await r.json();
      const audio = d.adaptiveFormats?.filter(f => f.type?.startsWith('audio'))[0];
      if (!audio) throw new Error('No audio formats');
      return {
        url: audio.url,
        title: d.title,
        uploader: d.author,
        thumbnailUrl: d.videoThumbnails?.find(t => t.quality === 'maxresdefault')?.url || d.videoThumbnails?.[0]?.url,
        mimeType: audio.type,
        provider: `invidious (${new URL(baseUrl).hostname})`
      };
    } catch (e) { throw e; }
  }

  const promises = [];

  // Добавляем Piped в гонку
  PIPED_APIS.forEach(url => promises.push(tryPiped(url)));
  
  // Добавляем Invidious в гонку
  INVIDIOUS_APIS.forEach(url => promises.push(tryInvidious(url)));

  // Добавляем play-dl (наш встроенный парсер)
  promises.push((async () => {
    try {
      // Пытаемся замаскироваться под Android плеер (меньше банят)
      const info = await play.video_info(youtubeUrl, { 
        userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
      });
      const itag18 = info.format.find(f => f.itag === 18);
      if (!itag18 || !itag18.url) throw new Error('No play-dl URL');
      return {
        url: itag18.url,
        title: info.video_details.title,
        uploader: info.video_details.channel?.name || 'Unknown',
        thumbnailUrl: info.video_details.thumbnails[0]?.url,
        mimeType: 'audio/mp4',
        provider: 'internal (play-dl)'
      };
    } catch (e) { throw e; }
  })());

  try {
    // Массовая гонка: кто первый, тот и папа
    const result = await Promise.any(promises);
    console.log(`[WINNER] ${result.provider}`);
    return res.status(200).json(result);
  } catch (error) {
    console.error('[FATAL] All methods failed');
    return res.status(500).json({ error: 'All extraction methods failed' });
  }
}