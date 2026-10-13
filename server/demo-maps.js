/* The staging demo maps (?demo=1), written once per viewing account. Lisbon
 * weekend is hand-laid to match the spec's screen; the rest are built with
 * the model's own placement rules from nested [text, [children]] lists.
 * Nothing here names real people, and every control works on these maps. */
'use strict';
const M2Model = require('../public/js/map-model');

// Lisbon weekend, exactly as the spec drew screen 1: root at 0,0, the mock's
// coordinates minus (250, 420). One example link, Check-in 3pm to Flights
// €180; the straight line between them clears the Stay and Budget pills.
function lisbonDoc() {
  return {
    v: 1,
    nodes: [
      { id: 'root', parent: null, text: 'Lisbon weekend', x: 0, y: 0 },
      { id: 'a1', parent: 'root', text: 'Food', x: 85, y: -190, color: 0 },
      { id: 'a2', parent: 'a1', text: 'Nata tarts', x: 150, y: -240 },
      { id: 'a3', parent: 'a1', text: 'Seafood bars', x: 150, y: -190 },
      { id: 'a4', parent: 'a1', text: 'Bifana', x: 150, y: -140 },
      { id: 'b1', parent: 'root', text: 'Sights', x: 90, y: 140, color: 1 },
      { id: 'b2', parent: 'b1', text: 'Belém Tower', x: 160, y: 90 },
      { id: 'b3', parent: 'b1', text: 'Alfama walk', x: 160, y: 140 },
      { id: 'b4', parent: 'b1', text: 'LX Factory', x: 160, y: 190 },
      { id: 'c1', parent: 'root', text: 'Transit', x: -90, y: -195, color: 2 },
      { id: 'c2', parent: 'c1', text: 'Tram 28', x: -160, y: -250 },
      { id: 'c3', parent: 'c1', text: 'Metro', x: -160, y: -195 },
      { id: 'c4', parent: 'c1', text: 'Viva Viagem', x: -160, y: -140 },
      { id: 'd1', parent: 'root', text: 'Stay', x: -100, y: 140, color: 3 },
      { id: 'd2', parent: 'd1', text: 'Alfama flat', x: -156, y: 110 },
      { id: 'd3', parent: 'd1', text: 'Check-in 3pm', x: -156, y: 170 },
      { id: 'e1', parent: 'root', text: 'Budget', x: 15, y: 320, color: 4 },
      { id: 'e2', parent: 'e1', text: 'Flights €180', x: 82, y: 295 },
      { id: 'e3', parent: 'e1', text: '€40 a day', x: 82, y: 345 },
    ],
    links: [{ id: 'l1', from: 'd3', to: 'e2', text: 'Arrive in time' }],
  };
}

// Build a doc from [text, [children]] pairs using the model's placement,
// where a child is either a plain string or another pair.
function buildDoc(title, branches) {
  const doc = { v: 1, nodes: [{ id: 'root', parent: null, text: title, x: 0, y: 0 }] };
  const add = (parent, tree) => {
    const id = M2Model.addIdea(doc, parent, tree[0]).id;
    (tree[1] || []).forEach(child => add(id, typeof child === 'string' ? [child] : child));
    return id;
  };
  branches.forEach(b => add('root', b));
  M2Model.layout(doc); // built maps come out tidy, though not kept tidy
  return doc;
}

