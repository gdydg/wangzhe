// 强制使用 Edge Runtime
export const runtime = 'edge';

export async function GET() {
  try {
    const targetUrl = 'https://zszb5.com/index.php?g=Wwapi&m=Shanmao&a=eventInfo';
    const apiResponse = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      cache: 'no-store'
    });

    const jsonData = await apiResponse.json();
    
    const nowMs = Date.now();
    const thirtyMinsLaterMs = nowMs + 30 * 60 * 1000;
    const bufferPastMs = nowMs - 15 * 60 * 1000;
    
    const liveEvents = jsonData.data
      .map(item => {
        let gameTimeMs = 0;
        let shortTime = '00:00';
        
        if (item.gameTime) {
          const timeString = item.gameTime.includes('+') || item.gameTime.includes('Z') 
            ? item.gameTime 
            : `${item.gameTime}+08:00`;
          gameTimeMs = new Date(timeString).getTime();
          shortTime = item.gameTime.substring(11, 16);
        }
        
        return { ...item, gameTimeMs, shortTime };
      })
      .filter(item => {
        if (item.gameStage === '直播中') return true;
        if (item.gameTimeMs >= bufferPastMs && item.gameTimeMs <= thirtyMinsLaterMs) return true;
        return false;
      })
      .sort((a, b) => b.gameTimeMs - a.gameTimeMs); // 降序排队

    let content = '清流直连,#genre#\n';
    
    liveEvents.forEach(event => {
      // 拼接时间标：[19:00]联赛名:主队_VS_客队
      const title = `[${event.shortTime}]${event.lname}:${event.hname}_VS_${event.aname}`;
      
      // 线路 1: m3u8
      if (event.stream && event.stream.m3u8) {
        content += `${title}(m3u8),${event.stream.m3u8}\n`;
      }
      
      // 线路 2: flv
      if (event.stream && event.stream.flv) {
        content += `${title}(flv),${event.stream.flv}\n`;
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
    return new Response(`Error fetching data: ${error.message}`, { status: 500 });
  }
}
