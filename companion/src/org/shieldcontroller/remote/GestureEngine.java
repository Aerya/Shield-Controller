package org.shieldcontroller.remote;

import java.util.HashMap;
import java.util.Map;

/** Pure gesture state machine. A consumed down always owns its matching up. */
final class GestureEngine {
    interface Scheduler { Object later(Runnable task, long ms); void cancel(Object token); }
    interface Sink { void fire(String action); }
    static final class Binding {
        final String tap, hold, twice;
        Binding(String tap, String hold, String twice) { this.tap = tap; this.hold = hold; this.twice = twice; }
    }
    private static final class State {
        Binding binding; boolean down, held, second; Object holdTask, tapTask;
    }
    private final Map<Integer, State> states = new HashMap<>();
    private final Scheduler scheduler;
    private final Sink sink;
    GestureEngine(Scheduler scheduler, Sink sink) { this.scheduler = scheduler; this.sink = sink; }
    static boolean allowed(int key) {
        return key == 3 || key == 4 || key == 82 || key == 84 || (key >= 85 && key <= 90)
            || key == 126 || key == 127 || key == 172 || (key >= 183 && key <= 190);
    }
    boolean event(int key, boolean down, int repeat, boolean canceled, Binding binding) {
        State s = states.get(key);
        if (down) {
            if (s != null && s.down) return true;
            if (repeat != 0 || binding == null || !allowed(key)) return false;
            if (s == null) { s = new State(); states.put(key, s); }
            s.second = s.tapTask != null;
            if (s.tapTask != null) scheduler.cancel(s.tapTask);
            s.tapTask = null; s.binding = binding; s.down = true; s.held = false;
            final State state = s;
            if (binding.hold != null) s.holdTask = scheduler.later(() -> {
                state.held = true; state.holdTask = null;
                // A held second press is a separate gesture, following the first tap.
                if (state.second) sink.fire(state.binding.tap);
                sink.fire(state.binding.hold);
            }, 600);
            return true;
        }
        if (s == null || !s.down) return false;
        s.down = false;
        if (s.holdTask != null) scheduler.cancel(s.holdTask);
        s.holdTask = null;
        if (canceled || s.held) { states.remove(key); return true; }
        if (s.second && s.binding.twice != null) { sink.fire(s.binding.twice); states.remove(key); }
        else if (s.binding.twice != null) {
            final State state = s;
            s.tapTask = scheduler.later(() -> { states.remove(key); sink.fire(state.binding.tap); }, 300);
        } else { sink.fire(s.binding.tap); states.remove(key); }
        return true;
    }
    void clear() {
        for (State s : states.values()) {
            if (s.holdTask != null) scheduler.cancel(s.holdTask);
            if (s.tapTask != null) scheduler.cancel(s.tapTask);
        }
        // Keep ownership of a held key until its up, but cancel all delayed actions.
        states.entrySet().removeIf(entry -> {
            State s = entry.getValue();
            s.holdTask = null; s.tapTask = null; s.held = true;
            return !s.down;
        });
    }
}
