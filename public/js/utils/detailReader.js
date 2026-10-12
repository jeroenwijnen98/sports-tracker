// @ts-check

/** @typedef {import('../../../types/domain.ts').DetailData} DetailData */
/** @typedef {import('../../../types/domain.ts').Lap} Lap */
/** @typedef {import('../../../types/domain.ts').Trackpoint} Trackpoint */
/** @typedef {import('../../../types/domain.ts').Route} Route */

/**
 * An element as the reader sees it: its local name (any namespace prefix
 * dropped), its attributes by local name, its children and its own text.
 * @typedef {object} XmlNode
 * @property {string} name
 * @property {Record<string, string>} attrs
 * @property {XmlNode[]} children
 * @property {string} text
 */

/**
 * Detail data from an exercise's TCX, or from its GPX when there is no TCX
 * (the route only, with empty laps and trackpoints). Null with neither.
 *
 * @param {{ tcx?: string | null, gpx?: string | null }} sources
 * @returns {DetailData | null}
 */
export function readDetail({ tcx, gpx }) {
  if (tcx) return readTcx(tcx);
  if (gpx) return readGpx(gpx);
  return null;
}

/**
 * @param {string} xml
 * @returns {DetailData}
 */
function readTcx(xml) {
  /** @type {Lap[]} */
  const laps = [];
  /** @type {Trackpoint[]} */
  const allTrackpoints = [];
  /** @type {Route} */
  const route = [];

  for (const lap of descendants(parseXml(xml), 'Lap')) {
    laps.push({
      index: laps.length + 1,
      duration: number(text(child(lap, 'TotalTimeSeconds'))),
      distance: number(text(child(lap, 'DistanceMeters'))),
      avgHR: number(text(child(child(lap, 'AverageHeartRateBpm'), 'Value'))),
      maxHR: number(text(child(child(lap, 'MaximumHeartRateBpm'), 'Value'))),
    });

    for (const tp of descendants(lap, 'Trackpoint')) {
      const position = child(tp, 'Position');
      const lat = number(text(child(position, 'LatitudeDegrees')));
      const lon = number(text(child(position, 'LongitudeDegrees')));
      if (lat !== null && lon !== null) route.push([lat, lon]);

      allTrackpoints.push({
        time: text(child(tp, 'Time')),
        lat,
        lon,
        heartRate: number(text(child(child(tp, 'HeartRateBpm'), 'Value'))),
        speed: speedOf(tp),
        distance: number(text(child(tp, 'DistanceMeters'))),
      });
    }
  }

  return {
    laps,
    allTrackpoints,
    route,
    hasGps: route.length > 0,
    hasHeartRate: allTrackpoints.some((tp) => tp.heartRate !== null),
    hasSpeed: allTrackpoints.some((tp) => tp.speed !== null),
  };
}

/**
 * A trackpoint's speed from its Extensions > TPX > Speed, whatever prefix
 * each of them carries.
 *
 * @param {XmlNode} tp
 * @returns {number | null}
 */
function speedOf(tp) {
  for (const tpx of descendants(tp, 'TPX')) {
    const speed = number(text(child(tpx, 'Speed')));
    if (speed !== null) return speed;
  }
  return null;
}

/**
 * @param {string} xml
 * @returns {DetailData}
 */
function readGpx(xml) {
  /** @type {Route} */
  const route = [];
  for (const trkpt of descendants(parseXml(xml), 'trkpt')) {
    const lat = number(trkpt.attrs.lat);
    const lon = number(trkpt.attrs.lon);
    if (lat !== null && lon !== null) route.push([lat, lon]);
  }
  return {
    laps: [],
    allTrackpoints: [],
    route,
    hasGps: route.length > 0,
    hasHeartRate: false,
    hasSpeed: false,
  };
}

/**
 * The one number rule: a finite number, or null when the text is missing,
 * empty or not a number.
 *
 * @param {string | null | undefined} value
 * @returns {number | null}
 */
function number(value) {
  if (value == null || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {XmlNode | null} node
 * @returns {string | null} The element's own text, trimmed, or null when
 *   there is no element.
 */
function text(node) {
  return node ? node.text.trim() : null;
}

/**
 * @param {XmlNode | null} node
 * @param {string} name A local name.
 * @returns {XmlNode | null} The first direct child of that name.
 */
function child(node, name) {
  return node?.children.find((c) => c.name === name) ?? null;
}

/**
 * Every element below `node` of that local name, in document order.
 *
 * @param {XmlNode} node
 * @param {string} name
 * @returns {XmlNode[]}
 */
function descendants(node, name) {
  /** @type {XmlNode[]} */
  const found = [];
  const stack = [...node.children].reverse();
  while (stack.length) {
    const next = /** @type {XmlNode} */ (stack.pop());
    if (next.name === name) found.push(next);
    for (let i = next.children.length - 1; i >= 0; i--) stack.push(next.children[i]);
  }
  return found;
}

const TAG = /<(\/?)([^\s/>]+)((?:"[^"]*"|'[^']*'|[^"'>])*)>/y;
const ATTR = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * Scan XML into a tree of elements by local name: enough for the TCX and GPX
 * Polar and `polarJsonToTcx` write. Comments, processing instructions and the
 * doctype are skipped, CDATA is text; a stray `<` is read as text and an
 * unmatched closing tag is ignored, so it never throws.
 *
 * @param {string} xml
 * @returns {XmlNode}
 */
function parseXml(xml) {
  /** @type {XmlNode} */
  const root = { name: '', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;

  while (i < xml.length) {
    const top = stack[stack.length - 1];
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      top.text += decode(xml.slice(i));
      break;
    }
    if (lt > i) top.text += decode(xml.slice(i, lt));

    if (xml.startsWith('<!--', lt)) {
      i = skipPast(xml, '-->', lt);
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const close = xml.indexOf(']]>', lt);
      top.text += xml.slice(lt + 9, close === -1 ? xml.length : close);
      i = close === -1 ? xml.length : close + 3;
    } else if (xml.startsWith('<?', lt)) {
      i = skipPast(xml, '?>', lt);
    } else if (xml.startsWith('<!', lt)) {
      i = skipPast(xml, '>', lt);
    } else {
      TAG.lastIndex = lt;
      const match = TAG.exec(xml);
      if (!match) {
        top.text += '<';
        i = lt + 1;
        continue;
      }
      i = TAG.lastIndex;
      const [, closing, qname, rest] = match;
      const name = localName(qname);

      if (closing) {
        const open = stack.findLastIndex((n) => n.name === name);
        if (open > 0) stack.length = open;
        continue;
      }

      /** @type {XmlNode} */
      const node = { name, attrs: {}, children: [], text: '' };
      for (const [, attr, double, single] of rest.matchAll(ATTR)) {
        node.attrs[localName(attr)] = decode(double ?? single);
      }
      top.children.push(node);
      if (!rest.trimEnd().endsWith('/')) stack.push(node);
    }
  }

  return root;
}

/**
 * @param {string} xml
 * @param {string} end
 * @param {number} from
 * @returns {number} The index just past `end`, or the end of the input.
 */
function skipPast(xml, end, from) {
  const at = xml.indexOf(end, from);
  return at === -1 ? xml.length : at + end.length;
}

/** @param {string} qname */
function localName(qname) {
  return qname.slice(qname.indexOf(':') + 1);
}

/** @type {Record<string, string>} */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** @param {string} s */
function decode(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[ref] ?? whole;
  });
}
