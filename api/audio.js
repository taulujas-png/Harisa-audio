const play = require('play-dl');

const COBALT_INSTANCES = [
  'https://api.cobalt.tools',
  'https://co.wuk.sh',
  'https://api.cobalt.buss.lol'
];

const PIPED_INSTANCES = [
  'https://api.piped.private.coffee',
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.tokhmi.xyz'
];

const INVIDIOUS_INSTANCES = [
  'https://vid.puffyan.us',
  'https://invidious.projectsegfau.lt',
  'https://yt.artemislena.eu'
];

export default async function handler(req, res) {
  // Настройка CORS для API
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { videoId } = req.query;
  if (!videoId) {
    return res.status(400).json({ error: 'Missing videoId parameter' });
  }

  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // 1. Пробуем Piped (Серверный запрос обходит CORS)
  for (const base of PIPED_INSTANCES) {
    try {
      const response = await fetch(`${base}/streams/${videoId}`, { signal: AbortSignal.timeout(4000) });
      if (response.ok) {
        const data = await response.json();
        if (data && data.audioStreams && data.audioStreams.length > 0) {
          const best = data.audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0)).find(s => s.mimeType?.includes('mp4')) || data.audioStreams[0];
          return res.status(200).json({
            provider: 'piped',
            title: data.title,
            uploader: data.uploader,
            thumbnailUrl: data.thumbnailUrl,
            url: best.url,
            mimeType: best.mimeType,
            bitrate: best.bitrate
          });
        }
      }
    } catch (e) { /* ignore and try next */ }
  }

  // 2. Пробуем Invidious (Серверный запрос обходит CORS)
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const response = await fetch(`${base}/api/v1/videos/${videoId}`, { signal: AbortSignal.timeout(4000) });
      if (response.ok) {
        const data = await response.json();
        if (data && data.adaptiveFormats && data.adaptiveFormats.length > 0) {
          const audioStreams = data.adaptiveFormats.filter(f => f.type && f.type.startsWith('audio'));
          if (audioStreams.length > 0) {
            const best = audioStreams.sort((a, b) => parseInt(b.bitrate || '0') - parseInt(a.bitrate || '0'))[0];
            return res.status(200).json({
              provider: 'invidious',
              title: data.title,
              uploader: data.author,
              thumbnailUrl: data.videoThumbnails?.find(t => t.quality === 'maxresdefault' || t.quality === 'high')?.url,
              url: best.url,
              mimeType: best.type,
              bitrate: parseInt(best.bitrate || '0')
            });
          }
        }
      }
    } catch (e) { /* ignore and try next */ }
  }

  // 3. Пробуем Cobalt (Требует POST запрос, обходим CORS)
  for (const base of COBALT_INSTANCES) {
    try {
      const response = await fetch(`${base}/api/json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ url: youtubeUrl, isAudioOnly: true }),
        signal: AbortSignal.timeout(5000)
      });
      if (response.ok) {
        const data = await response.json();
        if (data && data.url) {
          return res.status(200).json({
            provider: 'cobalt',
            title: 'YouTube Audio', // Cobalt не всегда возвращает мету в audio mode
            uploader: 'Unknown',
            thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            url: data.url,
            mimeType: 'audio/mp4',
            bitrate: 128000
          });
        }
      }
    } catch (e) { /* ignore and try next */ }
  }

  // 4. Fallback: play-dl (Запасной вариант на сервере)
  try {
    const info = await play.video_info(youtubeUrl);
    const audioFormats = info.format.filter(f => f.mimeType && f.mimeType.startsWith('audio/'));
    if (audioFormats.length > 0) {
      const best = audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0)).find(f => f.mimeType.includes('mp4')) || audioFormats[0];
      return res.status(200).json({
        provider: 'play-dl',
        title: info.video_details.title,
        uploader: info.video_details.channel?.name || 'Unknown',
        thumbnailUrl: info.video_details.thumbnails[info.video_details.thumbnails.length - 1]?.url,
        url: best.url,
        mimeType: best.mimeType,
        bitrate: best.bitrate || 128000
      });
    }
  } catch (error) {
    console.error('play-dl error:', error);
  }

  // Если всё упало
  return res.status(500).json({ error: 'All extraction methods failed' });
}