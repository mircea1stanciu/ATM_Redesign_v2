function fn() {
  var env = karate.env || 'local';
  var config = { env: env, baseUrl: 'https://jsonplaceholder.typicode.com' };
  // Add per-environment overrides here, e.g. if (env == 'test') config.baseUrl = '...';
  karate.configure('connectTimeout', 10000);
  karate.configure('readTimeout', 20000);
  return config;
}
