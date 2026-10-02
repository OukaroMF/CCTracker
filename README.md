# CCTracker

作者与维护者：[OukaroMF](https://github.com/OukaroMF)。项目仓库：[OukaroMF/CCTracker](https://github.com/OukaroMF/CCTracker)。

Chromium Manifest V3 扩展，为 **Bilibili** 添加跟随网页字幕选项的整轨时间轴和点击跳转，并在 YouTube 的 Save 旁提供原生 Transcript 入口，并将当前显示的字幕发送到本机 LyricSync，输出给现有 Waybar 模块。

```text
content scripts → service worker → LyricSync（Native Messaging 接收模式）
                                      ↓
                    $XDG_RUNTIME_DIR/cctracker/subtitle.json
                                      ↓
                        LyricSync -external-subtitles → Waybar
```

支持 Chromium 111+ 的普通视频和 Bilibili 番剧页；本机 LyricSync 接入目前支持 Linux。时间轴读取网页当前开启、实际选择的完整字幕轨道，不生成翻译，也不支持直播、YouTube Shorts 或嵌入播放器。烧录在画面中的字幕不是字幕轨道，无法读取。

## 字幕时间轴与原生文字稿（0.2.5）

- **YouTube**：Save 按钮旁增加字幕文字稿按钮，克隆网站互动按钮的结构和样式，使用播放器的字幕图标；点击打开 YouTube 自带的 Transcript，列表、滚动和跳转全部使用原生组件。插件不再向 YouTube 注入时间轴或整轨读取器。[YouTube 原生字幕列表说明](https://support.google.com/youtube/answer/15930243?hl=en)
- **Bilibili**：时间轴位于弹幕列表下，克隆原生折叠标题、箭头和内部下拉栏结构，折叠时沿用弹幕列表的尺寸和样式。点击标题折叠 / 展开；定位图标就在标题旁边，点击后展开列表、定位当前播放时间并开启跟随。
- 手动滚动、拖动滚动条或用键盘浏览时间轴后自动取消跟随；自动滚动只影响列表，不移动整个视频页面。点击字幕段跳转进度，暂停状态不变。句间空白不高亮，定位时显示最近的字幕段。
- Bilibili 双轨跟随网页主、副字幕及上下两处双语开关；上方副轨、下方主轨，按时间重叠对齐分段，各轨保留换行。支持网站的 AI 字幕文件，不生成翻译、不从原文多行猜语言。
- 时间轴不依赖 Native Messaging / LyricSync 注册。整轨仅缓存于标签页内存，最多缓存八条轨道，不写入本机共享状态或发送给 LyricSync。未开启或关闭字幕时隐藏整个时间轴控件，重新开启后恢复显示；换视频或分 P 清理旧轨道，并丢弃晚到的旧请求。

Bilibili 读取器在 `document_start` 的 `MAIN` 环境观察站点字幕响应，保留原请求与响应；启动时漏过元数据会通过本站 API 查询当前视频 / 分 P。只获取当前选择的轨道，不预取其他语言，不绕过登录、字幕权限或站点验证。CDN 字幕请求不携带账户凭据。[Chrome 内容脚本文档](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)

修改扩展文件后，需要在扩展管理页重新加载扩展，再刷新视频页；仅刷新可能继续使用缓存的内容脚本。网站没字幕或请求被拒绝时会显示尚未就绪，副轨未读到会单独提示。网站内部字幕接口可能变化，自动测试不能替代真实页面验收。

## 构建和测试

扩展测试需要 Node 24+，ZIP 打包需要 Python 3；无需 npm 依赖。LyricSync 在自己的仓库中构建和测试，CCTracker 不包含 Go 程序或本机安装器。

```sh
node --test --test-isolation=none tests/*.test.mjs
mkdir -p build
cd extension
python3 -m zipfile -c ../build/cctracker-extension.zip * ../LICENSE ../THIRD_PARTY_NOTICES.md ../PRIVACY.md
cd ../build
sha256sum cctracker-extension.zip > SHA256SUMS
```

也可使用 `make test` 和 `make build`，用 `make clean` 删除本机 `build/` 产物。`build/` 是忽略的本机产物。ZIP 根目录包含 `manifest.json`、完整扩展源码、许可证、第三方署名和隐私政策，可作为 Chrome 商店上传包；解压后加载直接包含 `manifest.json` 的目录。开发时加载源码中的 `extension/`。

Bilibili 字幕只作为 JSON 数据解析，错误页或旧 XML 响应直接视为无效；不使用 `DOMParser` 或 HTML 字符串赋值，因此不会触发这一路径的 TrustedHTML 限制。YouTube 文字稿由网站原生组件处理。

## GitHub 自动构建

`.github/workflows/build.yml` 在 push、pull request 和手动运行时测试扩展，随后上传 `cctracker-extension`（扩展 ZIP 和 `SHA256SUMS`），保留 30 天。ZIP 的清单位于根目录，解压后加载该目录。

CCTracker 的 Action 不构建 LyricSync，也不生成本机桥接产物。LyricSync 使用自己仓库的 `.github/workflows/build.yml` 测试、构建 Linux amd64 / arm64 二进制。这些 workflow 推送到 GitHub 后生效，不自动发布 Release。

## 本机接入

1. 安装支持 `-external-subtitles` 和 Native Messaging 的 [LyricSync](https://github.com/OukaroMF/lyricsync)。其源码、构建和接收端测试在 LyricSync 仓库维护。
2. 在 Brave 打开 `brave://extensions`（其他浏览器使用自己的扩展管理页），开启开发者模式，加载 CCTracker 的 `extension/` 目录，并刷新已有视频页。
3. 使用将实际运行的 LyricSync 二进制注册宿主。本扩展的公开 manifest key 固定 ID 为 `amibfjbcnoiilieibpnjbjmkkcoghleg`：

```sh
lyricsync install-native-host --browser brave --extension-id amibfjbcnoiilieibpnjbjmkkcoghleg
```

4. 给 Waybar 中的 LyricSync 命令加上 `-external-subtitles`，保留原有输出选项。例如两行布局可分别使用：

```sh
lyricsync -external-subtitles -player musicfox -hide-when-inactive -output secondary
lyricsync -external-subtitles -player musicfox -hide-when-inactive -output original
```

修改 Waybar 命令后重启 Waybar。个人的二进制选择脚本、`lrcsnc` 门控和 CSS 在各自 Waybar 配置中维护，CCTracker 不修改它们。

`--browser` 支持 `chrome`、`chromium`、`brave`；`--profile-dir` 指定自定义 user-data 根目录（不是它下面的 `Default`）。注册路径直接指向执行安装命令的 LyricSync；移动二进制后重新注册。NixOS 也可以把 LyricSync 的绝对路径和 manifest 纳入系统配置。

不同浏览器的宿主注册互不共享。内置浏览器使用独立配置时，需要先确认其 Native Messaging 支持及实际宿主查找目录；安装扩展本身不等于注册了 LyricSync。

## 使用行为

- 在网站上开启字幕，并播放视频。工具栏按等待字幕、已连接、LyricSync 未注册、连接失败、浏览器不支持本机连接五种状态切换图标；悬停提示保留状态和底层错误。图标自带状态标记，不叠加文字角标。点击图标可立即重试。
- 最近开始播放且开启字幕的视频接管显示。暂停保留字幕，其他标签页的普通进度更新不抢占；关闭当前会话后选择其他播放中的字幕会话，否则回退 musicfox。
- 字幕句间空白仍由网页接管，显示为空；关闭字幕、视频结束、离开视频页或关闭标签页时释放会话。
- 原文走 `original`，网页已有的副字幕走 `secondary` / `translation`；`combined` 沿用歌词格式，上方小字号译文、下方原文，罗马音为空。Bilibili 按主、副字幕容器分开读取，不从原文换行猜译文；YouTube 普通多行字幕仍视为原文。各轨保留多行，不生成翻译或逐字高亮。
- 多个 LyricSync 输出进程读取相同快照。没有 MPRIS 或网易云歌曲 ID 也能显示网页字幕。
- 网页字幕接收优先于网易云请求；请求在外部字幕模式中异步进行，断网不会阻塞字幕接管。

## 协议

接收端名：`com.oukaromf.lyricsync`。使用 `runtime.connectNative` 的长期连接，消息为 UTF-8 JSON，前置本机字节序的四字节长度。单帧上限 128 KiB；stdout 仅输出协议，诊断写 stderr。[Chrome Native Messaging 文档](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)

快照示例（position/duration 单位为秒）：

```json
{"version":1,"type":"snapshot","sessionId":"browser-session","sequence":1,"site":"youtube","mediaId":"video-id","title":"视频标题","url":"https://www.youtube.com/watch?v=video-id","captionsEnabled":true,"text":"第一行\n第二行","translation":"","status":"playing","position":12.5,"duration":120}
```

释放消息：`{"version":1,"type":"clear","sessionId":"browser-session","sequence":2}`。扩展后台将各页面的状态仲裁为一个会话，直接把参数发送给 LyricSync，原生连接使用自己的会话 ID 和递增序号，切换标签不会让序号倒退。错误消息不会改变上次有效状态。

浏览器启动 LyricSync 时传入扩展来源，LyricSync 自动进入接收模式，从标准输入持续读取 JSON 参数；可用 `lyricsync native-host chrome-extension://扩展ID/` 显式进入该模式。接收模式不访问 MPRIS，stdout 只写原生分帧回复。

状态文件添加 `hostId` 和 Unix 毫秒 `updatedAt`，采用原子替换，目录 `0700`、文件 `0600`。LyricSync 接收进程每两秒刷新存活时间；正常关闭删除自己的状态，异常退出超过十秒回退。首版同一用户只启用一个浏览器配置文件中的发送扩展。

## 排查与验收

1. 确认网页字幕确实开启、存在可选字幕轨道。Bilibili 部分字幕要求站点登录；本扩展不会绕过站点限制。
2. 检查工具栏状态和 `$XDG_RUNTIME_DIR/cctracker/subtitle.json`；不要把该文件当成持久字幕历史。
   连接错误的图标提示保留完整底层错误；`chrome.runtime.connectNative` 不可用时显示“浏览器不支持本机连接”。“LyricSync 未注册”表示浏览器报告宿主查找失败，仍需确认具体配置目录。
3. 用 `lyricsync -external-subtitles -hide-when-inactive -once -output original` 检查本机输出，再检查 Waybar；应与注册宿主和 Waybar 命令使用同一个适配版本。
4. 分别测试两个站点的字幕变化、暂停、跳转、换视频、关闭字幕和浏览器退出；确认没有两份歌词同时显示，退出后恢复 musicfox。

如果扩展错误页仍显示 YouTube 上 `timeline-core.js (parse)` / `page-tracks.js (load)` 的 TrustedHTML 堆栈，先确认管理页版本为 `0.2.5`，重新加载扩展、清除旧错误记录并刷新视频页。当前 YouTube 不加载整轨读取器，Bilibili JSON 解析也不调用 `DOMParser`；读取器另有 Bilibili 站点检查。旧错误记录不能代表当前版本再次报错。

DOM 适配包含当前 Bilibili `bili-subtitle-x` 和较旧的 `bpx-player-subtitle` 结构；站点更新可能需要调整适配器。扩展自动测试包含两个站点的 DOM fixtures、内容脚本事件、后台重连、多标签仲裁，以及 Bilibili 整轨解析、双语时间对齐、轨道选择、缓存元数据恢复、请求去重、导航竞态和 TrustedHTML 回归。原生接收、状态文件及输出模式由 LyricSync 自己的测试验证。真实浏览器验收需另外完成。

## 项目结构与职责

| 位置 | 职责 |
| --- | --- |
| `extension/adapters.js`、`content.js` | 读取两站实际显示的字幕和播放器状态，监听字幕及播放事件，去重后发送当前快照。 |
| `extension/core.mjs`、`background.mjs` | 校验来源和字段、多标签会话仲裁、Native Messaging 连接与重连、工具栏状态。 |
| `extension/page-tracks.js`、`timeline-core.js` | Bilibili 页面环境中观察字幕请求，补查视频元数据，获取所选完整 JSON 轨道，校验、缓存并按时间对齐双语。 |
| `extension/timeline.js`、`timeline.css` | Bilibili 时间轴 UI，复用折叠栏结构和网站样式，处理高亮、滚动跟随、定位和跳转。 |
| `extension/youtube-transcript.js` | 克隆 Save 旁的原生按钮样式，打开网站自带的 Transcript，不实现另一个字幕列表。 |
| `extension/icons/` | `cctracker-16/48/128.png` 为扩展主图标；`waiting`、`connected`、`unregistered`、`failed`、`unsupported` 各提供 16/32 像素工具栏图标。 |
| `tests/`、`.github/workflows/` | 自动回归测试，以及仅针对扩展的 GitHub 测试和 ZIP 打包。 |
| `build/` | 忽略的本机产物，不作为扩展加载目录。 |

LyricSync 的实现位于独立仓库：`cmd/lyricsync/main.go` 区分原生接收模式和 Waybar 输出模式；`internal/native/` 处理分帧、字段校验、原子状态写入、心跳和断连清理；`internal/external/` 读取并验证共享状态的有效期；`internal/app/external.go` 生成原文、译文和 combined 的 Pango 输出。原有 `internal/mpris/`、`internal/lyrics/` 仍负责 musicfox 歌词回退。

两个数据流程独立运行：当前字幕经过后台仲裁发送给本机 LyricSync；完整字幕只用于 Bilibili 标签页内的时间轴。Native Messaging 接收进程由浏览器启动，Waybar 的 LyricSync 输出进程读取共享状态；二者是同一程序的不同运行模式，无需额外桥接程序。

## 许可证与隐私

Copyright (C) 2026 OukaroMF.

CCTracker 的原创代码采用 **GPL-3.0-or-later**，完整正文见 [LICENSE](LICENSE)。允许使用、修改和商用；再分发时应遵守 GPL，包括保留许可及提供对应源码。这里的许可证选择与 LyricSync 保持一致。

Tabler 衍生图标保留 MIT 许可，来源、修改说明和完整署名见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。该文件和许可证正文随扩展 ZIP 一起分发。

数据处理说明见 [PRIVACY.md](PRIVACY.md)。上架时需将此政策发布到可公开访问的 URL，并在商店后台填写该 URL、用途、权限理由和数据使用声明；本机文档本身不等于已经完成商店提交。
