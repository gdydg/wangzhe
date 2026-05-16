// 强制使用 Edge Runtime
export const runtime = 'edge';

// 安全获取 KV 数据库实例
function getCacheDB() {
  if (typeof globalThis !== 'undefined' && globalThis.MATCH_KV) {
    return globalThis.MATCH_KV;
  }
  if (typeof process !== 'undefined' && process.env && process.env.MATCH_KV) {
    return process.env.MATCH_KV;
  }
  return null;
}

export async function GET() {
  try {
    const nowMs = Date.now();
    const thirtyMinsLaterMs = nowMs + 30 * 60 * 1000;
    const twoHoursMs = 2 * 60 * 60 * 1000;
    const fourHoursAgoMs = nowMs - 4 * 60 * 60 * 1000; 

    // 1. 拉取外部目标源站数据
    const targetUrl = 'https://zszb5.com/index.php?g=Wwapi&m=Shanmao&a=eventInfo';
    const apiResponse = await fetch(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cache: 'no-store' 
    });
    const jsonData = await apiResponse.json();
    
    // 数据预处理
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

    // 2. 读取 KV 存储 (使用原名 MATCH_KV 和 active_matches)
    const cacheDB = getCacheDB();
    let historyData = [];
    if (cacheDB) {
      try {
        historyData = await cacheDB.get('active_matches', { type: 'json' }) || [];
      } catch (e) {
        console.error('Cache read error:', e);
      }
    }

    // 3. 数据合并与 2 小时锁定逻辑
    const mergedMap = new Map();
    historyData.forEach(item => mergedMap.set(item.matchId, item));

    freshData.forEach(item => {
      const timeElapsed = nowMs - item.timeMs;
      if (timeElapsed >= twoHoursMs && mergedMap.has(item.matchId)) {
        return; 
      }
      mergedMap.set(item.matchId, item);
    });

    // 4. 数据清洗 (4 小时后清理)
    const finalData = Array.from(mergedMap.values()).filter(item => {
      if (item.timeMs >= fourHoursAgoMs && item.timeMs <= thirtyMinsLaterMs) {
        return true;
      }
      return false;
    }).sort((a, b) => b.timeMs - a.timeMs);

    // 5. 写回 KV
    if (cacheDB) {
      await cacheDB.put('active_matches', JSON.stringify(finalData));
    }

    // 6. 生成 M3U 格式文本
    let content = '#EXTM3U\n';
    
    finalData.forEach(event => {
      const baseTitle = `[${event.shortT}]${event.lname}:${event.hname}_VS_${event.aname}`;
      const logo = event.hicon || ''; 
      const group = '清流直连';

      const extractStreams = (streamNode, label) => {
        if (!streamNode) return;
        if (streamNode.m3u8) {
          content += `#EXTINF:-1 tvg-logo="${logo}" group-title="${group}",${baseTitle}(${label}-m3u8)\n`;
          content += `${streamNode.m3u8}\n`;
        }
        if (streamNode.flv) {
          content += `#EXTINF:-1 tvg-logo="${logo}" group-title="${group}",${baseTitle}(${label}-flv)\n`;
          content += `${streamNode.flv}\n`;
        }
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
