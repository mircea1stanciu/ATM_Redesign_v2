import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://jsonplaceholder.typicode.com';

// Smoke test: one virtual user, a few iterations, strict thresholds.
export const options = {
  vus: 1,
  iterations: 3,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
    checks: ['rate==1.0'],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/posts/1`);
  check(res, {
    'status is 200': (r) => r.status === 200,
    'returns post 1': (r) => r.json('id') === 1,
  });
  sleep(1);
}
