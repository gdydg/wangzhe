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

    // 1. 拉取外部目标源站数据
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

    // 2. 从 Upstash 数据库中获取历史同步数据
    const historyData = await getCacheData();

    // 3. 数据合并与 2 小时锁定逻辑
    const mergedMap = new Map();
    historyData.forEach(item => mergedMap.set(item.matchId, item));

    freshData.forEach(item => {
      const timeElapsed = nowMs - item.timeMs;
      if (timeElapsed >= twoHoursMs && mergedMap.has(item.matchId)) return; 
      mergedMap.set(item.matchId, item);
    });

    // 4. 时效清洗
    const finalData = Array.from(mergedMap.values()).filter(item => {
      return item.timeMs >= fourHoursAgoMs && item.timeMs <= thirtyMinsLaterMs;
    }).sort((a, b) => b.timeMs - a.timeMs);

    // 5. 同步回 Upstash 数据库
    await setCacheData(finalData);

    // 6. 转换为统一的 TXT 文本格式输出
    let content = '清流直连,#genre#\n';
    
    finalData.forEach(event => {
      const baseTitle = `[${event.shortT}]${event.lname}:${event.hname}_VS_${event.aname}`;
      
      const extractStreamsTxt = (streamNode, label) => {
        if (!streamNode) return;
        if (streamNode.m3u8) content += `${baseTitle}(${label}-m3u8),${streamNode.m3u8}\n`;
        if (streamNode.flv) content += `${baseTitle}(${label}-flv),${streamNode.flv}\n`;
      };

      extractStreamsTxt(event.stream, '标清');
      extractStreamsTxt(event.streamAmAli, '高清中文');
      if (event.streamNa && event.streamNa.live) extractStreamsTxt(event.streamNa.live, '高清英文');
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
