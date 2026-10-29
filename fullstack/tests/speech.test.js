'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const speech = require('../public/speech.js');

const vi = (text, subject) => speech.verbalize(text, { subject });

test('numbers read as Vietnamese words', () => {
  assert.equal(speech.readNumber('21'), 'hai mươi mốt');
  assert.equal(speech.readNumber('25'), 'hai mươi lăm');
  assert.equal(speech.readNumber('15'), 'mười lăm');
  assert.equal(speech.readNumber('101'), 'một trăm linh một');
  assert.equal(speech.readNumber('1005'), 'một nghìn không trăm linh năm');
  assert.equal(speech.readNumber('3.14'), 'ba phẩy mười bốn');
});

test('plain fractions are spoken as fractions, not as a slash', () => {
  const spoken = vi('Phân số 1/2 bằng 0,5.');
  assert.match(spoken, /1 phần 2/);
  assert.doesNotMatch(spoken, /1\/2/);
});

test('dates are spoken as dates instead of fractions', () => {
  assert.match(vi('Khai giảng 2/9/2025.'), /ngày 2 tháng 9 năm 2025/);
});

test('LaTeX fractions, powers and roots are verbalised', () => {
  assert.equal(vi('$\\frac{1}{2}$'), 'một phần hai');
  assert.equal(vi('$\\frac{a}{b}$'), 'a phần b');
  assert.equal(vi('$x^{2}$'), 'x bình phương');
  assert.equal(vi('$x^{3}$'), 'x lập phương');
  assert.equal(vi('$x^{n}$'), 'x mũ n');
  assert.equal(vi('$\\sqrt{x}$'), 'căn bậc hai của x');
  assert.equal(vi('$\\sqrt[3]{8}$'), 'căn bậc ba của tám');
});

test('inline math keeps the surrounding prose', () => {
  const spoken = vi('Vận tốc $v = \\frac{s}{t}$ không đổi.');
  assert.match(spoken, /Vận tốc/);
  assert.match(spoken, /v bằng s phần t/);
  assert.match(spoken, /không đổi/);
});

test('physics units are spelled out', () => {
  assert.match(vi('Gia tốc 9,8 m/s²'), /mét trên giây bình phương/);
  assert.match(vi('Tốc độ 60 km/h'), /ki lô mét trên giờ/);
  assert.match(vi('Khối lượng riêng 1000 kg/m³'), /ki lô gam trên mét khối/);
  assert.match(vi('Nồng độ 0,5 mol/L'), /mol trên lít/);
  assert.doesNotMatch(vi('Gia tốc 9,8 m/s²'), /m\/s/);
});

test('chemistry equations use reaction words and subscripts', () => {
  const spoken = vi('$2H_2 + O_2 \\to 2H_2O$', 'chemistry');
  assert.match(spoken, /tạo thành/);
  assert.match(spoken, /hai H hai/);
  assert.match(spoken, /hai H hai O/);
  assert.doesNotMatch(spoken, /_/);
  assert.doesNotMatch(spoken, /hai[A-Z]/);
  assert.equal(
    vi('$N_2 + 3H_2 \\rightleftharpoons 2NH_3$', 'chemistry').includes('thuận nghịch'),
    true
  );
});

test('chemistry formulas in prose are spelled out', () => {
  assert.equal(vi('H2O là nước.', 'chemistry'), 'H hai O là nước.');
  assert.equal(vi('CO2 gây hiệu ứng nhà kính.', 'chemistry'), 'C O hai gây hiệu ứng nhà kính.');
});

test('symbols and percentages are verbalised', () => {
  assert.match(vi('Chiết khấu 20%'), /20 phần trăm/);
  assert.match(vi('Nhiệt độ 30°C'), /30 độ C/);
  assert.match(vi('3 × 4 = 12'), /3 nhân 4/);
  assert.match(vi('10 ÷ 2'), /10 chia 2/);
  assert.match(vi('π ≈ 3,14'), /pi xấp xỉ 3,14/);
  assert.match(vi('5 < 7 và 9 > 4'), /5 nhỏ hơn 7 và 9 lớn hơn 4/);
});

test('biology base pairs are spoken as bonds', () => {
  assert.equal(vi('Cặp A-T và G-X.', 'biology'), 'Cặp A liên kết T và G liên kết X.');
});

test('bare LaTeX without delimiters is still verbalised', () => {
  assert.match(vi('Ta có \\frac{1}{2} số học sinh.'), /một phần hai/);
  assert.match(vi('Diện tích x^2 mét vuông.'), /x bình phương/);
});

test('markdown, links and code blocks are removed', () => {
  const spoken = vi('**Quan trọng** [tài liệu](https://example.com) ```js\nconst a = 1;\n``` hết.');
  assert.doesNotMatch(spoken, /\*\*|example\.com|const a/);
  assert.match(spoken, /Quan trọng/);
});

test('english answers keep their own number formatting', () => {
  assert.equal(vi('The ratio is 1/2 here.', 'english'), 'The ratio is 1/2 here.');
});

test('sentences are split with a pause between them', () => {
  const segments = speech.splitForSpeech('Câu một. Câu hai! Câu ba?');
  assert.equal(segments.length, 3);
  assert.deepEqual(segments.map((segment) => segment.text), ['Câu một.', 'Câu hai!', 'Câu ba?']);
  for (const segment of segments) assert.equal(segment.pause, 420);
});

test('decimal commas and dots do not split a sentence', () => {
  const segments = speech.splitForSpeech('Giá 3,14 triệu và 1.5 tỷ đồng.');
  assert.equal(segments.length, 1);
});

test('clock times do not split but labels do', () => {
  assert.equal(speech.splitForSpeech('Họp lúc 10:30 sáng nay.').length, 1);
  const labelled = speech.splitForSpeech('Lưu ý quan trọng nhất là: phải đọc kỹ đề bài trước khi làm.');
  assert.equal(labelled.length, 2);
  assert.equal(labelled[0].pause, 340);
});

test('long text is split at word boundaries and never mid-word', () => {
  const text = 'Đây là một câu rất dài để kiểm tra việc cắt nhỏ văn bản thành nhiều đoạn. '.repeat(6).trim();
  const segments = speech.splitForSpeech(text);
  assert.ok(segments.length > 1);
  for (const segment of segments) {
    assert.ok(segment.text.length <= 166, `too long: ${segment.text.length}`);
    assert.ok(!/^\s|\s$/.test(segment.text));
  }
  assert.equal(segments.map((segment) => segment.text).join(' '), text);
});

test('very short fragments are merged into the next sentence', () => {
  const segments = speech.splitForSpeech('Ừ. Đây là một câu dài hơn hai mươi bốn ký tự để kiểm tra.');
  assert.equal(segments.length, 1);
});

test('list bullets are not spoken', () => {
  const spoken = vi('- Một ý\n- Hai ý');
  assert.doesNotMatch(spoken, /- Một|- Hai/);
  assert.match(spoken, /Một ý/);
});
