package com.pipi.remote;

import android.content.Context;
import android.graphics.*;
import android.os.Handler;
import android.os.Looper;
import android.view.*;

public final class TouchpadView extends View {
    private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final GestureLogic gesture;
    private boolean connected,active;
    private float touchX,touchY;
    private final float density;
    private final Runnable hold;
    public TouchpadView(Context context,GestureLogic.Output output){
        super(context);density=getResources().getDisplayMetrics().density;
        gesture=new GestureLogic(output,10*density,42*density);
        hold=()->{if(gesture.longPress())performHapticFeedback(HapticFeedbackConstants.LONG_PRESS);};
        setContentDescription("电视触摸板。单指滑动移动，轻点左键，双指滚动，长按拖动。");
        setFocusable(true);setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES);
    }
    public void setConnected(boolean value){connected=value;if(!value)cancelGesture();invalidate();}
    public void cancelGesture(){handler.removeCallbacks(hold);gesture.cancel();active=false;invalidate();}
    @Override protected void onDraw(Canvas c){
        super.onDraw(c);float w=getWidth(),h=getHeight();
        paint.setColor(Color.rgb(233,239,228));c.drawRoundRect(0,0,w,h,28*density,28*density,paint);
        paint.setColor(Color.rgb(204,216,198));
        for(float x=22*density;x<w;x+=24*density)for(float y=22*density;y<h;y+=24*density)c.drawCircle(x,y,1.2f*density,paint);
        if(active){paint.setColor(0x28496249);c.drawCircle(touchX,touchY,29*density,paint);}
        float cx=w/2,cy=h*.32f;
        Path pointer=new Path();pointer.moveTo(cx-12*density,cy-15*density);pointer.lineTo(cx-9*density,cy+20*density);
        pointer.lineTo(cx,cy+11*density);pointer.lineTo(cx+8*density,cy+25*density);pointer.lineTo(cx+15*density,cy+21*density);
        pointer.lineTo(cx+7*density,cy+7*density);pointer.lineTo(cx+22*density,cy+6*density);pointer.close();
        paint.setColor(connected?Color.rgb(73,98,73):Color.rgb(144,157,137));c.drawPath(pointer,paint);
        paint.setTextAlign(Paint.Align.CENTER);paint.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));paint.setTextSize(22*density);
        c.drawText(connected?"滑动，控制电视光标":"连接后开始控制",cx,h*.62f,paint);
        paint.setTypeface(Typeface.create("sans-serif",Typeface.NORMAL));paint.setTextSize(12*density);
        c.drawText("轻点左键 · 双指滚动 · 长按拖动",cx,h*.77f,paint);
    }
    @Override public boolean onTouchEvent(MotionEvent e){
        if(!connected)return false;
        touchX=e.getX();touchY=e.getY();
        switch(e.getActionMasked()){
            case MotionEvent.ACTION_DOWN:
                getParent().requestDisallowInterceptTouchEvent(true);active=true;
                gesture.down(e.getX(),e.getY(),e.getEventTime());handler.postDelayed(hold,450);break;
            case MotionEvent.ACTION_POINTER_DOWN:
                handler.removeCallbacks(hold);gesture.twoFingers((e.getY(0)+e.getY(1))/2);break;
            case MotionEvent.ACTION_MOVE:
                if(e.getPointerCount()>=2){handler.removeCallbacks(hold);gesture.scrollMove((e.getY(0)+e.getY(1))/2);}
                else gesture.move(e.getX(),e.getY());
                break;
            case MotionEvent.ACTION_POINTER_UP:handler.removeCallbacks(hold);gesture.fingerLifted();break;
            case MotionEvent.ACTION_UP:
                handler.removeCallbacks(hold);gesture.up(e.getEventTime());active=false;
                getParent().requestDisallowInterceptTouchEvent(false);performClick();break;
            case MotionEvent.ACTION_CANCEL:
                cancelGesture();getParent().requestDisallowInterceptTouchEvent(false);break;
        }
        invalidate();return true;
    }
    @Override public boolean performClick(){super.performClick();return true;}
    @Override protected void onDetachedFromWindow(){cancelGesture();super.onDetachedFromWindow();}
}
