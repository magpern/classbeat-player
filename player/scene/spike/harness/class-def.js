'use strict';
// A hard-coded fake class: 10 minutes. Zones are planned intensity (rule 7), own palette.
const ZONES = {
  1: { number: 1, name: 'EASY', color: '#3fb6c9' },
  2: { number: 2, name: 'STEADY', color: '#5b7cf0' },
  3: { number: 3, name: 'TEMPO', color: '#a15cf0' },
  4: { number: 4, name: 'HARD', color: '#f0558f' },
  5: { number: 5, name: 'PEAK', color: '#ffb23f' },
};

const s = (n) => n * 1000;
const INTERVALS = [
  { name: 'Warm up', start: s(0), end: s(90), zone: 1, rpm: [80, 90], bpm: 110 },
  { name: 'Build', start: s(90), end: s(180), zone: 2, rpm: [85, 95], bpm: 120 },
  { name: 'Push', start: s(180), end: s(270), zone: 4, rpm: [90, 100], bpm: 128 },
  { name: 'Recover', start: s(270), end: s(330), zone: 1, rpm: [75, 85], bpm: 108 },
  { name: 'Peak', start: s(330), end: s(420), zone: 5, rpm: [100, 110], bpm: 140 },
  { name: 'Steady', start: s(420), end: s(510), zone: 3, rpm: [90, 95], bpm: 124 },
  { name: 'Cool down', start: s(510), end: s(600), zone: 1, rpm: [70, 80], bpm: 100 },
];
const SONGS = [
  { name: 'Fake Song One', start: s(0), end: s(210), bpm: 118 },
  { name: 'Fake Song Two', start: s(210), end: s(420), bpm: 132 },
  { name: 'Fake Song Three', start: s(420), end: s(600), bpm: 112 },
];

module.exports = { CLASS_DEF: { durationMs: s(600), intervals: INTERVALS, songs: SONGS }, ZONES };
