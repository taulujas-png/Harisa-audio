const play = require('play-dl');

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
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { videoId } = req.query;
  if (!videoId) return res.status(400).json({ error: 'Missing videoId' });

  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  console.log(`[START] Request for videoId: ${videoId}`);

  async function tryProvider(provider) {
    const timeout = 7500;
    const start = Date.now();
    try {
      console.log(`[TRY] ${provider.type} at ${provider.url}`);
      
      if (provider.type === 'cobalt') {
        const r = await fetch(provider.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ url: youtubeUrl, isAudioOnly: true }),
          signal: AbortSignal.timeout(timeout)
        });
        if (!r.ok) throw new Error(`Status ${r.status}`);
        const d = await r.json();
        if (!d.url) throw new Error('No URL in response');
        console.log(`[SUCCESS] ${provider.type} in ${Date.now() - start}ms`);
        return {
          url: d.url,
          title: d.filename || 'YouTube Audio',
          uploader: 'Cobalt',
          thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          mimeType: 'audio/mp4',
          provider: `cobalt (${new URL(provider.url).hostname})`
        };
      } else if (provider.type === 'piped') {
        const r = await fetch(`${provider.url}/streams/${videoId}`, { signal: AbortSignal.timeout(timeout) });
        if (!r.ok) throw new Error(`Status ${r.status}`);
        const d = await r.json();
        const best = d.audioStreams?.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
        if (!best) throw new Error('No audio streams');
        console.log(`[SUCCESS] ${provider.type} in ${Date.now() - start}ms`);
        return {
          url: best.url,
          title: d.title,
          uploader: d.uploader,
          thumbnailUrl: d.thumbnailUrl,
          mimeType: best.mimeType,
          provider: `piped (${new URL(provider.url).hostname})`
        };
      } else if (provider.type === 'invidious') {
        const r = await fetch(`${provider.url}/api/v1/videos/${videoId}`, { signal: AbortSignal.timeout(timeout) });
        if (!r.ok) throw new Error(`Status ${r.status}`);
        const d = await r.json();
        const audio = d.adaptiveFormats?.filter(f => f.type?.startsWith('audio'))[0];
        if (!audio) throw new Error('No audio formats');
        console.log(`[SUCCESS] ${provider.type} in ${Date.now() - start}ms`);
        return {
          url: audio.url,
          title: d.title,
          uploader: d.author,
          thumbnailUrl: d.videoThumbnails?.find(t => t.quality === 'maxresdefault')?.url || d.videoThumbnails?.[0]?.url,
          mimeType: audio.type,
          provider: `invidious (${new URL(provider.url).hostname})`
        };
      }
    } catch (e) {
      console.log(`[FAILED] ${provider.type} (${new URL(provider.url).hostname}): ${e.message}`);
      throw e;
    }
  }

  try {
    const cobaltPromises = PROVIDERS.filter(p => p.type === 'cobalt').map(p => tryProvider(p).catch(() => null));
    const results = await Promise.all(cobaltPromises);
    const valid = results.find(r => r !== null);
    if (valid) return res.status(200).json(valid);

    console.log(`[STAGE 2] Cobalt failed, racing others...`);
    const otherPromises = PROVIDERS.filter(p => p.type !== 'cobalt').map(p => tryProvider(p));
    
    otherPromises.push((async () => {
      const start = Date.now();
      try {
        console.log(`[TRY] play-dl (Direct)`);
        const info = await play.video_info(youtubeUrl);
        const itag18 = info.format.find(f => f.itag === 18);
        if (!itag18 || !itag18.url) throw new Error('No URL for itag 18');
        console.log(`[SUCCESS] play-dl in ${Date.now() - start}ms`);
        return {
          url: itag18.url,
          title: info.video_details.title,
          uploader: info.video_details.channel?.name || 'Unknown',
          thumbnailUrl: info.video_details.thumbnails[0]?.url,
          mimeType: 'audio/mp4',
          provider: 'play-dl (Vercel)'
        };
      } catch (e) {
        console.log(`[FAILED] play-dl: ${e.message}`);
        throw e;
      }
    })());

    const finalResult = await Promise.any(otherPromises);
    return res.status(200).json(finalResult);

  } catch (error) {
    console.error('[CRITICAL] All extraction methods exhausted');
    return res.status(500).json({ error: 'All extraction methods failed' });
  }
}