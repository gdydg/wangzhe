// 强制使用 Edge Runtime，提升响应速度并兼容 EdgeOne Pages
export const runtime = 'edge';

export async function GET() {
  try {
    const targetUrl = 'https://zszb5.com/index.php?g=Wwapi&m=Shanmao&a=eventInfo';
    const apiResponse = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      // 禁用缓存，确保每次获取最新直播源
      cache: 'no-store' 
    });

    const jsonData = await apiResponse.json();
    
    // 过滤出 "直播中" 的赛事
    const liveEvents = jsonData.data.filter(item => item.gameStage === '直播中');

    let content = '#EXTM3U\n';
    
    liveEvents.forEach(event => {
      // 紧凑格式：联赛名:主队_VS_客队
      const title = `${event.lname}:${event.hname}_VS_${event.aname}`;
      const logo = event.hicon || ''; // 主场球队图标
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
