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

  const promises = [];

  // 1. Piped
  for (const base of PIPED_INSTANCES) {
    promises.push((async () => {
      const response = await fetch(`${base}/streams/${videoId}`, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error('Piped Error');
      const data = await response.json();
      if (!data || !data.audioStreams || data.audioStreams.length === 0) throw new Error('No Piped Audio');
      const best = data.audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0)).find(s => s.mimeType?.includes('mp4')) || data.audioStreams[0];
      return {
        provider: 'piped',
        title: data.title,
        uploader: data.uploader,
        thumbnailUrl: data.thumbnailUrl,
        url: best.url,
        mimeType: best.mimeType,
        bitrate: best.bitrate
      };
    })());
  }

  // 2. Invidious
  for (const base of INVIDIOUS_INSTANCES) {
    promises.push((async () => {
      const response = await fetch(`${base}/api/v1/videos/${videoId}`, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error('Invidious Error');
      const data = await response.json();
      if (!data || !data.adaptiveFormats || data.adaptiveFormats.length === 0) throw new Error('No Invidious Audio');
      const audioStreams = data.adaptiveFormats.filter(f => f.type && f.type.startsWith('audio'));
      if (audioStreams.length === 0) throw new Error('No Invidious Audio Streams');
      const best = audioStreams.sort((a, b) => parseInt(b.bitrate || '0') - parseInt(a.bitrate || '0'))[0];
      return {
        provider: 'invidious',
        title: data.title,
        uploader: data.author,
        thumbnailUrl: data.videoThumbnails?.find(t => t.quality === 'maxresdefault' || t.quality === 'high')?.url,
        url: best.url,
        mimeType: best.type,
        bitrate: parseInt(best.bitrate || '0')
      };
    })());
  }

  // 3. Cobalt
  for (const base of COBALT_INSTANCES) {
    promises.push((async () => {
      const response = await fetch(`${base}/api/json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ url: youtubeUrl, isAudioOnly: true }),
        signal: AbortSignal.timeout(6000)
      });
      if (!response.ok) throw new Error('Cobalt Error');
      const data = await response.json();
      if (!data || !data.url) throw new Error('No Cobalt Audio');
      return {
        provider: 'cobalt',
        title: 'YouTube Audio',
        uploader: 'Unknown',
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        url: data.url,
        mimeType: 'audio/mp4',
        bitrate: 128000
      };
    })());
  }

  // 4. play-dl
  promises.push((async () => {
    const info = await play.video_info(youtubeUrl);
    const audioFormats = info.format.filter(f => f.mimeType && f.mimeType.startsWith('audio/'));
    if (audioFormats.length === 0) throw new Error('No play-dl Audio');
    const best = audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0)).find(f => f.mimeType.includes('mp4')) || audioFormats[0];
    return {
      provider: 'play-dl',
      title: info.video_details.title,
      uploader: info.video_details.channel?.name || 'Unknown',
      thumbnailUrl: info.video_details.thumbnails[info.video_details.thumbnails.length - 1]?.url,
      url: best.url,
      mimeType: best.mimeType,
      bitrate: best.bitrate || 128000
    };
  })());

  try {
    // Ждем первого успешного ответа
    const result = await Promise.any(promises);
    return res.status(200).json(result);
  } catch (error) {
    console.error('All extraction methods failed or timed out:', error);
    return res.status(500).json({ error: 'All extraction methods failed' });
  }
}