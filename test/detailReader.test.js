import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readDetail } from '../public/js/utils/detailReader.js';
import { polarJsonToTcx } from '../src/services/importConverters.ts';

/** @typedef {import('../types/domain.ts').DetailData} DetailData */
/** @typedef {import('../src/services/importConverters.ts').ExportSession} ExportSession */

const FIXTURES = path.join(import.meta.dirname, 'fixtures');

/**
 * A TCX around the given laps, with the namespaces Polar declares.
 *
 * @param {string} laps
 */
function tcx(laps) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities><Activity Sport="Running"><Id>2000-01-01T08:00:00.000Z</Id>${laps}</Activity></Activities>
</TrainingCenterDatabase>`;
}

/** @param {string} trackpoints */
function lap(trackpoints, { heartRate = true } = {}) {
  return `<Lap StartTime="2000-01-01T08:00:00.000Z">
  <TotalTimeSeconds>300.5</TotalTimeSeconds>
  <DistanceMeters>1000</DistanceMeters>
  ${heartRate ? '<AverageHeartRateBpm><Value>150</Value></AverageHeartRateBpm>' : ''}
  ${heartRate ? '<MaximumHeartRateBpm><Value>165</Value></MaximumHeartRateBpm>' : ''}
  <Track>${trackpoints}</Track>
</Lap>`;
}

/** @param {string} inner */
function trackpoint(inner) {
  return `<Trackpoint><Time>2000-01-01T08:00:01.000Z</Time>${inner}</Trackpoint>`;
}

/** @param {string} xml */
function read(xml) {
  return /** @type {DetailData} */ (readDetail({ tcx: xml }));
}

test('laps carry duration, distance and heart rate, numbered from 1', () => {
  const detail = read(tcx(lap('') + lap('')));
  assert.deepEqual(detail.laps, [
    { index: 1, duration: 300.5, distance: 1000, avgHR: 150, maxHR: 165 },
    { index: 2, duration: 300.5, distance: 1000, avgHR: 150, maxHR: 165 },
  ]);
});

test('a lap without heart rate has null heart rates', () => {
  const detail = read(tcx(lap(trackpoint('<DistanceMeters>3</DistanceMeters>'), { heartRate: false })));
  assert.deepEqual(detail.laps, [{ index: 1, duration: 300.5, distance: 1000, avgHR: null, maxHR: null }]);
  assert.equal(detail.allTrackpoints[0].heartRate, null);
});

test('a trackpoint carries its time, position, heart rate, speed, distance and cadence', () => {
  const detail = read(tcx(lap(trackpoint(`
    <Position><LatitudeDegrees>0.001</LatitudeDegrees><LongitudeDegrees>0.002</LongitudeDegrees></Position>
    <DistanceMeters>12.5</DistanceMeters>
    <HeartRateBpm><Value>142</Value></HeartRateBpm>
    <Cadence>84</Cadence>
    <Extensions><ns3:TPX><ns3:Speed>3.1</ns3:Speed></ns3:TPX></Extensions>`))));
  assert.deepEqual(detail.allTrackpoints, [{
    time: '2000-01-01T08:00:01.000Z', lat: 0.001, lon: 0.002, heartRate: 142, speed: 3.1, distance: 12.5, cadence: 84,
  }]);
  assert.deepEqual(detail.route, [[0.001, 0.002]]);
});

test('speed reads the same under ns3:, under no prefix and under any other prefix', () => {
  const speeds = [
    '<ns3:TPX><ns3:Speed>2.5</ns3:Speed></ns3:TPX>',
    '<TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2"><Speed>2.5</Speed></TPX>',
    '<ax:TPX xmlns:ax="http://www.garmin.com/xmlschemas/ActivityExtension/v2"><ax:Speed>2.5</ax:Speed></ax:TPX>',
  ].map((tpx) => read(tcx(lap(trackpoint(`<Extensions>${tpx}</Extensions>`)))).allTrackpoints[0].speed);
  assert.deepEqual(speeds, [2.5, 2.5, 2.5]);
});

test('a TCX element under a prefix reads like one without', () => {
  const xml = `<tc:TrainingCenterDatabase xmlns:tc="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
    <tc:Activities><tc:Activity><tc:Lap><tc:TotalTimeSeconds>60</tc:TotalTimeSeconds><tc:Track>
      <tc:Trackpoint><tc:HeartRateBpm><tc:Value>120</tc:Value></tc:HeartRateBpm></tc:Trackpoint>
    </tc:Track></tc:Lap></tc:Activity></tc:Activities></tc:TrainingCenterDatabase>`;
  const detail = read(xml);
  assert.equal(detail.laps[0].duration, 60);
  assert.equal(detail.allTrackpoints[0].heartRate, 120);
});

test('cadence is read when present, under a prefix or not, and null when missing or malformed', () => {
  const cadences = [
    '<Cadence>86</Cadence>',
    '<tc:Cadence xmlns:tc="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">86</tc:Cadence>',
    '',
    '<Cadence>quick</Cadence>',
  ].map((inner) => read(tcx(lap(trackpoint(inner)))).allTrackpoints[0].cadence);
  assert.deepEqual(cadences, [86, 86, null, null]);
});

test('a missing or malformed number is null, never NaN', () => {
  const detail = read(tcx(lap([
    trackpoint(''),
    trackpoint('<DistanceMeters>abc</DistanceMeters>'),
    trackpoint('<DistanceMeters></DistanceMeters><HeartRateBpm><Value>x</Value></HeartRateBpm>'),
    trackpoint('<Extensions><TPX><Speed>fast</Speed></TPX></Extensions>'),
  ].join(''))));
  for (const tp of detail.allTrackpoints) {
    assert.equal(tp.distance, null);
    assert.equal(tp.heartRate, null);
    assert.equal(tp.speed, null);
  }
});

test('a trackpoint without position adds nothing to the route', () => {
  const detail = read(tcx(lap(trackpoint('<Position><LatitudeDegrees>1</LatitudeDegrees></Position>'))));
  assert.deepEqual(detail.route, []);
  assert.equal(detail.allTrackpoints[0].lat, 1);
});

test('the synthetic heart rate fixture reads every trackpoint', () => {
  const xml = readFileSync(path.join(FIXTURES, 'hr-short.tcx'), 'utf8');
  const detail = read(xml);
  const count = xml.match(/<Trackpoint>/g)?.length;
  assert.equal(detail.allTrackpoints.length, count);
  assert.ok(detail.allTrackpoints.every((tp) => tp.heartRate !== null && tp.distance !== null));
  assert.deepEqual(detail.route, []);
});

test('a GPX-only exercise gives its route with empty laps and trackpoints', () => {
  const gpx = `<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>
  <trkpt lat="0.001" lon="0.002"><ele>10</ele></trkpt>
  <trkpt lon='0.004' lat='0.003'/>
  <trkpt lat="bad" lon="0.005"/>
