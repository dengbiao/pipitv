package com.pipi.kids;

public final class BaiduStreamTest {
    interface Action { void run() throws Exception; }
    static int assertions;
    static void check(boolean value) { if (!value) throw new AssertionError(); assertions++; }
    static void rejects(Action action) throws Exception { try { action.run(); throw new AssertionError("Expected rejection"); } catch (AssertionError e) { throw e; } catch (Exception expected) { assertions++; } }
    public static void main(String[] args) throws Exception {
        check(BaiduStream.quality("garbage").equals("480"));
        check(BaiduStream.quality("original").equals("original"));
        check(BaiduStream.type("720").equals("M3U8_AUTO_720"));
        rejects(() -> BaiduStream.type("original")); rejects(() -> BaiduStream.type("240")); rejects(() -> BaiduStream.type("1080"));
        check(BaiduStream.userAgent("11\r\nsecret").equals("xpanvideo;pipi-classroom;0.1.0;Android;11secret;ts"));
        String base = "https://video.baidupcs.com/video/list.m3u8?sign=opaque";
        BaiduStream.validate("#EXTM3U\n#EXTINF:10,\nsegment.ts?sign=opaque\n#EXT-X-ENDLIST", base); assertions++;
        BaiduStream.validate("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"https://video.baidupcs.com/key\"\n#EXTINF:2,\nhttps://video.baidupcs.com/1.ts", base); assertions++;
        BaiduStream.validate("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000,RESOLUTION=854x480\n480.m3u8", base); assertions++;
        rejects(() -> BaiduStream.validate("{\"errno\":31341}", base));
        rejects(() -> BaiduStream.validate("#EXTM3U\n", base));
        rejects(() -> BaiduStream.validate("#EXTM3U\n#EXTINF:10,\nhttps://evil.example/1.ts", base));
        rejects(() -> BaiduStream.validate("#EXTM3U\n#EXTINF:10,\nhttp://video.baidupcs.com/1.ts", base));
        rejects(() -> BaiduStream.validate("#EXTM3U\n#EXT-X-KEY:URI=\"https://evil.example/key\"\n#EXTINF:10,\n1.ts", base));
        rejects(() -> BaiduStream.validate("#EXTM3U\n#EXTINF:10,\nfile:///private/file", base));
        check(BaiduStream.adWaitSeconds(8) == 8); rejects(() -> BaiduStream.adWaitSeconds(0)); rejects(() -> BaiduStream.adWaitSeconds(121));
        System.out.println("BaiduStream: " + assertions + " quality/HLS boundary checks passed");
    }
}
