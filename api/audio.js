const play = require('play-dl');

// Список проверенных и мощных инстансов Cobalt и Piped
const PROVIDERS = [
  { type: 'cobalt', url: 'https://cobalt.canine.tools/api/json' },
  { type: 'cobalt', url: 'https://co.meowing.de/api/json' },
  { type: 'cobalt', url: 'https://api.cobalt.tools/api/json' },
  { type: 'piped', url: 'https://api.piped.private.coffee' },
  { type: 'piped', url: 'https://pipedapi.kavin.rocks' },
  { type: 'piped', url: 'https://pipedapi.tokhmi.xyz' },
  { type: 'invidious', url: 'https://invidious.projectsegfau.lt' },
  { type: 'invidious', url: 'https://vid.puffyan.us' }
];

export default async function handler(req, res) {
  // Настройка CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { videoId } = req.query;
  if (!videoId) return res.status(400).json({ error: 'Missing videoId' });

  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Функция для попытки получения через конкретный инстанс
  async function tryProvider(provider) {
    const timeout = 7000;
    if (provider.type === 'cobalt') {
      const r = await fetch(provider.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ url: youtubeUrl, isAudioOnly: true }),
        signal: AbortSignal.timeout(timeout)
      });
      if (!r.ok) throw new Error('Cobalt error');
      const d = await r.json();
      if (!d.url) throw new Error('No URL from Cobalt');
      return {
        url: d.url,
        title: d.filename || 'YouTube Audio',
        uploader: 'Cobalt',
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        mimeType: 'audio/mp4'
      };
    } else if (provider.type === 'piped') {
      const r = await fetch(`${provider.url}/streams/${videoId}`, { signal: AbortSignal.timeout(timeout) });
      if (!r.ok) throw new Error('Piped error');
      const d = await r.json();
      const best = d.audioStreams?.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      if (!best) throw new Error('No Piped streams');
      return {
        url: best.url,
        title: d.title,
        uploader: d.uploader,
        thumbnailUrl: d.thumbnailUrl,
        mimeType: best.mimeType
      };
    } else if (provider.type === 'invidious') {
      const r = await fetch(`${provider.url}/api/v1/videos/${videoId}`, { signal: AbortSignal.timeout(timeout) });
      if (!r.ok) throw new Error('Invidious error');
      const d = await r.json();
      const audio = d.adaptiveFormats?.filter(f => f.type?.startsWith('audio'))[0];
      if (!audio) throw new Error('No Invidious streams');
      return {
        url: audio.url,
        title: d.title,
        uploader: d.author,
        thumbnailUrl: d.videoThumbnails?.find(t => t.quality === 'maxresdefault')?.url || d.videoThumbnails?.[0]?.url,
        mimeType: audio.type
      };
    }
  }

  // Основная логика: пробуем инстансы группами
  try {
    // 1. Сначала пробуем Cobalt (самый стабильный для YouTube)
    const cobaltPromises = PROVIDERS.filter(p => p.type === 'cobalt').map(p => tryProvider(p).catch(() => null));
    const results = await Promise.all(cobaltPromises);
    const valid = results.find(r => r !== null);
    if (valid) return res.status(200).json(valid);

    // 2. Если Cobalt не помог, пробуем все остальные (Piped/Invidious) + play-dl одновременно
    const otherPromises = PROVIDERS.filter(p => p.type !== 'cobalt').map(p => tryProvider(p));
    
    // Добавляем play-dl как еще один вариант в гонку
    otherPromises.push((async () => {
      const info = await play.video_info(youtubeUrl);
      const itag18 = info.format.find(f => f.itag === 18); // 360p mp4 (содержит аудио и обычно не забанен)
      if (!itag18 || !itag18.url) throw new Error('No play-dl URL');
      return {
        url: itag18.url,
        title: info.video_details.title,
        uploader: info.video_details.channel?.name || 'Unknown',
        thumbnailUrl: info.video_details.thumbnails[0]?.url,
        mimeType: 'audio/mp4'
      };
    })());

    const finalResult = await Promise.any(otherPromises);
    return res.status(200).json(finalResult);

  } catch (error) {
    console.error('All methods failed:', error);
    return res.status(500).json({ error: 'All extraction methods failed' });
  }
}