"use strict";

/* Beat tracking for "Schläge erkennen" (#2041, js/beats.js), off the main thread: Essentia's
   RhythmExtractor2013 (vendor/essentia, AGPL-3). One message per Abschnitt:
   {id, samples: Float32Array mono 44.1 kHz, minTempo, maxTempo} -> {id, bpm, ticks: [s]} or {id, error}. */

var exports = {}; // the UMD wasm build hands its module over as exports.EssentiaWASM
importScripts('../vendor/essentia/essentia-wasm.umd.js', '../vendor/essentia/essentia.js-core.umd.min.js');

var essentia = null;
self.onmessage = function(e){
  var d = e.data;
  Promise.resolve(essentia || (exports.EssentiaWASM.ready || Promise.resolve()).then(function(){
    return (essentia = new Essentia(exports.EssentiaWASM));
  })).then(function(es){
    var vec = es.arrayToVector(d.samples);
    var r = es.RhythmExtractor2013(vec, d.maxTempo, 'multifeature', d.minTempo);
    var ticks = Array.prototype.slice.call(es.vectorToArray(r.ticks));
    vec.delete();
    self.postMessage({id: d.id, bpm: r.bpm, ticks: ticks});
  }).catch(function(err){
    self.postMessage({id: d.id, error: String(err && err.message || err)});
  });
};
