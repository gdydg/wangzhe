// 强制使用 Edge Runtime
export const runtime = 'edge';
// 【关键】强制每次访问都动态执行，避免 Next.js 将页面静态化导致边缘函数不触发
export const dynamic = 'force-dynamic';

// 安全获取 KV 数据库实例的封装函数
function getCacheDB() {
  if (typeof globalThis !== 'undefined' && globalThis.MATCH_KV) return globalThis.MATCH_KV;
  if (typeof process !== 'undefined' && process.env && process.env.MATCH_KV) return process.env.MATCH_KV;
  return null;
}

export async function GET() {
  try {
    const nowMs = Date.now();
    const thirtyMinsLaterMs = nowMs + 30 * 60 * 1000;      // 未来 30 分钟
    const twoHoursMs = 2 * 60 * 60 * 1000;                 // 锁定阈值：2 小时
    const fourHoursAgoMs = nowMs - 4 * 60 * 60 * 1000;     // 清理阈值：过去 4 小时

    // ==========================================
    // 1. 拉取外部目标源站数据
    // ==========================================
    const targetUrl = 'https://zszb5.com/index.php?g=Wwapi&m=Shanmao&a=eventInfo';
    const apiResponse = await fetch(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cache: 'no-store' 
    });
    const jsonData = await apiResponse.json();
    
    // 数据结构标准化与预处理
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

    // ==========================================
    // 2. 从系统缓存中读取历史同步数据
    // ==========================================
    const cacheDB = getCacheDB();
    let historyData = [];
    if (cacheDB) {
      try {
        // 根据 EdgeOne 文档规范，使用 { type: "json" } 读取
        historyData = await cacheDB.get('active_matches', { type: 'json' }) || [];
      } catch (e) {
        console.error('Cache read error:', e);
      }
    }

    // ==========================================
    // 3. 数据合并与 2 小时锁定逻辑
    // ==========================================
    const mergedMap = new Map();
    
    // 先载入缓存中的历史记录
    historyData.forEach(item => mergedMap.set(item.matchId, item));

    // 遍历新鲜数据，应用过滤覆盖规则
    freshData.forEach(item => {
      const timeElapsed = nowMs - item.timeMs;
      
      // 如果该比赛开赛已满 2 小时，且缓存中已有记录：【放弃覆盖，锁定原有链接】
      if (timeElapsed >= twoHoursMs && mergedMap.has(item.matchId)) {
        return; 
      }
      
      // 未满 2 小时，或是新生成的比赛：【允许覆盖/写入】
      mergedMap.set(item.matchId, item);
    });

    // ==========================================
    // 4. 时效清洗：清除超过 4 小时的数据
    // ==========================================
    const finalData = Array.from(mergedMap.values()).filter(item => {
      // 仅保留在时效时间窗内的数据
      return item.timeMs >= fourHoursAgoMs && item.timeMs <= thirtyMinsLaterMs;
    }).sort((a, b) => b.timeMs - a.timeMs); // 降序排列：开赛时间越晚越靠前

    // ==========================================
    // 5. 将更新后的干净数据同步回系统缓存 KV
    // ==========================================
    if (cacheDB) {
      // 根据 EdgeOne 文档，写入需要传递 string
      await cacheDB.put('active_matches', JSON.stringify(finalData));
    }

    // ==========================================
    // 6. 转换为统一的 M3U 文本格式输出
    // ==========================================
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

      // 多线路全量提取（包含默认流、备用流、英文流）
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
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
}
