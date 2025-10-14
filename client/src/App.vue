<template>
  <div id="app">
    <canvas ref="canvasRef" class="webgl"></canvas>

    <div class="hud top">
      <div class="brand">🐯 Little Tiger Player</div>
      <div class="spacer"></div>
      <input v-model.trim="keyword" placeholder="搜索歌曲/歌手" style="padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#e8ecff;outline:none;min-width:240px;">
      <button :class="['btn', {'active-btn': activeTab === 'search'}]" @click="doSearch">搜索</button>
      <button :class="['btn', {'active-btn': activeTab === 'hot'}]" @click="fetchHot">热榜</button>
      <button :class="['btn', {'active-btn': showPlaylist}]" @click="togglePlaylist">播放列表</button>
    </div>

    <!-- 搜索/热榜结果浮层面板 -->
    <div v-if="(activeTab === 'search' || activeTab === 'hot' ) && !showPlaylist" style="position:absolute; top:64px; right:16px; width:440px; max-height:66vh; overflow:auto; background:rgba(6,7,13,0.92); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:10px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); backdrop-filter: blur(8px);">
      <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 6px 10px 6px; color:#98a2b3;">
        <div style="font-weight:700; letter-spacing:.3px;">{{ activeTab === 'search' ? '搜索' : '热榜' }}结果</div>
        <div style="display:flex; gap:8px;">
          <button class="btn" @click="addAll">加入全部</button>
          <button class="btn" @click="activeTab === 'search' ? searchResults = [] : hotResults = []">清空</button>
          <button class="btn" @click="activeTab === 'search' ? searchResults = [] : hotResults = []">关闭</button>
        </div>
      </div>
      <div v-for="(s,idx) in (activeTab === 'search' ? searchResults : hotResults)" :key="s.id || idx" style="display:grid; grid-template-columns: 44px 1fr auto; gap:10px; align-items:center; padding:10px; border-radius:12px; background:rgba(255,255,255,0.04); margin:8px 4px;">
        <div style="width:44px; height:44px; border-radius:10px; background:linear-gradient(135deg, #22d3ee33, #7c3aed33);">
          <img :src="s.cover+'?imageView&thumbnail=360y360&quality=75&tostatic=0'" alt="cover" style="width:100%; height:100%; object-fit:cover;">
        </div>
        <div style="min-width:0;">
          <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">{{ s.title }}</div>
          <div style="font-size:12px; color:#98a2b3; display:flex; gap:8px; align-items:center;">
            <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">{{ Array.isArray(s.artist) ? s.artist.map(x => x.name).join('/') : (s.artist || '未知') }}</span>
            <span v-if="s.duration" style="opacity:.8;">· {{ formatTime(s.duration) }}</span>
          </div>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn" @click="playOnline(s)">播放</button>
          <button class="btn" @click="addToPlaylist(s)">加入</button>
        </div>
      </div>
    </div>

    <!-- 播放列表浮层面板 -->
    <div v-show="showPlaylist" style="position:absolute; top:64px; right:16px; width:440px; max-height:66vh; overflow:auto; background:rgba(6,7,13,0.92); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:10px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); backdrop-filter: blur(8px);">
      <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 6px 10px 6px; color:#98a2b3;">
        <div style="font-weight:700; letter-spacing:.3px;">播放列表</div>
        <div style="display:flex; gap:8px;">
          <button class="btn" @click="togglePlayMode" :title="getPlayModeTitle()">
            {{ getPlayModeIcon() }}
          </button>
          <button class="btn" @click="clearPlaylist">清空</button>
          <button class="btn" @click="togglePlaylist">关闭</button>
        </div>
      </div>
      <div v-if="playlist.length === 0" style="text-align:center; padding:40px 20px; color:#98a2b3;">
        播放列表为空，请添加音乐
      </div>
      <div v-else>
        <div v-for="(t,i) in playlist" :key="t.id || i" :class="['track', { active: i===currentIndex }]" @click="select(i)" style="cursor:pointer; display:flex; align-items:center; justify-content:space-between; padding:10px; border-radius:12px; background:rgba(255,255,255,0.04); margin:8px 4px;">
          <div style="flex:1; min-width:0;">
            <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">{{ t.title }}</div>
            <div style="font-size:12px; color:#98a2b3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">{{ Array.isArray(t.artist) ? t.artist.map(x => x.name).join('/') : (t.artist || '未知') }}</div>
          </div>
          <button class="btn" @click.stop="removeFromPlaylist(i)">移除</button>
        </div>
      </div>
    </div>

    <div class="hud bottom">
      <div class="controls">
        <button class="btn" @click="prev">⏮</button>
        <button class="btn primary" @click="toggle" v-text="isPlaying ? '⏸' : '▶'"></button>
        <button class="btn" @click="next">⏭</button>

        <div class="time">
          <span>{{ currentTimeText }}</span>
          <input type="range" min="0" max="1000" step="1" :value="seekValue" @input="onSeek" />
          <span>{{ durationText }}</span>
        </div>

        <div class="volume">
          🔊
          <input type="range" min="0" max="1" step="0.05" v-model.number="volume" @input="onSetVolume" />
        </div>
      </div>
    </div>

    <!-- 歌词显示区域 -->
    <div ref="lyricsContainerRef" class="lyrics-container">
      <div v-if="currentLyrics.length > 0" class="lyrics">
        <div v-for="(line, index) in currentLyrics" :key="index" 
             :class="['lyric-line', { 'active-lyric': index === currentLyricIndex }]"
             @click="seekToLyric(index)">
          {{ line.text }}
        </div>
      </div>
      <div v-else class="no-lyrics">
        {{ playlist.length > 0 ? '暂无歌词' : '请先添加歌曲' }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { ThreeMusicVisualizer } from "./utils/ThreeMusicVisualizer.js";
import { search, hotList, lyric, playMusic } from "./utils/api.js";
import { formatTime } from "./utils/tools.js";

import hjImg from './assets/hj.jpeg';
import playImg from './assets/tool/play.png';
import pauseImg from './assets/tool/pause.png';
import nextImg from './assets/tool/next.png';

// 响应式数据
const currentIdx = ref(0);
const audioStart = ref(false);
const musicList = ref([]);
const canvasRef = ref(null)

const playlist = ref([])
const currentIndex = ref(0)
const isPlaying = ref(false)
const dropActive = ref(false)
const showPlaylist = ref(false) // 控制播放列表面板显示
// 播放模式：0-顺序循环，1-随机循环，2-单曲循环
const playMode = ref(0)
// 上一次随机播放的索引，用于避免连续播放同一首歌
let lastRandomIndex = -1
const currentLyrics = ref([]) // 当前歌词
const currentLyricIndex = ref(-1) // 当前歌词索引
const lyricsContainerRef = ref(null) // 歌词容器引用

// 在线搜索/热榜
const activeTab = ref('hot')
const keyword = ref('')
const hotResults = ref([])
const searchResults = ref([])
const lyricsCache = new Map()


// 播放器状态
const currentTimeText = ref('0:00')
const durationText = ref('0:00')
const seekValue = ref(0)
const volume = ref(0.5)

let teardown = null
let progressUpdateTimer = null

// Three.js 可视化实例
let visualizer = null;

async function doSearch() {
  if (!keyword.value) return
  try {
    activeTab.value = 'search'
    const list = await search(keyword.value)
    searchResults.value = list
  } catch (e) { console.error(e) }
}
async function fetchHot() {
  showPlaylist.value = false
  try {
    activeTab.value = 'hot'
    const list = await hotList()
    hotResults.value = list
  } catch (e) { console.error(e) }
}

function addToPlaylist(item) {
  console.log(item)
  if (!item?.url) return
  const exists = playlist.value.find(x => x.id === item.id)
  if (!exists) playlist.value.push(item)
}
function addAll() {
  const toAdd = (activeTab.value === 'search' ? searchResults.value : hotResults.value || []).filter(x => x.url)
  toAdd.forEach(addToPlaylist)
}

function playOnline(item) {
  console.log(item.id)
  // playMusic(item.id)
  if (!item?.url) return
  addToPlaylist(item)
  const idx = playlist.value.findIndex(x => x.id === item.id)
  if (idx >= 0) { loadIndex(idx); }
}

function loadIndex(i) {
  currentIndex.value = (i + playlist.value.length) % playlist.value.length
  const track = playlist.value[currentIndex.value]
  if (!track) return
  console.log(track.url)

  if (isPlaying.value) {
    visualizer.stopAudio();
    isPlaying.value = false
    
    // 清除进度更新定时器
    clearProgressUpdate()
  }
  // 使用回调函数确保音频加载完成后再播放，比固定延迟更可靠
  visualizer.audioLoad(track.url, () => {
    play()
  });
  
  // 重置歌词
  currentLyrics.value = []
  currentLyricIndex.value = -1
  
  // 尝试加载歌词（如果有id）
  if (track.id && lyricsCache.has(track.id)) {
    parseLyrics(lyricsCache.get(track.id))
  } else if (track.id) {
    lyric(track.id).then(res => {
      console.log('歌词接口：',res)
      const lyricString = res?.data?.lrc.lyric
      lyricsCache.set(track.id, lyricString)
      parseLyrics(lyricString)
    }).catch(() => {})
  }
}

// 解析歌词
function parseLyrics(lyrics) {
  // 简单的歌词解析，实际可能需要更复杂的解析逻辑
  const lines = lyrics.split('\n')
  const parsedLyrics = []
  console.log('解析歌词', lines)
  lines.forEach(line => {
    // 假设歌词格式为 [mm:ss]歌词内容
    const match = line.match(/\[(\d+):(\d+(?:\.\d+)?)\](.*)/)
    if (match) {
      const minutes = parseInt(match[1], 10)
      const seconds = parseFloat(match[2])
      const time = minutes * 60 + seconds
      parsedLyrics.push({
        time,
        text: match[3].trim()
      })
    }
  })
  
  // 按时间排序
  parsedLyrics.sort((a, b) => a.time - b.time)
  currentLyrics.value = parsedLyrics
}

// 切换播放列表显示/隐藏
function togglePlaylist() {
  showPlaylist.value = !showPlaylist.value
  // 切换播放列表时关闭搜索/热榜结果
  if (showPlaylist.value && ((activeTab.value === 'search' && searchResults.value.length) || (activeTab.value === 'hot' && hotResults.value.length))) {
    if (activeTab.value === 'search') {
      searchResults.value = []
    } else {
      hotResults.value = []
    }
  }
  activeTab.value = 'showPlaylist'
}

// 清空播放列表
function clearPlaylist() {
  if (playlist.value.length > 0) {
    // 如果当前有歌曲播放，停止播放
    if (isPlaying.value) {
      visualizer.stopAudio()
      isPlaying.value = false
      
      // 清除进度更新定时器
      clearProgressUpdate()
    }
    playlist.value = []
    currentIndex.value = 0
    currentLyrics.value = []
    currentLyricIndex.value = -1
  }
}

// 从播放列表移除歌曲
function removeFromPlaylist(index) {
  if (index === currentIndex.value) {
    // 如果移除的是当前播放的歌曲，需要特殊处理
    const wasPlaying = isPlaying.value
    visualizer.stopAudio()
    isPlaying.value = false
    
    // 清除进度更新定时器
    clearProgressUpdate()
    
    playlist.value.splice(index, 1)
    
    if (playlist.value.length > 0) {
      // 如果还有其他歌曲，自动播放下一首
      currentIndex.value = Math.min(index, playlist.value.length - 1)
      if (wasPlaying) {
        loadIndex(currentIndex.value)
      }
    } else {
      currentIndex.value = 0
      currentLyrics.value = []
      currentLyricIndex.value = -1
    }
  } else {
    // 如果移除的不是当前播放的歌曲，直接移除
    playlist.value.splice(index, 1)
    // 调整当前索引
    if (index < currentIndex.value) {
      currentIndex.value--
    }
  }
}

// 根据歌词索引跳转到对应时间
function seekToLyric(index) {
  if (currentLyrics.value[index]) {
    const time = currentLyrics.value[index].time
    // 使用新添加的seekTo方法
    visualizer.seekTo(time)
    
    // 更新当前歌词索引
    currentLyricIndex.value = index
    
    // 立即更新进度条
    updateProgressBar();
    
    // 手动触发滚动，使点击的歌词行居中
    setTimeout(() => {
      if (!lyricsContainerRef.value) return;
      
      const container = lyricsContainerRef.value;
      const activeLine = container.querySelector('.active-lyric');
      
      if (activeLine) {
        const containerHeight = container.clientHeight;
        const lineHeight = activeLine.offsetHeight;
        const lineTop = activeLine.offsetTop;
        
        container.scrollTop = lineTop - (containerHeight / 2) + (lineHeight / 2);
      }
    }, 0);
  }
}

// 启动进度更新定时器
function startProgressUpdate() {
  // 先清除可能存在的定时器
  clearProgressUpdate();
  
  // 每100毫秒更新一次进度
  progressUpdateTimer = setInterval(updateProgressBar, 100);
}

// 清除进度更新定时器
function clearProgressUpdate() {
  if (progressUpdateTimer) {
    clearInterval(progressUpdateTimer);
    progressUpdateTimer = null;
  }
}

// 更新进度条
function updateProgressBar(time) {
  if (!visualizer) return;
  
  const currentTime = time || visualizer.getCurrentTime();
  const duration = visualizer.getDuration();
  
  // 更新时间文本
  currentTimeText.value = formatTime(currentTime);
  durationText.value = formatTime(duration);
  
  // 更新进度值
  if (duration > 0) {
    seekValue.value = Math.floor((currentTime / duration) * 1000);
    
    // 检查是否播放结束（当前时间接近总时长）
    if (isPlaying.value && currentTime > 0 && duration > 0 && (duration - currentTime) < 0.5) {
      // 歌曲即将结束，根据播放模式决定下一步操作
      // 单曲循环模式会在next()中处理
      // 对于其他模式，自动播放下一首
      if (playMode.value !== 2) {
        // 使用setTimeout确保歌曲完全播放完毕
        setTimeout(() => {
          if (isPlaying.value) { // 再次检查，确保用户没有手动暂停
            next();
          }
        }, 100);
      }
    }
  }
  
  // 更新当前歌词索引
  updateCurrentLyricIndex(currentTime);
}

// 更新当前歌词索引并自动滚动
function updateCurrentLyricIndex(currentTime) {
  if (currentLyrics.value.length === 0) return;
  
  // 找到当前应该显示的歌词索引
  let newIndex = -1;
  for (let i = currentLyrics.value.length - 1; i >= 0; i--) {
    if (currentLyrics.value[i].time <= currentTime) {
      newIndex = i;
      break;
    }
  }
  
  if (newIndex !== currentLyricIndex.value) {
    currentLyricIndex.value = newIndex;
    
    // 自动滚动使当前歌词居中
    // 使用setTimeout确保DOM已更新
    setTimeout(() => {
      if (!lyricsContainerRef.value) return;
      
      const container = lyricsContainerRef.value;
      const activeLine = container.querySelector('.active-lyric');
      
      if (activeLine) {
        // 计算滚动位置，使当前歌词居中
        const containerHeight = container.clientHeight;
        const lineHeight = activeLine.offsetHeight;
        const lineTop = activeLine.offsetTop;
        
        // 滚动到使当前行位于容器中间
        container.scrollTop = lineTop - (containerHeight / 2) + (lineHeight / 2);
      }
    }, 0);
  }
}

// 处理进度条拖动
function onSeek(event) {
  if (!visualizer) return;
  
  const seekPercent = parseInt(event.target.value) / 1000;
  const duration = visualizer.getDuration();
  const seekTime = duration * seekPercent;
  
  // 设置音频进度
  visualizer.seekTo(seekTime);

  // 立即更新进度显示
  updateProgressBar(seekTime);
}

function onSetVolume() {
  if (!visualizer) return;
  visualizer.setVolume(volume.value);
}

async function play() {
  try {
    visualizer.playAudio();
    isPlaying.value = true
    
    // 启动进度更新定时器
    startProgressUpdate();
  } catch (e) {
    console.error(e)
  }
}

function pause() {
  visualizer.pauseAudio();
  // visualizer.playAudio();
  isPlaying.value = false
  
  // 暂停时清除定时器
  clearProgressUpdate();
}
function toggle() { isPlaying.value ? pause() : play() }

// 获取播放模式标题
function getPlayModeTitle() {
  switch (playMode.value) {
    case 0: return '顺序循环';
    case 1: return '随机循环';
    case 2: return '单曲循环';
    default: return '顺序循环';
  }
}

// 获取播放模式图标
function getPlayModeIcon() {
  switch (playMode.value) {
    case 0: return '🔄';
    case 1: return '🎲';
    case 2: return '🔂';
    default: return '🔄';
  }
}

// 切换播放模式
function togglePlayMode() {
  playMode.value = (playMode.value + 1) % 3;
}

// 播放上一首歌曲
function prev() {
  if (playlist.value.length === 0) return;
  
  // 随机模式下的上一首逻辑
  if (playMode.value === 1) {
    if (playlist.value.length <= 1) {
      return; // 如果只有一首歌，不切换
    }
    let randomIndex;
    // 确保随机索引不同于当前索引
    do {
      randomIndex = Math.floor(Math.random() * playlist.value.length);
    } while (randomIndex === currentIndex.value);
    lastRandomIndex = currentIndex.value;
    loadIndex(randomIndex);
  } else {
    // 顺序循环和单曲循环模式下的上一首逻辑
    const prevIndex = (currentIndex.value - 1 + playlist.value.length) % playlist.value.length;
    loadIndex(prevIndex);
  }
}

// 播放下一首歌曲
function next() {
  if (playlist.value.length === 0) return;
  
  // 单曲循环模式
  if (playMode.value === 2) {
    // 重新加载当前歌曲实现单曲循环
    loadIndex(currentIndex.value);
  }
  // 随机循环模式
  else if (playMode.value === 1) {
    if (playlist.value.length <= 1) {
      // 如果只有一首歌，重新加载当前歌曲
      loadIndex(currentIndex.value);
      return;
    }
    
    let randomIndex;
    // 确保随机索引不同于当前索引，并且尽可能避免与上一次随机索引相同
    do {
      randomIndex = Math.floor(Math.random() * playlist.value.length);
    } while (randomIndex === currentIndex.value || 
             (playlist.value.length > 2 && randomIndex === lastRandomIndex));
    
    lastRandomIndex = currentIndex.value;
    loadIndex(randomIndex);
  }
  // 顺序循环模式
  else {
    const nextIndex = (currentIndex.value + 1) % playlist.value.length;
    loadIndex(nextIndex);
  }
}

// 选择播放列表中的歌曲
function select(index) {
  if (index !== currentIndex.value) {
    // 先暂停当前播放
    if (isPlaying.value) {
      visualizer.pauseAudio();
    }
    // 加载并播放选中的歌曲
    loadIndex(index);
    // 开始播放
    visualizer.playAudio();
    isPlaying.value = true;
  }
}


// 组件挂载时初始化
onMounted(() => {
  // 延迟初始化Three.js可视化，确保DOM已加载
  setTimeout(() => {
    fetchHot();
    visualizer = new ThreeMusicVisualizer({
      positionZ: 80,
      N: 256,
      volume: volume.value
    });
    visualizer.init(canvasRef.value);
  }, 800);
});

// 组件卸载时清理资源
onUnmounted(() => {
  // 清除进度更新定时器
  clearProgressUpdate();
  
  if (visualizer) {
    visualizer.dispose();
    visualizer = null;
  }
});
</script>


