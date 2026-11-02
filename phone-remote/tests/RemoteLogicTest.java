package com.pipi.remote;

import java.util.*;

public final class RemoteLogicTest {
    static int count;
    static void check(boolean condition,String message) {
        count++; if (!condition) throw new AssertionError(message);
    }
    static final class Recorder implements GestureLogic.Output {
        List<String> events=new ArrayList<>();
        public void move(double x,double y){events.add("move");}
        public void scroll(double x){events.add("scroll");}
        public void hold(boolean down){events.add(down?"down":"up");}
        public void tap(){events.add("tap");}
    }
    public static void main(String[] ignored) {
        Map<Integer,Integer> input=new HashMap<>(),output=new HashMap<>();
        int id=0,size=0,n=0,depth=0;
        byte[] desc=HidReports.DESCRIPTOR;
        for(int p=0;p<desc.length;) {
            int prefix=desc[p++]&255,len=prefix&3;if(len==3)len=4;
            int value=0;for(int k=0;k<len;k++)value|=(desc[p++]&255)<<(8*k);
            int tag=prefix&0xfc;
            if(tag==0x84)id=value;else if(tag==0x74)size=value;else if(tag==0x94)n=value;
            else if(tag==0x80)input.put(id,input.getOrDefault(id,0)+size*n);
            else if(tag==0x90)output.put(id,output.getOrDefault(id,0)+size*n);
            else if(tag==0xa0)depth++;else if(tag==0xc0)depth--;
        }
        check(depth==0,"balanced HID collections");
        check(input.get(1)==64,"keyboard descriptor is eight bytes");
        check(input.get(2)==32,"mouse descriptor is four bytes");
        check(input.get(3)==16,"consumer descriptor is two bytes");
        check(output.get(1)==8,"keyboard LED output is one byte");
        byte[] m=HidReports.mouse(255,128,-128,700);
        check(m[0]==7 && m[1]==127 && m[2]==-127 && m[3]==127,"clamping avoids signed overflow");
        check(HidReports.keyboard(HidReports.TAB)[2]==0x2b,"Tab is a real keyboard usage");
        check(Arrays.equals(HidReports.consumer(HidReports.BACK),new byte[]{0x24,0x02}),"Back consumer usage is little endian");
        HidReports.PointerBuffer b=new HidReports.PointerBuffer();
        b.move(300.75,-255.5);b.scroll(2.5);int x=0,y=0,w=0;
        while(b.pending()){m=b.take(1);x+=m[1];y+=m[2];w+=m[3];check(m[0]==1,"movement retains drag button");}
        check(x==300 && y==-255 && w==2,"large motion is split without dropping pixels");
        b.move(.5,-.5);b.scroll(.5);m=b.take(0);
        check(m[1]==1 && m[2]==-1 && m[3]==1,"fractional movement retained across frames");
        b.move(Double.NaN,Double.POSITIVE_INFINITY);check(!b.pending(),"nonfinite input is ignored");
        b.move(10,10);b.clear();check(!b.pending(),"disconnect clears pending movement");
        Recorder r=new Recorder();GestureLogic g=new GestureLogic(r,8,40);
        g.down(0,0,0);g.up(100);check(r.events.equals(Arrays.asList("tap")),"short stationary touch clicks once");
        r.events.clear();g.down(0,0,0);g.move(30,0);g.up(100);check(r.events.equals(Arrays.asList("move")),"moving does not click");
        r.events.clear();g.down(0,0,0);g.longPress();g.move(20,10);g.cancel();
        check(r.events.equals(Arrays.asList("down","move","up")),"cancel releases a drag");
        r.events.clear();g.down(0,0,0);g.longPress();g.twoFingers(20);g.scrollMove(60);g.fingerLifted();g.up(100);
        check(r.events.equals(Arrays.asList("down","up","scroll")),"two fingers release drag and never create a phantom click");
        r.events.clear();g.down(0,0,0);g.twoFingers(20);g.fingerLifted();g.move(50,50);g.up(90);
        check(r.events.isEmpty(),"remaining finger cannot jump cursor after scroll");
        System.out.println("PASS: "+count+" HID and gesture checks");
    }
}
