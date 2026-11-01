import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { secretDraw, randomInt } from '../src/draw.js';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const names = Array.from({length:8},(_,i)=>`Pessoa ${i+1}`);
test('mil sorteios com 8 pessoas: ninguém tira a si mesmo; todos são únicos',()=>{
  for(let t=0;t<1000;t++){
    const pairs=secretDraw(names);
    assert.equal(pairs.length,8);
    assert.deepEqual(pairs.map(p=>p.giver),names);
    assert.deepEqual([...pairs.map(p=>p.recipient)].sort(),[...names].sort());
    assert.ok(pairs.every(p=>p.giver!==p.recipient));
  }
});
test('duas pessoas também recebem destinatários diferentes de si mesmas',()=>{
  assert.deepEqual(secretDraw(['A','B']),[{giver:'A',recipient:'B'},{giver:'B',recipient:'A'}]);
});
test('rejeita nomes repetidos',()=>assert.throws(()=>secretDraw(['A','A'])));
test('aleatório sempre fica dentro do intervalo',()=>{
  for(let i=0;i<1000;i++)assert.ok(randomInt(8)>=0&&randomInt(8)<8);
});
