import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCSV,analyzeCSV,numericValue,analyzeText,detectDelimiter} from '../analysis.js';

test('handles escaped quotes, commas, CRLF, newlines in quoted fields',()=>{
 const data='name,value\r\n"A, B",10\r\n"he said ""hi""",20\r\n"two\nlines",30\r\n';
 const {headers,rows}=parseCSV(data);
 assert.deepEqual(headers,['name','value']);
 assert.equal(rows.length,3);
 assert.equal(rows[0].name,'A, B');
 assert.equal(rows[1].name,'he said "hi"');
 assert.equal(rows[2].name,'two\nlines');
});
test('semicolon and Arabic digit conversion',()=>{
 assert.equal(detectDelimiter('a;b\n1;2\n'),';');
 assert.equal(numericValue('١٬٢٣٤٫٥'),1234.5);
 assert.equal(numericValue('20%'),20);
});
test('statistics are deterministic and correct',()=>{
 const x=analyzeCSV('product,sales,profit\na,1,2\nb,2,4\nc,3,6\nc,4,8','demo.csv');
 assert.equal(x.rowCount,4);
 assert.equal(x.numeric.find(c=>c.column==='sales').mean,2.5);
 assert.equal(x.numeric.find(c=>c.column==='sales').median,2.5);
 assert.equal(x.numeric.find(c=>c.column==='sales').min,1);
 assert.equal(x.numeric.find(c=>c.column==='sales').max,4);
 assert.ok(Math.abs(x.correlations[0].r - 1) < 1e-12);
});
test('missing data, duplicates, JSON invalid checks',()=>{
 const x=analyzeCSV('a,b\n1,2\n1,2\n,4\n');
 assert.equal(x.duplicateRows,1);
 assert.equal(x.numeric.find(c=>c.column==='a').missing,1);
 const c=analyzeText('{oops}','sample.json');
 assert.match(c.report,/JSON غير صالح/);
});
test('rejects unclosed quotes',()=>assert.throws(()=>parseCSV('a,b\n"open,3'),/اقتباس/));
