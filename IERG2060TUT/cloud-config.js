// One Apps Script project serves every tutorial group. Public endpoints are not
// credentials; the backend checks each Google account against its Groups tab.
export const endpoints = {
  admin: 'https://script.google.com/macros/s/AKfycbyWUeRnFWmGtNjzJnQbAvq1Aenkkrq1XnQKEPUzEDC3Uj-JlUS4WYevB57QjwthFRzSAQ/exec',
  student: 'https://script.google.com/macros/s/AKfycbzTTYuA_0RGLi2b0KTP7Rg0r2lm1pkuKicHtb7YPocQlFv4u_yLns9T3CGWY6x7jZ6sIQ/exec',
  // The isolated 35-student test deployment (Tutorial 3 only).
  test: 'https://script.google.com/macros/s/AKfycbwdI48LCEanTS_nbN2UjqPy49uGlxRQ8sHYFgb7Q15eor0LXVs-gyFEgz1RklSAlmVJjw/exec'
};
// OAuth Web client ID for "Sign in with Google" (public). Empty keeps the
// original owner-only sign-in window.
export const googleClientId = '';

// Groups offered on the start page. The backend's Groups tab decides who may
// open each one.
export const groupChoices = [
  {id: 't1', label: 'Tutorial 1'},
  {id: 't2', label: 'Tutorial 2'},
  {id: 't3', label: 'Tutorial 3'},
  {id: 't4', label: 'Tutorial 4'}
];

const params = new URLSearchParams(location.search);
const requested = params.get('group');
export const groupId = requested && /^[a-z0-9]{1,16}$/.test(requested) ? requested : 't3';
// Only this fixed query flag chooses the isolated Google test dataset.
export const testMode = params.get('mode') === 'test' && groupId === 't3';
// Without ?group= the instructor page shows the group picker first.
export const groupChosen = requested !== null || testMode;
export const cloudDefaults = {admin: endpoints.admin, student: testMode ? endpoints.test : endpoints.student};
// Tutorial 3 keeps its original browser keys; other groups get their own.
export const browserStateKey = key => `${groupId === 't3' ? '' : `ierg2060-${groupId}:`}${testMode ? 'ierg2060-test:' : ''}${key}`;
// Query string that keeps the same group and mode on linked pages.
export function pageQuery(group = groupId) {
  const query = new URLSearchParams();
  if (!testMode) query.set('group', group);
  if (testMode) query.set('mode', 'test');
  return query;
}
