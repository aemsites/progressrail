import { loadScript } from './aem.js';

const OT_DOMAIN_SCRIPT = '0bce5055-3ba9-41df-8539-fb806717230d';
const OT_TEST_COOKIE_DOMAINS = [
  '.cat.com',
  '.caterpillar.com',
  '.fgwilson.com',
  '.mak-catmarine.com',
  '.perkins.com',
  '.progressrail.com',
  '.solarturbines.com',
  '.spmoilandgas.com',
  '.tangentenergy.com',
  '.pecktech.com',
  '.anchorcoupling.com',
  '.anchorfluidsystems.com',
  '.catrentalstore.com',
  '.catdealer.com',
];

let consentedLoaded = false;

/**
 * Clears OneTrust cookies on test domains so the banner can be re-tested.
 */
function clearTestConsentCookies() {
  ['OptanonConsent', 'OptanonAlertBoxClosed'].forEach((name) => {
    OT_TEST_COOKIE_DOMAINS.forEach((domain) => {
      document.cookie = `${name}=;domain=${domain};path=/;expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    });
  });
}

/**
 * Returns true once the user has closed the OneTrust banner.
 * @returns {boolean}
 */
function hasConsent() {
  return document.cookie.split(';').some((cookie) => cookie.trim().startsWith('OptanonAlertBoxClosed='));
}

/**
 * Loads consented scripts once consent is available.
 */
function loadConsented() {
  if (consentedLoaded) return;
  consentedLoaded = true;
  import('./consented.js');
}

/**
 * Handles OneTrust consent updates.
 * @param {string[]} groups Active OneTrust group IDs
 */
function onConsentUpdate(groups) {
  window.dispatchEvent(new CustomEvent('consent.onetrust', { detail: groups }));

  if (hasConsent()) {
    loadConsented();
  }
}

/**
 * Loads OneTrust and waits for consent before loading consented scripts.
 */
async function initOneTrust() {
  if (OT_DOMAIN_SCRIPT.includes('-test')) {
    clearTestConsentCookies();
  }

  window.OptanonWrapper = () => {
    const groups = (window.OnetrustActiveGroups || '')
      .split(',')
      .filter(Boolean);
    onConsentUpdate(groups);
  };

  window.addEventListener('OneTrustGroupsUpdated', (event) => {
    onConsentUpdate(event.detail || []);
  });

  await loadScript('https://cdn.cookielaw.org/scripttemplates/otSDKStub.js', {
    id: 'otDomainScript',
    charset: 'UTF-8',
    'data-domain-script': OT_DOMAIN_SCRIPT,
  });
}

const initPromise = initOneTrust();

/**
 * Opens the OneTrust cookie preference center.
 */
export default async function openCookieSettings() {
  await initPromise;
  window.OneTrust?.ToggleInfoDisplay?.();
}
