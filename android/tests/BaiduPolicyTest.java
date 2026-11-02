package com.pipi.kids;

public final class BaiduPolicyTest {
    interface Action { void run() throws Exception; }
    static void rejected(Action action) throws Exception { try { action.run(); throw new AssertionError("Expected rejection"); } catch (AssertionError error) { throw error; } catch (Exception expected) {} }
    public static void main(String[] args) throws Exception {
        BaiduPolicy.remote("/apps/皮皮课堂"); BaiduPolicy.remote("/apps/皮皮课堂/英语/古力小超人");
        for (String path : new String[]{"/apps/皮皮课堂2", "/apps/其他应用", "/apps/皮皮课堂/../私人", "/apps/皮皮课堂//英语", "/apps/皮皮课堂/英语/", "/apps/皮皮课堂/英语\\其他", "/apps/皮皮课堂/\nprivate"}) rejected(() -> BaiduPolicy.remote(path));
        BaiduPolicy.https("https://d.pcs.baidu.com/file?sign=opaque", false); BaiduPolicy.https("https://example.baidupcs.com/file", false);
        BaiduPolicy.https("https://openapi.baidu.com/device/qrcode/example", true);
        for (String url : new String[]{"http://pan.baidu.com/file", "https://baidu.com.evil.test/file", "https://pan.baidu.com@evil.test/file", "https://pan.baidu.com:444/file", "file:///tmp/file", "/relative", "https://127.0.0.1/file", "https://pan.baidu.com/file#fragment"}) rejected(() -> BaiduPolicy.https(url, false));
        rejected(() -> BaiduPolicy.https("https://pan.baidu.com/device", true));
        if (!BaiduPolicy.segment(123, "Old title.mp4", false).equals(BaiduPolicy.segment(123, "Renamed title.mp4", false))) throw new AssertionError("Filename changed stable identity");
        if (BaiduPolicy.within("/baidu/account/12/4.mp4", "/baidu/account/1")) throw new AssertionError("Sibling scope escaped");
        rejected(() -> BaiduPolicy.segment(0, "video.mp4", false)); rejected(() -> BaiduPolicy.account("other-account"));
        System.out.println("BaiduPolicyTest passed: directory/URL boundaries, account isolation and stable file IDs");
    }
}