// Garden plan, hand-laid to start messy the way a map grows before Tidy up:
// Tools' pill sits over Vegetables' ideas, New trowel lies on Lettuce, and
// Seasons drifted left with its ideas pointing back at the centre.
function gardenDoc() {
  return {
    v: 1,
    nodes: [
      { id: 'root', parent: null, text: 'Garden plan', x: 0, y: 0 },
      { id: 'g1', parent: 'root', text: 'Vegetables', x: 120, y: -120, color: 0 },
      { id: 'g2', parent: 'g1', text: 'Tomatoes', x: 200, y: -170 },
      { id: 'g3', parent: 'g1', text: 'Lettuce', x: 200, y: -110 },
      { id: 'g4', parent: 'root', text: 'Tools', x: 185, y: -135, color: 2 },
      { id: 'g5', parent: 'g4', text: 'New trowel', x: 200, y: -110 },
      { id: 'g6', parent: 'root', text: 'Flowers', x: -140, y: -40, color: 1 },
      { id: 'g7', parent: 'g6', text: 'Roses', x: -220, y: -40 },
      { id: 'g8', parent: 'root', text: 'Seasons', x: -160, y: 60, color: 3 },
      { id: 'g9', parent: 'g8', text: 'Spring sowing', x: -90, y: 40 },
      { id: 'g10', parent: 'g8', text: 'Autumn pruning', x: -90, y: 100 },
    ],
  };
}

const KEYS = ['lisbon', 'thesis', 'offsite', 'garden', 'meals', 'kitchen', 'reading', 'spanish'];

// Minutes before "now" each map was last edited, in list order.
const AGES = [5, 120, 26 * 60, 3 * 1440, 5 * 1440, 9 * 1440, 18 * 1440, 27 * 1440];

function demoMaps(now) {
  const docs = {
    lisbon: lisbonDoc(),
    thesis: buildDoc('Thesis outline', [
      ['Introduction', ['Research question', 'Scope']],
      ['Background', ['Key papers', 'Open gaps']],
      ['Methods', ['Interviews', 'Surveys']],
      ['Results', ['Themes', 'Quotes']],
      ['Timeline', ['Draft by March', 'Supervisor reviews']],
    ]),
    offsite: buildDoc('Team offsite agenda', [
      ['Day 1', ['Kickoff', 'Workshops', 'Dinner']],
      ['Day 2', ['Retrospective', 'Planning', 'Closing']],
      ['Logistics', ['Venue map', 'Travel plans']],
      ['People', ['Icebreakers', 'Teams']],
      ['Follow-up', ['Notes', 'Actions']],
    ]),
    garden: gardenDoc(),
    meals: buildDoc('Weekly meals', [
      ['Weekdays', ['Pasta Monday']],
      ['Weekend', ['Big breakfast', 'Roast']],
      ['Shopping', ['Market list']],
      ['Prep', ['Sunday batch']],
      ['Treats', ['Friday pizza']],
    ]),
    kitchen: buildDoc('Kitchen renovation', [
      ['Layout', ['Island', 'Sink position']],
      ['Cabinets', ['Painted white']],
      ['Budget', ['Quotes', 'Contingency']],
      ['Timing', ['Start January']],
      ['Trades', ['Plumber']],
    ]),
    reading: buildDoc('Reading list', [
      ['Fiction', ['The Overstory', 'Piranesi']],
      ['Non-fiction', ['Thinking in Systems', 'Deep Work']],
      ['Finished', ['Project Hail Mary']],
    ]),
    spanish: buildDoc('Learning Spanish', [
      ['Vocabulary', ['Ten words a day', 'Flashcards']],
      ['Verbs', ['Ser and estar', 'Irregular stems']],
      ['Listening', ['Podcasts', 'Songs']],
      ['Speaking', ['Language exchange']],
      ['Practice', ['Fifteen minutes daily']],
    ]),
  };
  return KEYS.map((key, i) => ({
    key,
    title: docs[key].nodes[0].text,
    doc: docs[key],
    updatedAt: new Date(now.getTime() - AGES[i] * 60000),
  }));
}

// A made-up friend's map, shared with the viewer (Shared with you) and by a
// fixed secret link (the shared-link check). Staging only.
function sharedDemoDoc() {
  return buildDoc('Staging demo: Book club picks', [
    ['Novels', ['Piranesi', 'The Overstory']],
    ['Memoirs', ['Educated']],
    ['Next meeting', ['First Tuesday']],
  ]);
}

module.exports = { demoMaps, lisbonDoc, sharedDemoDoc };
