#!/usr/bin/env python3
"""Serve just the public installation page and APK on the current Wi-Fi interface."""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import argparse
import html
import urllib.parse

ROOT = Path(__file__).resolve().parents[1]
APK = ROOT / 'outputs/PIPI-KIDS-0.1.0-dev.apk'
PAGE = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PIPI KIDS 安装</title>
<style>body{margin:0;background:#fcfbf6;color:#43563e;font:22px/1.8 system-ui,sans-serif}main{max-width:760px;margin:7vh auto;padding:30px}img{width:250px}h1{font-size:40px;line-height:1.3}a{display:inline-block;background:#435f3b;color:white;padding:16px 30px;border-radius:20px;text-decoration:none;font-weight:700}small{color:#859078}p{margin:26px 0}</style>
<main><img src="/logo.png" alt="PIPI KIDS"><h1>给好奇心，留一个入口。</h1><p>电视存储与 U 盘内容快捷入口，支持家长计时管理。</p><a href="/install.apk" autofocus>下载电视安装包</a><p>下载完成后，在电视的下载列表或文件管理器里打开安装包，按电视提示安装。也可以先下载到手机或电脑，再通过文件投屏或 U 盘发送到电视。</p><small>0.1.0 · 开发预览版 · Android 5.0 及以上 · 具体电视兼容性仍需上机验证</small></main><script>document.querySelector('a').focus()</script></html>'''

class Handler(BaseHTTPRequestHandler):
    def do_HEAD(self): self.respond(False)
    def do_GET(self): self.respond(True)
    def respond(self, body):
        path = urllib.parse.urlsplit(self.path).path
        if path == '/': data = PAGE.encode(); mime = 'text/html; charset=utf-8'; attachment = False
        elif path == '/logo.png': data = (ROOT / 'public/art/logo.png').read_bytes(); mime = 'image/png'; attachment = False
        elif path == '/install.apk' and APK.exists(): data = APK.read_bytes(); mime = 'application/vnd.android.package-archive'; attachment = True
        else: self.send_error(404); return
        self.send_response(200); self.send_header('Content-Type', mime); self.send_header('Content-Length', str(len(data))); self.send_header('Cache-Control', 'no-store')
        if attachment: self.send_header('Content-Disposition', 'attachment; filename="PIPI-KIDS-0.1.0-dev.apk"')
        self.end_headers()
        if body: self.wfile.write(data)
    def log_message(self, format, *args):
        # Record delivery status only; never log credentials or request headers.
        print('%s %s' % (self.client_address[0], format % args), flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--bind', default='192.168.1.11'); parser.add_argument('--port', type=int, default=4174); args = parser.parse_args()
    print('Installation page: http://%s:%s/' % (args.bind, args.port), flush=True)
    ThreadingHTTPServer((args.bind, args.port), Handler).serve_forever()
