const BASE = 'http://192.168.0.132:9090';

// 工具函数：解析JSON响应
function toJSON(res) {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// 工具函数：添加请求超时处理
function withTimeout(p, ms = 10000) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('请求超时')), ms))
  ]);
}

// 工具函数：标准化列表数据格式
function normalizeList(data) {
  const arr = Array.isArray(data?.list || data?.data || data) ? (data.list || data.data || data) : [];
  return arr.map((item) => ({
    id: item.id ?? item.songId ?? item.rid ?? item.songid ?? item.ID ?? String(Math.random()).slice(2),
    title: item.title ?? item.name ?? item.songName ?? item.filename ?? '未命名',
    artist: item.artist ?? item.singer ?? item.author ?? item.artists ?? item.singerName ?? '未知',
    url: item.url ?? item.playUrl ?? item.music_url ?? item.src ?? item.link ?? '',
    cover: item.album?.picUrl ?? item.album?.artist?.img1v1Url ?? item.img ?? item.albumPic ?? '',
    duration: item.duration ?? item.time ?? 0,
  }));
}

// 搜索音乐
export async function search(name) {
  const url = `${BASE}/getKeyword?name=${encodeURIComponent(name)}`;
  const data = await withTimeout(fetch(url).then(toJSON));
  return normalizeList(data);
}

// 获取热门音乐列表
export async function hotList() {
  const url = `${BASE}/getHotList`;
  const data = await withTimeout(fetch(url).then(toJSON));
  return normalizeList(data);
}

// 获取歌词
export async function lyric(id) {
  const url = `${BASE}/getLyric?id=${encodeURIComponent(id)}`;
  return withTimeout(fetch(url).then(toJSON));
}

// 播放音乐
export async function playMusic(id) {
  const url = `${BASE}/playMusic?id=${id}`;
  return await fetch(url);
}

// 导出默认对象，方便统一导入
export default {
  search,
  hotList,
  lyric,
  playMusic,
  normalizeList
};