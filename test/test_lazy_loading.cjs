const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('    function renderCards()');
const end = html.indexOf('    function renderLoadedCards()', start);
assert(start > 0 && end > start);
const code = html.slice(start, end);

function fixture() {
    const calls = [], renders = [], pending = new Map(), elements = new Map();
    const context = vm.createContext({
        AbortController, setTimeout, clearTimeout, console: {error() {}},
        document: {getElementById(id) {
            if (!elements.has(id)) elements.set(id, {innerHTML: '', addEventListener(name, fn) {this[name] = fn;}});
            return elements.get(id);
        }},
        fetch(url) {
            calls.push(url);
            return new Promise((resolve, reject) => pending.set(url, {resolve, reject}));
        },
        renderPagination() {}, updateTradeTypeCounts() {}, updateMap() {},
        renderLoadedCards() {renders.push(vm.runInContext('[...selectedComplexes]', context).join(','));}
    });
    vm.runInContext(`let allData = {}; let selectedComplexes = new Set(); let cardsRequestVersion = 0;
        let totalFilteredData = []; const complexRequests = new Map();
        let dataManifest = {complexes: {'3354': {file: 'complexes/3354.hash.json'}, '912': {file: 'complexes/912.hash.json'}}};
        ${code}`, context);
    return {context, calls, renders, elements,
        select(ids) {context.ids = ids; vm.runInContext('selectedComplexes = new Set(ids)', context);},
        refresh() {return vm.runInContext('renderCards()', context);},
        complete(id, body = {}) {pending.get(`./data/complexes/${id}.hash.json`).resolve({ok: true, json: async () => body});},
        fail(id) {pending.get(`./data/complexes/${id}.hash.json`).resolve({ok: false, status: 503});}
    };
}

test('all inline scripts compile and initial load never fetches the aggregate', () => {
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
    assert(!/fetch\([^)]*fulldata_all/.test(html));
    assert(html.includes("fetchDataJson('./data/manifest.json')"));
});

test('only selected complexes requested; concurrent requests deduplicated; cached selection reused', async () => {
    const f = fixture(); f.select(['3354']);
    const first = f.refresh(), second = f.refresh();
    assert.deepEqual(f.calls, ['./data/complexes/3354.hash.json']);
    f.complete('3354', {card: {is_deleted: true}});
    await Promise.all([first, second]);
    assert.deepEqual(f.renders, ['3354']);
    await f.refresh();
    assert.equal(f.calls.length, 1);
    f.select(['3354', '912']);
    const third = f.refresh(); f.complete('912'); await third;
    assert.equal(f.calls.length, 2);
});

test('late completion does not render an obsolete selection', async () => {
    const f = fixture(); f.select(['3354']); const first = f.refresh();
    f.select(['912']); const second = f.refresh();
    f.complete('912'); await second;
    f.complete('3354'); await first;
    assert.deepEqual(f.renders, ['912']);
    f.select([]); await f.refresh();
    assert.deepEqual(f.renders, ['912', '']);
    assert.equal(f.calls.length, 2);
});

test('failed requests display retry and can be retried without caching failures', async () => {
    const f = fixture(); f.select(['3354']); const first = f.refresh();
    f.fail('3354'); await first;
    assert(f.elements.get('cards').innerHTML.includes('retryComplexData'));
    const retry = f.elements.get('retryComplexData').click();
    f.complete('3354'); await retry;
    assert.equal(f.calls.length, 2);
    assert.deepEqual(f.renders, ['3354']);
});

test('missing and malformed complex data produce an error, never a false empty result', async () => {
    const f = fixture(); f.select(['missing']); await f.refresh();
    assert.equal(f.calls.length, 0); assert.equal(f.renders.length, 0);
    f.select(['3354']); const request = f.refresh(); f.complete('3354', []); await request;
    assert.equal(f.renders.length, 0);
    assert(f.elements.get('cards').innerHTML.includes('retryComplexData'));
});
