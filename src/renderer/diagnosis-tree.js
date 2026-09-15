const DIAGNOSIS_TREE = [
  {
    name: 'Wydajność',
    symptoms: ['Komputer działa wolno', 'Komputer długo się uruchamia', 'Programy długo się uruchamiają', 'Komputer zwalnia po pewnym czasie', 'Komputer zwalnia pod obciążeniem', 'Komputer okresowo przestaje odpowiadać'],
  },
  {
    name: 'Programy / gry',
    symptoms: ['Gra lub program się nie uruchamia', 'Gra lub program uruchamia się i natychmiast zamyka', 'Program zawiesza się', 'Program wyświetla komunikat błędu', 'Gra ma niski FPS', 'Gra/program okresowo się przycina', 'Problem występuje tylko w jednej aplikacji', 'Problem pojawił się po aktualizacji programu/gry'],
  },
  {
    name: 'Grafika / monitory',
    symptoms: ['Obraz się przycina', 'Monitor migocze', 'Monitor okresowo gaśnie', 'Pojawia się „No Signal”', 'Jeden z monitorów się rozłącza', 'Problem występuje przy kilku monitorach', 'Nie można ustawić właściwej rozdzielczości', 'Nie można ustawić właściwego odświeżania', 'Pojawiają się artefakty graficzne', 'Obraz jest zniekształcony', 'Ekran robi się czarny podczas gry/programu'],
  },
  {
    name: 'Dysk / pliki',
    symptoms: ['Dysk pracuje głośno: klikanie, stukanie, zgrzytanie lub wibracje', 'Dysk często osiąga 100% aktywności', 'Kopiowanie plików jest wolne', 'Otwieranie plików trwa długo', 'Eksplorator plików się zawiesza', 'Dysk okresowo znika', 'Pojawiają się błędy odczytu/zapisu'],
  },
  {
    name: 'Zawieszanie / stabilność',
    symptoms: ['Cały komputer się zawiesza', 'Komputer sam się restartuje', 'Komputer sam się wyłącza', 'Pojawia się BSOD', 'Ekran jest zamrożony, ale działa dźwięk', 'Komputer przestaje odpowiadać pod obciążeniem', 'Problem występuje losowo'],
  },
  {
    name: 'Temperatura / chłodzenie',
    symptoms: ['Komputer jest bardzo gorący', 'Wentylatory cały czas pracują szybko', 'Wentylatory pracują bardzo głośno', 'Wentylator wydaje nietypowe dźwięki', 'Komputer zwalnia po nagrzaniu', 'Komputer wyłącza się pod obciążeniem', 'Obudowa/laptop mocno się nagrzewa'],
  },
  {
    name: 'Dźwięk',
    symptoms: ['Brak dźwięku', 'Dźwięk działa tylko w części programów', 'Dźwięk przerywa', 'Dźwięk trzeszczy', 'Dźwięk jest opóźniony', 'Mikrofon nie działa', 'Urządzenie audio okresowo znika'],
  },
  {
    name: 'Internet / sieć',
    symptoms: ['Internet działa wolno', 'Internet okresowo się rozłącza', 'Wi-Fi ma słaby zasięg', 'Wi-Fi znika', 'Ethernet się rozłącza', 'Duży ping / skoki opóźnienia', 'Problem występuje tylko w grach', 'Problem występuje tylko na tym komputerze'],
  },
  {
    name: 'USB / urządzenia',
    symptoms: ['Urządzenie USB nie jest wykrywane', 'Urządzenie USB okresowo się rozłącza', 'Klawiatura/mysz przestaje odpowiadać', 'Kamera nie działa', 'Bluetooth nie działa', 'Drukarka nie działa', 'Problem występuje tylko na konkretnym porcie'],
  },
  {
    name: 'Zasilanie / laptop',
    symptoms: ['Bateria szybko się rozładowuje', 'Bateria się nie ładuje', 'Laptop działa wolniej na baterii', 'Laptop działa wolniej po podłączeniu zasilacza', 'Komputer nie wybudza się poprawnie', 'Problem pojawia się po uśpieniu'],
  },
  {
    name: 'Inne',
    symptoms: ['Komputer wydaje nietypowy dźwięk', 'Problem pojawił się po aktualizacji Windows', 'Problem pojawił się po aktualizacji sterownika', 'Problem pojawił się po instalacji programu', 'Problem pojawił się po zmianie sprzętu', 'Inny problem'],
  },
];
