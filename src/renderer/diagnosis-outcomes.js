// Populate this file over time. Each entry maps an exact symptom string from
// diagnosis-tree.js to a checklist that ends in a suggested replacement part.
//
// Shape of one entry:
// 'Exact symptom text from diagnosis-tree.js': {
//   checks: [
//     {
//       id: 'unique-id',
//       question: 'Yes/no question shown to the user.',
//       // Shown when the user answers "Nie" (something is wrong here).
//       // Omit `no` if a "Nie" answer should just continue to the next check.
//       no: { component: 'gpu', label: 'Human readable part name', reason: 'Why this check points at this part.' },
//     },
//   ],
//   // Used only if every check was answered "Tak" (everything checked out).
//   finalOutcome: { component: 'cable', label: 'Human readable part name', reason: 'Why this is the remaining cause.' },
// }
//
// Symptoms without an entry here fall back to the generic step list in renderer.js.
const DIAGNOSIS_OUTCOMES = {
  'Monitor migocze': {
    checks: [
      {
        id: 'gpu-seated',
        question: 'Czy karta graficzna jest poprawnie osadzona w slocie PCIe?',
        no: { component: 'gpu-reseat', label: 'Osadzenie karty graficznej w slocie PCIe', reason: 'Karta graficzna nie była poprawnie osadzona w slocie.' },
      },
      {
        id: 'gpu-damage',
        question: 'Czy karta graficzna nie ma widocznych uszkodzeń?',
        no: { component: 'gpu', label: 'Karta graficzna', reason: 'Widoczne uszkodzenia karty graficznej.' },
      },
      {
        id: 'gpu-power',
        question: 'Czy karta graficzna jest prawidłowo podłączona do zasilania na płycie głównej?',
        no: { component: 'gpu-power-cable', label: 'Kabel zasilający karty graficznej', reason: 'Karta graficzna nie miała prawidłowego podłączenia zasilania.' },
      },
      {
        id: 'other-port',
        question: 'Czy migotanie nadal występuje po podłączeniu do innego portu karty graficznej?',
        no: { component: 'gpu-output-port', label: 'Port wyjściowy karty graficznej', reason: 'Migotanie ustąpiło po zmianie portu karty graficznej.' },
      },
      {
        id: 'other-screen',
        question: 'Czy migotanie nadal występuje na innym monitorze podłączonym tym samym kablem?',
        no: { component: 'monitor', label: 'Monitor', reason: 'Migotanie ustąpiło po podłączeniu innego monitora.' },
      },
    ],
    finalOutcome: {
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
        component: 'display-resolution',
        label: 'Ustawienia rozdzielczości ekranu',
        reason: 'Nieprawidłowa rozdzielczość może powodować przycięcie lub nieprawidłowe skalowanie obrazu.',
      },
    },
    {
      id: 'display-scaling',
      question: 'Czy skalowanie obrazu w systemie jest ustawione na zalecaną wartość?',
      no: {
        component: 'display-scaling',
        label: 'Ustawienia skalowania obrazu',
        reason: 'Nieprawidłowe skalowanie systemowe może powodować wyświetlanie obrazu poza widocznym obszarem ekranu.',
      },
    },
    {
      id: 'monitor-scaling',
      question: 'Czy ustawienia proporcji i skalowania w menu monitora są ustawione prawidłowo?',
      no: {
        component: 'monitor-settings',
        label: 'Ustawienia skalowania monitora',
        reason: 'Nieprawidłowy tryb proporcji lub skalowania monitora może powodować przycięcie obrazu.',
      },
    },
    {
      id: 'gpu-scaling',
      question: 'Czy skalowanie w ustawieniach karty graficznej jest ustawione prawidłowo?',
      no: {
        component: 'gpu-scaling',
        label: 'Ustawienia skalowania karty graficznej',
        reason: 'Nieprawidłowe skalowanie GPU lub włączony overscan może powodować przycięcie krawędzi obrazu.',
      },
    },
    {
      id: 'other-port',
      question: 'Czy obraz nadal jest przycięty po podłączeniu monitora do innego portu karty graficznej?',
      no: {
        component: 'gpu-output-port',
        label: 'Port wyjściowy karty graficznej',
        reason: 'Problem ustąpił po zmianie portu karty graficznej.',
      },
    },
    {
      id: 'other-cable',
      question: 'Czy obraz nadal jest przycięty po podłączeniu monitora innym kablem wideo?',
      no: {
        component: 'cable',
        label: 'Kabel wideo (HDMI/DisplayPort)',
        reason: 'Problem ustąpił po zastosowaniu innego kabla wideo.',
      },
    },
    {
      id: 'other-screen',
      question: 'Czy obraz nadal jest przycięty po podłączeniu innego monitora?',
      no: {
        component: 'monitor',
        label: 'Monitor',
        reason: 'Problem nie występuje na innym monitorze, co wskazuje na problem z monitorem lub jego ustawieniami.',
      },
    },
  ],
  finalOutcome: {
    component: 'gpu',
    label: 'Karta graficzna',
    reason: 'Rozdzielczość, skalowanie, monitor, kabel i port zostały sprawdzone, a problem z przyciętym obrazem nadal występuje.',
  },
},
};

function getDiagnosisOutcome(symptom) {
  return DIAGNOSIS_OUTCOMES[symptom] || null;
}
