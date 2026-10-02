# CCTracker Privacy Policy / 隐私政策

Effective date / 生效日期：2026-10-03

## Purpose / 用途

CCTracker displays and navigates subtitles from the current Bilibili video, opens YouTube's native transcript, and sends the currently displayed captions to the user's locally installed LyricSync.

CCTracker 用于显示和跳转当前 Bilibili 视频的字幕、打开 YouTube 原生文字稿，以及将当前显示的字幕发送给用户本机安装的 LyricSync。

## Data processed / 处理的数据

On supported video pages, CCTracker reads the video identifier, page title, page URL, selected subtitle language, current subtitle and secondary subtitle text, playback status, position and duration. Bilibili's selected full subtitle tracks are cached in the tab's memory for the timeline. CCTracker does not request camera, microphone, location, clipboard or browser history access, and does not read passwords or payment details.

CCTracker 在支持的视频页读取视频标识、页面标题、URL、所选字幕语言、当前原文及副字幕、播放状态、进度和时长。Bilibili 所选整轨字幕缓存在标签页内存中，仅供时间轴使用。扩展不申请摄像头、麦克风、定位、剪贴板或浏览历史权限，也不读取密码或支付信息。

## Network and local transfer / 网络与本机传输

To obtain Bilibili subtitles, CCTracker observes the site's subtitle responses and may request metadata and selected subtitle files from Bilibili and its `hdslb.com` subtitle hosts. Site API requests may use the browser's existing login session; subtitle CDN requests made by CCTracker omit account credentials. These requests are subject to the site's access rules and privacy policy. CCTracker does not send subtitles to a developer-operated server, analytics service or translation provider.

CCTracker 为获取 Bilibili 字幕观察网站字幕响应，并可能向 Bilibili API 和 `hdslb.com` 字幕服务请求当前视频元数据及所选字幕文件。本站 API 请求可能使用浏览器现有登录会话；扩展发起的字幕 CDN 请求不携带账户凭据。这些请求受网站访问规则和隐私政策约束。扩展不向开发者服务器、统计服务或翻译服务发送字幕。

When a caption session is active, CCTracker sends the current subtitle, secondary subtitle, video identifier, title, URL and playback state through Native Messaging to `com.oukaromf.lyricsync` on the same computer. Complete subtitle tracks remain in the tab and are not sent through Native Messaging.

字幕会话有效时，扩展通过 Native Messaging 将当前字幕、副字幕、视频标识、标题、URL 和播放状态发送给同一台电脑上的 `com.oukaromf.lyricsync`。整轨字幕留在标签页内存中，不通过该接口发送。

## Retention and control / 保留与控制

CCTracker does not maintain a persistent subtitle history or use extension storage. The companion LyricSync receiver maintains the latest snapshot at `$XDG_RUNTIME_DIR/cctracker/subtitle.json` for local output processes. Normal release or disconnect clears that state; after an abnormal receiver exit, a state older than ten seconds is ignored and may remain until runtime cleanup. The tab's track cache is reset when the video changes or the tab closes.

CCTracker 不保存持久字幕历史，也不使用扩展存储。配套 LyricSync 接收端在 `$XDG_RUNTIME_DIR/cctracker/subtitle.json` 保存最新快照，供本机输出进程读取。正常释放或断连会清理状态；接收端异常退出时，超过十秒的状态失效，文件可能保留到运行目录清理。换视频或关闭标签页会清除标签页轨道缓存。

Turn subtitles off to release the active caption session. Disable or remove CCTracker to stop extension processing. LyricSync's own music-player and lyric-service features are separate from this extension and governed by its implementation.

关闭网页字幕可释放当前字幕会话；停用或移除扩展可停止扩展处理。LyricSync 自身的音乐播放器与歌词服务功能独立于本扩展。

## Contact and changes / 反馈与更新

CCTracker is maintained by [OukaroMF](https://github.com/OukaroMF). For privacy questions, contact the maintainer through [CCTracker's GitHub issues](https://github.com/OukaroMF/CCTracker/issues). Changes to data handling will be reflected in this policy and its effective date before release.

CCTracker 由 [OukaroMF](https://github.com/OukaroMF) 维护。隐私问题请通过 [CCTracker 的 GitHub Issues](https://github.com/OukaroMF/CCTracker/issues) 联系维护者。数据处理方式变更时，会在发布前更新本政策和生效日期。
