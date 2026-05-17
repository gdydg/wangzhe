// 强制使用 Edge Runtime
export const runtime = 'edge';
// 强制每次请求动态执行，拒绝 Next.js 的静态缓存机制
export const dynamic = 'force-dynamic';

// 采用标准 HTTP REST 协议读取 Upstash 数据库
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
    console.error('Database read error:', e);
    return [];
  }
}

// 采用标准 HTTP REST 协议写入 Upstash 数据库
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
  } catch (e) {
    console.error('Database write error:', e);
  }
}

export async function GET() {
  try {
    const nowMs = Date.now();
    const thirtyMinsLaterMs = nowMs + 30 * 60 * 1000;      // 未来 30 分钟
    const twoHoursMs = 2 * 60 * 60 * 1000;                 // 锁定阈值：2 小时
    const fourHoursAgoMs = nowMs - 4 * 60 * 60 * 1000;     // 清理阈值：过去 4 小时 

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

    // 2. 从 Upstash 数据库中获取历史同步数据
    const historyData = await getCacheData();

    // 3. 数据合并与 2 小时锁定逻辑
    const mergedMap = new Map();
    historyData.forEach(item => mergedMap.set(item.matchId, item));

    freshData.forEach(item => {
      const timeElapsed = nowMs - item.timeMs;
      // 满 2 小时，拒绝覆盖历史数据（锁源）
      if (timeElapsed >= twoHoursMs && mergedMap.has(item.matchId)) {
        return; 
      }
      // 小于 2 小时，覆盖更新
      mergedMap.set(item.matchId, item);
    });

    // 4. 数据清洗 (4 小时后清理过期比赛)
    const finalData = Array.from(mergedMap.values()).filter(item => {
      return item.timeMs >= fourHoursAgoMs && item.timeMs <= thirtyMinsLaterMs;
    }).sort((a, b) => b.timeMs - a.timeMs); // 时间降序：越晚的越靠前

    // 5. 将更新后的数据同步回 Upstash
    await setCacheData(finalData);

    // 6. 生成 M3U 格式文本
    let content = '#EXTM3U\n';
    
    finalData.forEach(event => {
      const baseTitle = `[${event.shortT}]${event.lname}:${event.hname}_VS_${event.aname}`;
      const logo = event.hicon || ''; 
      const group = '清流直连';

      const extractStreams = (streamNode, label) => {
        if (!streamNode) return;
        
        // --- 修改点：辅助函数，用于替换目标域名 ---
        const processUrl = (url) => {
            if (!url) return '';
            return url.replace('qinl-play.agiaexpress.com', 'tv8.gitee.tech/qinl');
        };
        // ------------------------------------------

        if (streamNode.m3u8) {
          content += `#EXTINF:-1 tvg-logo="${logo}" group-title="${group}",${baseTitle}(${label}-m3u8)\n`;
          content += `${processUrl(streamNode.m3u8)}\n`; // 调用辅助函数
        }
        if (streamNode.flv) {
          content += `#EXTINF:-1 tvg-logo="${logo}" group-title="${group}",${baseTitle}(${label}-flv)\n`;
          content += `${processUrl(streamNode.flv)}\n`; // 调用辅助函数
        }
      };

      // 提取全量多线路
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
