const TRANSLATIONS = {
  pl: {
    'app.title': 'TillDeals Hardware',
    'app.eyebrow': 'LOKALNY PRZEGLĄD SYSTEMU',
    'app.profile': 'Profil komputera',
    'app.reading': 'Odczytywanie danych sprzętu...',
    'nav.profile': 'Profil',
    'nav.settings': 'Ustawienia',
    'nav.diagnosis': 'Ręczna diagnoza',
    'nav.aria': 'Widoki aplikacji',
    'action.refresh': 'Odśwież',
    'action.backProfile': 'Wróć do profilu',
    'settings.title': 'Ustawienia',
    'settings.autoRefresh': 'Odświeżaj dane sprzętu co 60 sekund',
    'settings.localData': 'Dane sprzętu są odczytywane lokalnie. Aplikacja niczego nie wysyła.',
    'settings.openAi': 'Klucz API OpenAI',
    'settings.openAiHelp': 'Używany wyłącznie do wyszukania zgodnego zamiennika po diagnozie. Klucz jest szyfrowany na tym urządzeniu i opuszcza je tylko w bezpośrednich żądaniach do OpenAI.',
    'settings.keyPlaceholder': 'sk-...',
    'settings.save': 'Zapisz',
    'settings.test': 'Testuj połączenie',
    'settings.secureUnavailable': 'Bezpieczny magazyn jest niedostępny; klucz nie może zostać zapisany.',
    'settings.keySaved': 'Klucz jest zapisany na tym urządzeniu.',
    'settings.noKey': 'Nie zapisano jeszcze klucza.',
    'settings.saved': 'Klucz zapisany.',
    'settings.saveFailed': 'Nie udało się zapisać klucza: {message}',
    'settings.testing': 'Testowanie połączenia...',
    'diagnosis.eyebrow': 'ROZWIĄZYWANIE PROBLEMÓW',
    'diagnosis.title': 'Ręczna diagnoza',
    'diagnosis.path': 'Komputer działa, ale występuje problem',
    'diagnosis.mode': 'Tryb:',
    'diagnosis.amateur': 'Początkujący',
    'diagnosis.professional': 'Profesjonalny',
    'diagnosis.chooseArea': 'Gdzie występuje problem?',
    'diagnosis.chooseAreaHelp': 'Wybierz obszar, którego dotyczy problem.',
    'diagnosis.backAreas': '← Obszary',
    'diagnosis.chooseSymptom': 'Co dokładnie się dzieje?',
    'diagnosis.backSymptoms': '← Objawy',
    'diagnosis.amateurSteps': 'Co możesz sprawdzić',
    'diagnosis.professionalSteps': 'Kroki oceny technicznej',
    'diagnosis.searchPlaceholder': 'Szukaj problemu, np. migotanie, Wi-Fi, bateria...',
    'diagnosis.noSearchResults': 'Nie znaleziono problemów dla „{query}”.',
    'diagnosis.check': 'Sprawdź i odpowiedz',
    'diagnosis.yes': 'Tak',
    'diagnosis.no': 'Nie',
    'diagnosis.suggestedReplacement': 'SUGEROWANA WYMIANA',
    'diagnosis.findReplacement': 'Znajdź zamiennik (AI)',
    'diagnosis.searching': 'Szukam zamiennika...',
    'diagnosis.replacementFailed': 'Nie udało się znaleźć zamiennika: {message}',
    'diagnosis.osSource': 'Źródło systemu operacyjnego',
    'diagnosis.temperature': 'Dane temperatury',
    'diagnosis.gpuSensor': 'Dane czujnika GPU',
    'diagnosis.memorySlots': 'Dane gniazd pamięci',
    'diagnosis.inventory': 'Lista urządzeń',
    'status.available': 'Dostępne',
    'status.driverUnavailable': 'Brak odczytu z czujnika',
    'status.notReported': 'Brak danych',
    'status.devices': '{count} urządzeń',
    'status.usedSlots': '{used} z {total} zajętych',
    'hardware.operatingSystem': 'System operacyjny',
    'hardware.processor': 'Procesor',
    'hardware.installedMemory': 'Zainstalowana pamięć',
    'hardware.graphics': 'Grafika',
    'hardware.system': 'System',
    'hardware.manufacturer': 'Producent',
    'hardware.model': 'Model',
    'hardware.version': 'Wersja',
    'hardware.platform': 'Platforma',
    'hardware.kernel': 'Jądro systemu',
    'hardware.architecture': 'Architektura',
    'hardware.physicalCores': 'Rdzenie fizyczne',
    'hardware.logicalCores': 'Rdzenie logiczne',
    'hardware.speed': 'Taktowanie',
    'hardware.socket': 'Gniazdo procesora',
    'hardware.temperature': 'Temperatura',
    'hardware.coreTemperatures': 'Temperatury rdzeni',
    'hardware.sensorStatus': 'Stan czujnika',
    'hardware.memory': 'Pamięć',
    'hardware.installed': 'Zainstalowana',
    'hardware.available': 'Dostępna',
    'hardware.active': 'Aktywna',
    'hardware.slots': 'Gniazda',
    'hardware.maxCapacity': 'Maksymalna pojemność',
    'hardware.modules': 'Moduły',
    'hardware.controllers': 'Kontrolery',
    'hardware.vram': 'Pamięć VRAM',
    'hardware.powerDraw': 'Pobór mocy',
    'hardware.displays': 'Monitory',
    'hardware.mainboardBios': 'Płyta główna i BIOS',
    'hardware.mainboard': 'Płyta główna',
    'hardware.biosVendor': 'Producent BIOS-u',
    'hardware.biosVersion': 'Wersja BIOS-u',
    'hardware.biosDate': 'Data BIOS-u',
    'hardware.storage': 'Nośniki danych',
    'hardware.physicalDisks': 'Dyski fizyczne',
    'hardware.filesystems': 'Zamontowane systemy plików',
    'hardware.inventorySection': 'Urządzenia PCI i pozostałe',
    'hardware.detectedDevices': 'Wykryte urządzenia',
    'hardware.network': 'Sieć i urządzenia peryferyjne',
    'hardware.interfaces': 'Interfejsy',
    'hardware.battery': 'Bateria',
    'hardware.audio': 'Audio',
    'hardware.unknown': 'Nieznane',
    'hardware.noBattery': 'Brak informacji o baterii',
    'hardware.charging': 'ładowanie',
    'hardware.updated': 'Zaktualizowano {date} | {source}',
    'hardware.readFailed': 'Nie udało się odczytać danych sprzętu: {message}',
    'language.label': 'Język',
    'language.polish': 'Polski',
    'language.english': 'English',
  },
  en: {
    'app.title': 'TillDeals Hardware', 'app.eyebrow': 'LOCAL SYSTEM OVERVIEW', 'app.profile': 'Machine profile', 'app.reading': 'Reading hardware details...',
    'nav.profile': 'Profile', 'nav.settings': 'Settings', 'nav.diagnosis': 'Manual Diagnosis', 'nav.aria': 'Application views', 'action.refresh': 'Refresh', 'action.backProfile': 'Back to profile',
    'settings.title': 'Settings', 'settings.autoRefresh': 'Refresh hardware data every 60 seconds', 'settings.localData': 'Hardware data is read locally. Nothing is uploaded by this application.', 'settings.openAi': 'OpenAI API key', 'settings.openAiHelp': 'Used only to look up a compatible replacement part after a diagnosis. The key is encrypted on this device and never leaves it except in direct requests to OpenAI.', 'settings.keyPlaceholder': 'sk-...', 'settings.save': 'Save', 'settings.test': 'Test connection', 'settings.secureUnavailable': 'Secure storage is unavailable on this system; the key cannot be saved.', 'settings.keySaved': 'A key is saved on this device.', 'settings.noKey': 'No key saved yet.', 'settings.saved': 'Key saved.', 'settings.saveFailed': 'Could not save key: {message}', 'settings.testing': 'Testing connection...',
    'diagnosis.eyebrow': 'TROUBLESHOOTING', 'diagnosis.title': 'Manual Diagnosis', 'diagnosis.path': 'Computer is working, but there is a problem', 'diagnosis.mode': 'Mode:', 'diagnosis.amateur': 'Beginner', 'diagnosis.professional': 'Professional', 'diagnosis.chooseArea': 'Where is the problem?', 'diagnosis.chooseAreaHelp': 'Choose the area related to the problem.', 'diagnosis.backAreas': '← Areas', 'diagnosis.chooseSymptom': 'What exactly is happening?', 'diagnosis.backSymptoms': '← Symptoms', 'diagnosis.amateurSteps': 'What you can check', 'diagnosis.professionalSteps': 'Technical assessment steps', 'diagnosis.check': 'Check and answer', 'diagnosis.yes': 'Yes', 'diagnosis.no': 'No', 'diagnosis.suggestedReplacement': 'SUGGESTED REPLACEMENT', 'diagnosis.findReplacement': 'Find replacement (AI)', 'diagnosis.searching': 'Looking for a replacement...', 'diagnosis.replacementFailed': 'Could not find a replacement: {message}',
    'diagnosis.searchPlaceholder': 'Search for a problem, e.g. flicker, Wi-Fi, battery...', 'diagnosis.noSearchResults': 'No problems found for “{query}”.',
    'diagnosis.osSource': 'Operating system source', 'diagnosis.temperature': 'Temperature data', 'diagnosis.gpuSensor': 'GPU sensor data', 'diagnosis.memorySlots': 'Memory slot data', 'diagnosis.inventory': 'Device inventory', 'status.available': 'Available', 'status.driverUnavailable': 'Not exposed by driver', 'status.notReported': 'Not reported', 'status.devices': '{count} devices', 'status.usedSlots': '{used} of {total} used',
    'hardware.operatingSystem': 'Operating system', 'hardware.processor': 'Processor', 'hardware.installedMemory': 'Installed memory', 'hardware.graphics': 'Graphics', 'hardware.system': 'System', 'hardware.manufacturer': 'Manufacturer', 'hardware.model': 'Model', 'hardware.version': 'Version', 'hardware.platform': 'Platform', 'hardware.kernel': 'Kernel', 'hardware.architecture': 'Architecture', 'hardware.physicalCores': 'Physical cores', 'hardware.logicalCores': 'Logical cores', 'hardware.speed': 'Speed', 'hardware.socket': 'Socket', 'hardware.temperature': 'Temperature', 'hardware.coreTemperatures': 'Core temperatures', 'hardware.sensorStatus': 'Sensor status', 'hardware.memory': 'Memory', 'hardware.installed': 'Installed', 'hardware.available': 'Available', 'hardware.active': 'Active', 'hardware.slots': 'Slots', 'hardware.maxCapacity': 'Maximum capacity', 'hardware.modules': 'Modules', 'hardware.controllers': 'Controllers', 'hardware.vram': 'VRAM', 'hardware.powerDraw': 'Power draw', 'hardware.displays': 'Displays', 'hardware.mainboardBios': 'Mainboard & BIOS', 'hardware.mainboard': 'Mainboard', 'hardware.biosVendor': 'BIOS vendor', 'hardware.biosVersion': 'BIOS version', 'hardware.biosDate': 'BIOS date', 'hardware.storage': 'Storage', 'hardware.physicalDisks': 'Physical disks', 'hardware.filesystems': 'Mounted filesystems', 'hardware.inventorySection': 'PCI & device inventory', 'hardware.detectedDevices': 'Detected devices', 'hardware.network': 'Network & peripherals', 'hardware.interfaces': 'Interfaces', 'hardware.battery': 'Battery', 'hardware.audio': 'Audio', 'hardware.unknown': 'Unknown', 'hardware.noBattery': 'No battery reported', 'hardware.charging': 'charging', 'hardware.updated': 'Updated {date} | {source}', 'hardware.readFailed': 'Could not read hardware details: {message}', 'language.label': 'Language', 'language.polish': 'Polski', 'language.english': 'English',
  },
};

let currentLocale = localStorage.getItem('tilldeals.locale') || 'pl';

function t(key, values = {}) {
  const template = TRANSLATIONS[currentLocale]?.[key] || TRANSLATIONS.en[key] || key;
  return template.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? `{${name}}`);
}

function setLocale(locale) {
  if (!TRANSLATIONS[locale]) return;
  currentLocale = locale;
  localStorage.setItem('tilldeals.locale', locale);
  document.documentElement.lang = locale;
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  });
  document.title = t('app.title');
  window.dispatchEvent(new CustomEvent('localechange'));
}

function getLocale() {
  return currentLocale;
}