</trkseg></trk></gpx>`;
  assert.deepEqual(readDetail({ gpx }), {
    laps: [],
    allTrackpoints: [],
    route: [[0.001, 0.002], [0.003, 0.004]],
  });
});

test('a TCX wins over a GPX', () => {
  const detail = readDetail({ tcx: tcx(lap('')), gpx: '<gpx><trkpt lat="1" lon="2"/></gpx>' });
  assert.equal(detail?.laps.length, 1);
  assert.deepEqual(detail?.route, []);
});

test('neither TCX nor GPX gives null', () => {
  assert.equal(readDetail({}), null);
  assert.equal(readDetail({ tcx: null, gpx: null }), null);
});

test('comments, CDATA and entities do not disturb the reading', () => {
  const detail = read(tcx(lap(trackpoint(
    '<!-- <DistanceMeters>9</DistanceMeters> --><DistanceMeters><![CDATA[7]]></DistanceMeters>'
    + '<HeartRateBpm><Value>&#49;40</Value></HeartRateBpm>',
  ))));
  assert.equal(detail.allTrackpoints[0].distance, 7);
  assert.equal(detail.allTrackpoints[0].heartRate, 140);
});

test('polarJsonToTcx → readDetail gives back the session speeds and heart rates', () => {
  /** @type {{ dateTime: string, value: number }[]} */
  const heartRate = [];
  /** @type {{ dateTime: string, value: number }[]} */
  const speed = [];
  /** @type {{ dateTime: string, value: number }[]} */
  const distance = [];
  for (let i = 0; i <= 600; i += 10) {
    const dateTime = new Date(Date.UTC(2000, 0, 1, 8, 0, i)).toISOString().replace('Z', '');
    heartRate.push({ dateTime, value: 140 + (i % 25) });
    speed.push({ dateTime, value: 10 + (i % 7) / 10 });
    distance.push({ dateTime, value: i * 3 });
  }
  /** @type {ExportSession} */
  const session = {
    exercises: [{
      sport: 'RUNNING',
      startTime: '2000-01-01T08:00:00.000',
      duration: 'PT600S',
      distance: 1800,
      samples: { heartRate, speed, distance },
    }],
  };

  const detail = read(polarJsonToTcx(session));
  assert.deepEqual(detail.allTrackpoints.map((tp) => tp.heartRate), heartRate.map((s) => s.value));
  assert.deepEqual(detail.allTrackpoints.map((tp) => tp.speed), speed.map((s) => s.value));
  assert.deepEqual(detail.allTrackpoints.map((tp) => tp.distance), distance.map((s) => s.value));
});
