// 强制使用 Edge Runtime
export const runtime = 'edge';

export async function GET() {
  try {
    const targetUrl = 'https://zszb5.com/index.php?g=Wwapi&m=Shanmao&a=eventInfo';
    const apiResponse = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      cache: 'no-store' 
    });

    const jsonData = await apiResponse.json();
    
    const nowMs = Date.now();
    const thirtyMinsLaterMs = nowMs + 30 * 60 * 1000;
    const bufferPastMs = nowMs - 15 * 60 * 1000;

    // 1. 预处理数据、2. 过滤、3. 排序
    const liveEvents = jsonData.data
      .map(item => {
        // 计算准确的时间戳
        let gameTimeMs = 0;
        let shortTime = '00:00';
        
        if (item.gameTime) {
          const timeString = item.gameTime.includes('+') || item.gameTime.includes('Z') 
            ? item.gameTime 
            : `${item.gameTime}+08:00`;
          gameTimeMs = new Date(timeString).getTime();
          
          // 截取类似 "2026-05-14T10:30:00" 中的 "10:30"
          shortTime = item.gameTime.substring(11, 16);
        }
        
        return { ...item, gameTimeMs, shortTime };
      })
      .filter(item => {
        // 保留直播中，或者开赛时间在 [当前时间-15分钟, 当前时间+30分钟] 内的
        if (item.gameStage === '直播中') return true;
        if (item.gameTimeMs >= bufferPastMs && item.gameTimeMs <= thirtyMinsLaterMs) return true;
        return false;
      })
      // 降序排序：b - a，时间戳越大（越晚）排越前
      .sort((a, b) => b.gameTimeMs - a.gameTimeMs);

    let content = '#EXTM3U\n';
    
    liveEvents.forEach(event => {
      // 拼接时间标：[19:00]联赛名:主队_VS_客队
      const title = `[${event.shortTime}]${event.lname}:${event.hname}_VS_${event.aname}`;
      const logo = event.hicon || ''; 
      const group = '清流直连';
      
      // 线路 1: m3u8
      if (event.stream && event.stream.m3u8) {
        content += `#EXTINF:-1 tvg-logo="${logo}" group-title="${group}",${title}(m3u8)\n`;
        content += `${event.stream.m3u8}\n`;
      }
      
      // 线路 2: flv
      if (event.stream && event.stream.flv) {
        content += `#EXTINF:-1 tvg-logo="${logo}" group-title="${group}",${title}(flv)\n`;
        content += `${event.stream.flv}\n`;
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
    return new Response(`Error fetching data: ${error.message}`, { status: 500 });
  }
}
