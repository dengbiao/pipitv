package com.pipi.remote;

import android.Manifest;
import android.app.*;
import android.bluetooth.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.*;
import java.util.ArrayDeque;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Owns the HID registration while the user switches through system pairing screens. */
public final class HidService extends Service {
    public static final String STOP="com.pipi.remote.STOP";
    private static final String CHANNEL="pipi_remote_connection";
    private static final int NOTIFICATION=14;
    public interface Listener { void changed(State state); }
    public static final class State {
        public final boolean registered,connected;
        public final String message,device;
        State(boolean r,boolean c,String m,String d){registered=r;connected=c;message=m;device=d;}
    }
    public final class LocalBinder extends Binder { public HidService service(){return HidService.this;} }
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ExecutorService callbacks=Executors.newSingleThreadExecutor();
    private final LocalBinder binder=new LocalBinder();
    private final HidReports.PointerBuffer pointer=new HidReports.PointerBuffer();
    private final ArrayDeque<Tap> taps=new ArrayDeque<>();
    private BluetoothAdapter adapter;
    private BluetoothHidDevice hid;
    private BluetoothDevice device,desired;
    private Listener listener;
    private boolean registered,requesting,destroyed,running,frameQueued,tapRunning,receiverRegistered;
    private int buttons,inputGeneration;
    private byte[] keyboard=new byte[8],consumer=new byte[2];
    private byte leds;
    private String message="正在准备蓝牙鼠标…";

