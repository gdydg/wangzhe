// 强制使用 Edge Runtime
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

async function getCacheData() {
  const url = process.env.SYS_DB_URL;
  const token = process.env.SYS_DB_TOKEN;
  if (!url || !token) return [];
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['GET', 'active_matches']),
      cache: 'no-store'
    });
    const resJson = await response.json();
    return resJson.result ? JSON.parse(resJson.result) : [];
  } catch (e) {
    return [];
  }
}

async function setCacheData(data) {
  const url = process.env.SYS_DB_URL;
  const token = process.env.SYS_DB_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['SET', 'active_matches', JSON.stringify(data)]),
      cache: 'no-store'
    });
  } catch (e) {}
}

export async function GET() {
  try {
    const nowMs = Date.now();
    const thirtyMinsLaterMs = nowMs + 30 * 60 * 1000;
    const twoHoursMs = 2 * 60 * 60 * 1000;
    const fourHoursAgoMs = nowMs - 4 * 60 * 60 * 1000;

    const targetUrl = 'https://zszb5.com/index.php?g=Wwapi&m=Shanmao&a=eventInfo';
    const apiResponse = await fetch(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cache: 'no-store' 
    });
    const jsonData = await apiResponse.json();
    
    const freshData = jsonData.data.map(item => {
      let timeMs = 0;
      let shortT = '00:00';
      if (item.gameTime) {
        const tStr = item.gameTime.includes('+') || item.gameTime.includes('Z') 
          ? item.gameTime 
          : `${item.gameTime}+08:00`;
        timeMs = new Date(tStr).getTime();
        shortT = item.gameTime.substring(11, 16);
      }
      return { ...item, timeMs, shortT };
    });

    // 保留了原来的 DB 缓存读取与合并逻辑
    const historyData = await getCacheData();
    const mergedMap = new Map();
    historyData.forEach(item => mergedMap.set(item.matchId, item));

    freshData.forEach(item => {
      const timeElapsed = nowMs - item.timeMs;
      if (timeElapsed >= twoHoursMs && mergedMap.has(item.matchId)) return; 
      mergedMap.set(item.matchId, item);
    });

    const finalData = Array.from(mergedMap.values()).filter(item => {
      return item.timeMs >= fourHoursAgoMs && item.timeMs <= thirtyMinsLaterMs;
    }).sort((a, b) => b.timeMs - a.timeMs);

    // 保留了原来的 DB 缓存写入逻辑
    await setCacheData(finalData);

    let content = '#EXTM3U\n';
    
    finalData.forEach(event => {
      const baseTitle = `[${event.shortT}]${event.lname}:${event.hname}_VS_${event.aname}`;
      const logo = event.hicon || ''; 

      const extractStreams = (streamNode, label) => {
        if (!streamNode) return;
        
        const processUrl = (url) => {
            if (!url) return '';
            return url.replace('qinl-play.agiaexpress.com', 'tv8.gitee.tech/qinl');
        };

        // 仅保留 m3u8 的代理拼接逻辑，剔除直连和 FLV
        if (streamNode.m3u8) {
          const proxiedUrl = processUrl(streamNode.m3u8);
          // 去除了原来判断 proxiedUrl !== streamNode.m3u8 的限制，统一只输出代理组的源
          content += `#EXTINF:-1 tvg-logo="${logo}" group-title="清流赛事",${baseTitle}(${label})\n`;
          content += `${proxiedUrl}\n`;
        }
        
        // 删除了 streamNode.flv 的所有判断和输出代码
      };

      extractStreams(event.stream, '标清');
      extractStreams(event.streamAmAli, '高清中文');
      if (event.streamNa && event.streamNa.live) {
        extractStreams(event.streamNa.live, '高清英文');
      }
    });

    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'Content-Disposition': 'inline; filename="live.m3u"',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response(`Sync Error: ${error.message}`, { status: 500 });
  }
}
