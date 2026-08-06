// Generates 30 ready-made test stops around a base point (for interface testing, no photo needed)
const TestData = (() => {
  const STREETS = [
    'улица Ленина', 'проспект Мира', 'улица Гагарина', 'Садовая улица', 'улица Пушкина',
    'Набережная улица', 'улица Кирова', 'Центральная улица', 'улица Чехова', 'Заречная улица',
    'улица Молодёжная', 'улица Победы', 'Школьная улица', 'улица Строителей', 'Полевая улица',
  ];

  function randomOffset() {
    // ~ +-0.03 deg (~3km) jitter
    return (Math.random() - 0.5) * 0.06;
  }

  function generate(baseLat = 55.751244, baseLng = 37.618423, count = 30) {
    const points = [];
    for (let i = 0; i < count; i++) {
      const street = STREETS[i % STREETS.length];
      const house = 1 + Math.floor(Math.random() * 80);
      points.push({
        id: Utils.uid(),
        rawText: `${street}, д. ${house}`,
        editedText: `${street}, д. ${house}`,
        lat: baseLat + randomOffset(),
        lng: baseLng + randomOffset(),
        geoStatus: 'ok',
        order: null,
        tourStatus: 'pending',
      });
    }
    return points;
  }

  return { generate };
})();
