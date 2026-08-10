import assert from 'node:assert/strict';
import test from 'node:test';
import { TranscriptActionGate } from '../server/actionGate.js';
import { UtteranceManager } from '../server/utteranceManager.js';

test('Test A: audio_start -> fragments "Tôi dị ứng" + "aspirin" -> pending utterance is "Tôi dị ứng aspirin"', () => {
  const manager = new UtteranceManager();
  manager.startUtterance();
  manager.appendInputFragment('Tôi dị ứng');
  manager.appendInputFragment('aspirin');

  assert.equal(manager.getCurrentUtterance(), 'Tôi dị ứng aspirin');
});

test('Test B: previous utterance was "Tôi bị đau đầu" -> new audio_start -> fragment "Tôi bị đau họng" -> current/pending utterance is ONLY "Tôi bị đau họng"', () => {
  const manager = new UtteranceManager();

  // Utterance 1
  manager.startUtterance();
  manager.appendInputFragment('Tôi bị đau đầu');
  assert.equal(manager.getCurrentUtterance(), 'Tôi bị đau đầu');

  // Utterance 2 (new audio_start)
  manager.startUtterance();
  manager.appendInputFragment('Tôi bị đau họng');

  assert.equal(manager.getCurrentUtterance(), 'Tôi bị đau họng');
  assert.equal(manager.getCurrentUtterance().includes('đau đầu'), false);
});

test('Test C: starting a new utterance does not automatically open the mutation gate', () => {
  const gate = new TranscriptActionGate();
  const manager = new UtteranceManager();

  // Turn 1 start
  manager.startUtterance();
  gate.startListening();
  assert.equal(gate.canMutate(), false);

  manager.appendInputFragment('Tôi bị sốt');
  gate.markPending();
  assert.equal(gate.canMutate(), false);

  // Confirm turn 1
  gate.confirm('Tôi bị sốt');
  assert.equal(gate.canMutate(), true);

  // Turn 2 start (audio_start)
  manager.startUtterance();
  gate.startListening();
  assert.equal(gate.canMutate(), false); // Mutation gate must be closed
});

test('Test D: currentUtterance does not overwrite modelTranscript or confirmedTranscript', () => {
  const manager = new UtteranceManager();

  manager.startUtterance();
  manager.appendInputFragment('Tôi bị sốt');
  manager.confirm('Tôi bị sốt');
  manager.appendOutputFragment('Chào bạn, bạn bị sốt bao lâu rồi?');

  assert.equal(manager.getCurrentUtterance(), 'Tôi bị sốt');
  assert.equal(manager.getConfirmedTranscript(), 'Tôi bị sốt');
  assert.equal(manager.getModelTranscript(), 'Chào bạn, bạn bị sốt bao lâu rồi?');

  // Start new utterance
  manager.startUtterance();
  manager.appendInputFragment('Khoảng 2 ngày');

  assert.equal(manager.getCurrentUtterance(), 'Khoảng 2 ngày');
  assert.equal(manager.getConfirmedTranscript(), 'Tôi bị sốt'); // Not overwritten
  assert.equal(manager.getModelTranscript(), 'Chào bạn, bạn bị sốt bao lâu rồi?'); // Not overwritten
});
