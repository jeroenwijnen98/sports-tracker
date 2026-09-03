# Sports Tracker

A personal running dashboard: it pulls runs from a Polar watch, keeps them
locally, and tracks how many kilometres each pair of shoes has done. Only
running counts here — no other sport is stored or shown.

## Language

### Runs

**Exercise**:
One recorded running session, as it comes out of Polar. The unit everything
else hangs off: it carries the distance, duration, heart rate and the shoe it
was run in.
_Avoid_: activity, workout, session, run (as the name of the record)

**Running sport**:
The set of sports that belong in this dashboard: road, trail, treadmill and
ultra running. An exercise in any other sport is not stored at all.
_Avoid_: sport type, discipline

**Overlap**:
The state of an exercise that records the same run a second time, because two
devices were recording at once. An overlapping exercise stays visible but does
not count towards any total.
_Avoid_: duplicate, double, ghost run

**Detail data**:
The per-run trace: its laps, its second-by-second samples and its route. It is
fetched once and kept, because Polar only hands it over once.
_Avoid_: raw data, track data, telemetry

**Lap**:
One segment of an exercise as the watch split it, with its own distance,
duration and heart rate.
_Avoid_: split, interval, segment

**Trackpoint**:
A single sample within an exercise: one moment with a heart rate, a speed and a
cumulative distance.
_Avoid_: datapoint, sample, reading

**Route**:
The GPS line an exercise was run along. Treadmill and indoor runs have none.
_Avoid_: track, path, trace

### Heart rate

**Heart rate sensor**:
Whether a run's heart rate came from a chest strap or from the watch's wrist
sensor. Nothing records this, so it is inferred per exercise and is an
indication rather than a fact.
_Avoid_: HR source, device, strap

**Smoothness**:
How filtered an exercise's heart rate series looks, measured against typical
chest strap runs. Higher means more wrist-like. This is the number to reason
with; the chest-strap/wrist label is only its rounded form.
_Avoid_: confidence, score, texture

### Shoes

**Shoe**:
A pair of running shoes that exercises are assigned to, so its wear can be
followed.
_Avoid_: sneaker, gear, equipment

**Initial km**:
The distance a shoe had already run before it was entered here. Its total is
this plus every exercise assigned to it.
_Avoid_: starting km, offset, baseline

**Default shoe**:
The one shoe that newly synced exercises are assigned to. Exactly one shoe is
the default.
_Avoid_: primary shoe, active shoe, current shoe

### Getting data in

**Sync**:
Pulling exercises from Polar and adding the new ones. Everything already here
is kept: this dashboard is the permanent record, not Polar.
_Avoid_: import, refresh, fetch, pull

## A note on language

Every word the user sees is Dutch. The terms above are the names used in code
and in conversation, not the words on screen.
