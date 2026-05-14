export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 仅响应 /m3u 和 /txt 路径
    if (path !== '/m3u' && path !== '/txt') {
      return new Response('请访问 /m3u 或 /txt 获取直播源', { 
        status: 200, 
        headers: { 'Content-Type': 'text/plain; charset=utf-8' } 
      });
    }

    try {
      // 拉取源站 JSON 数据
      const targetUrl = 'https://zszb5.com/index.php?g=Wwapi&m=Shanmao&a=eventInfo';
      const apiResponse = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      const jsonData = await apiResponse.json();

      // 过滤出 "直播中" 的赛事
      const liveEvents = jsonData.data.filter(item => item.gameStage === '直播中');

      if (path === '/m3u') {
        return generateM3U(liveEvents);
      } else if (path === '/txt') {
        return generateTXT(liveEvents);
      }

    } catch (error) {
      return new Response(`Error fetching or parsing data: ${error.message}`, { status: 500 });
    }
  }
};

// ==========================================
// 生成 M3U 格式的函数
// ==========================================
function generateM3U(events) {
  let content = '#EXTM3U\n';
  
  events.forEach(event => {
    const title = `${event.hname} VS ${event.aname}`;
    const logo = event.hicon || '';
    const group = '清流直连';
    
    // 线路 1: m3u8
    if (event.stream && event.stream.m3u8) {
      content += `#EXTINF:-1 tvg-logo="${logo}" group-title="${group}",${title} (m3u8)\n`;
      content += `${event.stream.m3u8}\n`;
    }
    
    // 线路 2: flv
    if (event.stream && event.stream.flv) {
      content += `#EXTINF:-1 tvg-logo="${logo}" group-title="${group}",${title} (flv)\n`;
      content += `${event.stream.flv}\n`;
    }
  });

  return new Response(content, {
    headers: {
      'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
      'Content-Disposition': 'inline; filename="live.m3u"',
      'Access-Control-Allow-Origin': '*' // 允许跨域请求
    }
  });
}

// ==========================================
// 生成 TXT 格式的函数
// ==========================================
function generateTXT(events) {
  let content = '清流直连,#genre#\n';
  
  events.forEach(event => {
    const title = `${event.hname} VS ${event.aname}`;
    
    // 线路 1: m3u8
    if (event.stream && event.stream.m3u8) {
      content += `${title} (m3u8),${event.stream.m3u8}\n`;
    }
    
    // 线路 2: flv
    if (event.stream && event.stream.flv) {
      content += `${title} (flv),${event.stream.flv}\n`;
    }
  });

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'inline; filename="live.txt"',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
