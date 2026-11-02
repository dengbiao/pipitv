# 每日休息提示音

页面文案来自 `public/rest-reminders.json`。按本地日期轮换 31 句，每句包含标点也不超过 15 字；同一天反复打开或重启保持一致。页面显示与对应音频的文字相同。音频文件位于 `public/rest-audio/01.m4a` 至 `31.m4a`，原生播放器和浏览器预览共用这套文件。

2026-11-01 用户认为初版系统朗读缺乏真人感，并指定使用 Dreamina CLI。随后用户认为「儿童绘本」试听偏慢、声音不合适，明确选择了 A 版「暖心学姐」；第一句约 2.4 秒。保留其轻快、清晰、日常说话的口吻，避免恢复缓慢的绘本朗读。

制作使用 `seed_audio_v1` 的 `text-reading` 场景，目录音色为「暖心学姐」（voiceId `7595863981525307945`）。输入只有页面原文，不把导演说明写入朗读文本。去掉开头和结尾的空白；对少数较慢的句子保留音高、轻微提速，使时长约 2–3 秒。统一音量后，在最终的 44.1 kHz 采样率限制峰值，再转成单声道 AAC，避免编码后的声音削波。播放阶段不调用生成服务，不依赖系统 TTS。

画布：https://jimeng.jianying.com/ai-tool/ai-canvas/4ddf043d-e624-4ed7-93d9-cb51434556aa

`outputs/dreamina-rest-audio/job.json` 保存公开节点、提交、资源 ID 和文件校验值，便于继续同一次任务。该目录还保留两版试听、被放弃的绘本试听和替换前的系统语音，不保存授权令牌或临时下载链接。

```sh
python3 scripts/generate_rest_audio.py --phase prepare
python3 scripts/generate_rest_audio.py --phase run
python3 scripts/generate_rest_audio.py --phase collect
python3 scripts/generate_rest_audio.py --phase publish
```

先回读实时模型、音色和原节点再更新草稿；生成前查询报价。服务端需要积分批准时脚本会停止，不自动批准；结果不确定时先按已保存的提交 ID 查询，避免重复生成。发布步骤要求完整的 31 个文件就绪并与所选音色匹配，原语音先备份再替换。

电视 APK 必须把 `.m4a` 作为未压缩资源打包，以便 `RestReminderAudio` 通过文件描述符离线播放。重新构建和覆盖安装后，核对安装包哈希以及全部音频文件哈希，不重置家长 PIN、时间规则或内容记录。
