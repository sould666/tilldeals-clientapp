const DIAGNOSIS_AREAS = [
  {
    id: 'computer',
    name: 'Komputer',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="7" y="7" width="10" height="10" rx="1"/><path d="M9 2v5M12 2v5M15 2v5M9 17v5M12 17v5M15 17v5M2 9h5M2 12h5M2 15h5M17 9h5M17 12h5M17 15h5"/></svg>',
  },
  {
    id: 'devices',
    name: 'Urządzenia',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 3v3M15 3v3M6 8h12v7a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V8Z"/><path d="M9 21v-3M15 21v-3"/></svg>',
  },
  {
    id: 'screens',
    name: 'Monitory',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="12" rx="1"/><path d="M9 21h6M12 17v4"/></svg>',
  },
  {
    id: 'software',
    name: 'Oprogramowanie',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 8h18M7 6h.01"/></svg>',
  },
];

const DIAGNOSIS_TREE = [
  {
    name: 'Wydajność',
    area: 'computer',
    symptoms: ['Komputer działa wolno', 'Komputer długo się uruchamia', 'Programy długo się uruchamiają', 'Komputer zwalnia po pewnym czasie', 'Komputer zwalnia pod obciążeniem', 'Komputer okresowo przestaje odpowiadać'],
  },
  {
    name: 'Programy / gry',
    area: 'software',
    symptoms: ['Gra lub program się nie uruchamia', 'Gra lub program uruchamia się i natychmiast zamyka', 'Program zawiesza się', 'Program wyświetla komunikat błędu', 'Gra ma niski FPS', 'Gra/program okresowo się przycina', 'Problem występuje tylko w jednej aplikacji', 'Problem pojawił się po aktualizacji programu/gry'],
  },
  {
    name: 'Grafika / monitory',
    area: 'screens',
    symptoms: ['Obraz jest przycięty', 'Monitor migocze', 'Monitor okresowo gaśnie', 'Pojawia się „No Signal”', 'Jeden z monitorów się rozłącza', 'Problem występuje przy kilku monitorach', 'Nie można ustawić właściwej rozdzielczości', 'Nie można ustawić właściwego odświeżania', 'Pojawiają się artefakty graficzne', 'Obraz jest zniekształcony', 'Ekran robi się czarny podczas gry/programu'],
  },
  {
    name: 'Dysk / pliki',
    area: 'computer',
    symptoms: ['Dysk pracuje głośno: klikanie, stukanie, zgrzytanie lub wibracje', 'Dysk często osiąga 100% aktywności', 'Kopiowanie plików jest wolne', 'Otwieranie plików trwa długo', 'Eksplorator plików się zawiesza', 'Dysk okresowo znika', 'Pojawiają się błędy odczytu/zapisu'],
  },
  {
    name: 'Zawieszanie / stabilność',
    area: 'computer',
    symptoms: ['Cały komputer się zawiesza', 'Komputer sam się restartuje', 'Komputer sam się wyłącza', 'Pojawia się BSOD', 'Ekran jest zamrożony, ale działa dźwięk', 'Komputer przestaje odpowiadać pod obciążeniem', 'Problem występuje losowo'],
  },
  {
    name: 'Temperatura / chłodzenie',
    area: 'computer',
    symptoms: ['Komputer jest bardzo gorący', 'Wentylatory cały czas pracują szybko', 'Wentylatory pracują bardzo głośno', 'Wentylator wydaje nietypowe dźwięki', 'Komputer zwalnia po nagrzaniu', 'Komputer wyłącza się pod obciążeniem', 'Obudowa/laptop mocno się nagrzewa'],
  },
  {
    name: 'Dźwięk',
    area: 'devices',
    symptoms: ['Brak dźwięku', 'Dźwięk działa tylko w części programów', 'Dźwięk przerywa', 'Dźwięk trzeszczy', 'Dźwięk jest opóźniony', 'Mikrofon nie działa', 'Urządzenie audio okresowo znika'],
  },
  {
    name: 'Internet / sieć',
    area: 'devices',
    symptoms: ['Internet działa wolno', 'Internet okresowo się rozłącza', 'Wi-Fi ma słaby zasięg', 'Wi-Fi znika', 'Ethernet się rozłącza', 'Duży ping / skoki opóźnienia', 'Problem występuje tylko w grach', 'Problem występuje tylko na tym komputerze'],
  },
  {
    name: 'USB / urządzenia',
    area: 'devices',
    symptoms: ['Urządzenie USB nie jest wykrywane', 'Urządzenie USB okresowo się rozłącza', 'Klawiatura/mysz przestaje odpowiadać', 'Kamera nie działa', 'Bluetooth nie działa', 'Drukarka nie działa', 'Problem występuje tylko na konkretnym porcie'],
  },
  {
    name: 'Zasilanie / laptop',
    area: 'devices',
    symptoms: ['Bateria szybko się rozładowuje', 'Bateria się nie ładuje', 'Laptop działa wolniej na baterii', 'Laptop działa wolniej po podłączeniu zasilacza', 'Komputer nie wybudza się poprawnie', 'Problem pojawia się po uśpieniu'],
  },
  {
    name: 'Inne',
    area: 'software',
    symptoms: ['Komputer wydaje nietypowy dźwięk', 'Problem pojawił się po aktualizacji Windows', 'Problem pojawił się po aktualizacji sterownika', 'Problem pojawił się po instalacji programu', 'Problem pojawił się po zmianie sprzętu', 'Inny problem'],
  },
];
