// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface. German says "du", Spanish "usted". Brand and model names are not
// translated (Winix, Plasmawave, PM2.5).
//
// Feature names are fixed when the user adds the purifier to Gladys: they
// follow the `language` field of the configuration at that moment.
// -----------------------------------------------------------------------------

import { DEFAULT_CONFIG, LANGUAGES } from './config.js';

/** Feature names, by language. */
export const NAMES = {
  en: {
    power: 'Power',
    mode: 'Mode',
    fanSpeed: 'Fan speed',
    plasmawave: 'Plasmawave',
    airQuality: 'Air pollution',
    pm25: 'PM2.5',
    ambientLight: 'Ambient light',
    filterLife: 'Filter life',
    filterHours: 'Filter hours left',
    online: 'Online',
  },
  fr: {
    power: 'Marche',
    mode: 'Mode',
    fanSpeed: 'Vitesse du ventilateur',
    plasmawave: 'Plasmawave',
    airQuality: "Pollution de l'air",
    pm25: 'PM2.5',
    ambientLight: 'Luminosité ambiante',
    filterLife: 'Durée de vie du filtre',
    filterHours: 'Heures de filtre restantes',
    online: 'En ligne',
  },
  de: {
    power: 'Betrieb',
    mode: 'Modus',
    fanSpeed: 'Lüftergeschwindigkeit',
    plasmawave: 'Plasmawave',
    airQuality: 'Luftverschmutzung',
    pm25: 'PM2.5',
    ambientLight: 'Umgebungshelligkeit',
    filterLife: 'Filterlebensdauer',
    filterHours: 'Verbleibende Filterstunden',
    online: 'Online',
  },
  es: {
    power: 'Encendido',
    mode: 'Modo',
    fanSpeed: 'Velocidad del ventilador',
    plasmawave: 'Plasmawave',
    airQuality: 'Contaminación del aire',
    pm25: 'PM2.5',
    ambientLight: 'Luz ambiental',
    filterLife: 'Vida útil del filtro',
    filterHours: 'Horas de filtro restantes',
    online: 'En línea',
  },
};

/** Labels of the purifier modes (the options of the mode select). */
export const MODE_LABELS = {
  en: { auto: 'Auto', manual: 'Manual', sleep: 'Sleep' },
  fr: { auto: 'Auto', manual: 'Manuel', sleep: 'Sommeil' },
  de: { auto: 'Auto', manual: 'Manuell', sleep: 'Schlaf' },
  es: { auto: 'Auto', manual: 'Manual', sleep: 'Sueño' },
};

/** Labels of the air quality levels 0 to 3, as the Winix ring shows them. */
export const AIR_QUALITY_LABELS = {
  en: ['Good', 'Fair', 'Poor', 'Very poor'],
  fr: ['Bonne', 'Moyenne', 'Mauvaise', 'Très mauvaise'],
  de: ['Gut', 'Mittel', 'Schlecht', 'Sehr schlecht'],
  es: ['Buena', 'Regular', 'Mala', 'Muy mala'],
};

/** Connection status messages of the Configuration screen. */
export const STATUS = {
  notConfigured: {
    en: 'Enter the e-mail address and password of your Winix account.',
    fr: "Saisissez l'adresse e-mail et le mot de passe de votre compte Winix.",
    de: 'Gib die E-Mail-Adresse und das Passwort deines Winix-Kontos ein.',
    es: 'Introduzca la dirección de correo y la contraseña de su cuenta Winix.',
  },
  credentials: {
    en: 'Winix refused the e-mail address or the password. Check them in the Winix app, then save them again here.',
    fr: "Winix a refusé l'adresse e-mail ou le mot de passe. Vérifiez-les dans l'appli Winix, puis enregistrez-les à nouveau ici.",
    de: 'Winix hat die E-Mail-Adresse oder das Passwort abgelehnt. Prüfe sie in der Winix-App und speichere sie hier erneut.',
    es: 'Winix rechazó la dirección de correo o la contraseña. Compruébelas en la aplicación Winix y vuelva a guardarlas aquí.',
  },
  passwordReset: {
    en: 'Winix asks for a new password: change it in the Winix app, then enter it here.',
    fr: "Winix demande un nouveau mot de passe : changez-le dans l'appli Winix, puis saisissez-le ici.",
    de: 'Winix verlangt ein neues Passwort: Ändere es in der Winix-App und gib es dann hier ein.',
    es: 'Winix pide una nueva contraseña: cámbiela en la aplicación Winix y luego introdúzcala aquí.',
  },
  notConfirmed: {
    en: 'This Winix account is not confirmed yet: finish creating it in the Winix app.',
    fr: "Ce compte Winix n'est pas encore confirmé : terminez sa création dans l'appli Winix.",
    de: 'Dieses Winix-Konto ist noch nicht bestätigt: Schließe die Erstellung in der Winix-App ab.',
    es: 'Esta cuenta Winix aún no está confirmada: termine de crearla en la aplicación Winix.',
  },
  unreachable: {
    en: 'The Winix cloud does not answer. The integration retries on its own.',
    fr: "Le cloud Winix ne répond pas. L'intégration réessaie d'elle-même.",
    de: 'Die Winix-Cloud antwortet nicht. Die Integration versucht es selbst erneut.',
    es: 'La nube de Winix no responde. La integración lo vuelve a intentar sola.',
  },
  rateLimited: {
    en: 'The Winix cloud asks to slow down. The integration waits a minute and retries.',
    fr: "Le cloud Winix demande de ralentir. L'intégration attend une minute et réessaie.",
    de: 'Die Winix-Cloud bittet darum, langsamer zu machen. Die Integration wartet eine Minute.',
    es: 'La nube de Winix pide ir más despacio. La integración espera un minuto y reintenta.',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les journaux de l'intégration.",
    de: 'Die Initialisierung ist fehlgeschlagen, sieh dir die Protokolle der Integration an.',
    es: 'La inicialización falló, consulte los registros de la integración.',
  },
};

