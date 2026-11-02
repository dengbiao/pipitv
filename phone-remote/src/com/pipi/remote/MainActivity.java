package com.pipi.remote;

import android.Manifest;
import android.app.*;
import android.bluetooth.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.widget.*;
import java.util.*;

public final class MainActivity extends Activity {
    private static final int CREAM=0xfffcfaf3,INK=0xff344b39,GREEN=0xff496249,MUTED=0xff7c8879;
    private static final int PERMISSIONS=41,ENABLE_BT=42,DISCOVERABLE=43;
    private BluetoothAdapter adapter;
    private HidService service;
    private boolean bound,wantDiscover,connected,showingDiscover;
    private String queuedAddress;
    private Runnable pending;
    private TextView stateText,stateHint,phoneName;
    private LinearLayout root;
    private TouchpadView touchpad;
    private final List<Button> controls=new ArrayList<>();
    private Button stopButton;

    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);
        BluetoothManager manager=getSystemService(BluetoothManager.class);adapter=manager==null?null:manager.getAdapter();
        getWindow().setStatusBarColor(CREAM);getWindow().setNavigationBarColor(CREAM);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        buildUi();refreshPhone();
    }
    private int dp(float x){return Math.round(x*getResources().getDisplayMetrics().density);}
    private GradientDrawable background(int color,int radius){
        GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radius));return d;
    }
    private TextView text(String value,int size,int color,boolean bold){
        TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(color);
        t.setTypeface(Typeface.create(bold?"sans-serif-medium":"sans-serif",Typeface.NORMAL));
        t.setLineSpacing(dp(3),1);return t;
    }
    private void gap(LinearLayout parent,int height){View space=new View(this);parent.addView(space,new LinearLayout.LayoutParams(1,dp(height)));}
    private Button button(String value,boolean solid,Runnable action){
        Button b=new Button(this);b.setText(value);b.setTextSize(14);b.setAllCaps(false);
        b.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));
        b.setTextColor(solid?Color.WHITE:INK);b.setBackground(background(solid?GREEN:0xffefefe7,16));
        b.setPadding(dp(6),dp(7),dp(6),dp(7));b.setMinHeight(dp(48));b.setMinimumHeight(dp(48));
        b.setOnClickListener(v->action.run());return b;
    }
    private LinearLayout row(){LinearLayout r=new LinearLayout(this);r.setOrientation(LinearLayout.HORIZONTAL);return r;}
    private void inRow(LinearLayout row,View view){
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(0,dp(50),1);p.setMargins(dp(3),0,dp(3),0);row.addView(view,p);
    }
    private void control(LinearLayout row,String label,Runnable action){
        Button b=button(label,false,()->{if(service!=null && connected)action.run();});controls.add(b);inRow(row,b);
    }
    private void buildUi(){
        root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(CREAM);
        root.setPadding(0,0,0,0);
        if(Build.VERSION.SDK_INT>=30)root.setOnApplyWindowInsetsListener((view,insets)->{
            android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());
            view.setPadding(bars.left,bars.top,bars.right,bars.bottom);return insets;
        });
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);root.addView(scroll,new LinearLayout.LayoutParams(-1,-1));
        LinearLayout body=new LinearLayout(this);body.setOrientation(LinearLayout.VERTICAL);body.setPadding(dp(20),dp(18),dp(20),dp(24));scroll.addView(body);
        TextView brand=text("PIPI  REMOTE",12,GREEN,true);brand.setLetterSpacing(.18f);body.addView(brand);gap(body,6);
        body.addView(text("手机，就是电视鼠标。",25,INK,true));gap(body,7);
        body.addView(text("用蓝牙连接 · 电视无需安装 App",13,MUTED,false));gap(body,20);
        LinearLayout card=new LinearLayout(this);card.setOrientation(LinearLayout.VERTICAL);card.setPadding(dp(17),dp(16),dp(17),dp(16));
        card.setBackground(background(Color.WHITE,22));body.addView(card,new LinearLayout.LayoutParams(-1,-2));
        stateText=text("尚未连接",17,INK,true);card.addView(stateText);
        stateHint=text("先开始配对，再到电视蓝牙设置中选择这台手机。",13,MUTED,false);card.addView(stateHint);gap(card,10);
        phoneName=text("本机名称：授权后显示",12,MUTED,false);card.addView(phoneName);gap(card,13);
        LinearLayout pairRow=row();
        inRow(pairRow,button("开始配对",true,()->ensureReady(()->begin(null,true))));
        inRow(pairRow,button("已配对的设备",false,()->ensureReady(this::showDevices)));card.addView(pairRow);
        gap(body,16);
        touchpad=new TouchpadView(this,new GestureLogic.Output(){
            public void move(double x,double y){if(service!=null)service.move(x*.85,y*.85);}
            public void scroll(double ticks){if(service!=null)service.scroll(ticks);}
            public void hold(boolean down){if(service!=null)service.hold(down);}
            public void tap(){if(service!=null)service.click(1);}
        });
        body.addView(touchpad,new LinearLayout.LayoutParams(-1,dp(235)));gap(body,12);
        LinearLayout clicks=row();control(clicks,"左键",()->service.click(1));control(clicks,"右键",()->service.click(2));body.addView(clicks);gap(body,9);
        LinearLayout nav=row();control(nav,"返回",()->service.back());control(nav,"Tab",()->service.key(HidReports.TAB));control(nav,"确认",()->service.key(HidReports.ENTER));body.addView(nav);gap(body,9);
        LinearLayout wheel=row();control(wheel,"↑ 向上滚动",()->service.scroll(3));control(wheel,"↓ 向下滚动",()->service.scroll(-3));body.addView(wheel);gap(body,14);
        LinearLayout foot=row();inRow(foot,button("连接说明",false,this::help));
        stopButton=button("结束连接",false,this::stop);inRow(foot,stopButton);body.addView(foot);gap(body,12);
        body.addView(text("首次配对时，在电视上确认配对请求。使用时保持本 App 打开。",12,MUTED,false));
        setContentView(root);setConnected(false);stopButton.setEnabled(false);
    }
    private void setConnected(boolean value){
        connected=value;touchpad.setConnected(value);
        for(Button b:controls){b.setEnabled(value);b.setAlpha(value?1f:.4f);}
        if(value)getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
    private boolean hasPermission(){return Build.VERSION.SDK_INT<31 || (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)==PackageManager.PERMISSION_GRANTED && checkSelfPermission(Manifest.permission.BLUETOOTH_ADVERTISE)==PackageManager.PERMISSION_GRANTED);}
    private void ensureReady(Runnable task){
        pending=task;
        if(adapter==null){alert("手机没有可用蓝牙","当前手机没有蓝牙适配器，无法作为电视鼠标。");pending=null;return;}
        if(!hasPermission()){
            requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT,Manifest.permission.BLUETOOTH_ADVERTISE},PERMISSIONS);return;
        }
        refreshPhone();
        try{
            if(!adapter.isEnabled()){startActivityForResult(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE),ENABLE_BT);return;}
            pending=null;task.run();
        }catch(RuntimeException e){alert("蓝牙尚未就绪","请在手机系统设置中开启蓝牙，再返回重试。");}
    }
    private void refreshPhone(){
        if(adapter==null || !hasPermission())return;
        try{phoneName.setText("电视上选择的本机名称："+adapter.getName());}catch(SecurityException ignored){}
    }
    @Override public void onRequestPermissionsResult(int req,String[] names,int[] results){
        super.onRequestPermissionsResult(req,names,results);
        if(req==PERMISSIONS){
            if(hasPermission() && pending!=null)ensureReady(pending);
            else{
                pending=null;
                new AlertDialog.Builder(this).setTitle("需要附近设备权限").setMessage("蓝牙鼠标需要连接和配对权限。请在应用权限里允许“附近设备”，无需位置权限。")
                    .setPositiveButton("应用设置",(d,w)->startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,android.net.Uri.parse("package:"+getPackageName()))))
                    .setNegativeButton("稍后",null).show();
            }
        }
    }
    @Override protected void onActivityResult(int req,int result,Intent data){
        super.onActivityResult(req,result,data);
        if(req==ENABLE_BT){if(pending!=null && hasPermission() && adapter.isEnabled())ensureReady(pending);else pending=null;}
        if(req==DISCOVERABLE){showingDiscover=false;if(result<=0)Toast.makeText(this,"没有开放被发现。可再次点“开始配对”。",Toast.LENGTH_LONG).show();}
    }
    private void begin(String address,boolean discover){
        queuedAddress=address;wantDiscover=discover;
        stateText.setText("正在启动…");stateHint.setText("正在注册蓝牙鼠标服务");
        try{
            startForegroundService(new Intent(this,HidService.class));
            if(!bound)bound=bindService(new Intent(this,HidService.class),connection,Context.BIND_AUTO_CREATE);
            else if(service!=null){if(queuedAddress!=null){service.connect(queuedAddress);queuedAddress=null;}service.startProfile();render(service.state());}
            stopButton.setEnabled(true);
        }catch(RuntimeException e){stateText.setText("启动失败");stateHint.setText("请允许附近设备权限，并保持 App 在前台后重试。");}
    }
    private final ServiceConnection connection=new ServiceConnection(){
        @Override public void onServiceConnected(ComponentName name,IBinder binder){
            if(!bound)return;
            service=((HidService.LocalBinder)binder).service();service.setListener(MainActivity.this::render);
            if(queuedAddress!=null){service.connect(queuedAddress);queuedAddress=null;}
            render(service.state());stopButton.setEnabled(true);
        }
        @Override public void onServiceDisconnected(ComponentName name){
            service=null;setConnected(false);stateText.setText("连接服务已停止");stateHint.setText("点“开始配对”重新启动。");
        }
    };
    private void render(HidService.State s){
        setConnected(s.connected);stateText.setText(s.connected?"已连接 · "+s.device:s.registered?"等待电视连接":"蓝牙鼠标");
        stateText.setTextColor(s.connected?GREEN:INK);stateHint.setText(s.message);refreshPhone();
        if(s.registered && wantDiscover && !showingDiscover){
            wantDiscover=false;showingDiscover=true;
            root.post(()->{
                try{startActivityForResult(new Intent(BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE).putExtra(BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION,180),DISCOVERABLE);}
                catch(RuntimeException e){showingDiscover=false;alert("无法打开配对提示","请在手机蓝牙设置里允许附近设备发现此手机，再从电视搜索。");}
            });
        }
    }
    private void showDevices(){
        try{
            ArrayList<BluetoothDevice> list=new ArrayList<>(adapter.getBondedDevices());
            Collections.sort(list,(a,b)->deviceLabel(a).compareToIgnoreCase(deviceLabel(b)));
            if(list.isEmpty()){alert("还没有配对设备","先点“开始配对”，再用电视原来的遥控器打开海信的蓝牙设置，搜索并选择这台手机。配对完成后回到此处。");return;}
            String[] labels=new String[list.size()];for(int i=0;i<list.size();i++)labels[i]=deviceLabel(list.get(i));
            new AlertDialog.Builder(this).setTitle("选择要控制的电视").setItems(labels,(d,which)->begin(list.get(which).getAddress(),false)).setNegativeButton("取消",null).show();
        }catch(SecurityException e){alert("需要权限","请允许附近设备权限后重试。");}
    }
    private String deviceLabel(BluetoothDevice d){String name=d.getName();return (name==null?"蓝牙设备":name)+"\n"+d.getAddress();}
    private void help(){
        new AlertDialog.Builder(this).setTitle("第一次连接")
            .setMessage("1. 点“开始配对”，允许蓝牙和被附近设备发现。\n\n2. 用电视原遥控器进入海信自己的“蓝牙 / 外设连接”，搜索并选择上方显示的本机名称，确认配对。\n\n3. 若没有自动连接，点“已配对的设备”选中电视。\n\n4. 连接后单指滑动、轻点左键、双指滚动，长按可拖动。\n\n5. 打开电视的“关于手机”，点击“版本号”7次，再到系统 → 高级 → 开发者选项开启 USB 调试。\n\n需要 Android 9 或以上，且手机系统开放 HID Device；若注册失败，会显示原因。")
            .setPositiveButton("知道了",null).setNeutralButton("手机蓝牙设置",(d,w)->startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS))).show();
    }
    private void alert(String title,String detail){new AlertDialog.Builder(this).setTitle(title).setMessage(detail).setPositiveButton("好",null).show();}
    private void stop(){
        wantDiscover=false;queuedAddress=null;touchpad.cancelGesture();
        if(service!=null){service.releaseAll();service.setListener(null);}
        if(bound){unbindService(connection);bound=false;}service=null;
        stopService(new Intent(this,HidService.class));setConnected(false);stopButton.setEnabled(false);
        stateText.setText("已结束连接");stateHint.setText("蓝牙鼠标服务已关闭，需要时可重新开始配对。");
    }
    @Override protected void onStart(){super.onStart();if(!bound)bound=bindService(new Intent(this,HidService.class),connection,0);}
    @Override protected void onPause(){touchpad.cancelGesture();if(service!=null)service.releaseAll();super.onPause();}
    @Override protected void onStop(){
        if(service!=null)service.setListener(null);
        if(bound){unbindService(connection);bound=false;}service=null;super.onStop();
    }
}
