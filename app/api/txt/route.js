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

    // 2. 从系统缓存中读取历史同步数据
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

    // 4. 时效清洗
    const finalData = Array.from(mergedMap.values()).filter(item => {
      if (item.timeMs >= fourHoursAgoMs && item.timeMs <= thirtyMinsLaterMs) {
        return true;
      }
      return false;
    }).sort((a, b) => b.timeMs - a.timeMs);

    // 5. 将更新后的干净数据同步回系统缓存 KV
    if (cacheDB) {
      await cacheDB.put('active_matches', JSON.stringify(finalData));
    }

    // 6. 转换为统一的 TXT 文本格式输出
    let content = '清流直连,#genre#\n';
    
    finalData.forEach(event => {
      const baseTitle = `[${event.shortT}]${event.lname}:${event.hname}_VS_${event.aname}`;
      
      const extractStreamsTxt = (streamNode, label) => {
        if (!streamNode) return;
        if (streamNode.m3u8) {
          content += `${baseTitle}(${label}-m3u8),${streamNode.m3u8}\n`;
        }
        if (streamNode.flv) {
          content += `${baseTitle}(${label}-flv),${streamNode.flv}\n`;
        }
      };

      extractStreamsTxt(event.stream, '标清');
      extractStreamsTxt(event.streamAmAli, '高清中文');
      if (event.streamNa && event.streamNa.live) {
        extractStreamsTxt(event.streamNa.live, '高清英文');
      }
    });

    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'inline; filename="live.txt"',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response(`Sync Error: ${error.message}`, { status: 500 });
  }
}
