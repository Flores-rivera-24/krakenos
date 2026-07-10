import type { TranslationKey } from './es';

/**
 * Catálogo de traducciones en inglés (US-177). Tipado como
 * `Record<TranslationKey, string>`: si falta una clave que existe en `es.ts`, el
 * typecheck falla (paridad garantizada). Una clave sobrante también es un error.
 */
export const en: Record<TranslationKey, string> = {
  // --- Navigation ---
  'nav.connect': 'Connect',
  'nav.dashboard': 'Dashboard',
  'nav.devices': 'Devices',
  'nav.wifi': 'WiFi',
  'nav.coverage': 'WiFi coverage',
  'nav.traffic': 'Traffic',
  'nav.rooms': 'Rooms',
  'nav.scenes': 'Scenes',
  'nav.automations': 'Automations',
  'nav.iot': 'IoT',
  'nav.cameras': 'Cameras',
  'nav.vpn': 'VPN',
  'nav.firewall': 'Firewall',
  'nav.vlans': 'VLANs',
  'nav.qos': 'QoS',
  'nav.dns': 'DNS',
  'nav.settings': 'Settings',
  'nav.group.general': 'General',
  'nav.group.network': 'Network',
  'nav.group.home': 'Home',
  'nav.group.advanced': 'Advanced network',
  'nav.group.system': 'System',

  // --- Boot / generic ---
  'app.booting': 'Starting KrakenOS…',
  'common.close': 'Close',
  'common.logout': 'Log out',

  // --- Shell / layout ---
  'layout.expandMenu': 'Expand menu',
  'layout.collapseMenu': 'Collapse menu',
  'layout.moreSections': 'More sections',
  'layout.more': 'More',
  'layout.homeConnected': 'Home connected',
  'layout.noRouterConnection': 'No connection to the router',
  'layout.driver': 'Driver',
  'layout.uptime': 'Uptime',

  // --- Errors ---
  'errors.network': 'Could not reach the server. Check your connection.',
  'errors.code.AUTH_INVALID_CREDENTIALS': 'Incorrect credentials.',
  'errors.code.RATE_LIMITED': 'Too many attempts. Wait a moment and try again.',
  'errors.code.VALIDATION': 'Check the details and try again.',

  // --- Setup / wizard ---
  'setup.welcome': 'Welcome to KrakenOS',
  'setup.subtitle': 'Set up your administrator to get started.',
  'setup.defaultHomeName': 'My home',
  'setup.homeName': 'Home name',
  'setup.displayName': 'Your name',
  'setup.email': 'Email',
  'setup.password': 'Password',
  'setup.confirm': 'Confirm password',
  'setup.token': 'Setup token',
  'setup.tokenHint': 'The agent printed it in its log at startup (look for “Setup token”).',
  'setup.submit': 'Create administrator',
  'setup.submitting': 'Setting up…',
  'setup.error.mismatch': 'The passwords do not match.',
  'setup.error.short': 'The password must be at least 8 characters.',
  'setup.error.generic': 'Could not complete setup',

  // --- Login ---
  'login.verifying': 'Verifying…',
  'login.health.online': 'System online',
  'login.health.offline': 'Offline',
  'login.welcome': 'Welcome back',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.showPassword': 'Show password',
  'login.hidePassword': 'Hide password',
  'login.keepSignedIn': 'Keep me signed in',
  'login.submit': 'Sign in',
  'login.submitting': 'Signing in…',
  'login.error.credentials': 'Incorrect email or password.',
  'login.error.connection': 'Could not reach the server. Try again.',
  'login.lastAccess': 'Last access',
  'login.tagline': 'Local access · No cloud · No third parties',
  'login.mfa.title': 'Verify your identity with your device',
  'login.mfa.cancelled': 'Verification cancelled. Try again.',
  'login.mfa.error': 'Could not verify the passkey. Try again.',
  'login.mfa.usePasskey': 'Use passkey',
  'login.mfa.retry': 'Retry',
  'login.backup.label': 'Recovery code',
  'login.backup.verify': 'Verify code',
  'login.backup.invalid': 'Invalid or already used code.',
  'login.backup.prompt': 'Lost your device? Use a recovery code',

  // --- Settings → Account: interface mode ---
  'settings.uiMode.title': 'App mode',
  'settings.uiMode.simple': 'Simple',
  'settings.uiMode.simpleDesc':
    'Just the essentials: devices, home, WiFi and cameras. No technical jargon.',
  'settings.uiMode.advanced': 'Advanced',
  'settings.uiMode.advancedDesc': 'Everything, including the advanced network (VPN, firewall, VLANs, QoS, DNS).',
  'settings.uiMode.simpleOn': 'Simple mode enabled',
  'settings.uiMode.advancedOn': 'Advanced mode enabled',
  'settings.uiMode.error': 'Could not change the mode',

  // --- Settings → Account: language ---
  'settings.language.title': 'Language',
  'settings.language.es': 'Español',
  'settings.language.en': 'English',
  'settings.language.esDesc': 'La interfaz en español.',
  'settings.language.enDesc': 'The interface in English.',
  'settings.language.changed': 'Language changed',
  'settings.language.error': 'Could not change the language',

  // --- Dashboard ---
  'dashboard.title': 'Dashboard',
  'dashboard.realtime': 'Real time · connected',
  'dashboard.disconnected': 'Disconnected',
  'dashboard.customize': 'Customize',
  'dashboard.done': 'Done',
  'dashboard.moveUp': 'Move {title} up',
  'dashboard.moveDown': 'Move {title} down',
  'dashboard.show': 'Show {title}',
  'dashboard.hide': 'Hide {title}',

  // --- WiFi network ---
  'wifi.title': 'WiFi network',
  'wifi.subtitle.admin': 'Manage your main and guest networks.',
  'wifi.subtitle.readonly': 'Read only — admin role required to edit.',
  'wifi.loadError': 'Could not load the WiFi configuration',
  'wifi.empty.title': 'No WiFi configuration available yet.',
  'wifi.empty.desc':
    'The WiFi configuration appears once your router is connected to KrakenOS. Connect it to manage your network name, password and guest network from here.',
  'wifi.empty.cta': 'Connect your router',
};
