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
};

function getDiagnosisOutcome(symptom) {
  return DIAGNOSIS_OUTCOMES[symptom] || null;
}
