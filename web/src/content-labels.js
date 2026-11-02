import reviewedTopics from '../../public/media-topics.json' with { type: 'json' };

const genericDescriptions = new Set(['', '英文学习内容', '英文动画', '本地内容', '文件夹']);
const videoTopics = new Map(reviewedTopics.videos.map(video => [`${video.name}\n${video.bytes}`, video.tags]));

// Reviewed against the actual video/audio. A replacement with the same title
// must not silently inherit the previous recording's content labels.
export function mediaTags(file = {}) {
  const name = file.name || file.path?.split('/').pop() || '';
  if (file.kind && file.kind !== 'video') return [];
  return videoTopics.get(`${name}\n${file.size}`) || [];
}

export function entrySummary(entry = {}) {
  const subtitle = (entry.subtitle || '').trim();
  if (!genericDescriptions.has(subtitle)) return subtitle;
  const identity = `${entry.title || ''} ${entry.path || ''}`;
  if (/wow/i.test(identity)) return '问候 · 颜色 · 花园 · 玩具 · 身体';
  if (/古力小超人/.test(identity)) return '问候 · 游戏 · 生活习惯';
  return subtitle;
}

export function mediaSummary(file = {}) {
  const name = file.name || file.path?.split('/').pop() || '';
  if (file.kind === 'folder') return entrySummary({ title: name, path: file.path, subtitle: file.subtitle });
  if (file.kind === 'pdf' || /\.pdf$/i.test(name)) {
    if (/计划表/.test(name)) return '学习计划 · 进度安排';
    if (/第(?:1|一)周/.test(name)) return '问候 · 颜色 · 花园 · 词汇复习';
    if (/第(?:2|二)周/.test(name)) return '玩具 · 身体 · 词汇复习';
    if (/第(?:3|三)周/.test(name)) return '食物 · 昆虫 · 词汇复习';
    if (/第(?:4|四)周|复盘/.test(name)) return '情绪 · 阶段复习';
    return '阅读 · 学习资料';
  }
  return mediaTags(file).join(' · ');
}
