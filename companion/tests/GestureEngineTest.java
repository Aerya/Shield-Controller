package org.shieldcontroller.remote;
import java.util.*;
public final class GestureEngineTest {
    static class Clock implements GestureEngine.Scheduler {
        long now;
        final Map<Runnable,Long> jobs = new LinkedHashMap<>();
        public Object later(Runnable r, long ms) { jobs.put(r, now + ms); return r; }
        public void cancel(Object r) { jobs.remove(r); }
        void advance(long ms) {
            long end = now + ms;
            while (true) {
                Runnable next = null; long due = Long.MAX_VALUE;
                for (Map.Entry<Runnable,Long> e : jobs.entrySet()) if (e.getValue() < due) { due = e.getValue(); next = e.getKey(); }
                if (next == null || due > end) break;
                now = due; jobs.remove(next); next.run();
            }
            now = end;
        }
    }
    static void check(boolean b) { if (!b) throw new AssertionError(); }
    public static void main(String[] args) {
        Clock c = new Clock(); List<String> hits = new ArrayList<>();
        GestureEngine e = new GestureEngine(c, hits::add);
        GestureEngine.Binding b = new GestureEngine.Binding("tap", "hold", "double");
        check(!e.event(26, true, 0, false, b)); check(!e.event(19, true, 0, false, b));
        check(!e.event(82, true, 0, false, null));
        check(e.event(82, true, 0, false, b)); check(e.event(82, false, 0, false, b));
        c.advance(299); check(hits.isEmpty()); c.advance(1); check(hits.equals(Arrays.asList("tap"))); hits.clear();
        e.event(82, true, 0, false, b); e.event(82, false, 0, false, b); c.advance(100);
        e.event(82, true, 0, false, b); e.event(82, false, 0, false, b); c.advance(1000);
        check(hits.equals(Arrays.asList("double"))); hits.clear();
        e.event(82, true, 0, false, b); c.advance(600); check(e.event(82, true, 1, false, b));
        e.event(82, false, 0, false, b); c.advance(1000); check(hits.equals(Arrays.asList("hold"))); hits.clear();
        e.event(82, true, 0, false, b); e.event(82, false, 0, true, b); c.advance(1000); check(hits.isEmpty());
        e.event(82, true, 0, false, b); e.event(82, false, 0, false, b); e.clear(); c.advance(1000); check(hits.isEmpty());
        e.event(82, true, 0, false, b); e.event(82, false, 0, false, b); c.advance(100);
        e.event(82, true, 0, false, b); c.advance(600); e.event(82, false, 0, false, b);
        check(hits.equals(Arrays.asList("tap", "hold"))); hits.clear();
        e.event(82, true, 0, false, b); e.clear(); c.advance(1000);
        check(e.event(82, false, 0, false, null)); check(hits.isEmpty());
        GestureEngine.Binding simple = new GestureEngine.Binding("tap", null, null);
        e.event(82, true, 0, false, simple); c.advance(2000); e.event(82, false, 0, false, simple);
        check(hits.equals(Arrays.asList("tap"))); hits.clear();
        e.event(82, true, 0, false, b); e.event(4, true, 0, false, b);
        e.event(82, false, 0, false, b); e.event(4, false, 0, false, b); c.advance(300);
        check(hits.equals(Arrays.asList("tap", "tap")));
        System.out.println("GestureEngine: single/double/long/cancel/reset/repeat/concurrent/protected keys passed");
    }
}
