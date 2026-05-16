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
      .sort((a, b) => b.gameTimeMs - a.gameTimeMs);

    let content = '#EXTM3U\n';
    
    liveEvents.forEach(event => {
      const baseTitle = `[${event.shortTime}]${event.lname}:${event.hname}_VS_${event.aname}`;
      const logo = event.hicon || ''; 
      const group = '清流直连';

      // 定义一个内部函数来处理和提取不同节点的流
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

      // 1. 提取默认标清流
      extractStreams(event.stream, '标清');
      
      // 2. 提取备用/高清中文流 (部分赛事有)
      extractStreams(event.streamAmAli, '高清中文');
      
      // 3. 提取北美/高清英文流 (部分赛事有)
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
    return new Response(`Error fetching data: ${error.message}`, { status: 500 });
  }
}
