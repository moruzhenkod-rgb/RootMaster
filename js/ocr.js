// OCR + address-line extraction via Tesseract.js
const OCR = (() => {
  async function recognize(imageFile, onProgress) {
    const worker = await Tesseract.createWorker('rus+eng', 1, {
      logger: (m) => {
        if (onProgress && m.status === 'recognizing text') {
          onProgress(m.progress); // 0..1
        }
      },
    });
    try {
      const { data } = await worker.recognize(imageFile);
      return data.text || '';
    } finally {
      await worker.terminate();
    }
  }

  // Heuristic split of raw OCR text into candidate address lines.
  function extractAddressLines(rawText) {
    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    const candidates = lines.filter((line) => {
      if (line.length < 6) return false;
      // Looks like an address if it has a digit (house number) and letters
      const hasDigit = /\d/.test(line);
      const hasLetters = /[A-Za-zА-Яа-яЁё]/.test(line);
      // Skip obvious noise lines (pure numbers, short codes, headers)
      const isNoise = /^[\d\s:.\-#№]+$/.test(line) || line.length > 140;
      return hasDigit && hasLetters && !isNoise;
    });

    return candidates.length ? candidates : lines;
  }

  return { recognize, extractAddressLines };
})();
