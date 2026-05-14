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
    
    // 过滤出 "直播中" 的赛事
    const liveEvents = jsonData.data.filter(item => item.gameStage === '直播中');

    let content = '清流直连,#genre#\n';
    
    liveEvents.forEach(event => {
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
