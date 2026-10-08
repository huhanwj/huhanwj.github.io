// Public endpoint addresses. Google checks the administrator's account server-side.
export const liveCloudDefaults = {
  admin: 'https://script.google.com/macros/s/AKfycbyWUeRnFWmGtNjzJnQbAvq1Aenkkrq1XnQKEPUzEDC3Uj-JlUS4WYevB57QjwthFRzSAQ/exec',
  student: 'https://script.google.com/macros/s/AKfycbzTTYuA_0RGLi2b0KTP7Rg0r2lm1pkuKicHtb7YPocQlFv4u_yLns9T3CGWY6x7jZ6sIQ/exec'
};

// Only this fixed query flag chooses the isolated Google test dataset.
export const testMode = new URLSearchParams(location.search).get('mode') === 'test';
export const testStudent = 'https://script.google.com/macros/s/AKfycbwdI48LCEanTS_nbN2UjqPy49uGlxRQ8sHYFgb7Q15eor0LXVs-gyFEgz1RklSAlmVJjw/exec';
export const cloudDefaults = {admin: liveCloudDefaults.admin, student: testMode ? testStudent : liveCloudDefaults.student};
export const browserStateKey = key => testMode ? `ierg2060-test:${key}` : key;
