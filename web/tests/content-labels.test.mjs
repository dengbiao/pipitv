import test from 'node:test';
import assert from 'node:assert/strict';
import { entrySummary, mediaTags, mediaSummary } from '../src/content-labels.js';
import reviewed from '../../public/media-topics.json' with { type: 'json' };

const video = fragment => {
  const source = reviewed.videos.find(file => file.name.includes(fragment));
  return { name: source.name, kind: 'video', size: source.bytes };
};

test('merged WOW keeps specific home topics and custom descriptions remain editable', () => {
  assert.equal(entrySummary({ title: 'WOW English', subtitle: '英文学习内容' }), '问候 · 颜色 · 花园 · 玩具 · 身体');
  assert.equal(entrySummary({ title: 'WOW English', subtitle: '亲子共读' }), '亲子共读');
  assert.equal(entrySummary({ title: '古力小超人', subtitle: '英文动画' }), '问候 · 游戏 · 生活习惯');
});
test('the reviewed USB catalog contains 12 Guli and 26 WOW videos with concise unique tags', () => {
  assert.equal(reviewed.videos.length, 38);
  assert.equal(reviewed.videos.filter(file => file.name.startsWith('古力小超人 ')).length, 12);
  assert.equal(reviewed.videos.filter(file => file.name.includes('Wow!Yellow')).length, 26);
  assert.equal(new Set(reviewed.videos.map(file => `${file.name}\n${file.bytes}`)).size, 38);
  for (const source of reviewed.videos) {
    const file = { name: source.name, size: source.bytes, kind: 'video' };
    const tags = mediaTags(file);
    assert.equal(tags.length, 3, file.name);
    assert.equal(new Set(tags).size, tags.length, file.name);
    assert.ok(tags.every(tag => tag.length > 0 && tag.length <= 12 && !/[\r\n]/.test(tag)), file.name);
  }
});
test('actual content corrects misleading episode names and separates story/song subjects', () => {
  assert.equal(mediaSummary(video('02 wake up')), '春天苏醒 · 冬眠动物 · 唤醒口令');
  assert.equal(mediaSummary(video('05 Pat,')), '沙滩堆沙堡 · 挖沙装桶 · 动作口令');
  assert.equal(mediaSummary(video('12 Who are You')), '职业扮演 · 厨师司机 · 唱歌跳舞');
  assert.equal(mediaSummary(video('003.Wow')), '1–3 数数 · 数字跟唱 · 儿歌');
  assert.equal(mediaSummary(video('006.Wow')), '房子门窗 · 搭建游戏 · 物品问答');
  assert.equal(mediaSummary(video('008.Wow')), '树花太阳 · 颜色认知 · 魔法画中游');
  assert.equal(mediaSummary(video('016.Wow')), '手指脚趾 · 1–3 数数 · 拼装机器人');
  assert.equal(mediaSummary(video('027.Wow')), '开心难过还好 · 情绪问答 · 儿歌');
});
test('unknown, unfinished and replaced files never inherit a reviewed recording label', () => {
  const source = video('003.Wow');
  assert.deepEqual(mediaTags({ ...source, size: source.size + 1 }), []);
  assert.deepEqual(mediaTags({ ...source, size: undefined }), []);
  assert.deepEqual(mediaTags({ ...source, kind: 'audio' }), []);
  assert.deepEqual(mediaTags({ ...source, name: `${source.name}.baiduyun.p.downloading` }), []);
  assert.equal(mediaSummary({ name: 'new hello video_song.mp4', kind: 'video', size: 123 }), '');
  assert.equal(mediaSummary({ name: '古力小超人 02 wake up.mp4' }), '');
});
test('existing PDF descriptions remain available separately from reviewed video tags', () => {
  assert.equal(mediaSummary({ name: 'Wow English 第一季第1周高频词.pdf' }), '问候 · 颜色 · 花园 · 词汇复习');
  assert.equal(mediaSummary({ name: 'Wow English 第一季（计划表）.pdf' }), '学习计划 · 进度安排');
  assert.equal(mediaSummary({ name: 'unrecognized.mp4' }), '');
});