    @Override public void onCreate(){
        super.onCreate();
        BluetoothManager manager=getSystemService(BluetoothManager.class);
        adapter=manager==null?null:manager.getAdapter();
        NotificationManager notifications=getSystemService(NotificationManager.class);
        notifications.createNotificationChannel(new NotificationChannel(CHANNEL,"电视鼠标连接",NotificationManager.IMPORTANCE_LOW));
        IntentFilter filter=new IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED);
        if(Build.VERSION.SDK_INT>=33)registerReceiver(bluetoothChanged,filter,Context.RECEIVER_EXPORTED);
        else registerReceiver(bluetoothChanged,filter);
        receiverRegistered=true;
    }
    @Override public int onStartCommand(Intent intent,int flags,int id){
        if(intent!=null && STOP.equals(intent.getAction())){
            closeProfile();running=false;status("蓝牙鼠标服务已结束，需要时可重新开始配对。");
            stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();return START_NOT_STICKY;
        }
        try{
            running=true;
            if(Build.VERSION.SDK_INT>=29)startForeground(NOTIFICATION,notification(),android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
            else startForeground(NOTIFICATION,notification());
            startProfile();
        }catch(RuntimeException e){status("无法启动蓝牙连接，请重新允许附近设备权限");stopSelf();}
        return START_NOT_STICKY;
    }
    @Override public IBinder onBind(Intent intent){return binder;}
    @Override public void onTaskRemoved(Intent rootIntent){stopSelf();}
    public void setListener(Listener value){listener=value;if(value!=null)value.changed(state());}
    public State state(){return new State(registered,ready(),message,name(device));}
    private boolean permission(){return Build.VERSION.SDK_INT<31 || checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)==PackageManager.PERMISSION_GRANTED;}
    private boolean ready(){return running && !destroyed && permission() && registered && hid!=null && device!=null;}
    private String name(BluetoothDevice d){
        if(d==null)return "";
        try{return d.getName()==null?d.getAddress():d.getName();}catch(SecurityException e){return "已连接设备";}
    }
    private void status(String text){
        if(destroyed)return;
        message=text;
        if(running)getSystemService(NotificationManager.class).notify(NOTIFICATION,notification());
        if(listener!=null)listener.changed(state());
    }
    private Notification notification(){
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,HidService.class).setAction(STOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this,CHANNEL).setSmallIcon(R.drawable.ic_stat_mouse)
            .setContentTitle("PIPI 遥控助手").setContentText(message).setContentIntent(open)
            .setOngoing(true).setOnlyAlertOnce(true).addAction(new Notification.Action.Builder(null,"结束连接",stop).build()).build();
    }
    public void startProfile(){
        if(destroyed || requesting || registered)return;
        if(!permission()){status("请允许附近设备权限后重试");return;}
        if(adapter==null){status("这台手机没有蓝牙功能");return;}
        try{
            if(!adapter.isEnabled()){status("请先打开手机蓝牙");return;}
            requesting=true;
            main.removeCallbacks(profileTimeout);main.postDelayed(profileTimeout,10000);
            if(hid!=null){register();return;}
            status("正在准备蓝牙鼠标…");
            if(!adapter.getProfileProxy(this,profile,BluetoothProfile.HID_DEVICE)){
                main.removeCallbacks(profileTimeout);requesting=false;status("手机系统未提供蓝牙鼠标功能，无法建立连接");return;
            }
        }catch(RuntimeException e){main.removeCallbacks(profileTimeout);requesting=false;status("蓝牙鼠标启动失败，请关闭其他遥控 App 后重试");}
    }
    private final Runnable profileTimeout=()->{
        if(!registered){requesting=false;status("手机没有响应蓝牙鼠标注册，请检查系统是否支持 HID Device");}
    };
    private final BluetoothProfile.ServiceListener profile=new BluetoothProfile.ServiceListener(){
        @Override public void onServiceConnected(int which,BluetoothProfile proxy){main.post(()->{
            if(destroyed || !running){if(adapter!=null)adapter.closeProfileProxy(which,proxy);return;}
            if(which==BluetoothProfile.HID_DEVICE){hid=(BluetoothHidDevice)proxy;register();}
        });}
        @Override public void onServiceDisconnected(int which){main.post(()->{
            if(destroyed)return;
            resetInput();hid=null;device=null;registered=false;requesting=false;
            status("蓝牙服务已断开，点“开始配对”重试");
        });}
    };
    private void register(){
        if(hid==null || registered)return;
        try{
            BluetoothHidDeviceAppSdpSettings sdp=new BluetoothHidDeviceAppSdpSettings(
                "PIPI Remote","Mouse and keyboard for your TV","PIPI",BluetoothHidDevice.SUBCLASS1_COMBO,HidReports.DESCRIPTOR);
            BluetoothHidDeviceAppQosSettings qos=new BluetoothHidDeviceAppQosSettings(
                BluetoothHidDeviceAppQosSettings.SERVICE_BEST_EFFORT,6000,1024,10000,11250,11250);
            if(!hid.registerApp(sdp,qos,qos,callbacks,callback)){
                main.removeCallbacks(profileTimeout);requesting=false;status("系统未接受注册，请关闭其他蓝牙鼠标 App 后重试");
            }
        }catch(RuntimeException e){main.removeCallbacks(profileTimeout);requesting=false;status("蓝牙鼠标注册失败，请检查附近设备权限");}
    }
    private final BluetoothHidDevice.Callback callback=new BluetoothHidDevice.Callback(){
        @Override public void onAppStatusChanged(BluetoothDevice plugged,boolean ok){main.post(()->{
            if(destroyed || !running)return;
            main.removeCallbacks(profileTimeout);requesting=false;registered=ok;
            if(!ok){resetInput();device=null;status("蓝牙鼠标已停止，点“开始配对”重新启用");return;}
            if(plugged!=null && hid!=null){
                try{if(hid.getConnectionState(plugged)==BluetoothProfile.STATE_CONNECTED){connected(plugged);return;}}catch(RuntimeException ignored){}
            }
            status("鼠标已就绪，等待电视连接");
            if(desired!=null)connectNow();
        });}
        @Override public void onConnectionStateChanged(BluetoothDevice remote,int state){main.post(()->{
            if(destroyed || !running)return;
            if(state==BluetoothProfile.STATE_CONNECTED){
                if(desired!=null && !desired.equals(remote)){
                    try{hid.disconnect(remote);}catch(RuntimeException ignored){}return;
                }
                connected(remote);
            }else if(state==BluetoothProfile.STATE_CONNECTING){status("正在连接 "+name(remote)+"…");}
            else if(state==BluetoothProfile.STATE_DISCONNECTED){
                if(device!=null && !device.equals(remote))return;
                resetInput();device=null;status("连接已断开，可以重新选择电视");
                if(desired!=null && !desired.equals(remote))connectNow();
            }
        });}
        @Override public void onGetReport(BluetoothDevice remote,byte type,byte id,int size){main.post(()->{
            if(destroyed || hid==null)return;
            byte[] data=null;
            if(type==BluetoothHidDevice.REPORT_TYPE_INPUT){
                if(id==HidReports.KEYBOARD)data=keyboard.clone();
                if(id==HidReports.MOUSE)data=HidReports.mouse(buttons,0,0,0);
                if(id==HidReports.CONSUMER)data=consumer.clone();
            }else if(type==BluetoothHidDevice.REPORT_TYPE_OUTPUT && id==HidReports.KEYBOARD)data=new byte[]{leds};
            try{
                if(data==null)hid.reportError(remote,BluetoothHidDevice.ERROR_RSP_INVALID_RPT_ID);
                else if(size>0 && size<data.length)hid.reportError(remote,BluetoothHidDevice.ERROR_RSP_INVALID_PARAM);
                else hid.replyReport(remote,type,id,data);
            }catch(RuntimeException ignored){}
        });}
        @Override public void onSetReport(BluetoothDevice remote,byte type,byte id,byte[] data){main.post(()->{
            if(destroyed || hid==null)return;
            try{
                if(type==BluetoothHidDevice.REPORT_TYPE_OUTPUT && id==HidReports.KEYBOARD && data!=null && data.length==1){
                    leds=data[0];hid.reportError(remote,BluetoothHidDevice.ERROR_RSP_SUCCESS);
                }else hid.reportError(remote,BluetoothHidDevice.ERROR_RSP_UNSUPPORTED_REQ);
            }catch(RuntimeException ignored){}
        });}
        @Override public void onInterruptData(BluetoothDevice remote,byte id,byte[] data){
            if(id==HidReports.KEYBOARD && data!=null && data.length==1)main.post(()->leds=data[0]);
        }
        @Override public void onVirtualCableUnplug(BluetoothDevice remote){main.post(()->{
            if(destroyed)return;resetInput();device=null;desired=null;status("电视已取消连接，请重新配对");
        });}
    };
    private void connected(BluetoothDevice remote){
        main.removeCallbacks(connectTimeout);resetInput();device=remote;desired=null;
        getSharedPreferences("remote",MODE_PRIVATE).edit().putString("lastAddress",remote.getAddress()).putString("lastName",name(remote)).apply();
        releaseAll();status("已连接，可以控制电视");
    }
    public void connect(String address){
        if(!permission() || adapter==null){status("请先允许附近设备权限");return;}
        try{
            BluetoothDevice target=adapter.getRemoteDevice(address);
            if(target.getBondState()!=BluetoothDevice.BOND_BONDED){status("请先在电视蓝牙设置里与这台手机配对");return;}
            desired=target;
            if(device!=null && !device.equals(target)){
                releaseAll();status("正在切换设备…");hid.disconnect(device);return;
            }
            if(device!=null && device.equals(target)){status("已连接，可以控制电视");return;}
            if(registered)connectNow();else startProfile();
        }catch(RuntimeException e){status("无法连接，请在电视上重新选择这台手机");}
    }
    private void connectNow(){
        if(hid==null || desired==null || !registered)return;
        try{
            status("正在连接 "+name(desired)+"…");
            if(hid.connect(desired)){main.removeCallbacks(connectTimeout);main.postDelayed(connectTimeout,15000);}
            else status("电视暂未接受连接，请在电视蓝牙设置中选择手机");
        }catch(RuntimeException e){status("连接失败，请确认电视已开机并完成蓝牙配对");}
    }
    private final Runnable connectTimeout=()->{
        if(device==null)status("电视未完成连接，请在电视蓝牙设置中选择手机后重试");
    };
    private final BroadcastReceiver bluetoothChanged=new BroadcastReceiver(){
        @Override public void onReceive(Context context,Intent intent){
            // Read actual adapter state rather than trusting broadcast extras.
            if(!permission() || adapter==null)return;
            try{if(!adapter.isEnabled()){resetInput();device=null;registered=false;requesting=false;status("手机蓝牙已关闭");}}
            catch(RuntimeException ignored){}
        }
    };
    private boolean send(int id,byte[] payload){
        if(!ready())return false;
        try{
            boolean ok=hid.sendReport(device,id,payload);
            if(!ok)status("发送未成功，请重新连接电视");
            return ok;
        }catch(RuntimeException e){status("发送失败，请检查蓝牙连接和附近设备权限");return false;}
    }
    public void move(double dx,double dy){if(ready()){pointer.move(dx,dy);scheduleFrame();}}
    public void scroll(double ticks){if(ready()){pointer.scroll(ticks);scheduleFrame();}}
    private void scheduleFrame(){if(!frameQueued){frameQueued=true;main.postDelayed(frame,16);}}
    private final Runnable frame=()->{
        frameQueued=false;
        if(!ready()){pointer.clear();return;}
        if(pointer.pending())send(HidReports.MOUSE,pointer.take(buttons));
        if(pointer.pending())scheduleFrame();
    };
    public void hold(boolean down){
        if(!ready())return;
        cancelTaps();buttons=down?1:0;send(HidReports.MOUSE,HidReports.mouse(buttons,0,0,0));
    }
    private static final class Tap {
        final int id;final byte[] down,up;
        Tap(int id,byte[] down,byte[] up){this.id=id;this.down=down;this.up=up;}
    }
    public void click(int which){if(buttons==0)enqueue(new Tap(HidReports.MOUSE,HidReports.mouse(which,0,0,0),new byte[4]));}
    public void key(int usage){enqueue(new Tap(HidReports.KEYBOARD,HidReports.keyboard(usage),new byte[8]));}
    public void back(){enqueue(new Tap(HidReports.CONSUMER,HidReports.consumer(HidReports.BACK),new byte[2]));}
    private void enqueue(Tap tap){if(ready() && taps.size()<20){taps.add(tap);pump();}}
    private void pump(){
        if(tapRunning || !ready() || taps.isEmpty())return;
        Tap tap=taps.remove();tapRunning=true;int generation=inputGeneration;
        remember(tap.id,tap.down);
        if(!send(tap.id,tap.down)){releaseAll();return;}
        main.postDelayed(()->{
            if(generation!=inputGeneration)return;
            remember(tap.id,tap.up);send(tap.id,tap.up);tapRunning=false;
            main.postDelayed(()->{if(generation==inputGeneration)pump();},35);
        },45);
    }
    private void remember(int id,byte[] payload){
        if(id==HidReports.MOUSE)buttons=payload[0]&7;
        else if(id==HidReports.KEYBOARD)keyboard=payload.clone();
        else if(id==HidReports.CONSUMER)consumer=payload.clone();
    }
    private void cancelTaps(){
        inputGeneration++;taps.clear();tapRunning=false;
        keyboard=new byte[8];consumer=new byte[2];
        send(HidReports.KEYBOARD,keyboard);send(HidReports.CONSUMER,consumer);
    }
    private void resetInput(){
        inputGeneration++;taps.clear();tapRunning=false;buttons=0;
        keyboard=new byte[8];consumer=new byte[2];pointer.clear();
        main.removeCallbacks(frame);frameQueued=false;
    }
    public void releaseAll(){
        resetInput();send(HidReports.MOUSE,new byte[4]);send(HidReports.KEYBOARD,keyboard);send(HidReports.CONSUMER,consumer);
    }
    private void closeProfile(){
        releaseAll();main.removeCallbacks(profileTimeout);main.removeCallbacks(connectTimeout);
        if(hid!=null){
            try{if(device!=null)hid.disconnect(device);hid.unregisterApp();}catch(RuntimeException ignored){}
            if(adapter!=null)adapter.closeProfileProxy(BluetoothProfile.HID_DEVICE,hid);
        }
        hid=null;device=null;desired=null;registered=false;requesting=false;
    }
    @Override public void onDestroy(){
        listener=null;closeProfile();destroyed=true;main.removeCallbacksAndMessages(null);
        if(receiverRegistered){unregisterReceiver(bluetoothChanged);receiverRegistered=false;}
        callbacks.shutdownNow();stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();
    }
}
