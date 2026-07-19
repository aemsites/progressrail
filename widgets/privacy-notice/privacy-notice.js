import { loadScript } from '../../scripts/aem.js';

const OT_NOTICE_SCRIPT = 'https://privacyportal-cdn.onetrust.com/privacy-notice-scripts/otnotice-1.0.min.js';
const OT_NOTICE_SETTINGS = 'eyJjYWxsYmFja1VybCI6Imh0dHBzOi8vcHJpdmFjeXBvcnRhbC5vbmV0cnVzdC5jb20vcmVxdWVzdC92MS9wcml2YWN5Tm90aWNlcy9zdGF0cy92aWV3cyIsImNvbnRlbnRBcGlVcmwiOiJodHRwczovL3ByaXZhY3lwb3J0YWwub25ldHJ1c3QuY29tL3JlcXVlc3QvdjEvZW50ZXJwcmlzZXBvbGljeS9kaWdpdGFscG9saWN5L2NvbnRlbnQiLCJtZXRhZGF0YUFwaVVybCI6Imh0dHBzOi8vcHJpdmFjeXBvcnRhbC5vbmV0cnVzdC5jb20vcmVxdWVzdC92MS9lbnRlcnByaXNlcG9saWN5L2RpZ2l0YWxwb2xpY3kvbWV0YS1kYXRhIn0=';
const OT_NOTICE_URL = 'https://privacyportal-cdn.onetrust.com/storage-container/dacb864b-cd78-48d1-a68b-5f1d05fe1473/privacy-notices/7f61a611-db7f-40a6-877f-fa0ae844b1bf/published/privacynotice.json';

/**
 * Loads the OneTrust privacy notice into the widget container.
 * @param {HTMLElement} widget - Widget container element
 */
export default async function decorate(widget) {
  if (widget.dataset.privacyNoticeInitialized === 'true') return;
  widget.dataset.privacyNoticeInitialized = 'true';

  await loadScript(OT_NOTICE_SCRIPT, {
    id: 'otprivacy-notice-script',
    charset: 'UTF-8',
    type: 'text/javascript',
    settings: OT_NOTICE_SETTINGS,
  });

  await window.OneTrust.NoticeApi.Initialized;
  window.OneTrust.NoticeApi.LoadNotices([OT_NOTICE_URL]);
}
