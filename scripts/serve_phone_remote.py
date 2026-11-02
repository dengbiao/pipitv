#!/usr/bin/env python3
"""Expose only the phone APK and its installation page on the home Wi-Fi."""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import argparse
import urllib.parse

ROOT = Path(__file__).resolve().parents[1]
APK = ROOT / 'outputs/PIPI-REMOTE-0.1.0.apk'
QR = ROOT / 'outputs/phone-remote-install-qr.png'
PAGE = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>PIPI 遥控助手 · 手机安装</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#fcfaf3;color:#344b39;font:16px/1.7 system-ui,sans-serif}
main{max-width:590px;margin:5vh auto;padding:26px}header{letter-spacing:.16em;font-size:12px;font-weight:700;color:#657b5e}
h1{font-size:34px;line-height:1.25;letter-spacing:-.04em;margin:18px 0}p{color:#72806d}.badge{font-size:13px}
a.download{display:block;padding:17px 22px;background:#496249;border-radius:18px;color:white;text-align:center;text-decoration:none;font-weight:700;margin:28px 0 12px}
.card{background:white;padding:22px;border-radius:24px;margin-top:27px}h2{font-size:19px;margin:0 0 10px}ol{padding-left:22px;margin:10px 0}li{margin:13px 0}
small{display:block;color:#7c8879;font-size:13px}strong{color:#344b39}footer{margin-top:25px;font-size:12px;color:#83907c}
</style><main><header>PIPI REMOTE</header><h1>手机，就是<br>电视鼠标。</h1>
<p>用手机控制电视上的光标，打开原来点不到的设置。</p>
<div class="badge">安卓手机安装 · Android 9 及以上 · 0.1.0</div>
<a class="download" href="/remote.apk">下载手机安装包</a>
<small>这是安装在<strong>手机</strong>上的遥控助手。电视端无需安装配套 App。</small>
<section class="card"><h2>三步开始</h2><ol>
<li>在安卓手机上下载、安装并打开 App。如果浏览器提示，允许本次安装。</li>
<li>点<strong>开始配对</strong>，允许附近设备权限和手机被发现。</li>
<li>用电视遥控器打开海信的<strong>蓝牙 / 外设连接</strong>，搜索 App 显示的手机名称，确认配对。</li>
</ol><small>若未自动连接，在 App 的“已配对的设备”里选择电视。以“已连接”和电视出现光标为准。</small></section>
<section class="card"><h2>连接后怎么用</h2><p>单指滑动移动光标，轻点左键，双指滚动，长按拖动。也可使用独立的左右键、返回、Tab 和确认按钮。</p>
<small>使用时保持 App 打开。结束后点“结束连接”。部分手机系统没有开放蓝牙鼠标功能，App 会显示注册失败。</small></section>
<footer>本地开发版 · 无广告 · 不需要定位、文件或无障碍权限<br>蓝牙配对和这台电视的实际兼容性仍需上机验证。</footer>
</main></html>'''

class Handler(BaseHTTPRequestHandler):
    server_version = 'PIPI-Remote-Install/1.0'
    sys_version = ''

    def do_HEAD(self):
        self.respond(False)

    def do_GET(self):
        self.respond(True)

    def respond(self, include_body):
        path = urllib.parse.urlsplit(self.path).path
        filename = None
        if path == '/':
            data, mime = PAGE.encode(), 'text/html; charset=utf-8'
        elif path == '/remote.apk' and APK.is_file():
            data, mime = APK.read_bytes(), 'application/vnd.android.package-archive'
            filename = APK.name
        elif path == '/qr.png' and QR.is_file():
            data, mime = QR.read_bytes(), 'image/png'
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if filename:
            self.send_header('Content-Disposition', 'attachment; filename="%s"' % filename)
        self.end_headers()
        if include_body:
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def log_message(self, fmt, *args):
        # Log requests, not headers or credentials. No filesystem browsing route exists.
        print('%s %s' % (self.client_address[0], fmt % args), flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--bind', default='192.168.1.11')
    parser.add_argument('--port', type=int, default=4175)
    args = parser.parse_args()
    if not APK.is_file():
        raise SystemExit('Build the phone APK first: python3 scripts/build_phone_remote.py')
    print('Phone installation: http://%s:%s/' % (args.bind, args.port), flush=True)
    ThreadingHTTPServer((args.bind, args.port), Handler).serve_forever()
