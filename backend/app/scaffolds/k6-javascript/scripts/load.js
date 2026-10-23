import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://jsonplaceholder.typicode.com';

// Load test: ramp up to 10 virtual users. Point BASE_URL at your own system before increasing load.
export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 10 },
    { duration: '15s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/posts`);
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}
