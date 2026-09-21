// Populate this file over time. Each entry maps an exact symptom string from
// diagnosis-tree.js to a checklist that ends in an outcome.
//
// Every outcome has a `type`:
// - 'resolved': the user can fix it themselves (reseat, reconnect, change a
//   setting, use a different port/cable that already works). No replacement
//   is needed, so the app must NOT offer the AI replacement search.
// - 'replacement': a specific physical part is faulty and should be replaced.
//   The app offers the AI replacement search for this outcome only.
//
// Shape of one entry:
// 'Exact symptom text from diagnosis-tree.js': {
//   checks: [
//     {
//       id: 'unique-id',
//       question: 'Yes/no question shown to the user.',
//       // Shown when the user answers "Nie" (something is wrong here).
//       // Omit `no` if a "Nie" answer should just continue to the next check.
//       no: { type: 'resolved', label: 'What was found', resolution: 'What the user should do.' },
//       // or: no: { type: 'replacement', component: 'gpu', label: 'Human readable part name', reason: 'Why this check points at this part.' },
//     },
//   ],
//   // Used only if every check was answered "Tak" (everything checked out).
//   finalOutcome: { type: 'replacement', component: 'cable', label: 'Human readable part name', reason: 'Why this is the remaining cause.' },
// }
//
// Symptoms without an entry here fall back to the generic step list in renderer.js.
const DIAGNOSIS_OUTCOMES = {
  'Monitor migocze': {
    checks: [
      {
        id: 'gpu-seated',
        question: 'Czy karta graficzna jest poprawnie osadzona w slocie PCIe?',
        no: {
          type: 'resolved',
          label: 'Karta graficzna nie była poprawnie osadzona',
          resolution: 'Wyłącz komputer i dociśnij kartę graficzną do końca w slocie PCIe, aż zatrzask się zablokuje.',
        },
      },
      {
        id: 'gpu-damage',
        question: 'Czy karta graficzna nie ma widocznych uszkodzeń?',
        no: { type: 'replacement', component: 'gpu', label: 'Karta graficzna', reason: 'Widoczne uszkodzenia karty graficznej.' },
      },
      {
        id: 'gpu-power',
        question: 'Czy karta graficzna jest prawidłowo podłączona do zasilania na płycie głównej?',
        no: {
          type: 'resolved',
          label: 'Kabel zasilający karty graficznej nie był podłączony prawidłowo',
          resolution: 'Podłącz ponownie kabel zasilający PCIe do karty graficznej, aż zatrzaśnie się prawidłowo.',
        },
      },
      {
        id: 'other-port',
        question: 'Czy migotanie nadal występuje po podłączeniu do innego portu karty graficznej?',
        no: {
          type: 'resolved',
          label: 'Migotanie ustąpiło po zmianie portu karty graficznej',
          resolution: 'Korzystaj z portu, na którym problem nie występuje. Wymiana sprzętu nie jest konieczna.',
        },
      },
      {
        id: 'other-screen',
        question: 'Czy migotanie nadal występuje na innym monitorze podłączonym tym samym kablem?',
        no: { type: 'replacement', component: 'monitor', label: 'Monitor', reason: 'Migotanie ustąpiło po podłączeniu innego monitora.' },
      },
    ],
    finalOutcome: {
      type: 'replacement',
      component: 'cable',
      label: 'Kabel wideo (HDMI/DisplayPort)',
      reason: 'Karta graficzna działa poprawnie na różnych portach i monitorach, ale migotanie nadal występuje.',
    },
  },
  'Obraz jest przycięty': {
    checks: [
      {
        id: 'resolution-native',
        question: 'Czy rozdzielczość ekranu jest ustawiona na natywną (zalecaną) rozdzielczość monitora?',
        no: {
          type: 'resolved',
          label: 'Nieprawidłowa rozdzielczość ekranu',
          resolution: 'Ustaw rozdzielczość ekranu na natywną (zalecaną) w ustawieniach systemu Windows.',
        },
      },
      {
        id: 'display-scaling',
        question: 'Czy skalowanie obrazu w systemie jest ustawione na zalecaną wartość?',
        no: {
          type: 'resolved',
          label: 'Nieprawidłowe skalowanie systemowe',
          resolution: 'Ustaw skalowanie systemowe na wartość zalecaną w ustawieniach ekranu Windows.',
        },
      },
      {
        id: 'monitor-scaling',
        question: 'Czy ustawienia proporcji i skalowania w menu monitora są ustawione prawidłowo?',
        no: {
          type: 'resolved',
          label: 'Nieprawidłowe ustawienia skalowania monitora',
          resolution: 'W menu ekranowym monitora ustaw tryb proporcji/skalowania na „Full” lub „1:1” (zależnie od modelu).',
        },
      },
      {
        id: 'gpu-scaling',
        question: 'Czy skalowanie w ustawieniach karty graficznej jest ustawione prawidłowo?',
        no: {
          type: 'resolved',
          label: 'Nieprawidłowe skalowanie karty graficznej',
          resolution: 'W panelu sterowania karty graficznej (NVIDIA/AMD/Intel) wyłącz overscan i ustaw skalowanie na monitor.',
        },
      },
      {
        id: 'other-port',
        question: 'Czy obraz nadal jest przycięty po podłączeniu monitora do innego portu karty graficznej?',
        no: {
          type: 'resolved',
          label: 'Problem ustąpił po zmianie portu karty graficznej',
          resolution: 'Korzystaj z portu, na którym problem nie występuje. Wymiana sprzętu nie jest konieczna.',
        },
      },
      {
        id: 'other-cable',
        question: 'Czy obraz nadal jest przycięty po podłączeniu monitora innym kablem wideo?',
        no: { type: 'replacement', component: 'cable', label: 'Kabel wideo (HDMI/DisplayPort)', reason: 'Problem ustąpił po zastosowaniu innego kabla wideo.' },
      },
      {
        id: 'other-screen',
        question: 'Czy obraz nadal jest przycięty po podłączeniu innego monitora?',
        no: { type: 'replacement', component: 'monitor', label: 'Monitor', reason: 'Problem nie występuje na innym monitorze, co wskazuje na problem z monitorem.' },
      },
    ],
    finalOutcome: {
      type: 'replacement',
      component: 'gpu',
      label: 'Karta graficzna',
      reason: 'Rozdzielczość, skalowanie, monitor, kabel i port zostały sprawdzone, a problem z przyciętym obrazem nadal występuje.',
    },
  },
};

function getDiagnosisOutcome(symptom) {
  return DIAGNOSIS_OUTCOMES[symptom] || null;
}