/** Messages of the commands and of the widget (toasts, empty states). */
export const TEXT = {
  offline: {
    en: 'The purifier is offline: the Winix cloud has no news from it.',
    fr: "Le purificateur est hors ligne : le cloud Winix n'a pas de nouvelles de lui.",
    de: 'Der Luftreiniger ist offline: Die Winix-Cloud hat keine Nachricht von ihm.',
    es: 'El purificador está desconectado: la nube de Winix no tiene noticias de él.',
  },
  unknownDevice: {
    en: 'This purifier is no longer in the Winix account. Run a new scan in the Discovery tab.',
    fr: "Ce purificateur n'est plus dans le compte Winix. Relancez une recherche dans l'onglet Découverte.",
    de: 'Dieser Luftreiniger ist nicht mehr im Winix-Konto. Starte eine neue Suche im Tab Entdecken.',
    es: 'Este purificador ya no está en la cuenta Winix. Inicie una nueva búsqueda en la pestaña Descubrir.',
  },
  notReady: {
    en: 'The Winix account is not connected yet: see the Configuration tab.',
    fr: "Le compte Winix n'est pas encore connecté : voir l'onglet Configuration.",
    de: 'Das Winix-Konto ist noch nicht verbunden: Sieh im Tab Konfiguration nach.',
    es: 'La cuenta Winix aún no está conectada: vea la pestaña Configuración.',
  },
  pickPurifier: {
    en: 'Choose a purifier in the settings of this widget.',
    fr: 'Choisissez un purificateur dans les réglages de ce widget.',
    de: 'Wähle einen Luftreiniger in den Einstellungen dieses Widgets.',
    es: 'Elija un purificador en los ajustes de este widget.',
  },
  noValueYet: {
    en: 'No reading yet: the first one arrives within a few minutes.',
    fr: "Pas encore de relevé : le premier arrive d'ici quelques minutes.",
    de: 'Noch kein Messwert: Der erste kommt in wenigen Minuten.',
    es: 'Aún no hay lectura: la primera llega en unos minutos.',
  },
  done: {
    en: 'Sent to the purifier.',
    fr: 'Envoyé au purificateur.',
    de: 'An den Luftreiniger gesendet.',
    es: 'Enviado al purificador.',
  },
  // Widget rows and buttons (short).
  rowMode: { en: 'Mode', fr: 'Mode', de: 'Modus', es: 'Modo' },
  rowAir: { en: 'Air', fr: 'Air', de: 'Luft', es: 'Aire' },
  rowFilter: { en: 'Filter', fr: 'Filtre', de: 'Filter', es: 'Filtro' },
  rowState: { en: 'State', fr: 'État', de: 'Zustand', es: 'Estado' },
  stateOff: { en: 'Off', fr: 'Éteint', de: 'Aus', es: 'Apagado' },
  stateOffline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Desconectado' },
  buttonOn: { en: 'Turn on', fr: 'Allumer', de: 'Einschalten', es: 'Encender' },
  buttonOff: { en: 'Turn off', fr: 'Éteindre', de: 'Ausschalten', es: 'Apagar' },
};

/** The configured language, or the default one. */
export function languageOf(config) {
  return LANGUAGES.includes(config?.language) ? config.language : DEFAULT_CONFIG.language;
}

/** "62 % · 4018 h", the filter row of the widget. */
export function filterSummary(remaining) {
  return `${remaining.percent} % · ${remaining.hours} h`;
}
